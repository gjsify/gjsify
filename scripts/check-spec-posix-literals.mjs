#!/usr/bin/env node
// A spec must not spell a POSIX constant as the number Linux happens to use.
//
// THE INVARIANT
//
// `open(2)` flags and libuv errnos are NOT portable numbers. `O_CREAT` is 0o100
// on Linux, 0x200 on darwin and 0x100 on win32; `O_APPEND` is 0o2000 on Linux
// and 0x8 on both others; `EEXIST` is -17 on Linux and -4075 under libuv on
// win32. A test that writes the Linux number asks a DIFFERENT question on every
// other host — and asks it silently, because the literal is still a valid number
// there. So: take the flag from `fs.constants`, and assert the errno's `code`
// (or that a number is present at all), never the number itself.
//
// THE INCIDENT
//
// #1039 ("fd-first redesign") added ~100 rules to `packages/node/fs`'s ledger
// and merged green: `main.yml` is Linux-only, and on Linux the Linux literal
// CANNOT fail. The OS legs run on `main`, so the regression landed before
// anything could see it — 9 failures on darwin, 36 on win32, and `main` was red
// for eight hours.
//
// Most of those needed a non-Linux host to find. Three did not, and they are
// this check:
//
//   const O_CREAT = 64;            // opened the wrong flag set on darwin/win32
//   const O_APPEND = 1024;         // the append rule appended nowhere
//   expect(err?.errno).toBe(-17);  // asserted Linux, not EEXIST
//
// `windows-suites.yml` had already written the class down — "specs that spelled
// a POSIX answer as though it were THE answer, which is exactly the failure mode
// a Linux-only pipeline cannot see". This is the part of that class a Linux-only
// pipeline CAN see, so it is checked here rather than paid for again on `main`.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SEARCH_ROOTS = ['packages', 'tests'];
const SKIP_DIRS = new Set(['node_modules', 'lib', 'dist', '.git', 'refs', 'build', 'out', 'coverage']);

/** A `const O_FOO = 123` binding — the flag spelled as a number. */
const FLAG_LITERAL = /\b(?:const|let|var)\s+(O_[A-Z0-9_]+)\s*=\s*(0[xXoO][0-9a-fA-F]+|\d+)/;

/**
 * `.toBe(-17)` (or toEqual/toStrictEqual) on a line reading the `errno`
 * PROPERTY. Case-sensitive and anchored on the dot on purpose: `constants.
 * Z_ERRNO` is zlib's own -1 on every platform and no business of this check.
 */
const ERRNO_LITERAL = /\.errno\b/;
const ERRNO_ASSERT = /\.(?:toBe|toEqual|toStrictEqual)\(\s*-\d+\s*\)/;

/** `// posix-literal-ok: <reason>` — the declared exception. */
const OPT_OUT = /\/\/\s*posix-literal-ok:/;

function* walk(dir) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            yield* walk(full);
        } else if (/\.spec\.(?:m?ts|m?js)$/.test(entry.name)) {
            yield full;
        }
    }
}

const findings = [];

for (const root of SEARCH_ROOTS) {
    const abs = join(ROOT, root);
    try {
        if (!statSync(abs).isDirectory()) continue;
    } catch {
        continue;
    }
    for (const file of walk(abs)) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
            // The honest exception: an errno WE synthesize is ours on every host,
            // so asserting it is asserting our own contract. It must say so, and
            // the reason is mandatory — the same shape as `osNotes` in ADR 0018.
            // Accepted on the line itself or on the one above it, so the reason
            // survives a formatter that would otherwise wrap it away.
            const marked = [line, lines[i - 1] ?? ''].filter((l) => OPT_OUT.test(l));
            if (marked.length > 0) {
                if (!marked.some((l) => /posix-literal-ok:\s*\S/.test(l))) {
                    findings.push({
                        file,
                        line: i + 1,
                        text: line.trim(),
                        fix: 'a `posix-literal-ok:` marker needs a reason after the colon.',
                    });
                }
                return;
            }
            // A comment may legitimately QUOTE the numbers to explain the trap —
            // this file's own header does. Only code is a claim.
            const code = line.replace(/\/\/.*$/, '');
            const flag = FLAG_LITERAL.exec(code);
            if (flag) {
                findings.push({
                    file,
                    line: i + 1,
                    text: line.trim(),
                    fix: `${flag[1]} is not the same number on every host — read it from \`fs.constants\`.`,
                });
            }
            if (ERRNO_LITERAL.test(code) && ERRNO_ASSERT.test(code)) {
                findings.push({
                    file,
                    line: i + 1,
                    text: line.trim(),
                    fix: 'a libuv errno differs per platform (EEXIST is -17 on Linux, -4075 on win32) — assert the `code`, or that an errno is present.',
                });
            }
        });
    }
}

if (findings.length === 0) {
    console.log('[check-spec-posix-literals] ok — no POSIX constant is spelled as a Linux number in a spec.');
    process.exit(0);
}

console.error(
    `[check-spec-posix-literals] ${findings.length} spec${findings.length > 1 ? 's assert' : ' asserts'} a POSIX constant as the number Linux uses:\n`,
);
for (const f of findings) {
    console.error(`  ${relative(ROOT, f.file)}:${f.line}`);
    console.error(`    ${f.text}`);
    console.error(`    → ${f.fix}\n`);
}
console.error('These pass on Linux and ask a different question on darwin and win32 — see the header of this script.');
process.exit(1);
