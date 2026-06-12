#!/usr/bin/env node
// Builds the `dist/tsc.gjs.mjs` bundle by running `gjsify build --app gjs`
// against upstream typescript's `_tsc.js` CLI entry (the real CLI; `tsc.js`
// is just a Node-only `enableCompileCache` shim that we skip).
//
// Why a Node script and not a plain script-string in package.json:
//
//   - We resolve `typescript/package.json` (not `lib/_tsc.js` directly) so
//     pnpm/yarn-PnP can find the hoisted copy from anywhere in the workspace.
//   - We log the version, byte size and time, mirroring the rest of the
//     gjsify build-scripts (cli/build:gjs-bundle, rolldown-plugin-gjsify
//     post-build) so CI logs stay consistent.
//   - The `gjsify` CLI runs through node_modules/.bin so it works whether
//     we're run from this package dir or via `gjsify workspace @gjsify/tsc
//     build` from the workspace root.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync, existsSync, readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { pickLibSource } from './lib-source.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const require = createRequire(import.meta.url);

// Resolve typescript from this package's dependency tree.
const tsPkgPath = require.resolve('typescript/package.json');
const tsRoot = dirname(tsPkgPath);
const tsLibDir = join(tsRoot, 'lib');
const tsVersion = JSON.parse(readFileSync(tsPkgPath, 'utf-8')).version;
const entry = join(tsLibDir, '_tsc.js');

const outfile = join(pkgRoot, 'dist', 'tsc.gjs.mjs');

// The `lib.*.d.ts` default-library files MUST ship inside `@gjsify/tsc` and be
// resolvable from the INSTALLED bundle — upstream `typescript` is only a build
// devDep, so a consumer never gets it transitively. tsc derives the default-lib
// directory as `dirname(getExecutingFilePath())` === `dirname(__filename)` of
// `_tsc.js`. We:
//   1. copy `lib*.d.ts` into `<pkgRoot>/lib/` (shipped via package.json#files),
//   2. re-point the bundle's runtime `__filename`/`__dirname` resolution from
//      `typescript/lib/_tsc.js` to `@gjsify/tsc/lib/_tsc.js` (see below).
// `@gjsify/tsc` is always resolvable from the bundle (it IS the package the
// bundle lives in), so lib resolution is deterministic + version-locked,
// independent of whether the consumer happens to have `typescript` installed.
const shipLibDir = join(pkgRoot, 'lib');
// The package spec the runtime path-rewriter bakes into the bundle for the
// entry module — see `rewrite-node-modules-paths.ts` (`extractPackageSpec`).
const ENTRY_SPEC = 'typescript/lib/_tsc.js';
const RETARGET_SPEC = '@gjsify/tsc/lib/_tsc.js';

console.log(`[@gjsify/tsc] bundling typescript@${tsVersion}`);
console.log(`             entry  : ${entry}`);
console.log(`             outfile: ${outfile}`);

// Prefer the workspace-local `gjsify` (Node entry, lib/index.js) over any
// globally installed one — the global is the GJS bundle, which today still
// requires `rolldown` to be reachable via its own resolution walker and
// may not find it when invoked from inside a sub-package. The workspace
// shim spawns Node + lib/index.js directly, which resolves rolldown from
// the local node_modules without surprises.
const env = {
    ...process.env,
    PATH: `${join(pkgRoot, '..', '..', '..', 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
};

// --- Ship the default-library `.d.ts` files alongside the bundle -----------
// These are the files tsc loads for `--lib ESNext,DOM,…`; without them a
// consumer hits `TS6053: File '…/lib.esnext.full.d.ts' not found` + a cascade
// of `TS2318: Cannot find global type 'Array'/'Promise'/…`.
//
// The committed `<pkgRoot>/lib/lib*.d.ts` are the version-locked source of
// truth (tracked in git, like `dist/tsc.gjs.mjs`). We REFRESH them from the
// upstream `typescript` devDep only when it EXACTLY matches the pinned
// `TYPESCRIPT_VERSION` and ships a complete set; otherwise we KEEP the
// committed libs untouched. A naive rm-then-copy destroys the correct libs and
// replaces them with whatever happens to be installed — a stale (TS 5.9's
// 100-file set, missing the `es2025.*` libs `lib.esnext` references) or
// partial/corrupt install yields a `lib/` that breaks every downstream
// `gjsify tsc`. See `pickLibSource()` (root cause of the v0.4.42 Fedora-44
// `main` red: an incomplete CI typescript install).
//
// The pin lives in `src/index.ts`; parse it from source (always present) so
// the .mjs build script needs no compiled artifact.
const pinnedTypescriptVersion = (() => {
    const indexTs = readFileSync(join(pkgRoot, 'src', 'index.ts'), 'utf-8');
    const m = indexTs.match(/TYPESCRIPT_VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (!m) {
        console.error('[@gjsify/tsc] could not parse TYPESCRIPT_VERSION from src/index.ts — cannot validate lib source');
        process.exit(1);
    }
    return m[1];
})();

const isLibFile = (name) => /^lib\..*\.d\.ts$/.test(name) || name === 'lib.d.ts';
const sourceLibs = readdirSync(tsLibDir).filter(isLibFile);
const committedLibs = existsSync(shipLibDir) ? readdirSync(shipLibDir).filter(isLibFile) : [];
const { action, reason } = pickLibSource({
    tsVersion,
    pinnedVersion: pinnedTypescriptVersion,
    sourceLibs,
    committedLibs,
    // Normally KEEP already-complete committed libs (no rm+copy → no race with
    // concurrent `gjsify tsc` readers during a parallel build). Set
    // GJSIFY_TSC_REFRESH_LIBS=1 to force a regeneration — used when bumping
    // TYPESCRIPT_VERSION, where the committed libs must be replaced.
    forceRefresh: process.env.GJSIFY_TSC_REFRESH_LIBS === '1',
});

let libCount;
if (action === 'refresh') {
    // Done BEFORE the bundle build (which can fail) on purpose: the libs are
    // version-locked runtime data, fully independent of the bundle step.
    rmSync(shipLibDir, { recursive: true, force: true });
    mkdirSync(shipLibDir, { recursive: true });
    for (const name of sourceLibs) copyFileSync(join(tsLibDir, name), join(shipLibDir, name));
    libCount = sourceLibs.length;
    console.log(`[@gjsify/tsc] refreshed ${libCount} lib*.d.ts — ${reason}`);
} else if (action === 'keep') {
    libCount = committedLibs.length;
    console.warn(`[@gjsify/tsc] ${reason}. Run \`npm install\` to align typescript with the pin, then rebuild.`);
} else {
    console.error(`[@gjsify/tsc] ${reason}.`);
    process.exit(1);
}

