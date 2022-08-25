import type { Abortable, OpenMode, ObjectEncodingOptions } from './index.js';

export type ReadOptions = 
| (ObjectEncodingOptions & Abortable & {
    flag?: OpenMode | undefined;
}) 
| BufferEncoding
| null