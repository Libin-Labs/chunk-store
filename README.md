# @lp-labs/chunk-store

Transactional content-addressed byte chunks with verified reads, manifests and garbage collection.

Original independent MIT TypeScript implementation with **zero runtime/peer dependencies**. ESM and CommonJS with separate declarations, Node 18+ (browser use when adapters/APIs are available). Development dependencies are not consumer runtime dependencies.

## Install

```sh
npm install @lp-labs/chunk-store
```

## Complete example

```js
import assert from 'node:assert/strict';
import { createChunkStore, ChunkCollisionError } from '@lp-labs/chunk-store';
const chunks = new Map(),
  manifests = new Map();
const tx = {
  getChunk: (id) => chunks.get(id),
  putChunk(id, bytes) {
    chunks.set(id, bytes.slice());
  },
  deleteChunk: (id) => chunks.delete(id),
  listChunkDigests: () => [...chunks.keys()],
  getManifest: (id) => manifests.get(id),
  putManifest(m) {
    manifests.set(m.id, m);
  },
  deleteManifest: (id) => manifests.delete(id),
  listManifests: () => [...manifests.values()],
};
const store = createChunkStore(
  {
    async transaction(action) {
      return await action(tx);
    },
  },
  (bytes) => [...bytes].join('-'),
);
const ref = await store.putChunk(Uint8Array.of(1, 2));
await store.writeManifest('file', [ref]);
assert.deepEqual([...(await store.getChunk(ref.digest))], [1, 2]);
assert.equal((await store.collectGarbage()).deleted.length, 0);
await store.deleteManifest('file');
assert.equal((await store.collectGarbage()).deleted.length, 1);
```

CommonJS exposes the same API: `const api = require('@lp-labs/chunk-store')`.

## Scope, customization and performance

Inject a stable cryptographic digest; toy join in example is for demonstration. Every transaction must be serialized, atomic and rollback on failure; example is sequential in-memory only. GC requires the SAME transaction isolation as manifest writes to avoid deleting newly referenced chunks. put detects collisions; get recomputes digest. Max chunk16MiB, manifest10,000 references; total backend/list sizes bounded by adapter. Repeated references count manifest bytes repeatedly, but GC uses digest set. No automatic persistence, chunking or refs database. Adapter must validate stored manifests and enforce total quotas.

Configure explicit limits, clocks, policies and adapters through the API below. Error classes and standard TypeError/RangeError reject malformed input; adapter/handler errors propagate. Await asynchronous methods and handle rejection in your application; no success-shaped fallback on failed work. Inputs must be trusted ordinary data, not hostile proxies; adapters must meet documented atomicity, isolation and ownership contracts. This package never publishes data, loads external code or starts background services at import time.

## API reference

The complete exported TypeScript contract (including option defaults discussed above, method return shapes, and error codes) is included below. TypeScript users import interfaces using `import type`; JavaScript users pass matching ordinary objects. Signature optionals indicate intentionally optional fields, not silent recovery.

```ts
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
  collectGarbage(): Promise<
    Readonly<{
      referenced: number;
      deleted: readonly string[];
    }>
  >;
}
export declare class ChunkCollisionError extends Error {
  readonly digest: string;
  constructor(digest: string);
}
export declare function createChunkStore(
  adapter: ChunkStoreAdapter,
  digestBytes: ChunkDigest,
): ChunkStore;
```

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
