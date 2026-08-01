// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by memfs
// (streamich + contributors, Apache-2.0).
//
// In-memory only. No persistence (OPFS bridge is a future iteration).
// No file watching (FSWatcher is a stub). No real permission/owner enforcement.
//
// Minimal POSIX path utilities. We deliberately inline these rather than
// depending on `@gjsify/path` so the browser bundle stays self-contained
// even when consumed without the full `@gjsify/*` workspace alias map.

/** Normalise a POSIX path: collapse repeated slashes, resolve `.` / `..`. */
export function normalize(p: string): string {
    if (typeof p !== 'string') throw new TypeError('path must be a string');
    if (p.length === 0) return '.';
    const isAbsolute = p.charCodeAt(0) === 47; // '/'
    const trailing = p.charCodeAt(p.length - 1) === 47;
    const parts = p.split('/');
    const out: string[] = [];
    for (const part of parts) {
        if (part === '' || part === '.') continue;
        if (part === '..') {
            if (out.length && out[out.length - 1] !== '..') out.pop();
            else if (!isAbsolute) out.push('..');
            continue;
        }
        out.push(part);
    }
    let joined = out.join('/');
    if (trailing && !joined.endsWith('/')) joined += '/';
    if (isAbsolute) return '/' + joined;
    return joined || '.';
}

/** Resolve into an absolute path. */
export function resolve(...segments: string[]): string {
    let resolved = '';
    let isAbsolute = false;
    for (let i = segments.length - 1; i >= 0 && !isAbsolute; i--) {
        const s = segments[i];
        if (typeof s !== 'string') throw new TypeError('path segment must be a string');
        if (!s) continue;
        resolved = s + '/' + resolved;
        if (s.charCodeAt(0) === 47) isAbsolute = true;
    }
    if (!isAbsolute) resolved = '/' + resolved;
    return normalize(resolved).replace(/\/$/, '') || '/';
}

export function dirname(p: string): string {
    if (p.length === 0) return '.';
    const isAbsolute = p.charCodeAt(0) === 47;
    let end = -1;
    let matchedSlash = true;
    for (let i = p.length - 1; i >= 1; i--) {
        if (p.charCodeAt(i) === 47) {
            if (!matchedSlash) {
                end = i;
                break;
            }
        } else {
            matchedSlash = false;
        }
    }
    if (end === -1) return isAbsolute ? '/' : '.';
    if (isAbsolute && end === 0) return '/';
    return p.slice(0, end);
}

export function basename(p: string, ext?: string): string {
    if (p.length === 0) return '';
    let start = 0;
    let end = -1;
    let matchedSlash = true;
    for (let i = p.length - 1; i >= 0; i--) {
        if (p.charCodeAt(i) === 47) {
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
    let base = p.slice(start, end);
    if (ext && base.endsWith(ext) && base !== ext) base = base.slice(0, -ext.length);
    return base;
}

/** Coerce a Node `PathLike` (string | Buffer | URL) to a POSIX path string. */
export function toPath(p: unknown): string {
    if (typeof p === 'string') return p;
    if (p instanceof URL) {
        if (p.protocol !== 'file:') throw new TypeError(`unsupported URL scheme: ${p.protocol}`);
        return decodeURIComponent(p.pathname);
    }
    if (p && typeof (p as { toString: () => string }).toString === 'function')
        return (p as { toString: () => string }).toString();
    throw new TypeError('path must be a string, Buffer, or URL');
}

/** Split a POSIX path into its components (no leading empty for absolutes). */
export function split(p: string): string[] {
    const n = normalize(p);
    if (n === '/') return [];
    const start = n.charCodeAt(0) === 47 ? 1 : 0;
    return n.slice(start).split('/').filter(Boolean);
}
