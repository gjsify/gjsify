// Resolve the `gjsify` CLI for a `spawn` from a repo script â€” correctly on Windows.
//
// WHY THIS EXISTS
//
// Three scripts carried the same four lines:
//
//     const local = join(root, 'node_modules', '.bin', 'gjsify');
//     if (existsSync(local)) return { cmd: local, args: [] };
//
// and on Windows every one of them is broken in the same way, because
// `node_modules/.bin/gjsify` DOES exist there â€” npm writes the extensionless sh
// shim alongside the `.cmd` and `.ps1` ones â€” while being the one member of the
// trio Windows cannot execute. Measured on win32 x64 / Node 24.18.1:
//
//     existsSync('â€¦\\node_modules\\.bin\\gjsify')          â†’ true
//     spawnSync('â€¦\\node_modules\\.bin\\gjsify', ['-v'])   â†’ ENOENT
//     spawnSync('â€¦\\node_modules\\.bin\\gjsify.cmd', â€¦)    â†’ EINVAL
//     spawnSync(cmd.exe, ['/d','/s','/c','"â€¦gjsify.cmd" -v']) â†’ 0
//
// The EINVAL is Node's CVE-2024-27980 mitigation: a batch file has to go through
// a command interpreter. So picking the `.cmd` path is not enough â€” it must be
// invoked through `%COMSPEC%` with every argument escaped for cmd's parser.
//
// The consequence was not cosmetic. `spawnSync` on an ENOENT leaves `status`
// NULL, and both call sites test `status !== 0`, so each reported a failure of
// the command it never managed to start:
//
//   â€¢ `verify-committed-bundles.mjs` â€” the check `.githooks/pre-commit` names
//     when it degrades on Windows ("CI remains the exhaustive check") â€” said
//     "`gjsify workspace @gjsify/cli build --with-dependencies` failed (exit
//     null)".
//   â€¢ `bootstrap-native-facades.mjs` â€” the documented cold-tree recovery, also
//     reached from `release.yml` â€” said "`gjsify run build:infra` failed (exit
//     null)" for a build that never started.
//
// WHY NOT `sh -c 'command -v gjsify'`
//
// That was the PATH fallback, and it fails in both directions on Windows. From
// cmd.exe or PowerShell there is no `sh`, so it degrades quietly. From Git Bash
// â€” where a Windows contributor is most likely to be standing â€” `sh` resolves
// and `command -v` answers with an MSYS path (`/c/src/â€¦`), which `status === 0`
// then accepts and hands to `spawnSync`, where it is ENOENT. A green-looking
// probe producing an unspawnable path is worse than no probe. PATH is walked
// directly here, honouring `PATHEXT`, the way `CreateProcess` does.
//
// This is a port of `packages/infra/cli/src/utils/win32-command.ts` (itself
// adapted from cross-spawn v7.0.6, MIT). It is duplicated rather than imported
// because `scripts/**` must run with NO `node_modules` at all â€” that is the
// whole point of the cold-tree bootstrap these two scripts implement.

import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Default when `PATHEXT` is unset â€” the extensions `CreateProcess` users expect. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** Only `.com`/`.exe` can be executed without an interpreter. */
const DIRECTLY_EXECUTABLE_RE = /\.(?:com|exe)$/i;

/** A cmd-shim under `node_modules/.bin/` re-enters cmd.exe, so meta chars are escaped twice. */
const CMD_SHIM_RE = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i;

/** See http://www.robvanderwoude.com/escapechars.php â€” verbatim from cross-spawn. */
const META_CHARS_RE = /([()\][%!^"`<>&|;, *?])/g;

/** Read `name` from `env` case-insensitively â€” Windows env keys are (`Path` vs `PATH`). */
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

/** Port of cross-spawn's `escape.argument` â€” https://qntm.org/cmd, backtracking removed. */
function escapeCmdArgument(arg, doubleEscapeMetaChars = false) {
    let out = `${arg}`;
    out = out.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
    out = out.replace(/(?=(\\+?)?)\1$/, '$1$1');
    out = `"${out}"`;
    out = out.replace(META_CHARS_RE, '^$1');
    if (doubleEscapeMetaChars) out = out.replace(META_CHARS_RE, '^$1');
    return out;
}

/** Build `%COMSPEC% /d /s /c "<file> <argsâ€¦>"` for a target that needs an interpreter. */
function buildCmdExeInvocation(commandFile, args, env) {
    const doubleEscape = CMD_SHIM_RE.test(commandFile);
    const line = [escapeCmdCommand(commandFile), ...args.map((a) => escapeCmdArgument(a, doubleEscape))].join(' ');
    return {
        cmd: lookupEnv(env, 'COMSPEC') ?? 'cmd.exe',
        args: ['/d', '/s', '/c', `"${line}"`],
        windowsVerbatimArguments: true,
    };
}

/** Find a bare command on PATH, trying each `PATHEXT` per directory â€” `CreateProcess` order. */
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
 * Everything a caller needs to spawn `gjsify <argvâ€¦>`, resolved for this host.
 *
 * Resolution order is the one `.githooks/pre-commit` documents: the
 * workspace-local shim first (it is the version this tree pins), PATH second (a
 * global install), the committed GJS bundle last (a tree with nothing installed
 * â€” the case the bootstrap exists for). On win32 the local and PATH hits pick
 * the `.cmd` member of npm's trio and route it through `%COMSPEC%`.
 *
 * Returns `null` when nothing resolves, so the caller owns the error message â€”
 * the two callers word it differently and both are right for their context.
 *
 * @param {string} root Repository root.
 * @param {readonly string[]} argv Arguments for the CLI, unescaped.
 * @param {{platform?: string, env?: NodeJS.ProcessEnv}} [opts] Injected for tests.
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
    if (existsSync(local)) return { ...invoke(local, args, env, platform), via: 'node_modules/.bin' };

    const onPath = lookupOnPath('gjsify', env, platform);
    if (onPath) return { ...invoke(onPath, args, env, platform), via: 'PATH' };

    // Last resort: the committed GJS bundle, which needs a `gjs` to run it.
    // There is no gjs for Windows, so this branch cannot succeed there â€” it is
    // still returned rather than skipped, so the failure names the missing gjs
    // instead of pretending no CLI exists.
    const bundle = join(root, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');
    if (existsSync(bundle)) return { cmd: 'gjs', args: ['-m', bundle, ...args], via: 'committed bundle' };

    return null;
}

/** Spawn shape for one resolved file: direct when it is a real executable, else via cmd.exe. */
function invoke(file, args, env, platform) {
    if (platform !== 'win32' || DIRECTLY_EXECUTABLE_RE.test(file)) return { cmd: file, args };
    return buildCmdExeInvocation(file, args, env);
}
