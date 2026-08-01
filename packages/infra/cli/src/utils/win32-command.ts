// SPDX-License-Identifier: MIT
// Adapted from `cross-spawn` (node_modules/cross-spawn/lib/parse.js and
// lib/util/escape.js, v7.0.6). Copyright (c) 2018 Made With MOXY Lda. MIT.
// Modifications: rewritten as pure TypeScript with `platform`, `env` and the
// filesystem probe INJECTED, so the Windows branch is unit-testable from a
// Linux host (the same shape `utils/bin-shim.ts` uses), and narrowed to the one
// case the CLI needs — resolving a bare command name before `spawn`.
//
// WHY THIS EXISTS
//
// `spawn('npm', …)` cannot work on Windows, and the failure is not a PATH
// problem. `CreateProcess` appends only `.exe` when it searches PATH for a bare
// name, and every npm-installed bin on Windows is a `.cmd` shim. Measured on
// win32 x64 / Node 24.18.1:
//
//     spawn('npm',     ['--version'])  →  ENOENT   (.cmd is never tried)
//     spawn('node',    ['--version'])  →  ok       (.exe is appended)
//     spawn('npm.cmd', ['--version'])  →  EINVAL   (Node refuses a batch file)
//
// The EINVAL is Node's CVE-2024-27980 mitigation: a `.cmd`/`.bat` target has to
// go through a command interpreter. So resolving the shim path is NOT enough —
// it must be invoked as `cmd.exe /d /s /c "…"` with every argument escaped for
// cmd's parser, which is what {@link buildCmdExeInvocation} does.
//
// That gap took out the whole orchestration layer, not one command: `gjsify
// workspace`/`foreach`/`check` spawn `<pm> run <script>` per package and the
// package manager is `npm` on every non-GJS host, so on Windows each one died
// with `spawn npm ENOENT` before running a single script.
//
// WHY RESOLUTION HAPPENS HERE AND NOT IN cmd.exe
//
// Handing the bare name to `cmd.exe /c` would also find the `.cmd` — and would
// destroy the ENOENT contract every caller depends on. A missing command would
// come back as a generic exit 1 with an unparsable message instead of an
// `ENOENT` error, and `SpawnToCompletionOptions.notFound` (the install hints)
// plus `commands/tsc.ts`'s transparent fall back to upstream tsc when `gjs` is
// absent both key on exactly that code. Resolving first keeps "not found" a
// spawn-time error and routes only what really is a batch file through cmd.exe.

/** Default when `PATHEXT` is unset — the extensions `CreateProcess` users expect. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** Only `.com`/`.exe` can be executed without an interpreter. Verbatim from cross-spawn. */
const DIRECTLY_EXECUTABLE_RE = /\.(?:com|exe)$/i;

/** A cmd-shim under `node_modules/.bin/` re-enters cmd.exe, so meta chars need escaping twice. */
const CMD_SHIM_RE = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i;

