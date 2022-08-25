import type { OpenFlags } from './index.js';

export interface CreateWriteStreamOptions {
    encoding?: BufferEncoding | null | undefined;
    autoClose?: boolean | undefined;
    emitClose?: boolean | undefined;
    start?: number | undefined;
    flags?: OpenFlags;
    fs?: any; // TODO
    mode?: number;
}