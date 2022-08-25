import type { OpenFlags } from './index.js';

export interface WriteStreamOptions {
    flags?: OpenFlags;
    mode?: number;
    fs?: any; // TODO
    encoding?: string;
    highWaterMark?: number;
}