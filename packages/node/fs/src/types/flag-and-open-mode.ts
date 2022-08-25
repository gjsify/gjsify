import type { Mode, OpenMode } from './index.js';

export interface FlagAndOpenMode {
    mode?: Mode | undefined;
    flag?: OpenMode | undefined;
}