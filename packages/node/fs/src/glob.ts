// Reference: Node.js lib/internal/fs/glob.js
// Reimplemented for GJS using readdirSync (recursive) + pattern matching

import { readdirSync } from './sync.js';
import { normalizePath } from './utils.js';
import type { PathLike } from 'node:fs';

export interface GlobOptions {
  cwd?: string | URL;
  exclude?: string | string[] | ((path: string) => boolean);
  withFileTypes?: boolean;
}

// ─── Pattern → RegExp conversion ─────────────────────────────────────────────

/** Convert a single glob segment (no `/`) to a regex source string */
function segmentToRegexSrc(seg: string): string {
  // Handle extglob: !(pattern), *(pattern), +(pattern), ?(pattern), @(pattern)
  const extglob = /^([!*+?@])\((.+)\)$/.exec(seg);
  if (extglob) {
    const [, type, inner] = extglob;
    const parts = inner.split('|').map(p => segmentToRegexSrc(p));
    const group = '(?:' + parts.join('|') + ')';
    switch (type) {
      case '!': return '(?!(?:' + parts.join('|') + '))[^/]*';
      case '*': return group + '*';
      case '+': return group + '+';
      case '?': return group + '?';
      case '@': return group;
    }
  }

  let result = '';
  let i = 0;
  while (i < seg.length) {
    const c = seg[i];
    if (c === '*') { result += '[^/]*'; i++; continue; }
    if (c === '?') { result += '[^/]'; i++; continue; }
    if (c === '[') {
      // Character class — pass through to regex
      const end = seg.indexOf(']', i + 1);
      if (end === -1) { result += '\\['; i++; continue; }
      result += seg.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (c === '{') {
      // Alternation
      const end = seg.indexOf('}', i + 1);
      if (end === -1) { result += '\\{'; i++; continue; }
      const alts = seg.slice(i + 1, end).split(',').map(a => segmentToRegexSrc(a.trim()));
      result += '(?:' + alts.join('|') + ')';
      i = end + 1;
      continue;
    }
    // Escape regex special chars
    if ('.+^$|()[]{}'.includes(c)) {
      result += '\\' + c;
    } else {
      result += c;
    }
    i++;
  }
  return result;
}

/**
 * Convert a glob pattern to a RegExp that matches relative POSIX paths.
 */
function globToRegex(pattern: string): RegExp {
  // Normalize: collapse multiple slashes, remove leading './'
  pattern = pattern.replace(/\/+/g, '/').replace(/^\.\//, '');

  const segments = pattern.split('/');
  const parts: string[] = [];

  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const isLast = si === segments.length - 1;

    if (seg === '**') {
      if (isLast) {
        if (parts.length > 0 && parts[parts.length - 1] === '/') {
          // Remove the trailing '/' so "a/" becomes optional: "a(?:/.*)?
          parts.pop();
          parts.push('(?:/.+)?');
        } else {
          // '**' at root level: match '.' or anything
          parts.push('(?:.+)?');
        }
      } else {
        // Not last: match zero or more path segments with trailing slash
        parts.push('(?:[^/]+/)*');
      }
    } else {
      parts.push(segmentToRegexSrc(seg));
      if (!isLast) parts.push('/');
    }
  }

  return new RegExp('^(?:' + parts.join('') + ')$');
}

// ─── Exclude logic ────────────────────────────────────────────────────────────

function buildExcludePredicate(exclude: GlobOptions['exclude']): ((path: string) => boolean) | null {
  if (!exclude) return null;
  if (typeof exclude === 'function') return exclude;
  const patterns = Array.isArray(exclude) ? exclude : [exclude];
  const regexes = patterns.map(p => globToRegex(p));
  return (path: string) => regexes.some(rx => rx.test(path));
}

// ─── Walk + match ─────────────────────────────────────────────────────────────

function matchAll(pattern: string, cwd: string, exclude: GlobOptions['exclude']): string[] {
  const regex = globToRegex(pattern);
  const isExcluded = buildExcludePredicate(exclude);

  // Get all entries recursively (files + directories)
  let allEntries: string[];
  try {
    allEntries = readdirSync(cwd, { recursive: true }) as string[];
  } catch {
    return [];
  }

  // Include '.' itself for patterns like '**' that match the root
  const candidates = ['.', ...allEntries];

  const results: string[] = [];
  for (const entry of candidates) {
    // Normalize separators for matching
    const normalized = entry.replace(/\\/g, '/');
    if (!regex.test(normalized)) continue;
    if (isExcluded && isExcluded(normalized)) continue;
    results.push(entry);
  }

  return results;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function globSync(
  pattern: string | string[],
  options?: GlobOptions,
): string[] {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  const cwd = options?.cwd
    ? normalizePath(options.cwd as PathLike)
    : (globalThis as any).process?.cwd?.() ?? '/';
  const exclude = options?.exclude;

  const seen = new Set<string>();
  const results: string[] = [];

  for (const p of patterns) {
    for (const match of matchAll(p, cwd, exclude)) {
      if (!seen.has(match)) {
        seen.add(match);
        results.push(match);
      }
    }
  }

  return results;
}

export function glob(
  pattern: string | string[],
  options: GlobOptions | ((err: NodeJS.ErrnoException | null, matches: string[]) => void),
  callback?: (err: NodeJS.ErrnoException | null, matches: string[]) => void,
): void {
  let opts: GlobOptions;
  let cb: (err: NodeJS.ErrnoException | null, matches: string[]) => void;

  if (typeof options === 'function') {
    cb = options;
    opts = {};
  } else {
    cb = callback!;
    opts = options || {};
  }

  Promise.resolve().then(() => {
    try {
      const matches = globSync(pattern, opts);
      cb(null, matches);
    } catch (err: unknown) {
      cb(err as NodeJS.ErrnoException, []);
    }
  });
}

// promises.glob returns an async iterator
export async function* globAsync(
  pattern: string | string[],
  options?: GlobOptions,
): AsyncIterableIterator<string> {
  const matches = globSync(pattern, options);
  for (const m of matches) {
    yield m;
  }
}
