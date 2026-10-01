#!/usr/bin/env node
// Every committed `*.d.blp.ts` is what its `.blp` derives TODAY.
//
// WHY THIS EXISTS. ADR 0087 § 4 commits the sidecars rather than generating them into a cache,
// because a type-check is not a build: `tree-checks` installs the workspace and does not build
// it, so types that only exist after a bundler has run are types the gate cannot see. The price
// of committing is a second copy of a derived fact, and this repository has already paid for an
// uncommitted-copy-with-no-gate twice in this very package — ADR 0053's census table went stale
// the day a twelfth `.blp` landed, and the corpus counts were corrected and re-broken within
// hours. A committed artifact with two producers (the vite plugin during build, `gjsify
// blueprint types` before a check) and no comparison is that same shape.
//
// WHAT IT CHECKS, and deliberately only these two:
//
//   1. a committed sidecar whose bytes are not what its `.blp` derives  → FAIL (stale)
//   2. a committed sidecar whose `.blp` is gone                         → FAIL (orphan)
//
// THE THIRD ARM IS HELD BY THE COMPILER, NOT HERE. A `.blp` whose consumer writes
// `import { build } from './x.blp'` and which has NO sidecar does not fail silently: the import
// falls back to the ambient `declare module '*.blp'` wildcard, which exports only `default`, and
// `tsc` reports TS2614 naming each missing member — measured on TypeScript 6.0.3 while spiking
// ADR 0087 § 4. So `gjsify run check` already refuses it, loudly, at the import site. A grep for
// `.blp` imports here would be a second, weaker reader of a question the type-checker answers
// exactly, and it would have to guess about `import.meta.glob` (which `website/` uses).
//
// AND IT DOES NOT DEMAND A SIDECAR PER `.blp`. Most tracked `.blp` are corpus fixtures or
// gallery sources nothing imports by name, so generating a sidecar for each would commit a file
// per fixture to be read by nothing. A sidecar is opt-in per file — `gjsify blueprint types
// <path>` — and this gate holds the ones that exist.
//
// Usage: node scripts/check-blueprint-sidecars.mjs [--root <dir>] [--write]
// Exits 0 when they agree, 1 when they drift, 2 on a usage or read error.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { emitTypedSidecar, parseBlueprint } from '@gjsify/blueprint';

/** `x.d.blp.ts` → `x.blp`. The inverse of `sidecarPathFor`, which this script never needs. */
const blueprintFor = (sidecar) => `${sidecar.slice(0, -'.d.blp.ts'.length)}.blp`;

function main(argv) {
    const rootAt = argv.indexOf('--root');
    const root = rootAt === -1 ? process.cwd() : argv[rootAt + 1];
    const write = argv.includes('--write');
    if (rootAt !== -1 && root === undefined) {
        console.error('check-blueprint-sidecars: --root needs a directory');
        return 2;
    }

    // `git ls-files` and not a walk: the subject is what is COMMITTED. An untracked sidecar is
    // a working-tree state, and on CI — the only place this verdict gates anything — the tree
    // IS the commit, so the two coincide where it matters.
    const sidecars = execFileSync('git', ['ls-files', '*.d.blp.ts'], { cwd: root, encoding: 'utf8' })
        .split('\n')
        .filter((line) => line !== '');

    const stale = [];
    const orphaned = [];

    for (const sidecar of sidecars) {
        const blueprint = blueprintFor(sidecar);
        if (!existsSync(join(root, blueprint))) {
            orphaned.push(sidecar);
            continue;
        }
        const source = readFileSync(join(root, blueprint), 'utf8');
        // A refusal is NOT caught: a `.blp` that has a sidecar is a `.blp` someone imports by
        // name, so one that no longer parses is a build already broken and the parser's own
        // error names the file and the line better than a verdict line could.
        const expected = emitTypedSidecar(parseBlueprint(source, blueprint));
        if (readFileSync(join(root, sidecar), 'utf8') === expected) continue;
        if (write) {
            writeFileSync(join(root, sidecar), expected, 'utf8');
            console.log(`check-blueprint-sidecars: rewrote ${sidecar}`);
            continue;
        }
        stale.push(sidecar);
    }

    if (orphaned.length === 0 && stale.length === 0) {
        console.log(`check-blueprint-sidecars: ${sidecars.length} sidecar(s) current.`);
        return 0;
    }

    for (const sidecar of orphaned) {
        console.error(`${sidecar} has no ${blueprintFor(sidecar)} — delete the sidecar or restore the .blp.`);
    }
    for (const sidecar of stale) {
        console.error(`${sidecar} is not what ${blueprintFor(sidecar)} derives.`);
    }
    // The fix is to RE-RUN the generator, never to edit the file: the sidecar is derived, and a
    // hand-edit is a third copy of the facts with nothing behind it.
    console.error('\nRegenerate: node scripts/check-blueprint-sidecars.mjs --write  (or `gjsify blueprint types`)');
    return 1;
}

process.exit(main(process.argv.slice(2)));
