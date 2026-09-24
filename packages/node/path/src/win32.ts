// SPDX-License-Identifier: MIT
// Adapted from Deno (refs/deno/ext/node/polyfills/path/_win32.ts) and Node.js (refs/node/lib/path.js)
// Copyright (c) 2018-2026 the Deno authors. MIT license.
// Copyright (c) Node.js contributors. MIT license.
// Modifications: TypeScript port; `index.ts` selects this flavour on a win32 host.

import { CHAR_DOT, CHAR_BACKWARD_SLASH, CHAR_COLON, CHAR_QUESTION_MARK } from './constants.js';
import {
    assertPath,
    isPathSeparator,
    isPosixPathSeparator,
    isWindowsDeviceRoot,
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

export const sep = '\\';
export const delimiter = ';';

/**
 * The directory a relative path resolves against — `process.cwd()`, which is where Node reads
 * it too, and `/` off a host that has no `process` (a bare browser bundle).
 */
function cwd(): string {
    return typeof globalThis.process?.cwd === 'function' ? globalThis.process.cwd() : '/';
}

export function resolve(...pathSegments: string[]): string {
    let resolvedDevice = '';
    let resolvedTail = '';
    let resolvedAbsolute = false;

    for (let i = pathSegments.length - 1; i >= -1; i--) {
        let path: string;
        if (i >= 0) {
            path = pathSegments[i];
            assertPath(path);
            if (path.length === 0) continue;
        } else if (resolvedDevice.length === 0) {
            path = cwd();
        } else {
            // A drive-RELATIVE path (`D:foo`) resolves against THAT drive's current directory,
            // which Windows keeps in the hidden `=D:` variable — not against the process cwd,
            // which may be on another drive. With neither available it is the drive's root:
            // `D:foo` with the cwd on `C:` is `D:\foo`, never `D:foo` (the answer this gave
            // before, a relative path that `pathToFileURL` then glued onto the cwd).
            path = globalThis.process?.env?.[`=${resolvedDevice}`] || cwd();
            if (
                path.slice(0, 2).toLowerCase() !== resolvedDevice.toLowerCase() &&
                path.charCodeAt(2) === CHAR_BACKWARD_SLASH
            ) {
                path = `${resolvedDevice}\\`;
            }
        }

        const len = path.length;
        let rootEnd = 0;
        let device = '';
        let isAbsolutePath = false;
        const code = path.charCodeAt(0);

        if (len === 1) {
            if (isPathSeparator(code)) {
                rootEnd = 1;
                isAbsolutePath = true;
            }
        } else if (isPathSeparator(code)) {
            isAbsolutePath = true;
            if (isPathSeparator(path.charCodeAt(1))) {
                const unc = matchUncRoot(path);
                if (unc) {
                    device = unc.device;
                    rootEnd = unc.rootEnd;
                }
            } else {
                rootEnd = 1;
            }
        } else if (isWindowsDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
            device = path.slice(0, 2);
            rootEnd = 2;
            if (len > 2 && isPathSeparator(path.charCodeAt(2))) {
                isAbsolutePath = true;
                rootEnd = 3;
            }
        }

        if (device.length > 0) {
            if (resolvedDevice.length > 0) {
                if (device.toLowerCase() !== resolvedDevice.toLowerCase()) continue;
            } else {
                resolvedDevice = device;
            }
        }

        if (resolvedAbsolute) {
            if (resolvedDevice.length > 0) break;
        } else {
            resolvedTail = `${path.slice(rootEnd)}\\${resolvedTail}`;
            resolvedAbsolute = isAbsolutePath;
            if (isAbsolutePath && resolvedDevice.length > 0) break;
        }
    }

    resolvedTail = normalizeString(resolvedTail, !resolvedAbsolute, '\\', isPathSeparator);

    return resolvedAbsolute ? `${resolvedDevice}\\${resolvedTail}` : `${resolvedDevice}${resolvedTail}` || '.';
}

/**
 * The root of a path that opens with two separators: a UNC share (`\\server\share`) or a
 * device namespace (`\\.\PHYSICALDRIVE0`, `\\?\C:`). The second is NOT a share — `.` and
 * `?` are not server names — so its root is the four-character prefix alone, and what
 * follows is an ordinary segment. Read as a share it gained a trailing separator Node does
 * not produce (`\\.\PHYSICALDRIVE0\`).
 */
function matchUncRoot(path: string): { device: string; rootEnd: number; shareOnly: boolean } | undefined {
    const len = path.length;
    let j = 2;
    let last = j;
    while (j < len && !isPathSeparator(path.charCodeAt(j))) j++;
    if (j >= len || j === last) return undefined;
    const firstPart = path.slice(last, j);
    last = j;
    while (j < len && isPathSeparator(path.charCodeAt(j))) j++;
    if (j >= len || j === last) return undefined;
    last = j;
    while (j < len && !isPathSeparator(path.charCodeAt(j))) j++;
    if (firstPart === '.' || firstPart === '?') {
        return { device: `\\\\${firstPart}`, rootEnd: 4, shareOnly: false };
    }
    return { device: `\\\\${firstPart}\\${path.slice(last, j)}`, rootEnd: j, shareOnly: j === len };
}

export function normalize(path: string): string {
    assertPath(path);
    const len = path.length;
    if (len === 0) return '.';
    const code = path.charCodeAt(0);
    if (len === 1) return isPosixPathSeparator(code) ? '\\' : path;

    let rootEnd = 0;
    let device: string | undefined;
    let isAbsolutePath = false;

    if (isPathSeparator(code)) {
        isAbsolutePath = true;
        if (isPathSeparator(path.charCodeAt(1))) {
            const unc = matchUncRoot(path);
            if (unc?.shareOnly) return `${unc.device}\\`;
            if (unc) {
                device = unc.device;
                rootEnd = unc.rootEnd;
                if (device.length === 3) {
                    // `\\?\COM1:` names the device itself, so the device name is root too.
                    const possibleDevice = path.slice(4, path.indexOf(':') + 1);
                    if (isWindowsReservedName(possibleDevice, possibleDevice.length - 1)) {
                        device = `\\\\?\\${possibleDevice}`;
                        rootEnd = 4 + possibleDevice.length;
                    }
                }
            }
        } else {
            rootEnd = 1;
        }
    } else {
        const colonIndex = path.indexOf(':');
        if (colonIndex > 0) {
            if (isWindowsDeviceRoot(code) && colonIndex === 1) {
                device = path.slice(0, 2);
                rootEnd = 2;
                if (len > 2 && isPathSeparator(path.charCodeAt(2))) {
                    isAbsolutePath = true;
                    rootEnd = 3;
                }
            } else if (isWindowsReservedName(path, colonIndex)) {
                device = path.slice(0, colonIndex + 1);
                rootEnd = colonIndex + 1;
            }
        }
    }

    let tail = rootEnd < len ? normalizeString(path.slice(rootEnd), !isAbsolutePath, '\\', isPathSeparator) : '';
    if (tail.length === 0 && !isAbsolutePath) tail = '.';
    if (tail.length > 0 && isPathSeparator(path.charCodeAt(len - 1))) tail += '\\';

    // CVE-2024-36139: collapsing `..` must not turn a relative path into one Windows reads as
    // drive-qualified — `foo\..\C:bar` normalised to `C:bar` names another drive's cwd.
    // Node prefixes `.\` whenever the result could be read that way, and `join()` inherits it.
    if (!isAbsolutePath && device === undefined && path.includes(':')) {
        if (tail.length >= 2 && isWindowsDeviceRoot(tail.charCodeAt(0)) && tail.charCodeAt(1) === CHAR_COLON) {
            return `.\\${tail}`;
        }
        let index = path.indexOf(':');
        do {
            if (index === len - 1 || isPathSeparator(path.charCodeAt(index + 1))) return `.\\${tail}`;
        } while ((index = path.indexOf(':', index + 1)) !== -1);
    }
    if (isWindowsReservedName(path, path.indexOf(':'))) return `.\\${device ?? ''}${tail}`;
    if (device === undefined) return isAbsolutePath ? `\\${tail}` : tail;
    return isAbsolutePath ? `${device}\\${tail}` : `${device}${tail}`;
}

/** DOS device names, which Windows resolves to the device in any directory (`C:\\x\\NUL`). */
const WINDOWS_RESERVED_NAMES = new Set([
    'CON',
    'PRN',
    'AUX',
    'NUL',
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '\xb9', '\xb2', '\xb3'].flatMap((n) => [`COM${n}`, `LPT${n}`]),
]);

