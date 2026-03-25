// Re-export Blob/File from buffer (which provides the polyfill on GJS)
// Reference: Node.js buffer.Blob (available since v18)
import { Blob, File } from 'node:buffer';

export {
    Blob,
    File,
}
