#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Every `gi://` import states the typelib version it wants.
//
// WHAT THIS PROTECTS
//
// `import Gtk from 'gi://Gtk'` asks the loader for whatever `Gtk` it finds first. On a
// machine with one Gtk that is the right one; on a machine with two it is a coin toss
// resolved at load time, and the failure is not an import error — it is a widget that
// behaves differently, or two toolkits in one address space. The repository already
// treats the version as part of the request almost everywhere: at the time this landed,
// 83 `gi://GLib?version=2.0`, 83 `gi://Gio?version=2.0`, 72 `gi://Gtk?version=4.0`. What
// it did not have was anything holding the remaining 52.
//
// THE HONEST SCOPE. For `Gio`, `GObject` and `Pango` exactly one version is installed on
// every machine this runs on, so those unpinned imports were not resolving wrongly — the
// value here is the RULE, stated the same way everywhere, and the machines where it stops
// being true are the ones nobody tests on. The case that is not hypothetical is the one
// the WebKit shim warns about in capitals: `WebKit2-4.1` (GTK3) and `WebKit-6.0` (GTK4)
// are routinely installed side by side, and picking the wrong one loads a second toolkit.
// A rule that only covers the namespace someone has already been bitten by covers the
// wrong set.
//
// WHAT IT DOES NOT CHECK: whether the stated version is the RIGHT one. That is a claim
// about the machine, not about the source, and a gate that asserted it would be
// [[tests-that-measure-the-runner]] — green or red depending on what is installed on the
// runner rather than on what the diff changed.
//
// COMMENTS ARE REMOVED FIRST, by `manifest-conformance/lib/strip-comments.mjs`, which is a
// lexical scanner rather than a pair of regexes. Neither ORDER of two regexes is right: a
// line comment ending in `/*` — `@girs/*`, `packages/*`, `src/*` — pairs with the next `*/`
// below if block comments go first, and a block comment containing a `//` loses its
// terminator if line comments do. Measured against the scanner over the 3642 tracked JS/TS
// sources, block-first hid 7780 code lines in 226 files and line-first 3503 in 104.
//
// FAILURE POLICY: hard, and a scan that finds nothing is itself a failure — a check that
// cannot find what it checks has stopped checking.
//
// Usage: node scripts/check-gi-import-versions.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { stripComments } from '../packages/infra/manifest-conformance/lib/strip-comments.mjs';
import { GI_IMPORT_VERSION_VECTORS } from './gi-import-version-fixtures.mjs';

/**
 * Sources a `gi://` import can appear in, plus the docs that teach the spelling.
 *
 * `.astro`/`.vue`/`.svelte` carry a script block like any other source, and
 * `website/src/components/ShowcaseSlideshow.astro` holds five `gi://` imports the first
 * list did not reach: seed one unpinned there and the check goes red with these
 * extensions and green without.
 */
const SCANNED = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|astro|vue|svelte|md|mdx)$/;

/** Markdown has no `//` comments to confuse, and a doc example teaches the form. */
const MARKDOWN = /\.mdx?$/;

/** The vectors, which are unpinned specifiers on purpose. */
const FIXTURES = 'scripts/gi-import-version-fixtures.mjs';

/**
 * An import statement binding `gi://<Ns>[?query]`, in every spelling that binds one:
 * `import Ns from`, `import { x } from`, a clause wrapped over lines, and a bare
 * side-effect `import 'gi://Ns'`.
 *
 * Anchored at the start of a line, at the backtick that opens a template literal, or at
 * an escaped `\n` inside one, and bounded by the `;` that ends the statement. The two
 * extra arms are not decoration: the GJS programs this repository hands to `gjs -m` — the
 * e2e runners, the node-gi gold-standard probes — are written as template literals, and
 * eight real unpinned imports sat in them while a line-anchored reader called the tree
 * clean. Prose quoting a specifier is still not an import; in a code file the scanner has
 * removed it, and in markdown only the line-anchored arm runs.
 */
