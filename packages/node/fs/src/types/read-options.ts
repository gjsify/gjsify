import type { Abortable } from 'node:events';
import type { ObjectEncodingOptions, OpenMode } from 'node:fs'; // Types from @types/node

export type ReadOptions = 
| (ObjectEncodingOptions & Abortable & {
    flag?: OpenMode | undefined;
}) 
| BufferEncoding
| null