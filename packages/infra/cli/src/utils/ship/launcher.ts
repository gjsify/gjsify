// The launcher a package installs in front of the app — one form per OS layout.
//
// Every form execs ONE interpreter, named by `settings.app`, and `deriveDepends`
// seeds the dependency from that same field. That coupling is the point rather
// than a convenience: the first cut of the Node half derived "this payload needs
// Node" from a FILENAME (`*.node.mjs` anywhere in the staged tree) while this
// function still execed gjs unconditionally, and the two disagreed in both
// directions — a `--app gjs` project that merely built a Node bundle beside its
// GJS one got `Depends: gjs (>= 1.86), nodejs (>= 24)` and a launcher running the
// GJS bundle, and `>= 24` is unsatisfiable on every current DEB stable, so a
// working package became uninstallable for a reason its author never opted into.
// `assertLauncherMatchesInterpreter` in `utils/ship/payload.ts` re-reads this
// line off the STAGED file and is the gate that keeps the two from drifting
// apart again. It reads the LAYOUT's launcher, so the three forms below share one
// `execLine` rather than each answering the question themselves.
//
// It derives its own location at runtime instead of having one baked in. That is
// what lets ONE staged payload become a `.deb` under `/usr`, an `.rpm` under
// `/usr` and a Flatpak under `/app` (ADR 0024 § 3) — a baked path would force a
// payload per format and collapse the whole design back into N packagers.
//
// `XDG_DATA_DIRS` is prepended for the same reason, and on all three OSes: GTK
// and GLib read it on macOS and Windows too, and it is what makes the staged
// icons, the desktop entry and the compiled GSettings schemas findable wherever
// the tree was installed. Getting that from the launcher rather than from the app
// keeps the app free of install-layout knowledge.
//
// THREE FORMS, because neither other OS runs this file. macOS runs a `/bin/sh`
// script too but cannot use `readlink -f` and must not be handed a `DYLD_*`;
// Windows runs `cmd.exe`, which shares no syntax with either. What they DO share
// is the set of decisions — where the prefix comes from, which variables are
// exported, what is exec'd — so the three renderers sit here side by side and the
// dispatch is a `switch` with a `never` guard, the same closed-vocabulary
// discipline `packOne` uses for the packers.

import { posix } from 'node:path';

import type { Layout } from './layout.js';
import type { ShipSettings } from './types.js';

/** POSIX-shell single-quote: the only escape inside `'…'` is `'\''`. */
function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Quote one argument for `cmd.exe`, or refuse it.
 *
 * `cmd.exe` has no escape that survives its own parser for `"` or `%` inside a
 * quoted string: `%` starts an expansion at PARSE time (so `%foo%` silently
 * becomes empty rather than staying literal), and `"` ends the quoted run with
 * nothing that reliably re-opens it. `!` is only special under delayed expansion,
 * which this launcher does not enable, but a consumer copying the line into one
 * that does gets the same silent substitution — so all three are refused with the
 * config key named, rather than emitted into a launcher that runs with the wrong
 * argv.
 */