// See http://www.robvanderwoude.com/escapechars.php — verbatim from cross-spawn.
const META_CHARS_RE = /([()\][%!^"`<>&|;, *?])/g;

/** A command rewritten for Windows: what to spawn, with which argv. */
export interface Win32Invocation {
    /** Executable to spawn — an absolute path, or the command interpreter. */
    cmd: string;
    /** Arguments for {@link cmd}. Pre-escaped when {@link windowsVerbatimArguments} is set. */
    args: string[];
    /** Tells Node the argv is already escaped and must be passed through untouched. */
    windowsVerbatimArguments?: boolean;
}

/** Everything {@link resolveWin32Command} needs from the outside world. */
export interface Win32ResolveContext {
    /** `process.platform`. Injected so the branch is testable off Windows. */
    platform: string;
    /** The environment the CHILD will get — its `PATH` is what must be searched. */
    env: NodeJS.ProcessEnv;
    /** Filesystem probe. Injected so tests need no real files. */
    exists: (path: string) => boolean;
    /** Path joiner. Injected so a Linux host can exercise Windows-shaped paths. */
    join: (dir: string, file: string) => string;
}

/**
 * Read `name` from `env` case-insensitively.
 *
 * Windows environment variables are case-insensitive and `process.env` mirrors
 * that, but a plain object handed in as `env` (which is what every spawn call
 * site builds) does not — a child env carrying `Path` rather than `PATH` would
 * otherwise silently resolve nothing.
 */
export function lookupEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
    const wanted = name.toLowerCase();
    for (const key of Object.keys(env)) {
        // A key present but explicitly `undefined` means NOT SET — `spawn`
        // drops it from the child env. Returning it here would shadow a later
        // spelling (`{ PATH: undefined, Path: 'C:\\bin' }`) and resolve nothing.
        if (key.toLowerCase() === wanted && env[key] !== undefined) return env[key];
    }
    return undefined;
}

/** Escape a command path for cmd.exe. Port of cross-spawn's `escape.command`. */
export function escapeCmdCommand(arg: string): string {
    return arg.replace(META_CHARS_RE, '^$1');
}

/**
 * Escape one argument for cmd.exe. Port of cross-spawn's `escape.argument`,
 * whose algorithm is https://qntm.org/cmd with the backtracking removed.
 */
export function escapeCmdArgument(arg: string, doubleEscapeMetaChars = false): string {
    let out = `${arg}`;
    // A run of backslashes before a double quote: double the run, escape the quote.
    out = out.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
    // A run of backslashes at the end (about to precede the closing quote): double it.
    out = out.replace(/(?=(\\+?)?)\1$/, '$1$1');
    out = `"${out}"`;
    out = out.replace(META_CHARS_RE, '^$1');
    if (doubleEscapeMetaChars) out = out.replace(META_CHARS_RE, '^$1');
    return out;
}

/**
 * Build the `cmd.exe /d /s /c "…"` invocation for a resolved, non-directly-
 * executable target. Pure — the unit tests drive this from any host.
 *
 * @param commandFile Resolved absolute path of the target (e.g. the `.cmd` shim).
 * @param args The caller's arguments, unescaped.
 * @param comspec The interpreter, normally `%COMSPEC%`.
 */
export function buildCmdExeInvocation(
    commandFile: string,
    args: readonly string[],
    comspec = 'cmd.exe',
): Win32Invocation {
    // A cmd-shim under `node_modules/.bin/` is itself a batch file that re-invokes
    // cmd.exe, so its meta chars are interpreted twice and must be escaped twice.
    const doubleEscape = CMD_SHIM_RE.test(commandFile);
    const line = [escapeCmdCommand(commandFile), ...args.map((a) => escapeCmdArgument(a, doubleEscape))].join(' ');
    return { cmd: comspec, args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
}

/** True when `cmd` is a bare name — no directory part and no extension. */
function isBareName(cmd: string): boolean {
    return !cmd.includes('/') && !cmd.includes('\\') && !/\.[^.]+$/.test(cmd);
}

/**
 * Find `cmd` on the child's `PATH`, trying each `PATHEXT` extension per
 * directory — the order `CreateProcess` itself uses.
 */
function lookupOnPath(cmd: string, ctx: Win32ResolveContext): string | undefined {
    const dirs = (lookupEnv(ctx.env, 'PATH') ?? '').split(';').filter(Boolean);
    const exts = (lookupEnv(ctx.env, 'PATHEXT') ?? DEFAULT_PATHEXT).split(';').filter(Boolean);
    for (const dir of dirs) {
        for (const ext of exts) {
            const candidate = ctx.join(dir, cmd + ext);
            if (ctx.exists(candidate)) return candidate;
        }
    }
    return undefined;
}

/**
 * Rewrite a bare command name into something Windows can actually spawn.
 *
 * Returns `undefined` when nothing needs rewriting — not win32, not a bare
 * name, or not found on `PATH`. The last case is deliberate: letting `spawn`
 * fail with `ENOENT` preserves the contract callers key their install hints on
 * (see the module header).
 */
export function resolveWin32Command(
    cmd: string,
    args: readonly string[],
    ctx: Win32ResolveContext,
): Win32Invocation | undefined {
    if (ctx.platform !== 'win32' || !isBareName(cmd)) return undefined;
    const resolved = lookupOnPath(cmd, ctx);
    if (!resolved) return undefined;
    // `.exe`/`.com` run without an interpreter; spawning the resolved absolute
    // path skips a second PATH search and cannot be shadowed in between.
    if (DIRECTLY_EXECUTABLE_RE.test(resolved)) return { cmd: resolved, args: [...args] };
    return buildCmdExeInvocation(resolved, args, lookupEnv(ctx.env, 'COMSPEC') ?? 'cmd.exe');
}