const CODE_IMPORT = /(?:^|`|\\n)[ \t]*import\b[^;`]*?(['"])gi:\/\/([A-Za-z0-9_]+)([^'"\n]*)\1/gm;

/**
 * The same, line-anchored, for markdown.
 *
 * Markdown is not comment-stripped and is mostly prose: an ADR quotes
 * `import … from 'gi://Ns'` inline, after a backtick, in the middle of a sentence. Only a
 * line that STARTS with `import` is a code example here.
 */
const MARKDOWN_IMPORT = /^[ \t]*import\b[^;`]*?(['"])gi:\/\/([A-Za-z0-9_]+)([^'"\n]*)\1/gm;

/**
 * `import('gi://<Ns>[?query]')`, the loader's other spelling.
 *
 * Read only in code files, where comments are gone: markdown prose explains dynamic
 * imports in exactly this shape. `@gjsify/gamepad` loads its whole backend through one.
 */
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(['"])gi:\/\/([A-Za-z0-9_]+)([^'"\n]*)\1/g;

/**
 * Whether a specifier's query states a version.
 *
 * A query is not a pin: `gi://Gtk?theme=dark` names no version and the loader still
 * takes whichever typelib it finds first. Only `version=<something>` counts, wherever
 * it sits among the parameters.
 */
const statesVersion = (query) => /(?:^\?|&)version=[^&]+/.test(query);

/** Every `gi://` import in one source, as `{ line, namespace, pinned, text }`. */
export function giImports(source, isMarkdown = false) {
    const code = isMarkdown ? source : stripComments(source);
    const original = source.split('\n');
    const lineAt = (index) => code.slice(0, index).split('\n').length;
    const found = [];
    for (const pattern of isMarkdown ? [MARKDOWN_IMPORT] : [CODE_IMPORT, DYNAMIC_IMPORT]) {
        pattern.lastIndex = 0;
        for (const m of code.matchAll(pattern)) {
            const line = lineAt(m.index + m[0].length);
            found.push({
                line,
                namespace: m[2],
                pinned: statesVersion(m[3]),
                text: (original[line - 1] ?? '').trim(),
            });
        }
    }
    return found.sort((a, b) => a.line - b.line);
}

/** Only the ones that state no version. */
export function unpinnedImports(source, isMarkdown = false) {
    return giImports(source, isMarkdown).filter((found) => !found.pinned);
}

// ------------------------------------------------------------------ the self-test
//
// The vectors live in `gi-import-version-fixtures.mjs`, which the scan below skips —
// see the note there for why a reader of this shape cannot carry them as data.
const selfTestFailures = [];
for (const [source, expected, markdown = false] of GI_IMPORT_VERSION_VECTORS) {
    const got = unpinnedImports(source, markdown).map((f) => f.namespace);
    if (got.join(',') !== expected.join(',')) {
        selfTestFailures.push(`  ${JSON.stringify(source)}\n    expected [${expected}], got [${got}]`);
    }
}
if (selfTestFailures.length > 0) {
    process.stderr.write('check-gi-import-versions: SELF-TEST failed — the check itself is broken:\n');
    for (const failure of selfTestFailures) process.stderr.write(`${failure}\n`);
    process.exit(2);
}

// ------------------------------------------------------------------ the scan

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\0')
    .filter(Boolean)
    .filter((f) => SCANNED.test(f))
    .filter((f) => f !== FIXTURES);

const offenders = [];
let imports = 0;
let scanned = 0;
for (const file of files) {
    let source;
    try {
        source = readFileSync(file, 'utf8');
    } catch {
        continue; // a tracked path that is not readable here (submodule gitlink, symlink)
    }
    if (!source.includes('gi://')) continue;
    scanned++;
    const isMarkdown = MARKDOWN.test(file);
    for (const found of giImports(source, isMarkdown)) {
        imports++;
        if (!found.pinned) offenders.push(`${file}:${found.line}: ${found.text}`);
    }
}

// The guard counts IMPORTS, not files that mention `gi://`. Mentions are mostly prose, so
// a reader whose pattern had stopped matching would still have found 600-odd of them and
// printed OK over zero imports — a green run that checked nothing.
if (imports === 0) {
    process.stderr.write(
        `check-gi-import-versions: ${scanned} file(s) mention \`gi://\` and the reader found no import in any of them — it has stopped checking.\n`,
    );
    process.exit(1);
}

if (offenders.length > 0) {
    process.stderr.write(`check-gi-import-versions: ${offenders.length} unpinned \`gi://\` import(s):\n\n`);
    for (const o of offenders) process.stderr.write(`  ${o}\n`);
    process.stderr.write(
        '\nAdd the version the code actually wants, the way the rest of the tree spells it:\n' +
            "  import Gtk from 'gi://Gtk?version=4.0';\n" +
            "  import Adw from 'gi://Adw?version=1';\n" +
            "  import GLib from 'gi://GLib?version=2.0';\n\n" +
            'Unversioned, the loader takes whichever typelib it finds first. Where two are\n' +
            'installed side by side — WebKit2-4.1 and WebKit-6.0 is the standing example —\n' +
            'that is a second toolkit in the same address space, decided at load time.\n',
    );
    process.exit(1);
}

process.stdout.write(
    `check-gi-import-versions: OK — ${GI_IMPORT_VERSION_VECTORS.length} self-test vector(s); ` +
        `${imports} \`gi://\` import(s) across ${scanned} file(s), every one of them versioned.\n`,
);
