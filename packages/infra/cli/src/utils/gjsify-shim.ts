// A runnable `gjsify` on PATH, for the two trees where the npm bin is not one.
//
// The CLI's npm bin (`node_modules/.bin/gjsify`) is a DISPATCHER written at install
// time: it prefers `packages/infra/cli/dist/cli.gjs.mjs` on a host with `gjs`, and
// otherwise execs the Node entry `packages/infra/cli/lib/index.js`. Orchestration
// goes through PATH to reach it — `gjsify workspace`/`foreach` spawn `<pm> run
// <script>` per package (under GJS the package manager is `gjsify` itself), and a
// compound script like `gjsify run a && gjsify run b` runs via `/bin/sh -c …`, whose
// shell resolves each `gjsify` from PATH.
//
// So: write a wrapper that re-invokes the RUNNING CLI and prepend its directory to
// `process.env.PATH`, so every child (and grandchild, via the inherited
// `GJSIFY_SHIM_DIR` marker) resolves `gjsify` to a CLI that exists.
//
// TWO HOSTS NEED IT, FOR TWO DIFFERENT REASONS
//
// GJS — always. The npm bin is the NODE entry, useless in a node-free environment
// (the Flatpak sandbox has no Node): the failures are `spawn npm ENOENT` and
// `gjsify: not found`.
//
// Node — only when the running CLI came from OUTSIDE the workspace, i.e. the
// cold-tree bootstrap (`npx @gjsify/cli@latest …`, or a global install). ADR 0002
// untracked BOTH bundles, so on an installed-but-unbuilt tree
// `node_modules/.bin/gjsify` exists and everything it dispatches to is missing: it
// resolves, then dies with `Cannot find module …/lib/index.js` on the FIRST nested
// `gjsify`. Reproducible on Linux in a cold worktree, nothing Windows-specific:
//
//   npx --yes @gjsify/cli@latest install --immutable   # ok
//   npx --yes @gjsify/cli@latest run build:infra       # Cannot find module …
//
// The bootstrap must therefore be ordered install-then-build, and the other order is
// not an alternative: `@gjsify/vite-plugin-blueprint` declares `"types": ["node"]`,
// so with no `node_modules` its `gjsify tsc` fails `TS2688: Cannot find type
// definition file for 'node'`. Linux CI never saw the gap because its bootstrap runs
// `gjs -m <published bundle> run build:infra` (`.github/actions/gjsify-setup`) and
// takes the GJS branch; Windows is the only leg with no `gjs` to fall back on.
//
// Scoped to an outside-the-workspace CLI ON PURPOSE: when the invocation already
// came through the workspace's own `node_modules/.bin/gjsify`, that shim IS the CLI
// the tree wants. Widening this to every Node invocation would silently move in-repo
// nested builds off the GJS bundle.

import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGjs } from '@gjsify/rolldown-plugin-gjsify/runtime';
import { buildLauncherShims } from './bin-shim.js';
import { resolveBinOnPath } from './install-global.js';
import { findWorkspaceRoot } from './workspace-root.js';

let _ensured = false;
let _selfShimActive = false;

/**
 * True when nested `gjsify` calls in this process tree are being routed through
 * a self-shim rather than through the workspace's `node_modules/.bin/gjsify`.
 *
 * `detectPackageManager()` reads this: a bootstrap CLI must run package scripts
 * ITSELF, because npm re-prepends `node_modules/.bin` for every lifecycle script it
 * starts — putting the tree's dead shim back ahead of this module's shim dir and
 * undoing the repair one level down.
 */
export function usingSelfShim(): boolean {
    return _selfShimActive;
}

/**
 * Does this invocation need its own `gjsify` on PATH, rather than the workspace's
 * npm bin?
 *
 * Host facts are PARAMETERS rather than read ambiently — the shape
 * `platform-check.ts` documents, and what lets the Windows branch be tested from
 * a Linux host.
 *
 * @param gjs           running under GJS (the npm bin is the Node entry there)
 * @param selfEntry     absolute path of the CLI entry currently executing
 * @param workspaceRoot absolute path of the workspace the command will act on
 */
