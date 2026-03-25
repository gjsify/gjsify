// Reference: Node.js lib/internal/errors.js — filesystem error helpers
// Reimplemented for GJS using Gio error codes

import type { PathLike } from 'fs';
import { createNodeError as createNodeErrorGeneric, isNotFoundError } from '@gjsify/utils';

export { isNotFoundError };

/**
 * Create a Node.js-style ErrnoException from a Gio error, with fs-specific path/dest fields.
 */
export function createNodeError(err: any, syscall: string, path: PathLike, dest?: PathLike): NodeJS.ErrnoException {
  const pathStr = path.toString();
  const error = createNodeErrorGeneric(err, syscall, {
    path: pathStr,
    dest: dest?.toString(),
  });
  return error;
}
