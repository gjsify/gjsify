// Where is `blueprint-compiler`, and what do we say when it is nowhere?
//
// Split out of the plugin so it is answerable in a test without a compiler
// installed, and because the answer is genuinely platform-shaped on Windows.
//
// The failure this replaces: the plugin called `execa('blueprint-compiler', …)`
// and rethrew whatever came back, so a host without it got an ExecaError stack
// naming the COMMAND THAT FAILED and nothing about what to install. Measured on
// the win11-gjsify VM, that error was read as "blueprint-compiler is a GNOME
// Python tool, so it is unavailable on Windows" — a conclusion that reached a
// docs file and stopped anyone building a `.blp` showcase there for a day. It is
// available; nothing said how to get it.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** A spawnable blueprint-compiler, plus how it was found (for `verbose`). */
export interface ResolvedBlueprintCompiler {
    /** The executable to spawn. */
    file: string;
    /** Arguments that must precede blueprint-compiler's own (e.g. the script path). */
    prefixArgs: string[];
    /** Environment overlay to spawn with, or undefined to inherit unchanged. */
    env?: Record<string, string>;
    source: 'env' | 'path' | 'msys2';
}

/**
 * The host facts this module decides on, taken as a PARAMETER rather than read
 * from ambient `process.*`.
 *
 * Every unit-test leg in this repo runs on Linux, so an ambient
 * `process.platform` puts the darwin and win32 branches — which are most of this
 * module and the only ones anybody gets wrong — out of reach of any test. This
 * is the purity `packages/infra/cli/src/utils/platform-check.ts` documents,
 * applied to the module whose entire job is a per-OS answer.
 */
export interface BlueprintHost {
    /** `process.platform` of the host being answered for. */
    platform: NodeJS.Platform;
    /** That host's environment. */
    env: Record<string, string | undefined>;
    /** Does this path exist? `existsSync` in production, a map in a test. */
    exists: (path: string) => boolean;
}

/**
 * `existsSync` throws rather than answering `false` when the argument is not a
 * usable path at all (an embedded NUL, for one) — and an unreadable or malformed
 * PATH entry is not an answer about the command we are looking for. Same catch,
 * and same reason, as `isOnPath()` in `@gjsify/cli`'s `check-system-deps.ts`.
 */
function existsSafe(path: string): boolean {
    try {
        return existsSync(path);
    } catch {
        return false;
    }
}

/** The running process as a {@link BlueprintHost}. */
export function currentBlueprintHost(): BlueprintHost {
    return { platform: process.platform, env: process.env, exists: existsSafe };
}

/**
 * MSYS2 install roots to probe on win32, in order.
 *
 * MSYS2 is the ONLY way to get blueprint-compiler onto Windows today, and not
 * for the reason the tool's Python-ness suggests: it is pure Python (PyPI ships
 * a `py3-none-any` wheel), but `blueprintcompiler/gir.py` reads TYPELIBS through
 * `GIRepository`, so it needs PyGObject — which publishes no Windows wheel, so
 * `pip install blueprint-compiler` dies building it from source. MSYS2 is where
 * Python, PyGObject and the typelibs arrive already fitted together.
 *
 * `C:\msys64` is the installer default; the `$USERPROFILE` entries cover the
 * extracted-archive install, which is what a host without admin rights gets;
 * `C:\tools\msys64` is Chocolatey's.
 */
function msys2Roots(env: BlueprintHost['env']): string[] {
    return [
        env.MSYS2_ROOT,
        'C:\\msys64',
        env.USERPROFILE && join(env.USERPROFILE, 'msys64'),
        env.USERPROFILE && join(env.USERPROFILE, 'Tools', 'msys64'),
        'C:\\tools\\msys64',
    ].filter((root): root is string => typeof root === 'string' && root.length > 0);
}

/**
 * MSYS2 environments, most-preferred first. `ucrt64` is MSYS2's own default for
 * new installs and links the modern Universal CRT; the others are probed so an
 * existing install is not rejected for being older.
 */
const MSYS2_ENVS = ['ucrt64', 'mingw64', 'clang64'];

/** Executable suffixes to try for a bare command name. Windows needs them; POSIX does not. */
function exeSuffixes(platform: NodeJS.Platform): string[] {
    return platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
}

/** First existing `<dir>/<cmd><suffix>`, or null. */
function findOnPath(cmd: string, host: BlueprintHost): string | null {
    const pathVar = host.env.PATH;
    if (!pathVar) return null;
    const sep = host.platform === 'win32' ? ';' : ':';
    for (const dir of pathVar.split(sep)) {
        if (!dir) continue;
        for (const suffix of exeSuffixes(host.platform)) {
            const candidate = join(dir, cmd + suffix);
            if (host.exists(candidate)) return candidate;
        }
    }
    return null;
}

/**
 * Find an MSYS2-provided blueprint-compiler.
 *
 * MSYS2 installs it as a SHEBANG SCRIPT with no `.exe` beside it, which Windows
 * cannot execute — so this returns MSYS2's own `python.exe` with the script as
 * its first argument, rather than the script alone. `<env>/bin` is prepended to
 * PATH because the script imports PyGObject, which loads MSYS2's libglib and its
 * typelibs from there.
 *
 * Deliberately does NOT set `GI_TYPELIB_PATH` at the gjsify GTK runtime bundle:
 * those typelibs are gvsbuild's and name `glib-2.0-0.dll` in their
 * `shared_library` field while MSYS2 ships `libglib-2.0-0.dll`. Measured — it
 * fails with "Failed to load shared library", and the obvious repair (put both
 * on PATH) would load two GLib builds into one process, which is a worse problem
 * than the one it solves.
 */
