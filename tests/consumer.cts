import { createChunkStore, ChunkCollisionError } from '@lp-labs/chunk-store';
const publicAPI = [createChunkStore, ChunkCollisionError];
const apiCount: number = publicAPI.length;
void apiCount;
const error = new ChunkCollisionError('digest');
const digest: string = error.digest;
const put: Parameters<typeof createChunkStore>[1] = (bytes) => String(bytes.length);
void digest;
void put;
