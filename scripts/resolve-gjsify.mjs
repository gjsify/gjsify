// Resolve the `gjsify` CLI for a `spawn` from a repo script — correctly on Windows.
//
// WHY THIS EXISTS
//
// Three scripts carried the same four lines:
//
//     const local = join(root, 'node_modules', '.bin', 'gjsify');
//     if (existsSync(local)) return { cmd: local, args: [] };
//
// and on Windows every one of them is broken in the same way, because
// `node_modules/.bin/gjsify` DOES exist there — npm writes the extensionless sh
// shim alongside the `.cmd` and `.ps1` ones — while being the one member of the
// trio Windows cannot execute. Measured on win32 x64 / Node 24.18.1:
//
//     existsSync('…\\node_modules\\.bin\\gjsify')          → true
//     spawnSync('…\\node_modules\\.bin\\gjsify', ['-v'])   → ENOENT
//     spawnSync('…\\node_modules\\.bin\\gjsify.cmd', …)    → EINVAL
//     spawnSync(cmd.exe, ['/d','/s','/c','"…gjsify.cmd" -v']) → 0
//
// The EINVAL is Node's CVE-2024-27980 mitigation: a batch file has to go through
// a command interpreter. So picking the `.cmd` path is not enough — it must be
// invoked through `%COMSPEC%` with every argument escaped for cmd's parser.
//
// The consequence was not cosmetic. `spawnSync` on an ENOENT leaves `status`
// NULL, and both call sites test `status !== 0`, so each reported a failure of
// the command it never managed to start:
//
//   • `verify-committed-bundles.mjs` — the check `.githooks/pre-commit` names
//     when it degrades on Windows ("CI remains the exhaustive check") — said
//     "`gjsify workspace @gjsify/cli build --with-dependencies` failed (exit
//     null)".
//   • `bootstrap-native-facades.mjs` — the documented cold-tree recovery, also
//     reached from `release.yml` — said "`gjsify run build:infra` failed (exit
//     null)" for a build that never started.
//
// WHY NOT `sh -c 'command -v gjsify'`
//
// That was the PATH fallback, and it fails in both directions on Windows. From
// cmd.exe or PowerShell there is no `sh`, so it degrades quietly. From Git Bash
// — where a Windows contributor is most likely to be standing — `sh` resolves
// and `command -v` answers with an MSYS path (`/c/src/…`), which `status === 0`
// then accepts and hands to `spawnSync`, where it is ENOENT. A green-looking
// probe producing an unspawnable path is worse than no probe. PATH is walked
// directly here, honouring `PATHEXT`, the way `CreateProcess` does.
//
// This is a port of `packages/infra/cli/src/utils/win32-command.ts` (itself
// adapted from cross-spawn v7.0.6, MIT). It is duplicated rather than imported
// because `scripts/**` must run with NO `node_modules` at all — that is the
// whole point of the cold-tree bootstrap these two scripts implement.

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
 * `buildBinShim` (`packages/infra/cli/src/commands/install.ts`) writes
 * `if command -v gjs && [ -f "<dist/cli.gjs.mjs>" ]; then exec gjs -m …; fi;
 * exec node "<lib/index.js>"` — so the shim is only usable when at least one of
 * these exists. BOTH are build outputs, and since ADR 0002 neither is tracked,
 * so on a fresh clone the shim exists and points at nothing.
 *
 * @param {string} root Repository root.
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
 * Resolution order: the workspace-local shim first (it is the version this tree
 * pins), PATH second (a global install), this tree's own built GJS bundle
 * third, and the bootstrap bundle `install.mjs --fetch-only` cached last (a tree
 * with nothing built — the case the cold-tree bootstrap exists for). On win32
 * the local and PATH hits pick the `.cmd` member of npm's trio and route it
 * through `%COMSPEC%`.
 *
 * **The local shim is skipped when neither of its targets exists.** Returning it
 * anyway is worse than skipping: the shim spawns fine and then dies inside `sh`
 * with `Cannot find module …/lib/index.js`, which reads as a broken install
 * rather than as "this tree has not been built yet" — and it shadows the two
 * rungs below that would have worked. Measured on a fresh clone after
 * `gjsify install --immutable`, where both targets are absent by construction.
 *
 * **`preferPath` inverts the first two rungs, and it exists for exactly one
 * caller.** `bootstrap-native-facades.mjs` under GJS asks a `gjsify` to BUILD
 * `@gjsify/rolldown-native`'s facade — the bundler engine itself. The workspace
 * CLI is the one host that structurally cannot do that on a cold tree: whatever
 * `node_modules/.bin/gjsify` points at resolves its engine from THIS tree, where
 * the facade is the artifact still missing. The `gjsify` on PATH is a global
 * install, which carries its own built engine (`installGjsEnginePackages()`), so
 * it can. Measured: with the default order the facade build exited 1 on a cold
 * tree while the same command through the PATH CLI succeeded in ~3 s.
 *
 * Everything else keeps the default order — the workspace pin SHOULD win when
 * the question is "which gjsify does this tree use".
 *
 * Returns `null` when nothing resolves, so the caller owns the error message —
 * the callers word it differently and each is right for its context.
 *
 * @param {string} root Repository root.
 * @param {readonly string[]} argv Arguments for the CLI, unescaped.
 * @param {{platform?: string, env?: NodeJS.ProcessEnv, preferPath?: boolean}} [opts] Injected for tests.
 * @returns {{cmd: string, args: string[], windowsVerbatimArguments?: boolean, via: string} | null}
 */
export function resolveGjsifySpawn(root, argv, opts = {}) {
    const platform = opts.platform ?? process.platform;
    const env = opts.env ?? process.env;
    const args = [...argv];

    // The local shim. On win32 the `.cmd` member is the executable one; the
    // extensionless sibling exists but cannot be spawned.
    const localBase = join(root, 'node_modules', '.bin', 'gjsify');
    const local = platform === 'win32' ? `${localBase}.cmd` : localBase;
    const localUsable = existsSync(local) && workspaceShimTargets(root).some((t) => existsSync(t));
    const onPath = lookupOnPath('gjsify', env, platform);

    // See `preferPath` in the docblock — PATH first only for the caller that
    // needs a CLI which is NOT this tree's.
    if (opts.preferPath && onPath) return { ...invoke(onPath, args, env, platform), via: 'PATH' };

    if (localUsable) {
        return { ...invoke(local, args, env, platform), via: 'node_modules/.bin' };
    }

    if (onPath) return { ...invoke(onPath, args, env, platform), via: 'PATH' };

    // This tree's own GJS bundle, when it has been built. Needs a `gjs` to run
    // it. There is no gjs for Windows, so this branch cannot succeed there — it
    // is still returned rather than skipped, so the failure names the missing
    // gjs instead of pretending no CLI exists.
    const bundle = join(root, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');
    if (existsSync(bundle)) return { cmd: 'gjs', args: ['-m', bundle, ...args], via: 'built bundle' };

    // Last resort: the PUBLISHED bundle `install.mjs --fetch-only` verified and
    // cached, handed down by CI in `GJSIFY_BOOTSTRAP`. Since ADR 0002 this is
    // the only rung left on a tree that has been installed but not yet built —
    // which is exactly the state `bootstrap-native-facades.mjs` runs in.
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
