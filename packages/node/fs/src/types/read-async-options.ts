import type { ReadSyncOptions } from './index.js';

export interface ReadAsyncOptions<TBuffer extends NodeJS.ArrayBufferView> extends ReadSyncOptions {
    buffer?: TBuffer;
}