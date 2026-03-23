// SPDX-License-Identifier: MIT
// Adapted from Deno (refs/deno/ext/node/polyfills/path/) and Node.js (refs/node/lib/path.js)
// Copyright (c) 2018-2026 the Deno authors. MIT license.
// Copyright (c) Node.js contributors. MIT license.
// Modifications: TypeScript types, no primordials

import {
  CHAR_DOT,
  CHAR_FORWARD_SLASH,
  CHAR_BACKWARD_SLASH,
} from './constants.js';

export function assertPath(path: unknown): asserts path is string {
  if (typeof path !== 'string') {
    throw new TypeError(
      'The "path" argument must be of type string. Received type ' + typeof path
    );
  }
}

export function isPosixPathSeparator(code: number): boolean {
  return code === CHAR_FORWARD_SLASH;
}

export function isPathSeparator(code: number): boolean {
  return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
}

export function isWindowsDeviceRoot(code: number): boolean {
  return (
    (code >= 65 && code <= 90) ||  // A-Z
    (code >= 97 && code <= 122)    // a-z
  );
}

/**
 * Resolves `.` and `..` segments in a path string.
 */
export function normalizeString(
  path: string,
  allowAboveRoot: boolean,
  separator: string,
  isPathSep: (code: number) => boolean
): string {
  let res = '';
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code: number;

  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) {
      code = path.charCodeAt(i);
    } else if (isPathSep(code!)) {
      break;
    } else {
      code = CHAR_FORWARD_SLASH;
    }

    if (isPathSep(code)) {
      if (lastSlash === i - 1 || dots === 1) {
        // NOOP — skip consecutive separators or single dot
      } else if (lastSlash !== i - 1 && dots === 2) {
        if (
          res.length < 2 ||
          lastSegmentLength !== 2 ||
          res.charCodeAt(res.length - 1) !== CHAR_DOT ||
          res.charCodeAt(res.length - 2) !== CHAR_DOT
        ) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf(separator);
            if (lastSlashIndex === -1) {
              res = '';
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - res.lastIndexOf(separator);
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length === 2 || res.length === 1) {
            res = '';
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          if (res.length > 0) {
            res += `${separator}..`;
          } else {
            res = '..';
          }
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) {
          res += separator + path.slice(lastSlash + 1, i);
        } else {
          res = path.slice(lastSlash + 1, i);
        }
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === CHAR_DOT && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }

  return res;
}

/**
 * Format a parsed path object into a path string.
 */
export function _format(sep: string, pathObject: Record<string, any>): string {
  if (pathObject === null || typeof pathObject !== 'object') {
    throw new TypeError(
      'The "pathObject" argument must be of type Object. Received type ' + typeof pathObject
    );
  }

  const dir = pathObject.dir || pathObject.root;
  const base =
    pathObject.base || (pathObject.name || '') + formatExt(pathObject.ext);

  if (!dir) {
    return base;
  }

  if (dir === pathObject.root) {
    return dir + base;
  }

  return dir + sep + base;
}

function formatExt(ext?: string): string {
  return ext ? `${ext[0] === '.' ? '' : '.'}${ext}` : '';
}