const t0 = Date.now();
// Since the GJS-first bin-shim flip, a PATH-resolved `gjsify` is the GJS
// bundle — but bundling the ~8 MB `_tsc.js` under GJS/native-rolldown is
// pathologically slow on few-core runners (issue #497's residual cold-CI
// stall: >17 min on 2 cores with zero output vs ~1 min under Node). This
// script already runs under Node, so spawn the workspace Node CLI entry
// directly — same pattern as @gjsify/cli's own `build:gjs-bundle`
// (`node lib/index.js build …`). Fall back to PATH resolution only when
// the workspace layout isn't present.
const nodeCliEntry = join(pkgRoot, '..', 'cli', 'lib', 'index.js');
const buildArgv = ['build', entry, '--app', 'gjs', '--outfile', outfile, '--shebang'];
const r = existsSync(nodeCliEntry)
    ? spawnSync(process.execPath, [nodeCliEntry, ...buildArgv], { stdio: 'inherit', cwd: pkgRoot, env })
    : spawnSync('gjsify', buildArgv, { stdio: 'inherit', cwd: pkgRoot, env });
if (r.status !== 0) {
    console.error(`[@gjsify/tsc] build failed (exit ${r.status}${r.signal ? `, signal ${r.signal}` : ''})`);
    process.exit(r.status ?? 1);
}

// --- Re-point runtime default-lib resolution to `@gjsify/tsc/lib` -----------
// The path-rewriter baked `__filename`/`__dirname` as
// `__gjsifyModule{File,Dir}("typescript/lib/_tsc.js")`. At runtime the
// module-resolve shim resolves the *package root* of that spec; for `typescript`
// (absent on a consumer) it would fall back to the bundle's own dir, and when
// present it would (wrongly) use the consumer's possibly-mismatched libs. Swap
// the spec to `@gjsify/tsc/lib/_tsc.js` so it always resolves to the libs we
// just shipped at `<pkgRoot>/lib/`. The spec survives minification as a string
// literal; assert exactly the two expected call-sites so a future rewriter
// change (0) or a string-collision with tsc's own data (>2) fails loudly. The
// minifier may emit either a double-quoted (`"…"`) or a backtick (`` `…` ``)
// literal, so match — and rewrite — both quote styles.
let code = readFileSync(outfile, 'utf-8');
const specLiterals = [JSON.stringify(ENTRY_SPEC), '`' + ENTRY_SPEC + '`'];
const retargetLiterals = [JSON.stringify(RETARGET_SPEC), '`' + RETARGET_SPEC + '`'];
const occurrences = specLiterals.reduce((sum, lit) => sum + (code.split(lit).length - 1), 0);
if (occurrences === 0) {
    console.error(
        `[@gjsify/tsc] expected runtime path-rewrite spec for ${ENTRY_SPEC} not found in bundle — ` +
            'lib resolution would break on consumers. Has the node-modules path rewriter changed?',
    );
    process.exit(1);
}
if (occurrences > 2) {
    console.error(
        `[@gjsify/tsc] runtime path-rewrite spec for ${ENTRY_SPEC} appears ${occurrences}× ` +
            '(expected ≤2 — the __filename/__dirname call-sites). Retarget would corrupt unrelated strings; aborting.',
    );
    process.exit(1);
}
for (let i = 0; i < specLiterals.length; i++) {
    code = code.split(specLiterals[i]).join(retargetLiterals[i]);
}
writeFileSync(outfile, code);

const dt = ((Date.now() - t0) / 1000).toFixed(2);
const bytes = statSync(outfile).size;
const mib = (bytes / 1024 / 1024).toFixed(2);
console.log(`[@gjsify/tsc] shipped ${libCount} lib*.d.ts → ${basename(shipLibDir)}/`);
console.log(`[@gjsify/tsc] retargeted default-lib resolution → ${RETARGET_SPEC}`);
console.log(`[@gjsify/tsc] done in ${dt}s — ${mib} MiB (${bytes} B)`);
