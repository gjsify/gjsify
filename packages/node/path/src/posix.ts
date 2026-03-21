// POSIX path implementation for GJS
// Reference: Node.js lib/path.js, Deno ext/node/polyfills/path/_posix.ts

import { CHAR_DOT, CHAR_FORWARD_SLASH } from './constants.js';
import {
  assertPath,
  isPosixPathSeparator,
  normalizeString,
  _format,
} from './util.js';

export interface ParsedPath {
  root: string;
  dir: string;
  base: string;
  ext: string;
  name: string;
}

export type FormatInputPathObject = Partial<ParsedPath>;

export const sep = '/';
export const delimiter = ':';

function posixCwd(): string {
  // In GJS, try GLib.get_current_dir() at runtime
  if (typeof globalThis.process?.cwd === 'function') {
    return globalThis.process.cwd();
  }
  // Fallback: try GLib
  try {
    const GLib = (globalThis as any).imports?.gi?.GLib;
    if (GLib?.get_current_dir) {
      return GLib.get_current_dir();
    }
  } catch {
    // ignore
  }
  return '/';
}

export function resolve(...pathSegments: string[]): string {
  let resolvedPath = '';
  let resolvedAbsolute = false;

  for (let i = pathSegments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    let path: string;
    if (i >= 0) {
      path = pathSegments[i];
      assertPath(path);
      if (path.length === 0) continue;
    } else {
      path = posixCwd();
    }

    resolvedPath = `${path}/${resolvedPath}`;
    resolvedAbsolute = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
  }

  resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute, '/', isPosixPathSeparator);

  if (resolvedAbsolute) {
    if (resolvedPath.length > 0) {
      return `/${resolvedPath}`;
    }
    return '/';
  } else if (resolvedPath.length > 0) {
    return resolvedPath;
  }
  return '.';
}

export function normalize(path: string): string {
  assertPath(path);

  if (path.length === 0) return '.';

  const isAbsolutePath = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
  const trailingSeparator = path.charCodeAt(path.length - 1) === CHAR_FORWARD_SLASH;

  let normalized = normalizeString(path, !isAbsolutePath, '/', isPosixPathSeparator);

  if (normalized.length === 0 && !isAbsolutePath) {
    normalized = '.';
  }
  if (normalized.length > 0 && trailingSeparator) {
    normalized += '/';
  }

  if (isAbsolutePath) {
    return `/${normalized}`;
  }
  return normalized;
}

export function isAbsolute(path: string): boolean {
  assertPath(path);
  return path.length > 0 && path.charCodeAt(0) === CHAR_FORWARD_SLASH;
}

export function join(...paths: string[]): string {
  if (paths.length === 0) return '.';

  let joined: string | undefined;
  for (let i = 0; i < paths.length; ++i) {
    const arg = paths[i];
    assertPath(arg);
    if (arg.length > 0) {
      if (joined === undefined) {
        joined = arg;
      } else {
        joined += `/${arg}`;
      }
    }
  }
  if (joined === undefined) return '.';
  return normalize(joined);
}

export function relative(from: string, to: string): string {
  assertPath(from);
  assertPath(to);

  if (from === to) return '';

  from = resolve(from);
  to = resolve(to);

  if (from === to) return '';

  // Find common prefix
  let fromStart = 1;
  const fromEnd = from.length;
  const fromLen = fromEnd - fromStart;

  let toStart = 1;
  const toLen = to.length - toStart;

  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;

  for (; i <= length; ++i) {
    if (i === length) {
      if (toLen > length) {
        if (to.charCodeAt(toStart + i) === CHAR_FORWARD_SLASH) {
          return to.slice(toStart + i + 1);
        } else if (i === 0) {
          return to.slice(toStart + i);
        }
      } else if (fromLen > length) {
        if (from.charCodeAt(fromStart + i) === CHAR_FORWARD_SLASH) {
          lastCommonSep = i;
        } else if (i === 0) {
          lastCommonSep = 0;
        }
      }
      break;
    }
    const fromCode = from.charCodeAt(fromStart + i);
    const toCode = to.charCodeAt(toStart + i);
    if (fromCode !== toCode) break;
    if (fromCode === CHAR_FORWARD_SLASH) lastCommonSep = i;
  }

  let out = '';
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === CHAR_FORWARD_SLASH) {
      if (out.length === 0) {
        out += '..';
      } else {
        out += '/..';
      }
    }
  }

  if (out.length > 0) {
    return out + to.slice(toStart + lastCommonSep);
  }

  toStart += lastCommonSep;
  if (to.charCodeAt(toStart) === CHAR_FORWARD_SLASH) {
    ++toStart;
  }
  return to.slice(toStart);
}