function isWindowsReservedName(path: string, colonIndex: number): boolean {
    return WINDOWS_RESERVED_NAMES.has(path.slice(0, colonIndex).toUpperCase());
}

export function isAbsolute(path: string): boolean {
    assertPath(path);
    const len = path.length;
    if (len === 0) return false;
    const code = path.charCodeAt(0);
    if (isPathSeparator(code)) return true;
    if (isWindowsDeviceRoot(code) && len > 2 && path.charCodeAt(1) === CHAR_COLON) {
        if (isPathSeparator(path.charCodeAt(2))) return true;
    }
    return false;
}

export function join(...paths: string[]): string {
    if (paths.length === 0) return '.';

    let joined: string | undefined;
    let firstPart: string | undefined;
    for (let i = 0; i < paths.length; ++i) {
        const arg = paths[i];
        assertPath(arg);
        if (arg.length > 0) {
            if (joined === undefined) {
                joined = firstPart = arg;
            } else {
                joined += `\\${arg}`;
            }
        }
    }
    if (joined === undefined) return '.';

    let needsReplace = true;
    let slashCount = 0;
    if (isPathSeparator(firstPart!.charCodeAt(0))) {
        ++slashCount;
        const firstLen = firstPart!.length;
        if (firstLen > 1) {
            if (isPathSeparator(firstPart!.charCodeAt(1))) {
                ++slashCount;
                if (firstLen > 2) {
                    if (isPathSeparator(firstPart!.charCodeAt(2))) ++slashCount;
                    else needsReplace = false;
                }
            }
        }
    }
    if (needsReplace) {
        for (; slashCount < joined.length; ++slashCount) {
            if (!isPathSeparator(joined.charCodeAt(slashCount))) break;
        }
        if (slashCount >= 2) joined = `\\${joined.slice(slashCount)}`;
    }

    // A reserved device name in any segment (`COM1:`) is returned un-normalised, as Node does:
    // normalising around it could fold the device into a path segment.
    const hasReservedSegment = joined.split(/\\+/).some((part) => {
        const colonIndex = part.indexOf(':');
        return colonIndex !== -1 && isWindowsReservedName(part, colonIndex);
    });
    if (hasReservedSegment) return joined.replace(/\//g, '\\');

    return normalize(joined);
}

export function relative(from: string, to: string): string {
    assertPath(from);
    assertPath(to);

    if (from === to) return '';

    const fromOrig = resolve(from);
    const toOrig = resolve(to);
    if (fromOrig === toOrig) return '';

    from = fromOrig.toLowerCase();
    to = toOrig.toLowerCase();
    if (from === to) return '';

    let fromStart = 0;
    for (; fromStart < from.length; ++fromStart) {
        if (from.charCodeAt(fromStart) !== CHAR_BACKWARD_SLASH) break;
    }
    let fromEnd = from.length;
    for (; fromEnd - 1 > fromStart; --fromEnd) {
        if (from.charCodeAt(fromEnd - 1) !== CHAR_BACKWARD_SLASH) break;
    }
    const fromLen = fromEnd - fromStart;

    let toStart = 0;
    for (; toStart < to.length; ++toStart) {
        if (to.charCodeAt(toStart) !== CHAR_BACKWARD_SLASH) break;
    }
    let toEnd = to.length;
    for (; toEnd - 1 > toStart; --toEnd) {
        if (to.charCodeAt(toEnd - 1) !== CHAR_BACKWARD_SLASH) break;
    }
    const toLen = toEnd - toStart;

    const length = fromLen < toLen ? fromLen : toLen;
    let lastCommonSep = -1;
    let i = 0;

    for (; i <= length; ++i) {
        if (i === length) {
            if (toLen > length) {
                if (to.charCodeAt(toStart + i) === CHAR_BACKWARD_SLASH) {
                    return toOrig.slice(toStart + i + 1);
                } else if (i === 2) {
                    return toOrig.slice(toStart + i);
                }
            }
            if (fromLen > length) {
                if (from.charCodeAt(fromStart + i) === CHAR_BACKWARD_SLASH) {
                    lastCommonSep = i;
                } else if (i === 2) {
                    lastCommonSep = 3;
                }
            }
            break;
        }
        const fromCode = from.charCodeAt(fromStart + i);
        const toCode = to.charCodeAt(toStart + i);
        if (fromCode !== toCode) break;
        if (fromCode === CHAR_BACKWARD_SLASH) lastCommonSep = i;
    }

    if (i !== length && lastCommonSep === -1) {
        return toOrig;
    }

    let out = '';
    if (lastCommonSep === -1) lastCommonSep = 0;
    for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
        if (i === fromEnd || from.charCodeAt(i) === CHAR_BACKWARD_SLASH) {
            if (out.length === 0) out += '..';
            else out += '\\..';
        }
    }

    if (out.length > 0) {
        return out + toOrig.slice(toStart + lastCommonSep, toEnd);
    }

    toStart += lastCommonSep;
    if (toOrig.charCodeAt(toStart) === CHAR_BACKWARD_SLASH) ++toStart;
    return toOrig.slice(toStart, toEnd);
}