export function needsSelfShim(opts: { gjs: boolean; selfEntry: string; workspaceRoot: string }): boolean {
    if (opts.gjs) return true;
    // Outside the workspace ⇒ a bootstrap CLI (npx / global install), whose tree's
    // own `.bin/gjsify` may point at build outputs that do not exist yet. Inside ⇒
    // the tree's CLI is the one running; leave PATH alone.
    const rel = relative(opts.workspaceRoot, opts.selfEntry);
    return rel === '' || rel.startsWith('..') || isAbsolute(rel);
}

/**
 * Ensure a runnable `gjsify` is on `process.env.PATH` for child processes.
 * Idempotent per process; children inherit the shim via `GJSIFY_SHIM_DIR` and
 * reuse it instead of creating their own.
 */
export function ensureGjsifyShimOnPath(): void {
    if (_ensured) return;
    _ensured = true;

    // A parent gjsify already created the shim — reuse it so nested orchestration
    // doesn't pile up temp dirs / PATH entries. The extension-less member is
    // written on every host, so it stays the probe.
    const inherited = process.env.GJSIFY_SHIM_DIR;
    if (inherited && existsSync(join(inherited, 'gjsify'))) {
        _selfShimActive = true;
        if (!(process.env.PATH ?? '').split(delimiter).includes(inherited)) {
            process.env.PATH = inherited + delimiter + (process.env.PATH ?? '');
        }
        return;
    }

    const gjs = isGjs();
    // Under GJS the whole CLI collapses into one `cli.gjs.mjs` bundle, so
    // `import.meta.url` IS the entry. Under Node this module is
    // `lib/utils/gjsify-shim.js` and the npm bin is `lib/index.js`, one hop up.
    const selfEntry = gjs ? fileURLToPath(import.meta.url) : fileURLToPath(new URL('../index.js', import.meta.url));
    const workspaceRoot = findWorkspaceRoot(process.cwd()) ?? process.cwd();
    if (!needsSelfShim({ gjs, selfEntry, workspaceRoot })) return;

    const dir = mkdtempSync(join(tmpdir(), 'gjsify-shim-'));
    const shim = join(dir, 'gjsify');

    // The interpreter is NAMED, not pathed, matching `buildShLauncher` and
    // `buildLauncherShims`, so a missing one fails the same way on every OS. Not
    // `process.execPath`: the batch member cannot quote an interpreter argument
    // (`<interpreter> "<target>" %*`), so `C:\Program Files\nodejs\node.exe` splits.
    const interpreter = gjs ? process.env.GJS_CONSOLE || 'gjs' : 'node';
    const interpreterArgs = gjs ? ['-m'] : [];
    const argv = interpreterArgs.length > 0 ? `${interpreterArgs.join(' ')} ` : '';

    writeFileSync(shim, `#!/bin/sh\nexec "${interpreter}" ${argv}"${selfEntry}" "$@"\n`, { mode: 0o755 });
    chmodSync(shim, 0o755);

    // cmd.exe and pwsh cannot run the extension-less member: not on PATHEXT, and
    // Windows has no shebang handling. `buildLauncherShims` ports npm's
    // three-sibling answer, including the IF/ELSE ERRORLEVEL handling that
    // `&&`/`||` chaining gets wrong.
    if (!gjs && process.platform === 'win32') {
        const { cmd, ps1 } = buildLauncherShims({ interpreter, interpreterArgs, target: selfEntry });
        writeFileSync(`${shim}.cmd`, cmd);
        writeFileSync(`${shim}.ps1`, ps1);
    }

    _selfShimActive = true;
    process.env.GJSIFY_SHIM_DIR = dir;
    process.env.PATH = dir + delimiter + (process.env.PATH ?? '');

    writeNodeShim(dir, gjs, selfEntry);
}

/** Deliberately NOT the shim dir itself — see {@link nodeShimDir}. */
const NODE_SHIM_SUBDIR = 'node-shim';

