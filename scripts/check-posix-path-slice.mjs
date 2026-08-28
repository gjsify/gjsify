#!/usr/bin/env node
// A filesystem path must not be split on `'/'` alone.
//
// THE INVARIANT
//
// `/` is the separator on POSIX and ONE of two on win32, so `path.lastIndexOf('/')` asks a
// different question per host — and asks it silently, because -1 is a valid answer that
// existing "no separator here" branches already handle. Take the separator from
// `@gjsify/utils/core` (`lastPathSeparatorIndex`, `splitPathComponents`, `pathToFileUrlHref`),
// which decides from the path's SHAPE and can therefore be checked from a Linux runner, or
// from `node:path` where the HOST is the authority (CLI tooling — but see #1146, which is why
// `node:path` is not yet the answer under GJS).
//
// THE INCIDENT (#1143)
//
// `@gjsify/fetch` found the program directory with `programPath.lastIndexOf('/')` under a
// comment asserting the path is "`/`-separated on every runtime this serves". On win32 it is
// `C:\…\dist\main.js`; the index came back -1, the guard written for "no program dir"
// swallowed it, and every root-relative `fetch()` reached the `Request` constructor
// unrewritten — `Invalid URL`, then SIGSEGV on bun and 0xC0000005 on deno. Three more copies
// were live at the same time (`@gjsify/sqlite`'s DB_DIR/DB_NAME split, `@gjsify/fs`'s
// per-component NAME_MAX check, the CLI's gettext basename) and `@gjsify/url`'s
// `pathToFileURL` tested absoluteness with `filepath[0] !== '/'`. CI is Linux-only, where not
// one of them can fail.
//
// WHY A LEDGER AND NOT A BAN
//
// Most `/`-splitting in this tree is correct: a D-Bus object path, a URL pathname, an npm
// specifier and a git path are `/`-separated by their own specifications on every OS. A grep
// cannot tell those from a filesystem path, so the check demands a STATED REASON per file
// rather than forbidding the shape — see `scripts/posix-path-slice-exceptions.mjs`.
//
// Usage: node scripts/check-posix-path-slice.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    CODE_SOURCE_EXTENSIONS,
    sourceExtensionRe,
} from '../packages/infra/manifest-conformance/lib/source-extensions.mjs';
import { POSIX_PATH_SLICE_EXCEPTIONS } from './posix-path-slice-exceptions.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SEARCH_ROOTS = ['packages'];
const SKIP_DIRS = new Set(['node_modules', 'lib', 'dist', '.git', 'refs', 'build', 'out', 'coverage', 'builddir']);

/**
 * A path-ish identifier split on `'/'`. Name-based on purpose: the same detection shape
 * `check-spec-posix-literals.mjs` uses for `const O_FOO = <number>`. `#path` (a private field)
 * and `this.path` both reach the receiver group.
 */
const PATH_SLICE =
    /\b[A-Za-z_$#.]*(?:[Pp]ath|[Dd]ir|[Ff]ile|filename|Filename)[A-Za-z_$]*\s*\.\s*(?:lastIndexOf|indexOf|split)\s*\(\s*['"]\/['"]\s*\)/;

/** `// posix-path-ok: <reason>` — the per-LINE escape hatch, for a file the ledger should not own. */
const OPT_OUT = /\/\/\s*posix-path-ok:\s*\S/;

/**
 * The module that ANSWERS the separator question, and therefore the one place that must take a
 * separator apart by hand. Exempt in the script and not in the ledger: the ledger records
 * "this value is not a filesystem path", which is a different claim from "this file is the
 * implementation of the rule". Without it the check flags its own fix — the same shape as
 * ADR 0015's root-only `headless` walk, which scans entry points rather than `src/**` for
 * exactly this reason.
 */
const OWNS_THE_ANSWER = new Set(['packages/gjs/utils/src/path-shape.ts']);

function* walk(dir) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            yield* walk(full);
        } else if (SOURCE_RE.test(entry.name) && !SPEC_RE.test(entry.name)) {
            yield full;
        }
    }
}

// From the shared vocabulary, not the `m?ts|m?js` pair written here before: that pattern
// matched neither `.tsx` nor `.cts` nor `.cjs`, and all three are tracked under `packages`
// today — 12 `.tsx` type-tests, one `.d.cts`, five `.cjs` — so a `lastIndexOf('/')` in any
// of them was graded by nothing while the check reported on everything around it.
const SOURCE_RE = sourceExtensionRe();
const SPEC_RE = new RegExp(`\\.spec\\.(${CODE_SOURCE_EXTENSIONS.join('|')})$`);

const findings = [];
/** Ledger keys seen slicing something, so a stale entry can be told from a live one. */
const ledgerHits = new Set();

for (const root of SEARCH_ROOTS) {
    const abs = join(ROOT, root);
    try {
        if (!statSync(abs).isDirectory()) continue;
    } catch {
        continue;
    }
    for (const file of walk(abs)) {
        // Ledger keys are written with `/` — this tool has to be right about its own paths too.
        const key = relative(ROOT, file).split(sep).join('/');
        if (OWNS_THE_ANSWER.has(key)) continue;
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
            // A comment may legitimately quote the broken shape to explain it — this file's own
            // header and every fixed call site do. Only code is a claim.
            const code = line.replace(/\/\/.*$/, '');
            if (!PATH_SLICE.test(code)) return;
            if (key in POSIX_PATH_SLICE_EXCEPTIONS) {
                ledgerHits.add(key);
                return;
            }
            if (OPT_OUT.test(line) || OPT_OUT.test(lines[i - 1] ?? '')) return;
            findings.push({
                key,
                line: i + 1,
                text: line.trim(),
            });
        });
    }
}

// The self-retiring half: an entry whose file no longer slices anything has outlived its
// cause, and a ledger nobody prunes is how the next one of these hides.
const stale = Object.keys(POSIX_PATH_SLICE_EXCEPTIONS).filter((key) => !ledgerHits.has(key));

if (findings.length === 0 && stale.length === 0) {
    const count = ledgerHits.size;
    console.log(
        `[check-posix-path-slice] ok — no filesystem path is split on '/' alone ` +
            `(${count} declared ${count === 1 ? 'exception' : 'exceptions'}, all still live).`,
    );
    for (const key of [...ledgerHits].sort()) {
        console.log(`  declared: ${key} — ${POSIX_PATH_SLICE_EXCEPTIONS[key]}`);
    }
    process.exit(0);
}

if (findings.length > 0) {
    console.error(
        `[check-posix-path-slice] ${findings.length} ${findings.length === 1 ? 'site splits' : 'sites split'} ` +
            `a path-ish value on '/' alone:\n`,
    );
    for (const f of findings) {
        console.error(`  ${f.key}:${f.line}`);
        console.error(`    ${f.text}`);
        console.error(
            "    → on win32 this separates on '\\\\'. Use `lastPathSeparatorIndex` / " +
                '`splitPathComponents` from `@gjsify/utils/core` (shape-decided, so a Linux runner ' +
                'can check it), or `node:path` where the host is the authority. If the value is a ' +
                '`/`-separated IDENTIFIER and not a path, add it to ' +
                'scripts/posix-path-slice-exceptions.mjs with a reason saying which kind.\n',
        );
    }
}

if (stale.length > 0) {
    console.error(
        `[check-posix-path-slice] ${stale.length} stale ledger ${stale.length === 1 ? 'entry' : 'entries'}:\n`,
    );
    for (const key of stale) {
        console.error(`  ${key} no longer splits a path-ish value on '/' — delete the entry.\n`);
    }
}

console.error('See the header of this script for the incident behind the rule.');
process.exit(1);
