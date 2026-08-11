// Resolve the `gjsify` CLI for a `spawn` from a repo script — correctly on Windows.
//
// On Windows the naive `existsSync(node_modules/.bin/gjsify)` probe is a trap:
// npm writes the extensionless sh shim alongside `.cmd`/`.ps1`, so the path
// exists while being the one member of the trio Windows cannot spawn (ENOENT).
// The `.cmd` member spawns EINVAL directly — Node's CVE-2024-27980 mitigation
// routes batch files through a command interpreter — so it must go through
// `%COMSPEC%` with every argument escaped for cmd's parser.
//
// Not cosmetic: `spawnSync` on ENOENT leaves `status` NULL and the call sites
// test `status !== 0`, so `verify-committed-bundles.mjs` and
// `bootstrap-native-facades.mjs` each reported "failed (exit null)" for a
// command that never started.
//
// PATH is walked directly, honouring `PATHEXT` the way `CreateProcess` does,
// rather than probing `sh -c 'command -v gjsify'`: under cmd.exe/PowerShell
// there is no `sh` and it degrades quietly, while under Git Bash `command -v`
// answers with an MSYS path (`/c/src/…`) that passes `status === 0` and is then
// ENOENT to `spawnSync`. A green probe producing an unspawnable path is worse
// than no probe.
//
// Port of `packages/infra/cli/src/utils/win32-command.ts` (adapted from
// cross-spawn v7.0.6, MIT), duplicated rather than imported because
// `scripts/**` must run with NO `node_modules` at all — the point of the
// cold-tree bootstrap these scripts implement.

import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Default when `PATHEXT` is unset — the extensions `CreateProcess` users expect. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** Only `.com`/`.exe` can be executed without an interpreter. */
const DIRECTLY_EXECUTABLE_RE = /\.(?:com|exe)$/i;

/** A cmd-shim under `node_modules/.bin/` re-enters cmd.exe, so meta chars are escaped twice. */
const CMD_SHIM_RE = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i;

