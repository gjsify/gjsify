#!/usr/bin/env node
// Generates the register-globals closure map consumed by `--globals auto`'s
// single-pass fast path (see rolldown-plugin-gjsify utils/auto-globals.ts).
//
// For every unique register subpath in GJS_GLOBALS_MAP, this bundles a stub
// entry that side-effect-imports just that register module and runs the
// TRUSTED iterative detection loop on it. The converged set = every mapped
// global identifier that injecting this register transitively references —
// i.e. exactly the growth the per-build iterative loop would re-discover at
// build time, pass after pass, for every single `gjsify build --app gjs`.
//
// Baking that closure into a committed map lets the per-build loop converge
// after ONE detection pass + ONE verification pass (3 bundles incl. the final
// build instead of ~5), which is the dominant cost of a GJS app build under
// both engines (npm rolldown on Node AND @gjsify/rolldown-native under GJS).
//
// Regenerate whenever a register module's implementation changes which
// globals its code references (new package, new global in an impl):
//
//   node packages/infra/cli/scripts/generate-register-closure.mjs
//
// A stale map is SAFE (the verification pass detects unexpected growth, falls
// back to the iterative loop and warns) — just slower until regenerated.
//
// Runs under Node from anywhere inside the workspace (uses npm rolldown).

import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { GJS_GLOBALS_MAP } from '@gjsify/resolve-npm/globals-map';
import { detectAutoGlobals, writeRegisterInjectFile } from '@gjsify/rolldown-plugin-gjsify/globals';
import { gjsifyPlugin } from '@gjsify/rolldown-plugin-gjsify';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..', '..');
// writeRegisterInjectFile writes its stubs under `<cwd>/node_modules/.cache/`,
// and the stubs' bare register imports resolve via the root node_modules.
process.chdir(repoRoot);

const outFile = join(repoRoot, 'packages', 'infra', 'resolve-npm', 'lib', 'register-globals-closure.mjs');

const registerPaths = [...new Set(Object.values(GJS_GLOBALS_MAP))].sort();
console.log(`Generating closure for ${registerPaths.length} register module(s)…`);

/** @type {Record<string, string[]>} */
const closure = {};
const started = Date.now();

for (const registerPath of registerPaths) {
    // A stub entry importing exactly this register module — same mechanism
    // the inject file uses, so resolution (bare-alias → @gjsify/<pkg>) goes
    // through the identical gjsify alias plugin path as a real build.
    const stub = await writeRegisterInjectFile(new Set([registerPath]));
    if (!stub) throw new Error(`could not write stub for ${registerPath}`);

    const gjsifyPluginFactory = async (opts) => {
        const cfg = await gjsifyPlugin(
            {
                input: stub,
                output: { file: join(repoRoot, 'node_modules', '.cache', 'gjsify', 'closure-gen-out.mjs') },
            },
            opts,
        );
        return { options: cfg.options, plugins: cfg.plugins };
    };

    const { detected } = await detectAutoGlobals(
        { input: stub, format: 'esm' },
        // consoleShim off: a real build's pass-1 detection sees the console
        // shim's own references anyway — baking them into every entry would
        // only add noise.
        { app: 'gjs', format: 'esm', exclude: [], consoleShim: false },
        gjsifyPluginFactory,
        false,
        // CRITICAL: bypass the committed closure map — generating THROUGH it
        // would re-import every stale identifier from the old entries (the
        // map could only ever grow; removed globals would never leave).
        { disableClosureExpansion: true },
    );

    // Keep only identifiers that are themselves mapped — others can't be
    // injected and therefore can't grow the per-build loop.
    const mapped = [...detected].filter((id) => GJS_GLOBALS_MAP[id] !== undefined).sort();
    closure[registerPath] = mapped;
    console.log(`  ${registerPath} → ${mapped.length}`);
}

const body = `// GENERATED FILE — do not edit by hand.
// Produced by packages/infra/cli/scripts/generate-register-closure.mjs.
// Regenerate after changing which globals a register module's code references:
//   node packages/infra/cli/scripts/generate-register-closure.mjs
//
// Maps each GJS_GLOBALS_MAP register subpath to every mapped global
// identifier its bundled code transitively references. \`--globals auto\`
// uses this to expand the pass-1 detection to the full fixpoint in memory,
// collapsing the iterative multi-pass loop to detection + verification.
// A stale map is safe (the verification pass falls back to the loop).

export const REGISTER_GLOBALS_CLOSURE = ${JSON.stringify(closure, null, 4)};
`;

// --check: compare against the committed map instead of writing — CI-friendly
// freshness gate (exit 1 + diff hint when stale).
if (process.argv.includes('--check')) {
    const { readFile } = await import('node:fs/promises');
    const current = await readFile(outFile, 'utf-8').catch(() => '');
    if (current === body) {
        console.log(
            `\nregister-globals-closure map is up to date (checked in ${((Date.now() - started) / 1000).toFixed(1)}s).`,
        );
    } else {
        console.error(
            `\nregister-globals-closure map is STALE — regenerate + commit:\n` +
                `  node packages/infra/cli/scripts/generate-register-closure.mjs`,
        );
        process.exit(1);
    }
} else {
    await writeFile(outFile, body, 'utf-8');
    console.log(`\nWrote ${outFile} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
