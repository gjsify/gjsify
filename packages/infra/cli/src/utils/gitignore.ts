// Gitignore-syntax matcher, the semantics of the Rust `ignore` crate's
// `Gitignore` that oxfmt (and oxlint) build every ignore layer from:
// `.gitignore`, `.git/info/exclude`, `.prettierignore` and a config's
// `ignorePatterns`. One reader for all of them, so a layer cannot be read
// with different rules than its neighbour.
//
// Rules held (gitignore(5)): `#` comments, `\#`/`\!` escapes, unescaped
// trailing spaces dropped, `!` re-includes, a trailing `/` matches
// directories only, a pattern with a `/` before its end is anchored to the
// file's directory while one without matches a basename at any depth,
// `**/`, `/**/` and `/**`, `*`/`?` never cross `/`, `[...]` classes. The
// LAST matching line of one matcher decides.

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, sep } from 'node:path';

export type IgnoreMatch = 'ignore' | 'whitelist' | null;

interface Rule {
    re: RegExp;
    negate: boolean;
    dirOnly: boolean;
}

export interface GitignoreMatcher {
    /** Directory the patterns are relative to. */
    readonly base: string;
    /** Decide `path` alone; `null` when no line matches or `path` is outside `base`. */
    matched(path: string, isDir: boolean): IgnoreMatch;
    /** Decide `path`, falling back to its parent directories up to `base`. */
    matchedPathOrAnyParents(path: string, isDir: boolean): IgnoreMatch;
}

/** Translate one glob to a regex source; `*`, `?` and classes stay inside a segment. */
export function globToRegexSource(glob: string): string {
    let out = '';
    let i = 0;
    while (i < glob.length) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*' && (i === 0 || glob[i - 1] === '/')) {
            if (i + 2 === glob.length) {
                out += '.*';
                i += 2;
                continue;
            }
            if (glob[i + 2] === '/') {
                out += '(?:.*/)?';
                i += 3;
                continue;
            }
        }
        if (c === '*') {
            out += '[^/]*';
            while (glob[i + 1] === '*') i++;
        } else if (c === '?') {
            out += '[^/]';
        } else if (c === '[') {
            const close = findClassEnd(glob, i);
            if (close === -1) {
                out += '\\[';
            } else {
                let body = glob.slice(i + 1, close);
                let negate = false;
                if (body.startsWith('!') || body.startsWith('^')) {
                    negate = true;
                    body = body.slice(1);
                }
                body = body.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
                out += `[${negate ? '^/' : ''}${body}]`;
                i = close;
            }
        } else if (c === '\\' && i + 1 < glob.length) {
            i++;
            out += escapeRegex(glob[i]);
        } else {
            out += escapeRegex(c);
        }
        i++;
    }
    return out;
}

function findClassEnd(glob: string, open: number): number {
    let j = open + 1;
    if (glob[j] === '!' || glob[j] === '^') j++;
    if (glob[j] === ']') j++;
    for (; j < glob.length; j++) if (glob[j] === ']') return j;
    return -1;
}

function escapeRegex(c: string): string {
    return /[.+^${}()|[\]\\*?]/.test(c) ? `\\${c}` : c;
}

function parseLine(raw: string): Rule | null {
    let line = raw.replace(/\r$/, '');
    // Trailing spaces are dropped unless the last one is backslash-escaped.
    line = line.replace(/(?<!\\)\s+$/, '');
    if (line === '' || line.startsWith('#')) return null;

    let negate = false;
    if (line.startsWith('!')) {
        negate = true;
        line = line.slice(1);
    } else if (line.startsWith('\\!') || line.startsWith('\\#')) {
        line = line.slice(1);
    }

    let dirOnly = false;
    if (line.endsWith('/') && !line.endsWith('\\/')) {
        dirOnly = true;
        line = line.slice(0, -1);
    }
    if (line === '') return null;

    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    const src = globToRegexSource(line);
    const prefix = anchored || line.startsWith('**/') ? '' : '(?:.*/)?';
    return { re: new RegExp(`^${prefix}${src}$`), negate, dirOnly };
}

/** Build a matcher from pattern lines, relative to `base`. */
export function compileGitignore(lines: readonly string[], base: string): GitignoreMatcher {
    const rules: Rule[] = [];
    for (const line of lines) {
        const rule = parseLine(line);
        if (rule) rules.push(rule);
    }

    const relOf = (path: string): string | null => {
        const rel = relative(base, path);
        if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
        return sep === '/' ? rel : rel.split(sep).join('/');
    };

    const decide = (rel: string, isDir: boolean): IgnoreMatch => {
        for (let k = rules.length - 1; k >= 0; k--) {
            const rule = rules[k];
            if (rule.dirOnly && !isDir) continue;
            if (rule.re.test(rel)) return rule.negate ? 'whitelist' : 'ignore';
        }
        return null;
    };

    return {
        base,
        matched(path, isDir) {
            if (rules.length === 0) return null;
            const rel = relOf(path);
            return rel === null ? null : decide(rel, isDir);
        },
        matchedPathOrAnyParents(path, isDir) {
            if (rules.length === 0) return null;
            let rel = relOf(path);
            if (rel === null) return null;
            // The nearest path component any line decides wins — an ignored
            // ancestor directory hides everything under it.
            let dir = isDir;
            for (;;) {
                const m = decide(rel, dir);
                if (m !== null) return m;
                const slash = rel.lastIndexOf('/');
                if (slash === -1) return null;
                rel = rel.slice(0, slash);
                dir = true;
            }
        },
    };
}

/** Read an ignore file; a missing or unreadable file yields `null`. */
export function readGitignoreFile(file: string, base: string = dirname(file)): GitignoreMatcher | null {
    let text: string;
    try {
        text = readFileSync(file, 'utf-8');
    } catch {
        return null;
    }
    return compileGitignore(text.split('\n'), base);
}
