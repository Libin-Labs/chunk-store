import test from 'node:test';
import assert from 'node:assert/strict';
import { createChunkStore, ChunkCollisionError } from '../dist/esm/index.js';

test('documented workflow produces required outputs', async () => {
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
});
function chunkHarness(digest = (b) => [...b].join(',')) {
  const chunks = new Map(),
    ms = new Map();
  const tx = {
    getChunk: (k) => chunks.get(k),
    putChunk(k, b) {
      chunks.set(k, b.slice());
    },
    deleteChunk: (k) => chunks.delete(k),
    listChunkDigests: () => [...chunks.keys()],
    getManifest: (k) => ms.get(k),
    putManifest: (m) => ms.set(m.id, m),
    deleteManifest: (k) => ms.delete(k),
    listManifests: () => [...ms.values()],
  };
  return {
    chunks,
    store: createChunkStore(
      {
        async transaction(f) {
          return f(tx);
        },
      },
      digest,
    ),
  };
}
test('digest collision is explicit', async () => {
  const { store } = chunkHarness(() => 'same');
  await store.putChunk(Uint8Array.of(1));
  await assert.rejects(store.putChunk(Uint8Array.of(2)), ChunkCollisionError);
});
test('read detects backend corruption', async () => {
  const { store, chunks } = chunkHarness();
  const r = await store.putChunk(Uint8Array.of(1));
  chunks.set(r.digest, Uint8Array.of(2));
  await assert.rejects(store.getChunk(r.digest), ChunkCollisionError);
});
test('missing manifest chunks reject', async () => {
  const { store } = chunkHarness();
  await assert.rejects(store.writeManifest('x', [{ digest: 'missing', size: 1 }]));
});
test('input and output buffers are detached', async () => {
  const { store } = chunkHarness();
  const b = Uint8Array.of(1);
  const r = await store.putChunk(b);
  b[0] = 9;
  const read = await store.getChunk(r.digest);
  read[0] = 8;
  assert.deepEqual([...(await store.getChunk(r.digest))], [1]);
});