export function toNamespacedPath(path: string): string {
  // On POSIX, this is a no-op
  return path;
}

export function dirname(path: string): string {
  assertPath(path);
  if (path.length === 0) return '.';

  const hasRoot = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
  let end = -1;
  let matchedSlash = true;

  for (let i = path.length - 1; i >= 1; --i) {
    if (path.charCodeAt(i) === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }

  if (end === -1) return hasRoot ? '/' : '.';
  if (hasRoot && end === 1) return '//';
  return path.slice(0, end);
}

export function basename(path: string, ext?: string): string {
  if (ext !== undefined) assertPath(ext);
  assertPath(path);

  let start = 0;
  let end = -1;
  let matchedSlash = true;

  if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
    if (ext.length === path.length && ext === path) return '';
    let extIdx = ext.length - 1;
    let firstNonSlashEnd = -1;
    for (let i = path.length - 1; i >= 0; --i) {
      const code = path.charCodeAt(i);
      if (code === CHAR_FORWARD_SLASH) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (firstNonSlashEnd === -1) {
          matchedSlash = false;
          firstNonSlashEnd = i + 1;
        }
        if (extIdx >= 0) {
          if (code === ext.charCodeAt(extIdx)) {
            if (--extIdx === -1) {
              end = i;
            }
          } else {
            extIdx = -1;
            end = firstNonSlashEnd;
          }
        }
      }
    }

    if (start === end) end = firstNonSlashEnd;
    else if (end === -1) end = path.length;
    return path.slice(start, end);
  } else {
    for (let i = path.length - 1; i >= 0; --i) {
      if (path.charCodeAt(i) === CHAR_FORWARD_SLASH) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else if (end === -1) {
        matchedSlash = false;
        end = i + 1;
      }
    }

    if (end === -1) return '';
    return path.slice(start, end);
  }
}

export function extname(path: string): string {
  assertPath(path);

  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;

  for (let i = path.length - 1; i >= 0; --i) {
    const code = path.charCodeAt(i);
    if (code === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === CHAR_DOT) {
      if (startDot === -1) {
        startDot = i;
      } else if (preDotState !== 1) {
        preDotState = 1;
      }
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }

  if (
    startDot === -1 ||
    end === -1 ||
    preDotState === 0 ||
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    return '';
  }
  return path.slice(startDot, end);
}

export function format(pathObject: FormatInputPathObject): string {
  if (pathObject === null || typeof pathObject !== 'object') {
    throw new TypeError(
      'The "pathObject" argument must be of type Object. Received type ' + typeof pathObject
    );
  }
  return _format('/', pathObject);
}

export function parse(path: string): ParsedPath {
  assertPath(path);

  const ret: ParsedPath = { root: '', dir: '', base: '', ext: '', name: '' };
  if (path.length === 0) return ret;

  const isAbsolutePath = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
  let start: number;

  if (isAbsolutePath) {
    ret.root = '/';
    start = 1;
  } else {
    start = 0;
  }

  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let i = path.length - 1;
  let preDotState = 0;

  for (; i >= start; --i) {
    const code = path.charCodeAt(i);
    if (code === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === CHAR_DOT) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }

  if (
    startDot === -1 ||
    end === -1 ||
    preDotState === 0 ||
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    if (end !== -1) {
      if (startPart === 0 && isAbsolutePath) {
        ret.base = ret.name = path.slice(1, end);
      } else {
        ret.base = ret.name = path.slice(startPart, end);
      }
    }
  } else {
    if (startPart === 0 && isAbsolutePath) {
      ret.name = path.slice(1, startDot);
      ret.base = path.slice(1, end);
    } else {
      ret.name = path.slice(startPart, startDot);
      ret.base = path.slice(startPart, end);
    }
    ret.ext = path.slice(startDot, end);
  }

  if (startPart > 0) {
    ret.dir = path.slice(0, startPart - 1);
  } else if (isAbsolutePath) {
    ret.dir = '/';
  }

  return ret;
}