function cmdQuote(value: string): string {
    const bad = /["%!\r\n]/.exec(value);
    if (bad !== null) {
        throw new Error(
            `gjsify ship: \`gjsify.ship.execArgs\` contains ${JSON.stringify(value)}, and cmd.exe has no way ` +
                `to pass ${JSON.stringify(bad[0])} through a Windows launcher literally — \`%\` expands at ` +
                'parse time and `"` ends the quoted run. Move the value into the app (it can read it from its ' +
                'own config) or drop the character.',
        );
    }
    return `"${value}"`;
}

/**
 * Render the launcher for one layout.
 *
 * `bundleRelPath` is the bundle's path inside the layout's BUNDLE directory —
 * `lib/<binaryName>/` on Linux, `Contents/Resources/lib/` in a `.app`, `app\` in
 * a Windows program directory.
 */
export function renderLauncher(settings: ShipSettings, bundleRelPath: string, layout: Layout): string {
    switch (layout.name) {
        case 'linux':
            return renderPrefixLauncher(settings, bundleRelPath, layout);
        case 'darwin':
            return renderAppBundleLauncher(settings, bundleRelPath, layout);
        case 'windows':
            return renderWindowsLauncher(settings, bundleRelPath, layout);
        default: {
            const unhandled: never = layout.name;
            throw new Error(`gjsify ship: no launcher is wired for the "${String(unhandled)}" layout.`);
        }
    }
}

/**
 * Linux: a `/bin/sh` script that walks up from its own RESOLVED path to the prefix.
 *
 * `readlink -f` is what makes this correct when the package's `bin/` entry has
 * been symlinked — `/usr/local/bin/<name>` → `/usr/lib/<pkg>/…` is a layout
 * distributions produce — and it is GNU coreutils', which every Linux this
 * packages for has.
 */
function renderPrefixLauncher(settings: ShipSettings, bundleRelPath: string, layout: Layout): string {
    const dirs = layout.dirs(settings);
    const lines = [
        '#!/bin/sh',
        '# Generated by `gjsify ship` — do not edit.',
        'set -e',
        'self=$(readlink -f "$0")',
        'prefix=$(dirname "$(dirname "$self")")',
        `XDG_DATA_DIRS="$prefix/${dirs.data}:\${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"`,
        'export XDG_DATA_DIRS',
    ];

    // Typelibs the package carries itself (see `gjsify.ship.bundledTypelibs`). PREPENDED, not
    // replacing: an app that ships `Gwebgl` still needs the system `Gtk`, and clobbering the path
    // would trade one missing namespace for all the others. Only emitted when something was
    // actually staged — an empty `GI_TYPELIB_PATH` entry makes GI search a directory that is not
    // there, on every import, forever.
    if (settings.typelibFiles.length > 0) {
        const giDir = `"$prefix"/${dirs.native}`;
        for (const variable of ['GI_TYPELIB_PATH', 'LD_LIBRARY_PATH']) {
            // `${VAR:+:$VAR}` appends the existing value with a separator ONLY when it is set —
            // a plain `:$VAR` leaves a trailing colon, which both loaders read as "and the current
            // directory", and a package that silently adds `.` to a library path is a bad package.
            lines.push(`${variable}=${giDir}\${${variable}:+:$${variable}}`, `export ${variable}`);
        }
    }

    // Where the app's gettext catalogues landed. `bindtextdomain` takes a DIRECTORY and there is no
    // standard environment variable it reads on its own (`TEXTDOMAINDIR` is honoured by the gettext
    // command-line tools, not by the library), so the prefix has to reach the app somehow. Passing
    // it from the launcher keeps the app free of install-layout knowledge, exactly as XDG_DATA_DIRS
    // above does for icons and schemas — a baked `/usr/share/locale` would be wrong in a Flatpak
    // and in any `--prefix` tree.
    if (settings.localeFiles.length > 0) {
        lines.push(`GJSIFY_LOCALE_DIR="$prefix"/${dirs.data}/locale`, 'export GJSIFY_LOCALE_DIR');
    }

    lines.push(`exec ${execLine(layout, `"$prefix"/${dirs.bundle}/${bundleRelPath}`, settings)} "$@"`, '');
    return lines.join('\n');
}

/**
 * macOS: `Contents/MacOS/<name>`, and two things it must NOT do.
 *
 *  1. **No `readlink -f`.** That flag is GNU coreutils'; the BSD `readlink` macOS
 *     ships does not have it, and a launcher whose first command fails under
 *     `set -e` exits before it does anything. It needs none either: LaunchServices,
 *     `open(1)` and Finder all exec `Contents/MacOS/<name>` at its real path
 *     inside the bundle, and the staged tree holds no symlink to resolve.
 *  2. **No `DYLD_*`.** SIP strips an inherited `DYLD_*` at the `/bin/sh` exec, so
 *     a wrapper structurally cannot hand the loader a library path — measured on
 *     the macOS 15.7.9 VM and written down as ADR 0024 § 3. `GI_TYPELIB_PATH` is
 *     not a `DYLD_` variable and does survive, so the half that CAN be handed
 *     over is; the other half is `GIRepository.Repository.prepend_library_path`
 *     from inside the process, which is ADR 0021's decision for prebuilds applied
 *     to the app's own runtime.
 */
function renderAppBundleLauncher(settings: ShipSettings, bundleRelPath: string, layout: Layout): string {
    const contents = `${layout.root(settings)}/Contents`;
    const dirs = layout.dirs(settings);
    // Every path is expressed relative to `Contents/`, which the launcher finds by
    // going one directory up from `Contents/MacOS`. Deriving them from the
    // layout's own directories is what keeps the two from drifting: they are the
    // same strings the planner placed the files with.
    const under = (dir: string): string => posix.relative(contents, dir);

    const lines = [
        '#!/bin/sh',
        '# Generated by `gjsify ship` — do not edit.',
        'set -e',
        'here=$(cd -- "$(dirname -- "$0")" && pwd)',
        'contents=$(dirname -- "$here")',
        `XDG_DATA_DIRS="$contents/${under(dirs.data)}:\${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"`,
        'export XDG_DATA_DIRS',
    ];

    if (settings.typelibFiles.length > 0) {
        lines.push(
            `GI_TYPELIB_PATH="$contents/${under(dirs.native)}"\${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}`,
            'export GI_TYPELIB_PATH',
        );
    }
    if (settings.localeFiles.length > 0) {
        lines.push(`GJSIFY_LOCALE_DIR="$contents/${under(dirs.data)}/locale"`, 'export GJSIFY_LOCALE_DIR');
    }

    lines.push(`exec ${execLine(layout, `"$contents/${under(dirs.bundle)}/${bundleRelPath}"`, settings)} "$@"`, '');
    return lines.join('\n');
}

/**
 * Windows: a `.cmd` that derives the program directory from `%~dp0`.
 *
 * CRLF, and that is not cosmetic — `cmd.exe` reads a batch file in chunks and
 * re-seeks by byte OFFSET while it runs, which is where the documented `goto` and
 * block-parsing failures on LF-only files come from. It costs nothing to be right
 * about, and the file is ASCII for the same reason: a batch file is read in the
 * console's active code page, not as UTF-8.
 *
 * `PATH` carries the native directory because Windows has no rpath: a DLL is
 * found on `PATH`, in the directory of the image that loaded it, or not at all.
 * That makes `PATH` the load-bearing variable here — where `LD_LIBRARY_PATH` is
 * on Linux, and where nothing can be on macOS.
 */
function renderWindowsLauncher(settings: ShipSettings, bundleRelPath: string, layout: Layout): string {
    const dirs = layout.dirs(settings);
    // `%~dp0` already ends in a backslash, so every path below concatenates directly.
    const at = (dir: string): string => `%HERE%${windowsPath(dir)}`;
    const lines = [
        '@echo off',
        'rem Generated by "gjsify ship" - do not edit.',
        'setlocal',
        'set "HERE=%~dp0"',
        // `if defined` rather than a bare `;%VAR%`, for the reason the sh form
        // gives: an unset variable leaves a trailing separator, and an empty entry
        // in a Windows search path is read as the current directory.
        prependVar('XDG_DATA_DIRS', at(dirs.data)),
    ];

    if (settings.typelibFiles.length > 0) {
        lines.push(prependVar('GI_TYPELIB_PATH', at(dirs.native)), prependVar('PATH', at(dirs.native)));
    }
    if (settings.localeFiles.length > 0) {
        lines.push(`set "GJSIFY_LOCALE_DIR=${at(dirs.data)}\\locale"`);
    }

    // No `exec` in batch. `cmd.exe` reports the last command's exit code when the
    // script ends, so the interpreter's status is the launcher's status.
    lines.push(`${execLine(layout, `"${at(dirs.bundle)}\\${windowsPath(bundleRelPath)}"`, settings)} %*`, '');
    return lines.join('\r\n');
}

/** `set "VAR=<value>;%VAR%"`, and just `<value>` when VAR is not set. */
function prependVar(variable: string, value: string): string {
    return `if defined ${variable} (set "${variable}=${value};%${variable}%") else (set "${variable}=${value}")`;
}

/** POSIX-separated → Windows-separated. An empty segment would produce `\\`, which is a UNC root. */
function windowsPath(rel: string): string {
    return rel
        .split('/')
        .filter((part) => part.length > 0)
        .join('\\');
}

/**
 * The interpreter, the bundle and the project's own `execArgs` — for every layout.
 *
 * ONE function, called by all three forms, because the answer is the same
 * question everywhere and the launcher is where it is checkable:
 * `assertLauncherMatchesInterpreter` reads this line back off the STAGED file
 * and compares it with the dependency about to be declared.
 *
 * `settings.app`, NOT the layout. ADR 0024 § 4's runtime-per-OS table says what
 * a shipped artifact CARRIES — that is `Layout.shippedRuntime` — and reading it
 * as a per-layout launcher decision breaks both directions at once: it would
 * refuse `gjsify.app: "gjs"` for the macOS layout, and it would put `exec node`
 * in front of a bundle whose first line is
 * `import Gtk from 'gi://Gtk?version=4.0'`. Measured before it was fixed: a
 * project with no `gjsify.app` key staged
 * `exec node "$contents/Resources/lib/gjs.js"` for macOS at exit 0. The only
 * interpreter that can read the payload is the one the payload was BUILT for,
 * and that is `settings.app` on all three.
 *
 * `Layout.runtimeGap` is where the honest half of that lives: it says, per OS,
 * why the staged launcher does not yet name what § 4 derives, and `gjsify ship`
 * prints it.
 *
 * `gjs` needs `-m` to treat the bundle as an ES module; `node` decides from the
 * extension and rejects the flag. The interpreter NAME, not a path: both are
 * found on `PATH`, which is what the emitted dependency guarantees is there —
 * and on Fedora `/usr/bin/node` is an alternatives symlink whose target is
 * whichever stream package won, so hardcoding a path would pin the launcher to a
 * layout the dependency does not promise. macOS and Windows have no system Node
 * and no dependency to declare, which is what `@gjsify/node-runtime-<target>`
 * exists for; the day a stage carries one, THIS is the line that names it by a
 * layout-relative path instead.
 */
function execLine(layout: Layout, bundle: string, settings: ShipSettings): string {
    const quote = layout.name === 'windows' ? cmdQuote : shellQuote;
    const args = settings.execArgs.map(quote).join(' ');
    const head = settings.app === 'node' ? 'node' : 'gjs -m';
    return `${head} ${bundle}${args ? ` ${args}` : ''}`;
}
