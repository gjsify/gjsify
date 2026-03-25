// Reference: Node.js lib/path.js
// Reimplemented for GJS
// Exports POSIX implementation by default (GJS runs on POSIX systems)

import * as posix from './posix.js';
import * as win32 from './win32.js';

export type { ParsedPath, FormatInputPathObject } from './posix.js';

// Re-export all POSIX functions as default path API
export const {
  resolve,
  normalize,
  isAbsolute,
  join,
  relative,
  toNamespacedPath,
  dirname,
  basename,
  extname,
  format,
  parse,
  sep,
  delimiter,
} = posix;

// Export platform-specific implementations
export { posix, win32 };

// Default export is the posix module (matching Node.js behavior on POSIX systems)
export default {
  resolve: posix.resolve,
  normalize: posix.normalize,
  isAbsolute: posix.isAbsolute,
  join: posix.join,
  relative: posix.relative,
  toNamespacedPath: posix.toNamespacedPath,
  dirname: posix.dirname,
  basename: posix.basename,
  extname: posix.extname,
  format: posix.format,
  parse: posix.parse,
  sep: posix.sep,
  delimiter: posix.delimiter,
  posix,
  win32,
};