/** See http://www.robvanderwoude.com/escapechars.php — verbatim from cross-spawn. */
const META_CHARS_RE = /([()\][%!^"`<>&|;, *?])/g;

/** Read `name` from `env` case-insensitively — Windows env keys are (`Path` vs `PATH`). */
function lookupEnv(env, name) {
    const wanted = name.toLowerCase();
    for (const key of Object.keys(env)) {
        if (key.toLowerCase() === wanted && env[key] !== undefined) return env[key];
    }
    return undefined;
}

function escapeCmdCommand(arg) {
    return arg.replace(META_CHARS_RE, '^$1');
}

/** Port of cross-spawn's `escape.argument` — https://qntm.org/cmd, backtracking removed. */
function escapeCmdArgument(arg, doubleEscapeMetaChars = false) {
    let out = `${arg}`;
    out = out.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
    out = out.replace(/(?=(\\+?)?)\1$/, '$1$1');
    out = `"${out}"`;
    out = out.replace(META_CHARS_RE, '^$1');
    if (doubleEscapeMetaChars) out = out.replace(META_CHARS_RE, '^$1');
    return out;
}

/** Build `%COMSPEC% /d /s /c "<file> <args…>"` for a target that needs an interpreter. */
function buildCmdExeInvocation(commandFile, args, env) {
    const doubleEscape = CMD_SHIM_RE.test(commandFile);
    const line = [escapeCmdCommand(commandFile), ...args.map((a) => escapeCmdArgument(a, doubleEscape))].join(' ');
    return {
        cmd: lookupEnv(env, 'COMSPEC') ?? 'cmd.exe',
        args: ['/d', '/s', '/c', `"${line}"`],
        windowsVerbatimArguments: true,
    };
}

/** Find a bare command on PATH, trying each `PATHEXT` per directory — `CreateProcess` order. */
function lookupOnPath(name, env, platform) {
    const dirs = (lookupEnv(env, 'PATH') ?? '').split(delimiter).filter(Boolean);
    const exts =
        platform === 'win32' ? (lookupEnv(env, 'PATHEXT') ?? DEFAULT_PATHEXT).split(';').filter(Boolean) : [''];
    for (const dir of dirs) {
        for (const ext of exts) {
            const candidate = join(dir, name + ext);
            if (existsSync(candidate)) return candidate;
        }
    }
    return undefined;
}

/**
 * The two files the WORKSPACE `.bin/gjsify` shim can hand control to.
 *
 * The shim (written by `buildBinShim` in the CLI's `install` command) execs `gjs
 * -m <dist/cli.gjs.mjs>` when both are available, else `node <lib/index.js>` —
 * so it is only usable when at least one target exists. Both are build outputs
 * and since ADR 0002 neither is tracked: on a fresh clone the shim exists and
 * points at nothing.
 */
function workspaceShimTargets(root) {
    return [
        join(root, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs'),
        join(root, 'packages', 'infra', 'cli', 'lib', 'index.js'),
    ];
}

/**
 * Everything a caller needs to spawn `gjsify <argv…>`, resolved for this host.
 *
 * Rungs, in order: workspace-local shim (the version this tree pins) → PATH (a
 * global install) → this tree's built GJS bundle → the cached bootstrap bundle.
 *
 * The local shim is skipped when neither of its targets exists: returning it
 * anyway spawns fine and then dies inside `sh` with `Cannot find module
 * …/lib/index.js`, which reads as a broken install rather than "not built yet",
 * and it shadows the two rungs below that would have worked.
 *
 * `preferPath` inverts the first two rungs for its one caller,
 * `bootstrap-native-facades.mjs`, which asks a `gjsify` to build
 * `@gjsify/rolldown-native`'s facade — the bundler engine itself. The workspace
 * CLI structurally cannot do that on a cold tree: it resolves its engine from
 * THIS tree, where that facade is the missing artifact. A global install on PATH
 * carries its own built engine (`installGjsEnginePackages()`), so it can.
 *
 * Returns `null` when nothing resolves, so the caller owns the error message.
 *
 * @param {readonly string[]} argv Arguments for the CLI, unescaped.
 * @param {{platform?: string, env?: NodeJS.ProcessEnv, preferPath?: boolean}} [opts] Injected for tests.
 */
export function resolveGjsifySpawn(root, argv, opts = {}) {
    const platform = opts.platform ?? process.platform;
    const env = opts.env ?? process.env;
    const args = [...argv];

    // On win32 the `.cmd` member is the executable one; the extensionless
    // sibling exists but cannot be spawned.
    const localBase = join(root, 'node_modules', '.bin', 'gjsify');
    const local = platform === 'win32' ? `${localBase}.cmd` : localBase;
    const localUsable = existsSync(local) && workspaceShimTargets(root).some((t) => existsSync(t));
    const onPath = lookupOnPath('gjsify', env, platform);

    if (opts.preferPath && onPath) return { ...invoke(onPath, args, env, platform), via: 'PATH' };

    if (localUsable) {
        return { ...invoke(local, args, env, platform), via: 'node_modules/.bin' };
    }

    if (onPath) return { ...invoke(onPath, args, env, platform), via: 'PATH' };

    // Needs a `gjs`, which Windows has none of — returned rather than skipped
    // there so the failure names the missing gjs instead of "no CLI exists".
    const bundle = join(root, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');
    if (existsSync(bundle)) return { cmd: 'gjs', args: ['-m', bundle, ...args], via: 'built bundle' };

    // The PUBLISHED bundle `install.mjs --fetch-only` verified and cached, handed
    // down by CI in `GJSIFY_BOOTSTRAP`. Since ADR 0002 the only rung left on a
    // tree installed but not yet built — the state `bootstrap-native-facades.mjs`
    // runs in.
    const bootstrap = lookupEnv(env, 'GJSIFY_BOOTSTRAP');
    if (bootstrap && existsSync(bootstrap)) {
        return { cmd: 'gjs', args: ['-m', bootstrap, ...args], via: 'GJSIFY_BOOTSTRAP' };
    }

    return null;
}

/** Spawn shape for one resolved file: direct when it is a real executable, else via cmd.exe. */
function invoke(file, args, env, platform) {
    if (platform !== 'win32' || DIRECTLY_EXECUTABLE_RE.test(file)) return { cmd: file, args };
    return buildCmdExeInvocation(file, args, env);
}
