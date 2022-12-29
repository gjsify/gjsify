import type { Mode, OpenMode } from 'fs';

export interface FlagAndOpenMode {
    mode?: Mode | undefined;
    flag?: OpenMode | undefined;
}