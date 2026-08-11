// A runnable `gjsify` on PATH, for the two trees where the npm bin is not one.
//
// The CLI's npm bin (`node_modules/.bin/gjsify`) is a DISPATCHER written at
// install time: it prefers `packages/infra/cli/dist/cli.gjs.mjs` on a host that
// has `gjs`, and otherwise execs the Node entry `packages/infra/cli/lib/index.js`.
// Multi-package orchestration and compound package scripts resolve `gjsify`
// from PATH and go through it:
//   - `gjsify workspace`/`foreach` spawn `<pm> run <script>` per package; under
//     GJS the package manager is `gjsify` itself, and `spawn('gjsify', …)`
//     searches PATH.
//   - a compound script like `gjsify run a && gjsify run b` is executed via
//     `/bin/sh -c …` (or `%COMSPEC% /c …`), and the shell resolves each
//     `gjsify` from PATH.
//
// Fix: write a tiny wrapper that re-invokes the RUNNING CLI, and prepend its
// directory to `process.env.PATH` so every child process (and grandchild, via
// the inherited `GJSIFY_SHIM_DIR` marker) resolves `gjsify` to a CLI that
// actually exists.
//
// TWO HOSTS NEED IT, FOR TWO DIFFERENT REASONS
//
// GJS — always. The npm bin is the NODE entry and is useless in a node-free
// environment (the Flatpak sandbox has no Node): without the shim the failures
// are `spawn npm ENOENT` and `gjsify: not found`.
//
// Node — only when the running CLI came from OUTSIDE the workspace, which is
// exactly the cold-tree bootstrap (`npx @gjsify/cli@latest …`, or a global
// install). ADR 0002 untracked BOTH bundles, so on a tree that is installed but
// not yet built, `node_modules/.bin/gjsify` exists and everything it dispatches
// to is missing. The bin shim is then a live landmine: it resolves, and then
// dies with `Cannot find module …/packages/infra/cli/lib/index.js` on the FIRST
// nested `gjsify` — which for `gjsify run build:infra` is its first clause,
// `gjsify workspace @gjsify/vite-plugin-blueprint build`.
//
// THE INCIDENT, because a rule without it gets simplified back into the bug.
//
// `windows-suites.yml` (added #1021) and `macos-suites.yml` (#1022) both landed
// during the 2026-08-06 GitHub Actions degradation with NO checks reported on
// their PRs, and neither leg had ever been green. Both ordered the cold-tree
// bootstrap as `run build:infra` BEFORE `install`, which cannot work either:
// `@gjsify/vite-plugin-blueprint` declares `"types": ["node"]`, so with no
// `node_modules` its `gjsify tsc` fails `TS2688: Cannot find type definition
// file for 'node'`. Correcting the order to install-then-build then exposed
// THIS gap, one step later.
//
// Reproduced on Linux at de7f5525 in a cold worktree — nothing about it is
// Windows-specific:
//
//   npx --yes @gjsify/cli@latest install --immutable   # ok
//   npx --yes @gjsify/cli@latest run build:infra       # Cannot find module …
//
// Linux CI never saw it because its bootstrap runs `gjs -m <published bundle>
// run build:infra` (`.github/actions/gjsify-setup`), which takes the GJS branch
// above. Windows is simply the only leg with no `gjs` to fall back on, so it is
// where the gap became load-bearing.
//
// Scoped to an outside-the-workspace CLI ON PURPOSE: when the invocation
// already came through the workspace's own `node_modules/.bin/gjsify`, that
// shim IS the CLI the tree wants, and today's dispatch (GJS bundle first on a
// host with `gjs`) stays byte-for-byte unchanged. Widening this to every Node
// invocation would silently move in-repo nested builds off the GJS bundle.

import { mkdtempSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
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
 * ITSELF, because npm re-prepends `node_modules/.bin` for every lifecycle
 * script it starts — which puts the tree's dead shim back ahead of the shim dir
 * this module placed on PATH, and undoes the whole repair one level down.
 */
export function usingSelfShim(): boolean {
    return _selfShimActive;
}

/**
 * Does this invocation need its own `gjsify` on PATH, rather than the
 * workspace's npm bin?
 *
 * Pure, and takes the host facts as PARAMETERS rather than reading them
 * ambiently — the same shape `platform-check.ts` documents, and what lets the
 * Windows-relevant branch be tested from a Linux host.
 *
 * @param gjs           running under GJS (the npm bin is the Node entry there)
 * @param selfEntry     absolute path of the CLI entry currently executing
 * @param workspaceRoot absolute path of the workspace the command will act on
 */
export function needsSelfShim(opts: { gjs: boolean; selfEntry: string; workspaceRoot: string }): boolean {
    if (opts.gjs) return true;
    // Outside the workspace ⇒ a bootstrap CLI (npx / global install), so the
    // tree's own `.bin/gjsify` may well point at build outputs that do not
    // exist yet. Inside ⇒ the tree's CLI is the one running; leave PATH alone.
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

    // A parent gjsify already created the shim — reuse it so nested
    // orchestration doesn't pile up temp dirs / PATH entries. The
    // extension-less member is written on every host, so it stays the probe.
    const inherited = process.env.GJSIFY_SHIM_DIR;
    if (inherited && existsSync(join(inherited, 'gjsify'))) {
        _selfShimActive = true;
        if (!(process.env.PATH ?? '').split(delimiter).includes(inherited)) {
            process.env.PATH = inherited + delimiter + (process.env.PATH ?? '');
        }
        return;
    }

    const gjs = isGjs();
    // Under GJS `import.meta.url` IS the entry — the whole CLI collapses into
    // the single `cli.gjs.mjs` bundle, so this module's URL is it. Under Node
    // this module is `lib/utils/gjsify-shim.js` and the npm bin is
    // `lib/index.js` (package.json `bin`), one hop up.
    const selfEntry = gjs ? fileURLToPath(import.meta.url) : fileURLToPath(new URL('../index.js', import.meta.url));
    const workspaceRoot = findWorkspaceRoot(process.cwd()) ?? process.cwd();
    if (!needsSelfShim({ gjs, selfEntry, workspaceRoot })) return;

    const dir = mkdtempSync(join(tmpdir(), 'gjsify-shim-'));
    const shim = join(dir, 'gjsify');

    // The interpreter is named, not pathed, on every member — matching
    // `buildShLauncher`'s `exec gjs` / `exec node` and `buildLauncherShims`'
    // documented contract, so a missing interpreter fails the same way on every
    // OS. `process.execPath` is deliberately NOT used: the batch member cannot
    // quote an interpreter argument (`<interpreter> "<target>" %*`), so a path
    // like `C:\Program Files\nodejs\node.exe` would split, and a trio whose
    // members disagree about which interpreter they re-enter is worse than one
    // name resolved consistently.
    const interpreter = gjs ? process.env.GJS_CONSOLE || 'gjs' : 'node';
    const interpreterArgs = gjs ? ['-m'] : [];
    const argv = interpreterArgs.length > 0 ? `${interpreterArgs.join(' ')} ` : '';

    writeFileSync(shim, `#!/bin/sh\nexec "${interpreter}" ${argv}"${selfEntry}" "$@"\n`, { mode: 0o755 });
    chmodSync(shim, 0o755);

    // cmd.exe and pwsh cannot run the extension-less member: it is not on
    // PATHEXT and Windows has no shebang handling. npm's three-sibling answer
    // is the de-facto standard, and `buildLauncherShims` is this repo's
    // reviewed port of it — including the IF/ELSE ERRORLEVEL handling that
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

/**
 * Also put a `node` on PATH — one that runs the file through
 * `gjsify run --node-script` — when the host is GJS and there is NO REAL `node`.
 *
 * WHY A SHIM AND NOT A MANIFEST REWRITE
 *
 * Every `node scripts/*.mjs` left in this repo's build chain imports nothing but
 * `node:fs` / `node:path` / `node:url`, all of which gjsify polyfills, so the
 * only thing stopping them on a Node-less host is that GJS's ESM loader cannot
 * resolve `node:` for a file on disk. `--node-script` solves that — but spelling
 * it in `package.json` does NOT work, for a structural reason rather than an
 * aesthetic one: CI bootstraps a cold tree with
 * `gjs -m "$GJSIFY_BOOTSTRAP" run build:infra`, and `$GJSIFY_BOOTSTRAP` is the
 * PREVIOUS RELEASE's CLI (`.github/workflows/release-cut.yml` documents the same
 * trap for its own step). A manifest using a flag the last release does not know
 * reds every cold-cache CI run until a release ships — and the release runs that
 * same chain to build itself.
 *
 * A shim has neither problem. The manifests keep saying `node scripts/x.mjs`, so
 * an older CLI behaves exactly as it does today, and a Node-less host gets a
 * `node` that works. It also covers what a per-script rewrite cannot: COMPOUND
 * scripts (`gjsify tsc && node scripts/build-assets.mjs`) are executed through
 * `/bin/sh`, which resolves `node` from PATH — as does anything those scripts
 * spawn in turn.
 *
 * IT CANNOT SHADOW ANYTHING, which is the safety argument: it is written only
 * when `node` resolves nowhere on PATH. Where a real Node exists, that Node keeps
 * running the scripts, byte-for-byte as before.
 */
function writeNodeShim(dir: string, gjs: boolean, selfEntry: string): void {
    if (!gjs) return;
    if (existsSync(join(dir, 'node'))) return; // inherited from a parent gjsify
    if (resolveBinOnPath('node')) return; // a real Node is present — leave it alone

    const interpreter = process.env.GJS_CONSOLE || 'gjs';
    // A leading FLAG is refused rather than forwarded. `node --test x.mjs` wants
    // Node's own test runner and `node -e '…'` an eval; neither is something
    // `--node-script` can honour, and yargs would silently take `--test` FOR the
    // script path (`unknown-options-as-args` turns an unknown flag into a
    // positional). A refusal naming the limit beats a mis-parse naming a file.
    const shim = join(dir, 'node');
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