export function toNamespacedPath(path: string): string {
    if (typeof path !== 'string' || path.length === 0) return path;

    const resolvedPath = resolve(path);
    if (resolvedPath.length <= 2) return path;

    if (resolvedPath.charCodeAt(0) === CHAR_BACKWARD_SLASH) {
        if (resolvedPath.charCodeAt(1) === CHAR_BACKWARD_SLASH) {
            const code = resolvedPath.charCodeAt(2);
            if (code !== CHAR_QUESTION_MARK && code !== CHAR_DOT) {
                return `\\\\?\\UNC\\${resolvedPath.slice(2)}`;
            }
        }
    } else if (
        isWindowsDeviceRoot(resolvedPath.charCodeAt(0)) &&
        resolvedPath.charCodeAt(1) === CHAR_COLON &&
        resolvedPath.charCodeAt(2) === CHAR_BACKWARD_SLASH
    ) {
        return `\\\\?\\${resolvedPath}`;
    }

    // A path that is not drive- or UNC-rooted has no long form, but it IS resolved: Node
    // returns the absolute path here, never the input.
    return resolvedPath;
}

export function dirname(path: string): string {
    assertPath(path);
    const len = path.length;
    if (len === 0) return '.';

    let rootEnd = -1;
    let end = -1;
    let matchedSlash = true;
    let offset = 0;
    const code = path.charCodeAt(0);

    if (len > 1) {
        if (isPathSeparator(code)) {
            rootEnd = offset = 1;
            if (isPathSeparator(path.charCodeAt(1))) {
                let j = 2;
                let last = j;
                for (; j < len; ++j) {
                    if (isPathSeparator(path.charCodeAt(j))) break;
                }
                if (j < len && j !== last) {
                    last = j;
                    for (; j < len; ++j) {
                        if (!isPathSeparator(path.charCodeAt(j))) break;
                    }
                    if (j < len && j !== last) {
                        last = j;
                        for (; j < len; ++j) {
                            if (isPathSeparator(path.charCodeAt(j))) break;
                        }
                        if (j === len) return path;
                        if (j !== last) rootEnd = offset = j + 1;
                    }
                }
            }
        } else if (isWindowsDeviceRoot(code)) {
            if (path.charCodeAt(1) === CHAR_COLON) {
                rootEnd = offset = 2;
                if (len > 2) {
                    if (isPathSeparator(path.charCodeAt(2))) rootEnd = offset = 3;
                }
            }
        }
    } else if (isPathSeparator(code)) {
        return path;
    }

    for (let i = len - 1; i >= offset; --i) {
        if (isPathSeparator(path.charCodeAt(i))) {
            if (!matchedSlash) {
                end = i;
                break;
            }
        } else {
            matchedSlash = false;
        }
    }

    if (end === -1) {
        if (rootEnd === -1) return '.';
        end = rootEnd;
    }
    return path.slice(0, end);
}

