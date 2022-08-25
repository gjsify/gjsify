import type { ReadPosition } from './index.js';

export interface ReadSyncOptions {
    /**
     * @default 0
     */
    offset?: number | undefined;
    /**
     * @default `length of buffer`
     */
    length?: number | undefined;
    /**
     * @default null
     */
    position?: ReadPosition | null | undefined;
}