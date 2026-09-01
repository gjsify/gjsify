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
// COMMENTS ARE BLANKED FIRST, and the ORDER of the two strippers is load-bearing. A line
// comment ending in `/*` — `@girs/*`, `packages/*`, `src/*`, all common — pairs with the
// next `*/` anywhere below if block comments are removed first, and everything between
// disappears. Measured across this repository at the time this landed: 8243 code lines in
// 307 of 3641 tracked sources went invisible that way, to every check that shares the
// idiom. Line comments first, then block comments.
//
// FAILURE POLICY: hard, and a scan that finds nothing is itself a failure — a check that
// cannot find what it checks has stopped checking.
//
// Usage: node scripts/check-gi-import-versions.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Sources a `gi://` import can appear in, plus the docs that teach the spelling. */
const SCANNED = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|md|mdx)$/;

/** Markdown has no `//` comments to confuse, and a doc example teaches the form. */
const MARKDOWN = /\.mdx?$/;

/**
 * `import <anything> from 'gi://<Ns>'` with no query string.
 *
 * Anchored at `import` so a specifier quoted in prose or built at runtime is not an
 * import — the check must not fire on the sentence that explains it.
 */
const UNPINNED = /^[ \t]*import\b[^\n]*\bfrom\s*(['"])gi:\/\/([A-Za-z0-9_]+)\1/;

/** Any `gi://` import, pinned or not — used to prove the scan actually found some. */
const ANY_GI_IMPORT = /^[ \t]*import\b[^\n]*\bfrom\s*['"]gi:\/\//;

/**
 * Blank comment bodies, preserving line numbering.
 *
 * `[^:]` before `//` keeps `gi://` and `https://` inside a string intact. Line comments
 * go first; see the header for what the other order costs.
 */
export function stripComments(text) {
    return text
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length))
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Every unpinned `gi://` import in one source, as `{ line, namespace, text }`. */
export function unpinnedImports(source, isMarkdown = false) {
    const lines = (isMarkdown ? source : stripComments(source)).split('\n');
    const original = source.split('\n');
    const found = [];
    lines.forEach((line, i) => {
        const m = line.match(UNPINNED);
        if (m) found.push({ line: i + 1, namespace: m[2], text: original[i].trim() });
    });
    return found;
}

// ------------------------------------------------------------------ the self-test
//
// Each vector is a source fragment and the namespaces the reader must report. The two
// that matter are the ones a regex gets wrong in the SAFE-LOOKING direction: prose that
// quotes the defect, and a line comment that ends in `/*`.
const VECTORS = [
    ["import Gtk from 'gi://Gtk';", ['Gtk']],
    ['import Gtk from "gi://Gtk";', ['Gtk']],
    ["import Gtk from 'gi://Gtk?version=4.0';", []],
    ["import { foo } from 'gi://Gio';", ['Gio']],
    ["    import GLib from 'gi://GLib';", ['GLib']],
    // Prose is not an import. A gate that fires on its own rationale gets the rationale
    // deleted, and the rationale is the half that survives a rewrite.
    ["// `import Gtk from 'gi://Gtk'` is what this forbids\nconst x = 1;", []],
    ["/* import Gtk from 'gi://Gtk' */\nconst x = 1;", []],
    // The ordering case. The trailing `/** … */` is part of the vector: with no later
    // `*/` the lazy block regex finds no match and the bug does not reproduce, so a
    // version of this without it passed under BOTH orderings and proved nothing.
    ["// types live under `@girs/*`\nimport Gtk from 'gi://Gtk';\n/** doc */\nconst x = 1;", ['Gtk']],
    // Not an import at all: a runtime require, and a string that merely contains one.
    ["const Gtk = require('gi://Gtk');", []],
    ["const spec = 'gi://Gtk';", []],
];

const selfTestFailures = [];
for (const [source, expected] of VECTORS) {
    const got = unpinnedImports(source).map((f) => f.namespace);
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
    .filter((f) => SCANNED.test(f));

const offenders = [];
let pinned = 0;
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
    const lines = (isMarkdown ? source : stripComments(source)).split('\n');
    for (const line of lines) if (ANY_GI_IMPORT.test(line)) pinned++;
    for (const found of unpinnedImports(source, isMarkdown)) {
        offenders.push(`${file}:${found.line}: ${found.text}`);
        pinned--;
    }
}

if (scanned === 0) {
    process.stderr.write('check-gi-import-versions: no file mentions `gi://` — the scan found nothing to check.\n');
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
    `check-gi-import-versions: OK — ${VECTORS.length} self-test vector(s); ` +
        `${pinned} \`gi://\` import(s) across ${scanned} file(s), every one of them versioned.\n`,
);