export function basename(path: string, ext?: string): string {
    if (ext !== undefined) assertPath(ext);
    assertPath(path);

    let start = 0;
    let end = -1;
    let matchedSlash = true;

    if (path.length >= 2) {
        if (isWindowsDeviceRoot(path.charCodeAt(0)) && path.charCodeAt(1) === CHAR_COLON) {
            start = 2;
        }
    }

    if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
        if (ext.length === path.length && ext === path) return '';
        let extIdx = ext.length - 1;
        let firstNonSlashEnd = -1;
        for (let i = path.length - 1; i >= start; --i) {
            const code = path.charCodeAt(i);
            if (isPathSeparator(code)) {
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
                        if (--extIdx === -1) end = i;
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
        for (let i = path.length - 1; i >= start; --i) {
            if (isPathSeparator(path.charCodeAt(i))) {
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

    let start = 0;
    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    let preDotState = 0;

    if (path.length >= 2 && path.charCodeAt(1) === CHAR_COLON && isWindowsDeviceRoot(path.charCodeAt(0))) {
        start = startPart = 2;
    }

    for (let i = path.length - 1; i >= start; --i) {
        const code = path.charCodeAt(i);
        if (isPathSeparator(code)) {
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
        return '';
    }
    return path.slice(startDot, end);
}

export function format(pathObject: FormatInputPathObject): string {
    if (pathObject === null || typeof pathObject !== 'object') {
        throw new TypeError('The "pathObject" argument must be of type Object. Received type ' + typeof pathObject);
    }
    return _format('\\', pathObject);
}

export function parse(path: string): ParsedPath {
    assertPath(path);

    const ret: ParsedPath = { root: '', dir: '', base: '', ext: '', name: '' };
    if (path.length === 0) return ret;

    const len = path.length;
    let rootEnd = 0;
    let code = path.charCodeAt(0);

    if (len > 1) {
        if (isPathSeparator(code)) {
            rootEnd = 1;
            if (isPathSeparator(path.charCodeAt(1))) {
                let j = 2;
                let last = j;
                for (; j < len; ++j) {
                    if (isPathSeparator(path.charCodeAt(j))) break;
                }
                if (j < len && j !== last) {
                    last = j;
                    for (; j < len; ++j) {
                        if (!isPathSeparator(path.charCodeAt(j))) break;
                    }
                    if (j < len && j !== last) {
                        last = j;
                        for (; j < len; ++j) {
                            if (isPathSeparator(path.charCodeAt(j))) break;
                        }
                        if (j === len) rootEnd = j;
                        else if (j !== last) rootEnd = j + 1;
                    }
                }
            }
        } else if (isWindowsDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
            rootEnd = 2;
            if (len > 2 && isPathSeparator(path.charCodeAt(2))) {
                rootEnd = 3;
            }
        }
    } else if (isPathSeparator(code)) {
        ret.root = ret.dir = path;
        return ret;
    }

    if (rootEnd > 0) ret.root = path.slice(0, rootEnd);

    let startDot = -1;
    let startPart = rootEnd;
    let end = -1;
    let matchedSlash = true;
    let i = path.length - 1;
    let preDotState = 0;

    for (; i >= rootEnd; --i) {
        code = path.charCodeAt(i);
        if (isPathSeparator(code)) {
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
            ret.base = ret.name = path.slice(startPart, end);
        }
    } else {
        ret.name = path.slice(startPart, startDot);
        ret.base = path.slice(startPart, end);
        ret.ext = path.slice(startDot, end);
    }

    if (startPart > 0 && startPart !== rootEnd) {
        ret.dir = path.slice(0, startPart - 1);
    } else {
        ret.dir = ret.root;
    }

    return ret;
}
