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
// IT ALSO CARRIES THE FONTS, and that reader is not GLib (ADR 0037). fontconfig
// expands the stock `fonts.conf`'s `<dir prefix="xdg">fonts</dir>` over
// `XDG_DATA_DIRS` as well as `XDG_DATA_HOME` — measured on fontconfig 2.17.0
// (Fedora 44) and 2.14.1 (`org.gnome.Platform//43`), in every list position,
// recursively, with a cold cache — so this one export is the whole mechanism
// behind `gjsify.ship.fonts` outside a `/usr` prefix, and it is what reaches
// `/app/share/fonts` in a Flatpak. `fonts-conf(5)` documents only
// `XDG_DATA_HOME`, so the behaviour is not re-derivable from the manual: do not
// narrow this line to the GLib readers on the strength of what the man page says.
//
// THREE FORMS, because neither other OS runs this file. macOS runs a `/bin/sh`
// script too but cannot use `readlink -f` and must not be handed a `DYLD_*`;
// Windows runs `cmd.exe`, which shares no syntax with either. What they DO share
// is the set of decisions — where the prefix comes from, which variables are
// exported, what is exec'd — so the three renderers sit here side by side and the
// dispatch is a `switch` with a `never` guard, the same closed-vocabulary
// discipline `packOne` uses for the packers.

import { posix } from 'node:path';

import type { LauncherRuntime } from './app-runtime.js';
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
 *
 * `runtime` names what the stage CARRIES (`utils/ship/app-runtime.ts`), as
 * stage-relative paths, and is empty when it carries nothing. The macOS and
 * Windows forms read it; the Linux one does not and never will, because its
 * interpreter is a package dependency. The default is what keeps a stage that
 * carries nothing byte-identical to what M1 wrote.
 */
