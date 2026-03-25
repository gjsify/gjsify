import type { Mode, OpenMode } from 'node:fs';

export interface FlagAndOpenMode {
    mode?: Mode | undefined;
    flag?: OpenMode | undefined;
}