/**
 * Directory carrying a `node` that runs the file through
 * `gjsify run --node-script`, or null when this host needs none.
 *
 * **It is NOT on `process.env.PATH`, and that is the whole point.** Only
 * `runScript` puts it on the PATH of a PACKAGE SCRIPT's child (`commands/run.ts`).
 * Prepending it globally breaks the CLI's ability to SEE a missing Node: `gjsify
 * tsc`'s Node fallback spawns a real `node` for typescript's CJS entry, and
 * `tests/e2e/tsc-node-fallback` asserts that on a PATH without one it fails loudly
 * naming the missing interpreter — an assertion that exists because a silent exit
 * 0 there once let `set-bin-mode.mjs` run against a `lib/index.js` tsc never wrote.
 *
 * The line the subdirectory draws: a PACKAGE SCRIPT saying `node x.mjs` means "run
 * this script", which gjsify can serve; the CLI's own internals asking for `node`
 * mean "I need a real Node", and lying to them turns an honest diagnosis into a
 * confusing one two layers down.
 */
export function nodeShimDir(): string | null {
    const dir = process.env.GJSIFY_SHIM_DIR;
    if (!dir) return null;
    const sub = join(dir, NODE_SHIM_SUBDIR);
    return existsSync(join(sub, 'node')) ? sub : null;
}

/**
 * Write a `node` that runs the file through `gjsify run --node-script`, when the
 * host is GJS and there is NO REAL `node`.
 *
 * A SHIM AND NOT A MANIFEST REWRITE. Every `node scripts/*.mjs` in this build chain
 * imports only polyfilled `node:` builtins, so the sole blocker on a Node-less host
 * is GJS's ESM loader being unable to resolve `node:` for a file on disk — which
 * `--node-script` solves. Spelling that flag in `package.json` cannot work: CI
 * bootstraps a cold tree with `gjs -m "$GJSIFY_BOOTSTRAP" run build:infra` where
 * `$GJSIFY_BOOTSTRAP` is the PREVIOUS RELEASE's CLI
 * (`.github/workflows/release-cut.yml` hits the same trap), so a manifest using a
 * flag the last release does not know reds every cold-cache run until a release
 * ships — and the release runs that chain to build itself.
 *
 * The shim leaves manifests saying `node scripts/x.mjs`, so an older CLI is
 * unaffected, and covers what a per-script rewrite cannot: COMPOUND scripts go
 * through `/bin/sh`, which resolves `node` from PATH, as does anything they spawn.
 *
 * Two things keep it from shadowing a real Node: it is written only when `node`
 * resolves NOWHERE, and it is reachable only from a package script's PATH (see
 * {@link nodeShimDir}).
 */
function writeNodeShim(dir: string, gjs: boolean, selfEntry: string): void {
    if (!gjs) return;
    const sub = join(dir, NODE_SHIM_SUBDIR);
    if (existsSync(join(sub, 'node'))) return; // inherited from a parent gjsify
    if (resolveBinOnPath('node')) return; // a real Node is present — leave it alone

    const interpreter = process.env.GJS_CONSOLE || 'gjs';
    mkdirSync(sub, { recursive: true });
    const shim = join(sub, 'node');
    // A leading FLAG is refused rather than forwarded: `node --test x.mjs` wants
    // Node's own test runner and `node -e '…'` an eval, neither of which
    // `--node-script` can honour, and yargs would take `--test` FOR the script
    // path (`unknown-options-as-args` turns an unknown flag into a positional).
    writeFileSync(
        shim,
        '#!/bin/sh\n' +
            'case "$1" in\n' +
            '  -*) echo "gjsify: this host has no node; the gjsify shim runs a SCRIPT FILE only" >&2\n' +
            '      echo "gjsify: got: node $*" >&2\n' +
            '      exit 127 ;;\n' +
            'esac\n' +
            `exec "${interpreter}" -m "${selfEntry}" run --node-script "$@"\n`,
        { mode: 0o755 },
    );
    chmodSync(shim, 0o755);
}
