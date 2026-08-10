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
const MSYS2_ROOTS = [
    process.env.MSYS2_ROOT,
    'C:\\msys64',
    process.env.USERPROFILE && join(process.env.USERPROFILE, 'msys64'),
    process.env.USERPROFILE && join(process.env.USERPROFILE, 'Tools', 'msys64'),
    'C:\\tools\\msys64',
].filter((root): root is string => typeof root === 'string' && root.length > 0);

/**
 * MSYS2 environments, most-preferred first. `ucrt64` is MSYS2's own default for
 * new installs and links the modern Universal CRT; the others are probed so an
 * existing install is not rejected for being older.
 */
const MSYS2_ENVS = ['ucrt64', 'mingw64', 'clang64'];

/** Executable suffixes to try for a bare command name. Windows needs them; POSIX does not. */
const EXE_SUFFIXES = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];

/** First existing `<dir>/<cmd><suffix>`, or null. */
function findOnPath(cmd: string): string | null {
    const pathVar = process.env.PATH;
    if (!pathVar) return null;
    const sep = process.platform === 'win32' ? ';' : ':';
    for (const dir of pathVar.split(sep)) {
        if (!dir) continue;
        for (const suffix of EXE_SUFFIXES) {
            const candidate = join(dir, cmd + suffix);
            try {
                if (existsSync(candidate)) return candidate;
            } catch {
                // An unreadable PATH entry is not an answer about `cmd`.
            }
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
function findInMsys2(): ResolvedBlueprintCompiler | null {
    if (process.platform !== 'win32') return null;
    for (const root of MSYS2_ROOTS) {
        for (const env of MSYS2_ENVS) {
            const bin = join(root, env, 'bin');
            const script = join(bin, 'blueprint-compiler');
            const python = join(bin, 'python.exe');
            try {
                if (!existsSync(script) || !existsSync(python)) continue;
            } catch {
                continue;
            }
            return {
                file: python,
                prefixArgs: [script],
                env: { PATH: `${bin};${process.env.PATH ?? ''}` },
                source: 'msys2',
            };
        }
    }
    return null;
}

/**
 * Locate a usable blueprint-compiler, or null when there is none.
 *
 * Order: `BLUEPRINT_COMPILER` (an explicit answer always wins, and is the escape
 * hatch for an install none of the probes below know about) → `PATH` → an MSYS2
 * install on win32.
 */
export function resolveBlueprintCompiler(): ResolvedBlueprintCompiler | null {
    const override = process.env.BLUEPRINT_COMPILER;
    if (override) {
        return { file: override, prefixArgs: [], source: 'env' };
    }
    const onPath = findOnPath('blueprint-compiler');
    if (onPath) {
        return { file: onPath, prefixArgs: [], source: 'path' };
    }
    return findInMsys2();
}

/**
 * What to tell someone who has no blueprint-compiler.
 *
 * Names the install command for THIS platform rather than listing every one:
 * the reader is on one host and the other two lines are noise they have to
 * filter. `BLUEPRINT_COMPILER` is mentioned everywhere because it is the answer
 * for any install the probes miss.
 */
export function formatMissingBlueprintCompiler(): string {
    const install =
        process.platform === 'win32'
            ? 'MSYS2 packages it prebuilt (it needs PyGObject, which has no Windows wheel, so pip cannot):\n' +
              '    pacman -S mingw-w64-ucrt-x86_64-blueprint-compiler mingw-w64-ucrt-x86_64-gtk4 mingw-w64-ucrt-x86_64-libadwaita\n' +
              '  An MSYS2 install under C:\\msys64, %USERPROFILE%\\msys64, %USERPROFILE%\\Tools\\msys64 or\n' +
              '  C:\\tools\\msys64 is found automatically — it does NOT need to be on PATH.'
            : process.platform === 'darwin'
              ? 'brew install blueprint-compiler'
              : 'sudo dnf install blueprint-compiler   (Debian/Ubuntu: sudo apt install blueprint-compiler)';
    return (
        'blueprint-compiler was not found, so a .blp template cannot be compiled.\n' +
        `  ${install}\n` +
        '  Or set BLUEPRINT_COMPILER to its full path.'
    );
}
