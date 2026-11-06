export interface ChunkDigest {
  (bytes: Uint8Array): string | PromiseLike<string>;
}

export interface ChunkReference {
  readonly digest: string;
  readonly size: number;
}

export interface ChunkManifest {
  readonly id: string;
  readonly chunks: readonly ChunkReference[];
  readonly size: number;
}

export interface ChunkTransaction {
  getChunk(digest: string): Uint8Array | undefined | PromiseLike<Uint8Array | undefined>;
  putChunk(digest: string, bytes: Uint8Array): void | PromiseLike<void>;
  deleteChunk(digest: string): boolean | PromiseLike<boolean>;
  listChunkDigests(): readonly string[] | PromiseLike<readonly string[]>;
  getManifest(id: string): ChunkManifest | undefined | PromiseLike<ChunkManifest | undefined>;
  putManifest(manifest: ChunkManifest): void | PromiseLike<void>;
  deleteManifest(id: string): boolean | PromiseLike<boolean>;
  listManifests(): readonly ChunkManifest[] | PromiseLike<readonly ChunkManifest[]>;
}

export interface ChunkStoreAdapter {
  transaction<T>(operation: (transaction: ChunkTransaction) => T | PromiseLike<T>): Promise<T>;
}

export interface ChunkStore {
  putChunk(bytes: Uint8Array): Promise<ChunkReference>;
  getChunk(digest: string): Promise<Uint8Array | undefined>;
  writeManifest(id: string, chunks: readonly ChunkReference[]): Promise<ChunkManifest>;
  getManifest(id: string): Promise<ChunkManifest | undefined>;
  deleteManifest(id: string): Promise<boolean>;
  collectGarbage(): Promise<Readonly<{ referenced: number; deleted: readonly string[] }>>;
}

export class ChunkCollisionError extends Error {
  readonly digest: string;

  constructor(digest: string) {
    super(`Digest collision detected for ${digest}.`);
    this.name = 'ChunkCollisionError';
    this.digest = digest;
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Chunk data must be a Uint8Array.');
  return new Uint8Array(bytes);
}

function validateId(id: string, name: string): string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 4096)
    throw new TypeError(`${name} must be a nonempty string of at most 4096 UTF-16 units.`);
  return id;
}

function validateDigest(digest: string): string {
  if (typeof digest !== 'string' || digest.length === 0 || digest.length > 256)
    throw new TypeError('Digest must be a nonempty string of at most 256 UTF-16 units.');
  return digest;
}

function validateReference(reference: ChunkReference): ChunkReference {
  if (!reference || typeof reference !== 'object')
    throw new TypeError('Chunk reference is required.');
  if (!Number.isSafeInteger(reference.size) || reference.size < 0)
    throw new RangeError('Chunk size must be a non-negative safe integer.');
  return Object.freeze({ digest: validateDigest(reference.digest), size: reference.size });
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function snapshotManifest(manifest: ChunkManifest): ChunkManifest {
  return Object.freeze({
    id: manifest.id,
    chunks: Object.freeze(manifest.chunks.map(validateReference)),
    size: manifest.size,
  });
}

export function createChunkStore(adapter: ChunkStoreAdapter, digestBytes: ChunkDigest): ChunkStore {
  if (!adapter || typeof adapter.transaction !== 'function')
    throw new TypeError('A transactional chunk-store adapter is required.');
  if (typeof digestBytes !== 'function')
    throw new TypeError('An injected digest function is required.');

  return Object.freeze({
    async putChunk(input: Uint8Array): Promise<ChunkReference> {
      const bytes = copyBytes(input);
      if (bytes.length > 16777216) throw new RangeError('Chunk exceeds 16 MiB.');
      const digest = validateDigest(await digestBytes(bytes.slice()));
      await adapter.transaction(async (transaction) => {
        const existing = await transaction.getChunk(digest);
        if (existing === undefined) {
          await transaction.putChunk(digest, bytes);
          return;
        }
        if (!(existing instanceof Uint8Array) || !equalBytes(existing, bytes))
          throw new ChunkCollisionError(digest);
      });
      return Object.freeze({ digest, size: bytes.byteLength });
    },

    async getChunk(inputDigest: string): Promise<Uint8Array | undefined> {
      const digest = validateDigest(inputDigest);
      return adapter.transaction(async (transaction) => {
        const bytes = await transaction.getChunk(digest);
        if (bytes === undefined) return undefined;
        const copy = copyBytes(bytes);
        if (validateDigest(await digestBytes(copy.slice())) !== digest)
          throw new ChunkCollisionError(digest);
        return copy;
      });
    },

    async writeManifest(
      inputId: string,
      inputChunks: readonly ChunkReference[],
    ): Promise<ChunkManifest> {
      const id = validateId(inputId, 'Manifest id');
      if (!Array.isArray(inputChunks) || inputChunks.length > 10000)
        throw new TypeError('Manifest chunks must be a bounded array.');
      const chunks = Object.freeze(inputChunks.map(validateReference));
      let size = 0;
      for (const chunk of chunks) {
        size += chunk.size;
        if (!Number.isSafeInteger(size))
          throw new RangeError('Manifest size exceeds safe integer precision.');
      }
      const manifest = Object.freeze({ id, chunks, size });
      await adapter.transaction(async (transaction) => {
        for (const chunk of chunks) {
          const bytes = await transaction.getChunk(chunk.digest);
          if (bytes === undefined || bytes.byteLength !== chunk.size)
            throw new TypeError(
              `Manifest references missing or size-mismatched chunk ${chunk.digest}.`,
            );
        }
        await transaction.putManifest(manifest);
      });
      return snapshotManifest(manifest);
    },

    async getManifest(inputId: string): Promise<ChunkManifest | undefined> {
      const id = validateId(inputId, 'Manifest id');
      return adapter.transaction(async (transaction) => {
        const manifest = await transaction.getManifest(id);
        return manifest === undefined ? undefined : snapshotManifest(manifest);
      });
    },

    async deleteManifest(inputId: string): Promise<boolean> {
      const id = validateId(inputId, 'Manifest id');
      return adapter.transaction((transaction) => transaction.deleteManifest(id));
    },

    async collectGarbage() {
      return adapter.transaction(async (transaction) => {
        const manifests = await transaction.listManifests();
        const referenced = new Set<string>();
        for (const manifest of manifests) {
          for (const chunk of manifest.chunks) referenced.add(chunk.digest);
        }
        const deleted: string[] = [];
        for (const digest of await transaction.listChunkDigests()) {
          if (!referenced.has(digest) && (await transaction.deleteChunk(digest)))
            deleted.push(digest);
        }
        deleted.sort();
        return Object.freeze({ referenced: referenced.size, deleted: Object.freeze(deleted) });
      });
    },
  });
}
