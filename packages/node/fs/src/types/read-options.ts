import type { Abortable } from 'events';
import type { ObjectEncodingOptions, OpenMode } from 'fs'; // Types from @types/node

export type ReadOptions = 
| (ObjectEncodingOptions & Abortable & {
    flag?: OpenMode | undefined;
}) 
| BufferEncoding
| null