export function renderLauncher(
    settings: ShipSettings,
    bundleRelPath: string,
    layout: Layout,
    runtime: LauncherRuntime = {},
): string {
    switch (layout.name) {
        case 'linux':
            return renderPrefixLauncher(settings, bundleRelPath, layout);
        case 'darwin':
            return renderAppBundleLauncher(settings, bundleRelPath, layout, runtime);
        case 'windows':
            return renderWindowsLauncher(settings, bundleRelPath, layout, runtime);
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

    // Where the faces landed, handed over for the same reason and in the same
    // shape as the catalogue directory above (ADR 0037). On Linux fontconfig
    // already finds them by itself, so this is the OS where the variable is
    // redundant — it is exported anyway because the ONE thing a consumer must not
    // have to write is an OS branch around a path this command chose. Windows is
    // where it is load-bearing: nothing there reaches a font file by
    // configuration, so the app registers it with
    // `PangoCairo.FontMap.get_default().add_font_file()` and this is how it learns
    // which directory to walk.
    if (settings.fontFiles.length > 0) {
        lines.push(`GJSIFY_FONT_DIR="$prefix"/${dirs.data}/fonts/${settings.appId}`, 'export GJSIFY_FONT_DIR');
    }

    lines.push(`exec ${execLine(layout, `"$prefix"/${dirs.bundle}/${bundleRelPath}`, settings)} "$@"`, '');
    return lines.join('\n');
}

/**
 * macOS: `Contents/MacOS/<name>` — what a self-contained bundle's launcher says,
 * and two things it must still NOT do.
 *
 * IT EXECS WHAT THE BUNDLE CARRIES. `runtime` comes from
 * `utils/ship/app-runtime.ts` and names the interpreter, the relocated GTK
 * closure and the node-gi addon staged inside `Contents/` — so the exec line is
 * `"$here/node"` and the two locators below point into `Contents/Frameworks`.
 * When the stage carries none of them every line here is byte-identical to what
 * M2a wrote, which is what keeps a bundle assembled without the runtime packages
 * exactly as (un)usable as it was rather than differently broken.
 *
 *  1. **No `readlink -f`.** That flag is GNU coreutils'; the BSD `readlink` macOS
 *     ships does not have it, and a launcher whose first command fails under
 *     `set -e` exits before it does anything. It needs none either: LaunchServices,
 *     `open(1)` and Finder all exec `Contents/MacOS/<name>` at its real path
 *     inside the bundle, and the staged tree holds no symlink to resolve.
 *  2. **No `DYLD_*`.** THE RULE STANDS AND ITS OLD REASON DID NOT, so the reason
 *     is replaced rather than the rule. This comment used to say a wrapper
 *     "structurally cannot hand the loader a library path" because SIP strips an
 *     inherited `DYLD_*` at the `/bin/sh` exec — which is stronger than what was
 *     measured, and this repository depends on the difference in two places that
 *     are green on the darwin legs today (`utils/bin-shim.ts`'s
 *     `dyldFallbackPreamble`, `packages/node-gi`'s `maybeReexecForGtkRuntime`).
 *     The narrow fact is that an INHERITED `DYLD_*` is stripped when a PROTECTED
 *     binary is exec'd; what a shim exports ITSELF survives into an unprotected
 *     child.
 *
 *     The reason that holds is one milestone away and points the same way: a
 *     hardened-runtime, Developer-ID-signed main executable IS restricted, so the
 *     variable is stripped there. A launcher depending on `DYLD_*` therefore
 *     works unsigned and breaks on the day the bundle is signed (#1354 M6,
 *     ADR 0024 § A4) — the worst possible day to find out. `GI_TYPELIB_PATH` is
 *     not a `DYLD_` variable and is stripped under neither rule, so the half that
 *     CAN be handed over is; the other half is
 *     `GIRepository.Repository.prepend_library_path` from inside the process,
 *     which is ADR 0021's decision for prebuilds applied to the app's own runtime.
 *
 *     Corrected rather than deleted, because a rule whose stated reason is wrong
 *     gets "simplified" back into the bug the first time somebody checks it.
 *
 *     What this function exports INSTEAD is the point of the distinction, not an
 *     exception to it: `GJSIFY_GTK_RUNTIME`, `NODE_GI_NATIVE`,
 *     `GJSIFY_GI_LIBRARY_PATH`, `GI_TYPELIB_PATH`. Every one is read by node-gi
 *     or by GLib in JS or in the process, none by dyld, so none is stripped from
 *     a restricted process and the bundle behaves the same signed and unsigned.
 *     The dylibs themselves need no variable at all: `install_name_tool` rewrote
 *     every install name to `@loader_path/<leaf>` when the closure was built, and
 *     the addon's `@rpath` is `@loader_path/gtk/lib` — which is exactly why the
 *     closure has to be staged as a TREE and not flattened.
 */
function renderAppBundleLauncher(
    settings: ShipSettings,
    bundleRelPath: string,
    layout: Layout,
    runtime: LauncherRuntime,
): string {
    const root = layout.root(settings);
    const contents = `${root}/Contents`;
    const dirs = layout.dirs(settings);
    // Every path is expressed relative to `Contents/`, which the launcher finds by
    // going one directory up from `Contents/MacOS`. Deriving them from the
    // layout's own directories is what keeps the two from drifting: they are the
    // same strings the planner placed the files with.
    const under = (dir: string): string => posix.relative(contents, dir);
    // …and the interpreter relative to `$here`, which is `Contents/MacOS` itself.
    // Two anchors rather than one because the launcher already computes both, and
    // `"$here/node"` is the shortest true expression for a file beside it.
    const beside = (path: string): string => posix.relative(dirs.launcher, path);

    const lines = [
        '#!/bin/sh',
        '# Generated by `gjsify ship` — do not edit.',
        'set -e',
        'here=$(cd -- "$(dirname -- "$0")" && pwd)',
        'contents=$(dirname -- "$here")',
        `XDG_DATA_DIRS="$contents/${under(dirs.data)}:\${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"`,
        'export XDG_DATA_DIRS',
    ];

    // The two locators a carried runtime needs, and both are read by node-gi ITSELF
    // rather than by a loader — which is the whole reason they are allowed here at
    // all (see this function's second numbered note).
    //
    // `GJSIFY_GTK_RUNTIME` is candidate 1 of `resolveGtkRuntimeBundle()`'s four.
    // Candidates 2–4 walk from `@gjsify/node-gi`'s own package directory or through
    // `node_modules`, and a shipped `.app` has neither: its JavaScript is one
    // bundled file under `Contents/Resources/lib`, so `import.meta.url` there
    // resolves node-gi's "package root" to the bundle's directory and every probed
    // path lands beside the bundle instead of in `Contents/Frameworks`.
    //
    // `NODE_GI_NATIVE` is the same problem for the addon: `prebuildAddonPath()`
    // joins `prebuilds/<target>/node_gi.node` onto that same wrong root
    // (`packages/node-gi/node-gi/native-paths.js`). An absolute path is one of the
    // three values that variable takes (`'build'`, `'prebuild'`, or a path), and
    // `nativeCandidates()` resolves it and returns it ALONE — so the bundle's addon
    // is not merely preferred, nothing else is tried.
    if (runtime.gtkRuntimeDir !== undefined) {
        lines.push(`GJSIFY_GTK_RUNTIME="$contents/${under(runtime.gtkRuntimeDir)}"`, 'export GJSIFY_GTK_RUNTIME');
    }
    if (runtime.nodeGiAddon !== undefined) {
        lines.push(`NODE_GI_NATIVE="$contents/${under(runtime.nodeGiAddon)}"`, 'export NODE_GI_NATIVE');
    }

    if (settings.typelibFiles.length > 0) {
        lines.push(
            `GI_TYPELIB_PATH="$contents/${under(dirs.native)}"\${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}`,
            'export GI_TYPELIB_PATH',
        );
        // The other half of the same pair, and the half no loader variable can
        // carry here. GI resolves the typelib and then `g_module_open`s the bare
        // leaf it records; `LD_LIBRARY_PATH` answers that on Linux and `DYLD_*`
        // cannot answer it in a signed bundle. `GJSIFY_GI_LIBRARY_PATH` is read by
        // node-gi in JS and handed to `gi_repository_prepend_library_path()`, so
        // dyld never sees it (#1410). Written here for the first time: that fix
        // shipped the READER with no writer anywhere in this pipeline.
        lines.push(
            `GJSIFY_GI_LIBRARY_PATH="$contents/${under(dirs.native)}"\${GJSIFY_GI_LIBRARY_PATH:+:$GJSIFY_GI_LIBRARY_PATH}`,
            'export GJSIFY_GI_LIBRARY_PATH',
        );
    }
    if (settings.localeFiles.length > 0) {
        lines.push(`GJSIFY_LOCALE_DIR="$contents/${under(dirs.data)}/locale"`, 'export GJSIFY_LOCALE_DIR');
    }
    // The face directory, for the same reason as above — and on THIS OS it is
    // informational rather than the mechanism: `Info.plist`'s
    // `ATSApplicationFontsPath` has already had macOS activate the same directory
    // before this script's interpreter started (ADR 0037). Exported all the same,
    // so a consumer that wants to name a bundled family has one spelling on three
    // operating systems instead of an OS branch.
    if (settings.fontFiles.length > 0) {
        lines.push(`GJSIFY_FONT_DIR="$contents/${under(dirs.data)}/fonts/${settings.appId}"`, 'export GJSIFY_FONT_DIR');
    }

    // `"$here/node"`, not `node`. The bare name is true of a developer's machine
    // and false of a `.app` a stranger downloads, and the difference is not a
    // degraded experience: macOS ships no Node at all, so the launcher's first act
    // would be `exec: node: not found`.
    const interpreter = runtime.interpreter === undefined ? undefined : `"$here/${beside(runtime.interpreter)}"`;
    lines.push(
        `exec ${execLine(layout, `"$contents/${under(dirs.bundle)}/${bundleRelPath}"`, settings, interpreter)} "$@"`,
        '',
    );
    return lines.join('\n');
}

/**
 * Windows: a `.cmd` that derives the program directory from `%~dp0` — and execs
 * the interpreter that directory carries.
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
 * on Linux, and where nothing can be on macOS. It is also the answer to the
 * question `GJSIFY_GI_LIBRARY_PATH` answers in the `.app` form: GI resolves a
 * typelib and then `g_module_open`s the bare leaf it records, and on Windows
 * `PATH` reaches that leaf, so no second variable is needed.
 *
 * WHAT THIS DELIBERATELY DOES NOT PUT ON `PATH` is the carried GTK closure's own
 * `bin/`, and the omission is the Windows counterpart of the `.app` form's "no
 * `DYLD_*`" rule — with the opposite reason, so it is written down rather than
 * inferred. node-gi does it ITSELF, in-process, before it `require`s the addon:
 * `maybePrependGtkRuntimeDllPath()` runs at `packages/node-gi/node-gi/index.js`
 * top level, above `loadNative()`, because "Windows re-reads the DLL search path
 * at every LoadLibrary (unlike dyld's launch-time capture), so mutating
 * process.env.PATH in-process before the require() below covers both the static
 * DLL imports and the runtime g_module_open of typelib backers". What that
 * function needs from the launcher is the LOCATOR — `GJSIFY_GTK_RUNTIME`,
 * candidate 1 of `resolveGtkRuntimeBundle()`'s four — and a launcher-set `PATH`
 * would be a second, silently diverging copy of a directory node-gi already
 * derives from it.
 *
 * `runtime` comes from `utils/ship/app-runtime.ts` and names what the program
 * directory CARRIES, as stage-relative paths. When it carries nothing every line
 * here is byte-identical to what M1 wrote (#1354 M3).
 */
function renderWindowsLauncher(
    settings: ShipSettings,
    bundleRelPath: string,
    layout: Layout,
    runtime: LauncherRuntime,
): string {
    const dirs = layout.dirs(settings);
    // `%~dp0` already ends in a backslash, so every path below concatenates
    // directly — which is the whole dialect difference from the `.app` form's
    // `"$here/node"`, where the separator is written out. `utils/ship/payload.ts`
    // reads this token back and has to know it (`readLauncherInterpreters`).
    const at = (rel: string): string => `%HERE%${windowsPath(rel)}`;
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

    // The two locators a carried runtime needs, identical in role to the `.app`
    // form's and read by node-gi ITSELF rather than by a loader. `GJSIFY_GTK_RUNTIME`
    // is candidate 1 of `resolveGtkRuntimeBundle()`'s four, and candidates 2-4 walk
    // from `@gjsify/node-gi`'s own package directory — which, in a shipped program
    // directory, resolves to wherever the staged JavaScript sits and not to `lib/`.
    // `NODE_GI_NATIVE` pins the addon the same way, absolutely, so
    // `nativeCandidates()` returns it ALONE.
    //
    // `set "NAME=value"`, quoted, because an unquoted `set` keeps trailing spaces
    // and a program directory under `C:\Program Files\…` has spaces in it.
    if (runtime.gtkRuntimeDir !== undefined) {
        lines.push(`set "GJSIFY_GTK_RUNTIME=${at(runtime.gtkRuntimeDir)}"`);
    }
    if (runtime.nodeGiAddon !== undefined) {
        lines.push(`set "NODE_GI_NATIVE=${at(runtime.nodeGiAddon)}"`);
    }

    if (settings.typelibFiles.length > 0) {
        lines.push(prependVar('GI_TYPELIB_PATH', at(dirs.native)), prependVar('PATH', at(dirs.native)));
    }
    if (settings.localeFiles.length > 0) {
        lines.push(`set "GJSIFY_LOCALE_DIR=${at(dirs.data)}\\locale"`);
    }
    // THE ONE OS WHERE THIS VARIABLE IS THE WHOLE HANDOVER (ADR 0037). GTK4 here
    // is pangowin32, whose font map is populated by
    // `pango_win32_dwrite_font_map_populate()` — DirectWrite's system font
    // collection plus Pango's own font-set builder, and NOT a filesystem search
    // path. There is no env var, no manifest element and no side-by-side entry
    // that activates a font file for one process; `AddFontResourceEx(FR_PRIVATE)`
    // registers with GDI, which that populate call never consults. So the app
    // registers the faces itself with
    // `PangoCairo.FontMap.get_default().add_font_file()` (Pango 1.56+, in the
    // typelib, and on win32 it clears the map's cache and emits `changed`, so it
    // works after the map exists), and this line is how it is told where.
    if (settings.fontFiles.length > 0) {
        lines.push(`set "GJSIFY_FONT_DIR=${at(dirs.data)}\\fonts\\${windowsPath(settings.appId)}"`);
    }

    // `"%HERE%node.exe"`, not `node`. The bare name is true of a developer's
    // machine and false of a program directory a stranger unzips: Windows ships no
    // Node at all, so the launcher's first act would be `'node' is not recognized
    // as an internal or external command`.
    const interpreter = runtime.interpreter === undefined ? undefined : `"${at(runtime.interpreter)}"`;
    // No `exec` in batch. `cmd.exe` reports the last command's exit code when the
    // script ends, so the interpreter's status is the launcher's status.
    lines.push(
        `${execLine(layout, `"${at(dirs.bundle)}\\${windowsPath(bundleRelPath)}"`, settings, interpreter)} %*`,
        '',
    );
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
 * Since #1486 `settings.app` is itself resolved per target (`resolveShipApp`), so
 * "NOT the layout" keeps meaning exactly what it meant: the layout does not DERIVE
 * the runtime, an author STATES it per OS. Deriving it here would still stage
 * `exec node` in front of a GJS bundle for everyone who said nothing.
 *
 * `Layout.runtimeGap` is where the honest half of that lives: it says, per OS,
 * why the staged launcher does not yet name what § 4 derives, and `gjsify ship`
 * prints it.
 *
 * `gjs` needs `-m` to treat the bundle as an ES module; `node` decides from the
 * extension and rejects the flag.
 *
 * THE NAME OR A PATH, and which one is a fact about the STAGE. On Linux it stays
 * the bare name, because the emitted dependency is what guarantees the
 * interpreter is on `PATH` — and on Fedora `/usr/bin/node` is an alternatives
 * symlink whose target is whichever stream package won, so hardcoding a path
 * there would pin the launcher to a layout the dependency does not promise. macOS
 * and Windows have no system Node and no dependency to declare, which is what
 * `@gjsify/node-runtime-<target>` exists for; this comment used to say "the day a
 * stage carries one, THIS is the line that names it by a layout-relative path
 * instead", and #1354 M2b is that day — `utils/ship/app-runtime.ts` stages the
 * interpreter into `Contents/MacOS/node` and the `.app` launcher execs
 * `"$here/node"`.
 *
 * #1354 M3 is the same day one OS over: the Windows layout stages `node.exe` into
 * the program directory and its `.cmd` runs `"%HERE%node.exe"`.
 *
 * `utils/ship/payload.ts`'s `readLauncherInterpreters` reads those quoted,
 * variable-bearing tokens back to the bare name `node`, which is what keeps
 * `assertLauncherMatchesInterpreter` a check rather than a vacuous pass. The two
 * dialects differ in a way that reader has to know: `$here/` writes its separator
 * and `%~dp0` already ends in one, so the macOS token splits on a `/` that is
 * there and the Windows token has no separator to split on at all.
 */
function execLine(layout: Layout, bundle: string, settings: ShipSettings, interpreter?: string): string {
    const quote = layout.name === 'windows' ? cmdQuote : shellQuote;
    const args = settings.execArgs.map(quote).join(' ');
    // The NAME when the stage carries no interpreter, the layout-relative PATH
    // when it does. `-m` stays attached to `gjs` in both branches: it tells the
    // interpreter to read the bundle as a module and has nothing to do with how
    // the interpreter was found.
    const program = interpreter ?? (settings.app === 'node' ? 'node' : 'gjs');
    return `${settings.app === 'node' ? program : `${program} -m`} ${bundle}${args ? ` ${args}` : ''}`;
}
