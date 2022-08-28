import type { Abortable, OpenMode } from './index.js';
import type { ObjectEncodingOptions } from 'fs'; // Types from @types/node

export type ReadOptions = 
| (ObjectEncodingOptions & Abortable & {
    flag?: OpenMode | undefined;
}) 
| BufferEncoding
| null