function findInMsys2(host: BlueprintHost): ResolvedBlueprintCompiler | null {
    if (host.platform !== 'win32') return null;
    for (const root of msys2Roots(host.env)) {
        for (const env of MSYS2_ENVS) {
            const bin = join(root, env, 'bin');
            const script = join(bin, 'blueprint-compiler');
            const python = join(bin, 'python.exe');
            if (!host.exists(script) || !host.exists(python)) continue;
            return {
                file: python,
                prefixArgs: [script],
                // `;` is a win32 fact, not a host fact — this branch only runs there.
                env: { PATH: `${bin};${host.env.PATH ?? ''}` },
                source: 'msys2',
            };
        }
    }
    return null;
}

/** Does this override name a location, as opposed to a bare command to look up? */
function looksLikePath(override: string): boolean {
    return override.includes('/') || override.includes('\\');
}

/**
 * Locate a usable blueprint-compiler, or null when there is none.
 *
 * Order: `BLUEPRINT_COMPILER` (an explicit answer always wins, and is the escape
 * hatch for an install none of the probes below know about) → `PATH` → an MSYS2
 * install on win32.
 *
 * A set-but-unusable override resolves to null rather than falling through to
 * the probes. Handing back a path that is not there sent its `ENOENT` into the
 * "the compiler EXISTS and refused the file" branch, which then blamed the
 * `.blp` for a typo in an environment variable; and quietly ignoring an explicit
 * instruction to run a second guess is not better. Null is what lets
 * {@link formatMissingBlueprintCompiler} say which of the two actually happened.
 */
export function resolveBlueprintCompiler(
    host: BlueprintHost = currentBlueprintHost(),
): ResolvedBlueprintCompiler | null {
    const override = host.env.BLUEPRINT_COMPILER;
    if (override) {
        if (looksLikePath(override)) {
            return host.exists(override) ? { file: override, prefixArgs: [], source: 'env' } : null;
        }
        // A bare command name is a legitimate override, and must still reach the
        // child through the same PATH walk any other command name gets.
        const onPath = findOnPath(override, host);
        return onPath ? { file: onPath, prefixArgs: [], source: 'env' } : null;
    }
    const onPath = findOnPath('blueprint-compiler', host);
    if (onPath) {
        return { file: onPath, prefixArgs: [], source: 'path' };
    }
    return findInMsys2(host);
}

/**
 * What to tell someone who has no blueprint-compiler.
 *
 * Names the install command for THIS platform rather than listing every one:
 * the reader is on one host and the other two lines are noise they have to
 * filter. The Linux arm is the exception that proves it — every Linux row of
 * `PM_PACKAGES` in `@gjsify/cli`'s `check-system-deps.ts` spells the package
 * identically, so splitting it per distro would be four lines carrying one word.
 *
 * `BLUEPRINT_COMPILER` is mentioned everywhere because it is the answer for any
 * install the probes miss — except when it is itself the problem, which gets its
 * own sentence: repeating "or set BLUEPRINT_COMPILER" at someone who just set it
 * is how a diagnostic loses their trust.
 */
export function formatMissingBlueprintCompiler(host: BlueprintHost = currentBlueprintHost()): string {
    const override = host.env.BLUEPRINT_COMPILER;
    if (override) {
        return (
            `BLUEPRINT_COMPILER is set to "${override}", which is not ${
                looksLikePath(override) ? 'a file that exists' : 'on PATH'
            }.\n` +
            '  Point it at a blueprint-compiler executable, or unset it to search PATH\n' +
            '  (and, on Windows, the usual MSYS2 install locations).'
        );
    }
    const install =
        host.platform === 'win32'
            ? 'MSYS2 packages it prebuilt (it needs PyGObject, which has no Windows wheel, so pip cannot):\n' +
              '    pacman -S mingw-w64-ucrt-x86_64-blueprint-compiler mingw-w64-ucrt-x86_64-gtk4 mingw-w64-ucrt-x86_64-libadwaita\n' +
              '  An MSYS2 install under C:\\msys64, %USERPROFILE%\\msys64, %USERPROFILE%\\Tools\\msys64 or\n' +
              '  C:\\tools\\msys64 is found automatically — it does NOT need to be on PATH.'
            : host.platform === 'darwin'
              ? 'brew install blueprint-compiler'
              : 'sudo dnf install blueprint-compiler   (apt, pacman, zypper and apk package it under the same name)';
    return (
        'blueprint-compiler was not found — @gjsify/vite-plugin-blueprint needs it to\n' +
        '  compile .blp templates to GtkBuilder XML.\n' +
        `  ${install}\n` +
        '  Or set BLUEPRINT_COMPILER to its full path.'
    );
}

/**
 * No usable compiler on this host.
 *
 * Carries the whole user-facing sentence so the wording has exactly one home and
 * the plugin composes nothing: what this replaces was an `ExecaError` naming the
 * COMMAND, in the guest's own language, from inside a rolldown plugin stack
 * (#1098).
 */
export class BlueprintCompilerNotFoundError extends Error {
    override readonly name = 'BlueprintCompilerNotFoundError';

    constructor(
        readonly blueprintPath: string,
        host: BlueprintHost = currentBlueprintHost(),
    ) {
        super(`${blueprintPath}: ${formatMissingBlueprintCompiler(host)}`);
    }
}

/**
 * The compiler exists and refused the file, so this is a blueprint syntax or
 * type error and its own stderr is the useful part — never an install hint the
 * reader has already satisfied.
 */
export class BlueprintCompileError extends Error {
    override readonly name = 'BlueprintCompileError';

    constructor(
        readonly blueprintPath: string,
        readonly compilerFile: string,
        detail: string,
    ) {
        super(`${blueprintPath}: blueprint-compiler failed (${compilerFile})\n${detail}`);
    }
}
