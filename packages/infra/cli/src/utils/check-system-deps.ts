// System dependency checker for gjsify CLI.
// Uses execFileSync with explicit argument arrays — no shell injection possible.
// All binary names are hardcoded constants, never derived from user input.
//
// Severity model:
//   - 'required'  → must be present, exit code 1 if missing
//   - 'optional'  → nice to have, only warned about, exit code stays 0
//
// Conditional checking: when a project's package.json is reachable from cwd,
// optional system deps are only checked if the corresponding @gjsify/* package
// is in the project's dependency tree. A user with only @gjsify/fs in their
// project never sees a warning about libmanette.

import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
// The zero-dependency subpath, deliberately: importing the plugin root would
// pull vite/execa/minify-xml into a system CHECK.
import { resolveBlueprintCompiler } from '@gjsify/vite-plugin-blueprint/resolve';

export type DepSeverity = 'required' | 'optional';

export interface DepCheck {
    /** Stable key used for install command lookup, e.g. "gjs" */
    id: string;
    /** Human-readable display name, e.g. "GJS" */
    name: string;
    found: boolean;
    /** Version string when found, e.g. "1.86.0" */
    version?: string;
    /** required = exit 1 if missing, optional = warn only */
    severity: DepSeverity;
    /** For optional deps: which @gjsify/* packages need this lib */
    requiredBy?: string[];
}

export type PackageManager = 'apt' | 'dnf' | 'pacman' | 'zypper' | 'apk' | 'brew' | 'winget' | 'unknown';

/** Run a binary and return its stdout trimmed, or null if it fails. */
function tryExecFile(binary: string, args: string[]): string | null {
    try {
        return execFileSync(binary, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return null;
    }
}

/**
 * True when `cmd` is on PATH. Walks `process.env.PATH` with `existsSync`
 * instead of shelling out to `which`(1).
 *
 * `which` is NOT a probe you can rely on: the Fedora 43/44 minimal containers
 * CI runs in ship without it (only the `which-2.x` rpm provides it), so a
 * `which`-based check silently answers "missing" for EVERY command. That is
 * exactly where this file's answer matters most — `detectPackageManager()`
 * returning `unknown` makes `buildInstallCommand()` return null, so the
 * distro-specific install hint for a missing system library prints nothing on
 * the hosts that needed it. Measured twice on 2026-08-05: ts-for-gir#437 had to
 * discover `json-glib` by hand, bauplaner#40 `libsoup3` — both in such a
 * container, both while this file already declared the dependency.
 *
 * `tests/e2e/helpers.mjs`'s `hasCommand()` carries the same walk for the same
 * reason. It stays a second copy on purpose: it is `.mjs` under `tests/` and
 * cannot be imported from the shipped CLI.
 */
export function isOnPath(cmd: string): boolean {
    const pathVar = process.env.PATH;
    if (!pathVar) return false;
    const sep = process.platform === 'win32' ? ';' : ':';
    for (const dir of pathVar.split(sep)) {
        if (!dir) continue;
        try {
            if (existsSync(join(dir, cmd))) return true;
        } catch {
            // An inaccessible PATH entry is not an answer about `cmd`.
        }
    }
    return false;
}

/** Check if a binary exists and optionally capture its version output. */
function checkBinary(
    id: string,
    name: string,
    binary: string,
    versionArgs: string[],
    severity: DepSeverity,
    parseVersion?: (out: string) => string,
    requiredBy?: string[],
): DepCheck {
    const out = tryExecFile(binary, versionArgs);
    if (out === null) return { id, name, found: false, severity, requiredBy };
    const version = parseVersion ? parseVersion(out) : (out.split('\n')[0] ?? out);
    return { id, name, found: true, version, severity, requiredBy };
}

/** Check a pkg-config library. pkg-config --modversion returns version on stdout. */
function checkPkgConfig(
    id: string,
    name: string,
    libName: string,
    severity: DepSeverity,
    requiredBy?: string[],
): DepCheck {
    const version = tryExecFile('pkg-config', ['--modversion', libName]);
    if (version === null) return { id, name, found: false, severity, requiredBy };
    return { id, name, found: true, version: version.split('\n')[0], severity, requiredBy };
}

/**
 * Check for an npm package. Tries the user's project first (cwd), then falls
 * back to the CLI's own node_modules. This way a locally installed version
 * takes precedence, but npx usage still works via the CLI's own dependencies.
 */
function checkNpmPackage(
    id: string,
    name: string,
    packageName: string,
    cwd: string,
    severity: DepSeverity,
    requiredBy?: string[],
): DepCheck {
    // 1. Try user's project
    try {
        const requireFromCwd = createRequire(pathToFileURL(join(cwd, '_check_.js')).href);
        requireFromCwd.resolve(packageName);
        return { id, name, found: true, severity, requiredBy };
    } catch {
        /* not in project, try CLI fallback */
    }

    // 2. Fallback: CLI's own node_modules
    try {
        const requireFromCli = createRequire(import.meta.url);
        requireFromCli.resolve(packageName);
        return { id, name, found: true, severity, requiredBy };
    } catch {
        return { id, name, found: false, severity, requiredBy };
    }
}

/**
 * The package manager whose install command we may suggest.
 *
 * Probe order is PLATFORM-FIRST, not a single global list. On macOS the Linux
 * managers are absent, so a flat list ending in `brew` would work by accident —
 * but Homebrew also runs on Linux, where it is the LAST resort rather than the
 * first (a Fedora host with linuxbrew installed wants `sudo dnf install`, whose
 * packages carry the distro's own GI typelibs). Keying the order on
 * `process.platform` states that intent instead of leaving it to list position.
 *
 * Returning `unknown` is a supported answer, not a failure: `buildInstallCommand`
 * then prints no command rather than a wrong one. That is the honest result on a
 * MacPorts or Nix host, and it is why this must never fall back to "probably brew".
 */
export function detectPackageManager(): PackageManager {
    // win32 has no `which`, so the loop below would return `unknown` by
    // ACCIDENT rather than by construction — which was the pre-existing
    // behaviour and produced the right answer for the wrong reason. `winget`
    // ships with Windows 11 and is what a user actually has, and it is only
    // ever consulted for the one dependency this platform has an entry for.
    if (process.platform === 'win32') {
        return tryExecFile('where', ['winget']) !== null ? 'winget' : 'unknown';
    }
    const managers: PackageManager[] =
        process.platform === 'darwin' ? ['brew'] : ['apt', 'dnf', 'pacman', 'zypper', 'apk', 'brew'];
    for (const pm of managers) {
        if (isOnPath(pm)) return pm;
    }
    return 'unknown';
}

/**
 * The Visual C++ runtime — an undeclared, undiagnosed win32 prerequisite (#997).
 *
 * `@gjsify/gtk-runtime-win32-x64` is built with gvsbuild, i.e. against the MSVC
 * ABI, and its DLLs load into stock (also MSVC-ABI) Node. On a Windows host
 * WITHOUT the Visual C++ redistributable that load fails — and nothing in the
 * toolchain said so. The precedent for why that matters is PR #994: a missing
 * load-time library made a typelib unloadable and the user-visible message was
 * `Unsupported type void, deriving from fundamental void`, which names nothing
 * a user could act on.
 *
 * Probed by FILE PRESENCE in the system directory rather than by asking a
 * package database: the redistributable can arrive with Visual Studio, with
 * another application's installer, or as part of a Windows image, and only one
 * of those routes is visible to a package manager. What the loader actually
 * needs is the DLL, so that is what is checked.
 *
 * `vcruntime140.dll` and `msvcp140.dll` are the C and C++ halves;
 * `vcruntime140_1.dll` carries the x64 exception-handling machinery and is
 * absent from pre-2019 redistributables, which is exactly the "installed, but
 * too old" case that otherwise fails at first use rather than at load.
 */
export function checkMsvcRuntime(): DepCheck {
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows';
    const required = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'];
    const missing = required.filter((dll) => !existsSync(`${systemRoot}\\System32\\${dll}`));
    return {
        id: 'msvc-runtime',
        name:
            missing.length === 0
                ? 'Microsoft Visual C++ runtime'
                : `Microsoft Visual C++ runtime (missing ${missing.join(', ')} — the GTK bundle's DLLs are MSVC-ABI and will not load)`,
        found: missing.length === 0,
        severity: 'required',
    };
}

// ---------------------------------------------------------------------------
// @gjsify/* package → system dependency mapping
// ---------------------------------------------------------------------------
//
// Lists which OPTIONAL system dependencies each gjsify package needs at
// runtime. Required deps (gjs, gtk4, libsoup3, libadwaita, etc.) are checked
// unconditionally because they're needed by the core toolchain.
//
// Used by `runAllChecks(cwd)` to skip optional deps for packages the user
// isn't using. If a project doesn't depend on @gjsify/gamepad, libmanette
// is not checked (and won't appear as a warning).

interface OptionalDep {
    /** DepCheck id */
    id: string;
    /** Display name */
    name: string;
    /** pkg-config library name */
    pkgName: string;
}

/** Optional system deps keyed by their DepCheck id. Exported for the spec's declaration invariant. */
export const OPTIONAL_DEPS: Record<string, OptionalDep> = {
    manette: { id: 'manette', name: 'libmanette', pkgName: 'manette-0.2' },
    gstreamer: { id: 'gstreamer', name: 'GStreamer', pkgName: 'gstreamer-1.0' },
    'gst-app': { id: 'gst-app', name: 'GStreamer App', pkgName: 'gstreamer-app-1.0' },
    'gdk-pixbuf': { id: 'gdk-pixbuf', name: 'GdkPixbuf', pkgName: 'gdk-pixbuf-2.0' },
    pango: { id: 'pango', name: 'Pango', pkgName: 'pango' },
    pangocairo: { id: 'pangocairo', name: 'PangoCairo', pkgName: 'pangocairo' },
    webkitgtk: { id: 'webkitgtk', name: 'WebKitGTK', pkgName: 'webkitgtk-6.0' },
    cairo: { id: 'cairo', name: 'Cairo', pkgName: 'cairo' },
    // Build-time deps for @gjsify/*-native Vala prebuilds. End-users with
    // installed prebuilds don't need the -devel package — only contributors
    // rebuilding from source via `yarn build:prebuilds`. We still surface
    // them in the optional set so the "missing" diagnostic catches build-
    // time failures with an actionable install-hint instead of a meson
    // `Run-time dependency X found: NO` error mid-build.
    gnutls: { id: 'gnutls', name: 'GnuTLS', pkgName: 'gnutls' },
    nghttp2: { id: 'nghttp2', name: 'libnghttp2', pkgName: 'libnghttp2' },
    // RUNTIME deps of the shipped prebuilds, not build-time ones — the distinction
    // the two entries above make does not hold for these. Measured on fedora:43
    // provisioned like a CONSUMER (gjs + libsoup3 only), `ldd` over every committed
    // linux-x64 prebuild: three sonames do not resolve, and each makes its typelib
    // UNLOADABLE, which surfaces as `Unsupported type void, deriving from
    // fundamental void` at first construction — a message that names nothing.
    //   @gjsify/rolldown-native  libjson-glib-1.0.so.0
    //   @gjsify/webgl            libepoxy.so.0            (gdk-pixbuf already listed)
    //   @gjsify/webrtc-native    libgstwebrtc-1.0.so.0    (gstreamer already listed)
    // json-glib is the severe one: rolldown-native IS the GJS bundler engine, so a
    // host without it cannot `gjsify build` at all, while `gjsify install` printed
    // "System dependencies OK." — a check passing for the wrong reason.
    'json-glib': { id: 'json-glib', name: 'JSON-GLib', pkgName: 'json-glib-1.0' },
    epoxy: { id: 'epoxy', name: 'libepoxy', pkgName: 'epoxy' },
    'gst-webrtc': { id: 'gst-webrtc', name: 'GStreamer WebRTC', pkgName: 'gstreamer-webrtc-1.0' },
};

/**
 * The declared system libraries a single `@gjsify/*` package needs that are NOT
 * present on this host.
 *
 * Exists so a FAILURE can answer the question this file already knows the answer
 * to. The tables below have declared `@gjsify/rolldown-native → json-glib` since
 * #994, complete with per-distro package names — but the only reader was
 * `runAllChecks()`, i.e. `gjsify system-check`, a command the user has to think
 * to run. So when the engine was installed and simply would not LOAD, the build
 * said "@gjsify/rolldown-native is NOT INSTALLED … install it" (it was) or
 * guessed at a bypassed launcher. Two repositories spent a CI round rediscovering
 * a library this file could have named: ts-for-gir#437, bauplaner#40.
 *
 * Cannot throw, by construction rather than by a catch: `checkPkgConfig` goes
 * through `tryExecFile`, which returns null on any failure. That matters because
 * the caller is `diagnoseNativeEngine()`, which runs *while explaining another
 * failure* — a probe that dies there would replace the diagnosis with its own
 * stack.
 *
 * Returns `[]` for an unknown package or one with no declared deps, so a caller
 * needs no special case for "nothing to say".
 */
export function missingSystemDepsFor(packageName: string): DepCheck[] {
    const ids = PACKAGE_DEPS[packageName];
    if (!ids) return [];
    const missing: DepCheck[] = [];
    for (const id of ids) {
        const dep = OPTIONAL_DEPS[id];
        // An id with no OPTIONAL_DEPS entry is not "present"; it is unanswerable
        // here. The spec's declaration invariant is what keeps that set empty —
        // silently reporting it as found would be the failure mode this whole
        // function exists to end.
        if (!dep?.pkgName) continue;
        const result = checkPkgConfig(dep.id, dep.name, dep.pkgName, 'optional', [packageName]);
        if (!result.found) missing.push(result);
    }
    return missing;
}

/**
 * Map of @gjsify/* package name → ids of OPTIONAL_DEPS this package needs.
 * Generated by walking each package's `gi://` imports (excluding the always-
 * available trio GLib/GObject/Gio).
 *
 * Used to compute the set of optional deps to check for a given project.
 *
 * Exported for the spec's declaration invariant: every id named here must exist in
 * OPTIONAL_DEPS, or the dep is silently never checked.
 */
export const PACKAGE_DEPS: Record<string, string[]> = {
    '@gjsify/gamepad': ['manette'],
    '@gjsify/webaudio': ['gstreamer', 'gst-app'],
    '@gjsify/iframe': ['webkitgtk'],
    '@gjsify/canvas2d': ['gdk-pixbuf', 'pango', 'pangocairo', 'cairo'],
    '@gjsify/canvas2d-core': ['gdk-pixbuf', 'pango', 'pangocairo', 'cairo'],
    '@gjsify/dom-elements': ['gdk-pixbuf'],
    // @gjsify/webgl needs the gwebgl npm package (Vala prebuild) — handled
    // as a special-case checkNpmPackage rather than checkPkgConfig in
    // runOptionalChecks. Mapping it here so its presence in the project's
    // dep tree triggers the check.
    '@gjsify/webgl': ['gwebgl', 'gdk-pixbuf', 'epoxy'],
    // Native Vala bridges with `dependency('gnutls')` / `dependency('libnghttp2')`
    // in their meson.build. Optional because the shipped prebuild covers the
    // common-arch user path; only contributors rebuilding from source hit the
    // build-time dep.
    '@gjsify/tls-native': ['gnutls'],
    '@gjsify/http2-native': ['nghttp2'],
    // Unlike the two above, these are LOAD-time: the prebuild is dynamically linked
    // and GIRepository cannot open its backing library without them.
    '@gjsify/rolldown-native': ['json-glib'],
    '@gjsify/webrtc-native': ['gstreamer', 'gst-webrtc'],
    // @gjsify/event-bridge only needs gtk4/gdk which are already in the
    // required set, so it doesn't need an optional entry.
};

/** Walk up from cwd looking for the nearest package.json. */
function findProjectRoot(cwd: string): string | null {
    let dir = resolve(cwd);
    while (true) {
        if (existsSync(join(dir, 'package.json'))) return dir;
        const parent = resolve(dir, '..');
        if (parent === dir) return null;
        dir = parent;
    }
}

/**
 * Discover which @gjsify/* packages a project depends on (transitively),
 * by walking the node_modules tree from the project root. Returns a Set of
 * package names like '@gjsify/webgl', '@gjsify/canvas2d'.
 *
 * If the project root cannot be determined or has no node_modules, returns
 * `null` to signal "check all optional deps" — this matches the historical
 * behaviour where `gjsify check` outside any project shows the full list.
 */
function discoverGjsifyPackages(cwd: string): Set<string> | null {
    const root = findProjectRoot(cwd);
    if (!root) return null;

    const nodeModulesDir = join(root, 'node_modules', '@gjsify');
    if (!existsSync(nodeModulesDir)) {
        // Project exists but no @gjsify/* installed → only need core checks.
        return new Set();
    }

    // Read top-level package.json to determine if @gjsify/cli is the only
    // dep (in which case we still want to warn about everything the CLI
    // transitively brings in). Otherwise scan node_modules for installed packages.
    const pkgJsonPath = join(root, 'package.json');
    let topPkg: Record<string, unknown> = {};
    try {
        topPkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    } catch {
        /* ignore */
    }

    const directDeps = {
        ...(topPkg.dependencies as Record<string, string> | undefined),
        ...(topPkg.devDependencies as Record<string, string> | undefined),
    };

    const found = new Set<string>();
    try {
        for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
            if (entry.isDirectory() || entry.isSymbolicLink()) {
                found.add(`@gjsify/${entry.name}`);
            }
        }
    } catch {
        /* ignore */
    }

    // Also include direct deps even if node_modules walk failed
    for (const dep of Object.keys(directDeps)) {
        if (dep.startsWith('@gjsify/')) found.add(dep);
    }

    return found;
}

/**
 * Compute the set of optional dep ids that should be checked for the
 * current project. Returns null to indicate "check all" (no project context).
 */
function computeNeededOptionalDeps(cwd: string): Set<string> | null {
    const installedPackages = discoverGjsifyPackages(cwd);
    if (installedPackages === null) return null; // no project → check everything

    const needed = new Set<string>();
    for (const pkg of installedPackages) {
        const deps = PACKAGE_DEPS[pkg];
        if (deps) for (const id of deps) needed.add(id);
    }
    return needed;
}

/**
 * Run all dependency checks. Used by `gjsify check` to show full system status.
 *
 * Required deps (gjs, gtk4, libsoup3, libadwaita, gobject-introspection,
 * blueprint-compiler, pkg-config, meson) are always checked.
 *
 * Optional deps are checked conditionally based on which @gjsify/* packages
 * the project (resolved from cwd) actually consumes. If no project context
 * is available, all optional deps are checked.
 */
export function runAllChecks(cwd: string): DepCheck[] {
    const needed = computeNeededOptionalDeps(cwd);
    return [
        ...runMinimalChecks(),
        ...runRequiredChecks(cwd),
        ...runNativeBuildToolchainChecks(),
        ...runOptionalChecks(needed, cwd),
    ];
}

/**
 * Minimal checks needed to run any GJS example (Node + GJS binaries only).
 * Used by `gjsify showcase` for examples that have no native deps.
 */
export function runMinimalChecks(): DepCheck[] {
    const results: DepCheck[] = [];

    // Node.js — always present
    results.push({ id: 'nodejs', name: 'Node.js', found: true, version: process.version, severity: 'required' });

    // GJS
    results.push(
        checkBinary(
            'gjs',
            'GJS',
            'gjs',
            ['--version'],
            'required',
            (out) => out.replace(/^GJS\s+/i, '').split('\n')[0] ?? out,
        ),
    );

    // The one win32 system dependency that is real and was undiagnosed (#997).
    // Checked at INSTALL time, not just in `system-check`, because the failure
    // it prevents is a bare `ERR_DLOPEN_FAILED` on a `.node` that is present —
    // by then the user has no thread to pull.
    if (process.platform === 'win32') results.push(checkMsvcRuntime());

    return results;
}

/**
 * Is a blueprint-compiler reachable, by the SAME rule the build uses?
 *
 * Delegates to `@gjsify/vite-plugin-blueprint/resolve` rather than probing PATH
 * here, because the two answers must not be able to disagree: on win32 the
 * compiler is normally an MSYS2 script that is deliberately NOT on PATH, so a
 * PATH-only check would report "missing" on a host where every `.blp` builds
 * fine — a check failing for the wrong reason, which is the failure mode this
 * file's own history is made of.
 *
 * `--version` is not run. MSYS2 ships blueprint-compiler as a shebang script
 * with no `.exe`, so `checkBinary` cannot execute it on Windows; presence of the
 * resolved pair is the honest answer, and the `source` is worth reporting
 * because "found via msys2" explains an install PATH does not show.
 */
export function checkBlueprintCompiler(requiredBy?: string[]): DepCheck {
    const resolved = resolveBlueprintCompiler();
    return {
        id: 'blueprint-compiler',
        name: 'blueprint-compiler (.blp templates)',
        found: resolved !== null,
        version: resolved ? `found via ${resolved.source}` : undefined,
        severity: 'optional',
        requiredBy,
    };
}

/** Check gwebgl npm package (project first, CLI fallback). Optional — only needed by @gjsify/webgl users. */
export function checkGwebgl(cwd: string): DepCheck {
    return checkNpmPackage('gwebgl', 'gwebgl (@gjsify/webgl)', '@gjsify/webgl', cwd, 'optional', ['@gjsify/webgl']);
}

/**
 * Required system dependencies — always checked, missing → exit 1.
 * Includes the core build toolchain (pkg-config, meson, blueprint-compiler)
 * and the foundational libraries (gtk4, libadwaita, libsoup3,
 * gobject-introspection) that nearly every gjsify app needs.
 */
function runRequiredChecks(_cwd: string): DepCheck[] {
    const results: DepCheck[] = [];

    // Build toolchain
    results.push(
        checkBinary('blueprint-compiler', 'Blueprint Compiler', 'blueprint-compiler', ['--version'], 'required'),
    );
    results.push(checkBinary('pkg-config', 'pkg-config', 'pkg-config', ['--version'], 'required'));
    results.push(checkBinary('meson', 'Meson', 'meson', ['--version'], 'required'));

    // Foundational libraries
    results.push(checkPkgConfig('gtk4', 'GTK4', 'gtk4', 'required'));
    results.push(checkPkgConfig('libadwaita', 'libadwaita', 'libadwaita-1', 'required'));
    results.push(checkPkgConfig('libsoup3', 'libsoup3', 'libsoup-3.0', 'required'));
    results.push(
        checkPkgConfig('gobject-introspection', 'GObject Introspection', 'gobject-introspection-1.0', 'required'),
    );

    return results;
}

/**
 * The native BUILD toolchain — needed to COMPILE a prebuild from source
 * (`gjsify workspace <pkg> build:prebuilds`), never to run one.
 *
 * Optional by design, and the distinction is the whole point: every `*-native`
 * package SHIPS its `.so`/`.dylib` + `.typelib` inside the tarball, so a user who
 * installs `@gjsify/tls-native` and runs it needs none of these. Marking them
 * `required` would fail `gjsify check` for the large majority who correctly have
 * no Vala compiler on the machine.
 *
 * They are reported at all because the opposite silence is worse: without them a
 * `build:prebuilds` failure surfaces from inside meson as a missing-compiler
 * error naming no package and no install command. That is the concrete shape of
 * "gjsify is supposed to be batteries-included, so why is cargo not part of it" —
 * the tools were always required, they were just never named.
 *
 * NB `meson` is checked one function up at `required` severity, which is
 * inconsistent with its own backend being optional here. That predates this
 * function and is left alone deliberately: flipping it changes the exit code of
 * `gjsify check` for existing users, which is a decision of its own, not a
 * side effect of documenting the toolchain.
 */
function runNativeBuildToolchainChecks(): DepCheck[] {
    // Every meson/Vala bridge in the tree — all of them need valac + ninja.
    const valaBridges = [
        '@gjsify/http-soup-bridge',
        '@gjsify/http2-native',
        '@gjsify/lightningcss-native',
        '@gjsify/oxfmt-native',
        '@gjsify/rolldown-native',
        '@gjsify/sab-native',
        '@gjsify/terminal-native',
        '@gjsify/tls-native',
        '@gjsify/webgl',
        '@gjsify/webrtc-native',
    ];
    // Narrower on purpose: only the three bridges that link an upstream Rust
    // crate by Cargo path-dependency need a Rust toolchain.
    const rustBridges = ['@gjsify/lightningcss-native', '@gjsify/oxfmt-native', '@gjsify/rolldown-native'];

    // Every showcase/app whose window comes from a `.blp` template. NOT a Vala
    // bridge and nothing to do with meson — it is a BUILD-time toolchain in the
    // same sense, and it belongs here so `gjsify system-check` names it before a
    // build does.
    const blueprintConsumers = ['@gjsify/vite-plugin-blueprint'];

    return [
        checkBlueprintCompiler(blueprintConsumers),
        checkBinary('ninja', 'Ninja', 'ninja', ['--version'], 'optional', undefined, valaBridges),
        checkBinary(
            'vala',
            'Vala',
            'valac',
            ['--version'],
            'optional',
            (out) => out.replace(/^Vala\s+/i, ''),
            valaBridges,
        ),
        checkBinary(
            'cargo',
            'Cargo (Rust)',
            'cargo',
            ['--version'],
            'optional',
            (out) => out.replace(/^cargo\s+/i, '').split(' ')[0] ?? out,
            rustBridges,
        ),
    ];
}

/**
 * Optional system dependencies — only checked if the corresponding @gjsify/*
 * package is in use. Missing optional deps generate warnings, not errors.
 *
 * @param needed Set of optional dep ids to check, or null to check all.
 * @param cwd Used to resolve the gwebgl npm package check.
 */
function runOptionalChecks(needed: Set<string> | null, cwd: string): DepCheck[] {
    const results: DepCheck[] = [];

    for (const [id, dep] of Object.entries(OPTIONAL_DEPS)) {
        if (needed !== null && !needed.has(id)) continue;

        const requiredBy = Object.entries(PACKAGE_DEPS)
            .filter(([, ids]) => ids.includes(id))
            .map(([pkg]) => pkg);

        results.push(checkPkgConfig(dep.id, dep.name, dep.pkgName, 'optional', requiredBy));
    }

    // gwebgl npm package — special case (not a pkg-config lib). Only checked
    // when the project directly or transitively depends on @gjsify/webgl —
    // since the CLI tarball no longer ships any showcase example packages,
    // gwebgl is not part of the CLI's own dep tree, so reporting it for every
    // project would always be `found: false`. `needed === null` means "check
    // everything" (no project context).
    const hasWebglDep = needed === null || needed.has('gwebgl');
    if (hasWebglDep) {
        results.push(checkGwebgl(cwd));
    }

    return results;
}

// Per-package-manager install package names, keyed by dep id.
// Entries with multiple space-separated packages are intentional (one dep needs multiple system pkgs).
const PM_PACKAGES: Record<PackageManager, Partial<Record<string, string>>> = {
    apt: {
        gjs: 'gjs',
        'blueprint-compiler': 'blueprint-compiler',
        'pkg-config': 'pkg-config',
        meson: 'meson',
        ninja: 'ninja-build',
        vala: 'valac',
        cargo: 'cargo',
        gtk4: 'libgtk-4-dev',
        libadwaita: 'libadwaita-1-dev',
        libsoup3: 'libsoup-3.0-dev',
        webkitgtk: 'libwebkit2gtk-6.0-dev',
        'gobject-introspection': 'gobject-introspection libgirepository1.0-dev',
        manette: 'libmanette-0.2-0 gir1.2-manette-0.2',
        gstreamer: 'libgstreamer1.0-dev',
        'gst-app': 'libgstreamer-plugins-base1.0-dev gir1.2-gst-plugins-base-1.0',
        'gdk-pixbuf': 'libgdk-pixbuf-2.0-dev',
        pango: 'libpango1.0-dev',
        pangocairo: 'libpango1.0-dev',
        cairo: 'libcairo2-dev',
        gnutls: 'libgnutls28-dev',
        nghttp2: 'libnghttp2-dev',
        'json-glib': 'libjson-glib-dev',
        epoxy: 'libepoxy-dev',
    },
    dnf: {
        gjs: 'gjs',
        'blueprint-compiler': 'blueprint-compiler',
        'pkg-config': 'pkgconf-pkg-config',
        meson: 'meson',
        ninja: 'ninja-build',
        vala: 'vala',
        cargo: 'cargo',
        gtk4: 'gtk4-devel',
        libadwaita: 'libadwaita-devel',
        libsoup3: 'libsoup3-devel',
        webkitgtk: 'webkitgtk6.0-devel',
        'gobject-introspection': 'gobject-introspection-devel',
        manette: 'libmanette-devel',
        gstreamer: 'gstreamer1-devel',
        'gst-app': 'gstreamer1-plugins-base-devel',
        'gdk-pixbuf': 'gdk-pixbuf2-devel',
        pango: 'pango-devel',
        pangocairo: 'pango-devel',
        cairo: 'cairo-devel',
        gnutls: 'gnutls-devel',
        nghttp2: 'libnghttp2-devel',
        'json-glib': 'json-glib-devel',
        epoxy: 'libepoxy-devel',
    },
    pacman: {
        gjs: 'gjs',
        'blueprint-compiler': 'blueprint-compiler',
        'pkg-config': 'pkgconf',
        meson: 'meson',
        ninja: 'ninja',
        vala: 'vala',
        cargo: 'rust',
        gtk4: 'gtk4',
        libadwaita: 'libadwaita',
        libsoup3: 'libsoup3',
        webkitgtk: 'webkitgtk-6.0',
        'gobject-introspection': 'gobject-introspection',
        manette: 'libmanette',
        gstreamer: 'gstreamer',
        'gst-app': 'gst-plugins-base',
        'gdk-pixbuf': 'gdk-pixbuf2',
        pango: 'pango',
        pangocairo: 'pango',
        cairo: 'cairo',
        gnutls: 'gnutls',
        nghttp2: 'libnghttp2',
        'json-glib': 'json-glib',
        epoxy: 'libepoxy',
    },
    zypper: {
        gjs: 'gjs',
        'blueprint-compiler': 'blueprint-compiler',
        'pkg-config': 'pkg-config',
        meson: 'meson',
        ninja: 'ninja',
        vala: 'vala',
        cargo: 'cargo',
        gtk4: 'gtk4-devel',
        libadwaita: 'libadwaita-devel',
        libsoup3: 'libsoup-3_0-devel',
        webkitgtk: 'webkitgtk6_0-devel',
        'gobject-introspection': 'gobject-introspection-devel',
        manette: 'libmanette-0_2-0-devel',
        gstreamer: 'gstreamer-devel',
        'gst-app': 'gstreamer-plugins-base-devel',
        'gdk-pixbuf': 'gdk-pixbuf-devel',
        pango: 'pango-devel',
        pangocairo: 'pango-devel',
        cairo: 'cairo-devel',
        gnutls: 'libgnutls-devel',
        nghttp2: 'libnghttp2-devel',
        'json-glib': 'json-glib-devel',
        epoxy: 'libepoxy-devel',
    },
    apk: {
        gjs: 'gjs',
        'blueprint-compiler': 'blueprint-compiler',
        'pkg-config': 'pkgconf',
        meson: 'meson',
        ninja: 'ninja',
        vala: 'vala',
        cargo: 'cargo',
        gtk4: 'gtk4.0-dev',
        libadwaita: 'libadwaita-dev',
        libsoup3: 'libsoup3-dev',
        webkitgtk: 'webkit2gtk-6.0-dev',
        'gobject-introspection': 'gobject-introspection-dev',
        manette: 'libmanette-dev',
        gstreamer: 'gstreamer-dev',
        'gst-app': 'gst-plugins-base-dev',
        'gdk-pixbuf': 'gdk-pixbuf-dev',
        pango: 'pango-dev',
        pangocairo: 'pango-dev',
        cairo: 'cairo-dev',
        gnutls: 'gnutls-dev',
        nghttp2: 'nghttp2-dev',
        'json-glib': 'json-glib-dev',
        epoxy: 'libepoxy-dev',
    },
    // macOS. Names verified against homebrew/core rather than inferred from the
    // Linux rows — the mapping is NOT mechanical: Homebrew ships no `-dev`/`-devel`
    // split (one formula carries headers, pkg-config file and typelib), `pkgconf`
    // is what actually provides `bin/pkg-config`, and `libsoup` is the 3.x formula
    // (`libsoup@2` is the old one), so a `libsoup3` guess installs nothing.
    //
    // TWO IDS ARE DELIBERATELY ABSENT, and in both cases the absence IS the
    // answer — printing a command that does not deliver the dependency would be
    // strictly worse than printing nothing:
    //   • `manette` — homebrew/core has no libmanette formula, and packaging one
    //     would not help: libmanette is built on the Linux input subsystem and
    //     reports raw evdev `BTN_*` codes (see @gjsify/gamepad's button-mapping),
    //     which macOS does not have. A macOS @gjsify/gamepad means a
    //     GameController.framework backend, not a missing brew formula.
    //   • `webkitgtk` — a formula by that name EXISTS, which is the trap. It is
    //     the GTK**3** build (it depends on `gtk+3` and ships `webkit2gtk-4.x`),
    //     while @gjsify/iframe needs the GTK4 API `webkitgtk-6.0`. homebrew/core
    //     packages no GTK4 WebKit at all, and the formula carries no bottle — so
    //     `brew install webkitgtk` would be an hours-long source build of the
    //     WRONG API that still leaves `pkg-config --exists webkitgtk-6.0` false.
    // Recorded here so the next reader does not "fix" the gap by guessing a name;
    // both are genuine platform gaps, not table omissions.
    brew: {
        gjs: 'gjs',
        'blueprint-compiler': 'blueprint-compiler',
        'pkg-config': 'pkgconf',
        meson: 'meson',
        ninja: 'ninja',
        vala: 'vala',
        cargo: 'rust',
        gtk4: 'gtk4',
        libadwaita: 'libadwaita',
        libsoup3: 'libsoup',
        'gobject-introspection': 'gobject-introspection',
        gstreamer: 'gstreamer',
        'gst-app': 'gst-plugins-base',
        'gdk-pixbuf': 'gdk-pixbuf',
        pango: 'pango',
        pangocairo: 'pango',
        cairo: 'cairo',
        gnutls: 'gnutls',
        nghttp2: 'nghttp2',
        'json-glib': 'json-glib',
        epoxy: 'libepoxy',
    },
    // Deliberately ONE entry. Windows is not a GJS host, so `gjs`, the
    // pkg-config toolchain and every `-devel` library above have no winget
    // package that would help — offering one would be a wrong answer rather
    // than a missing one, and `buildInstallCommand` already skips any id with
    // no mapping. The Visual C++ runtime is the one win32 system dependency
    // that IS real, installable, and currently undiagnosed (#997).
    winget: {
        'msvc-runtime': 'Microsoft.VCRedist.2015+.x64',
    },
    unknown: {},
};

const PM_INSTALL_PREFIX: Record<PackageManager, string> = {
    apt: 'sudo apt install',
    dnf: 'sudo dnf install',
    pacman: 'sudo pacman -S',
    zypper: 'sudo zypper install',
    apk: 'sudo apk add',
    // No `sudo`: Homebrew refuses to run as root and tells you so.
    brew: 'brew install',
    // `--id` because winget's fuzzy name match is ambiguous for this package,
    // and it is the spelling Microsoft's own docs use.
    winget: 'winget install --id',
    unknown: '',
};

/**
 * Build a suggested install command for missing dependencies.
 * gwebgl is an npm package, not a system package — handled separately.
 * Returns null when package manager is unknown or no installable deps are missing.
 */
export function buildInstallCommand(pm: PackageManager, missing: DepCheck[]): string | null {
    if (pm === 'unknown') return null;

    const pkgMap = PM_PACKAGES[pm];
    const pkgs: string[] = [];
    const npmDeps: string[] = [];
    const standalone: string[] = [];

    for (const dep of missing) {
        if (dep.id === 'gwebgl') {
            npmDeps.push('@gjsify/webgl');
            continue;
        }
        // blueprint-compiler on Windows is the one dep whose install command is
        // not this host's package manager. winget has no package for it, and it
        // cannot get one that works: the tool needs PyGObject, which publishes
        // no Windows wheel, so MSYS2 — which ships Python, PyGObject and the
        // typelibs already fitted together — is the only source. Its command is
        // not `winget install`-shaped, so it cannot live in PM_PACKAGES without
        // producing a line that looks right and fails.
        if (dep.id === 'blueprint-compiler' && process.platform === 'win32') {
            standalone.push(
                'pacman -S mingw-w64-ucrt-x86_64-blueprint-compiler mingw-w64-ucrt-x86_64-gtk4 ' +
                    'mingw-w64-ucrt-x86_64-libadwaita   # inside MSYS2; found automatically afterwards',
            );
            continue;
        }
        if (dep.id === 'nodejs') continue; // can't be missing if we're running
        const pkg = pkgMap[dep.id];
        if (pkg) pkgs.push(pkg);
    }

    const lines: string[] = [];
    if (pkgs.length > 0) {
        lines.push(`${PM_INSTALL_PREFIX[pm]} ${pkgs.join(' ')}`);
    }
    if (npmDeps.length > 0) {
        lines.push(`npm install ${npmDeps.join(' ')}`);
    }
    lines.push(...standalone);

    return lines.length > 0 ? lines.join('\n  ') : null;
}

// ---- @girs types vs the library actually installed ---------------------------
//
// `import Gtk from 'gi://Gtk?version=4.0'` gets its types from `@girs/gtk-4.0`,
// generated ahead of time from ONE upstream GTK's GIR — and loads a typelib from
// whatever GTK the host has. Nothing compares the two, and GIRepository cannot:
// it matches the API version (`4.0`) only, so a typelib from GTK 4.12 and one from
// 4.23 both satisfy `?version=4.0`.
//
// Measured on a maintainer workstation, 2026-08-04: host GTK 4.22.4,
// `@girs/gtk-4.0@4.1.0` generated from 4.23.0. `Gtk.RestoreReason.RECOVER` is
// `@since 4.24`; `gjsify tsc` exits 0 with no diagnostic, and the same line at
// runtime is `TypeError: can't access property "RECOVER", Gtk.RestoreReason is
// undefined`. `gjsify system-check` reported `✓ GTK4 (4.22.4)` and said nothing.
//
// The declaration to check against already exists: every `@girs/*` package carries
// `libraryVersion` (ADR 0008 names it). Nothing in this repo reads it — `grep -rn
// libraryVersion packages/ scripts/ .github/` matched nothing before this. So this
// is not a new mechanism, it is the missing half of one.
//
// SCOPE, and why it is not every package. `libraryVersion` is only an upstream
// version where the GIR declares a `<package version>`; otherwise ts-for-gir falls
// back to the NAMESPACE version, which looks like a version and is not one.
// Measured across 32 installed `@girs/*`: 12 real, 17 degenerate, 3 absent —
// `@girs/gdk-4.0` says `4.0.0` while GDK ships inside GTK 4.22.4, so comparing it
// would report an 18-minor skew that does not exist. Hence an explicit binding
// table plus `isDegenerate`, and a deliberate false NEGATIVE: a library genuinely
// at exactly `<namespace>.0` is skipped rather than risk a false alarm. Closing
// that gap needs the installed library's own `.gir`, which the bundles do not ship
// (`status/open-todos.md`) — it is not reachable from this field.

interface TypePackageBinding {
    /** pkg-config module whose `--modversion` is the runtime truth. */
    pkgConfig: string;
    /** The `@girs/*` package generated from that library's GIR. */
    typePackage: string;
    /** Namespace version in the package name — the degenerate fallback value. */
    namespaceVersion: string;
}

/**
 * Only libraries whose GIR carries a real `<package version>`, verified against
 * the published packages rather than assumed. A binding whose value turns out
 * degenerate is skipped at runtime by `isDegenerate`, so a wrong entry here
 * cannot produce a false alarm — it can only produce silence.
 */
const TYPE_PACKAGE_BINDINGS: TypePackageBinding[] = [
    { pkgConfig: 'gtk4', typePackage: '@girs/gtk-4.0', namespaceVersion: '4.0' },
    { pkgConfig: 'libadwaita-1', typePackage: '@girs/adw-1', namespaceVersion: '1' },
    { pkgConfig: 'libsoup-3.0', typePackage: '@girs/soup-3.0', namespaceVersion: '3.0' },
    { pkgConfig: 'glib-2.0', typePackage: '@girs/glib-2.0', namespaceVersion: '2.0' },
    { pkgConfig: 'gobject-2.0', typePackage: '@girs/gobject-2.0', namespaceVersion: '2.0' },
    { pkgConfig: 'gio-2.0', typePackage: '@girs/gio-2.0', namespaceVersion: '2.0' },
    { pkgConfig: 'gstreamer-1.0', typePackage: '@girs/gst-1.0', namespaceVersion: '1.0' },
    { pkgConfig: 'webkitgtk-6.0', typePackage: '@girs/webkit-6.0', namespaceVersion: '6.0' },
    { pkgConfig: 'manette-0.2', typePackage: '@girs/manette-0.2', namespaceVersion: '0.2' },
    { pkgConfig: 'pango', typePackage: '@girs/pango-1.0', namespaceVersion: '1.0' },
    { pkgConfig: 'harfbuzz', typePackage: '@girs/harfbuzz-0.0', namespaceVersion: '0.0' },
];

export interface TypeSkew {
    typePackage: string;
    pkgConfig: string;
    /** `libraryVersion` declared by the installed `@girs/*` package. */
    declared: string;
    /** `pkg-config --modversion` of the library the host actually has. */
    installed: string;
    /**
     * `ahead` = the types describe a NEWER library than is installed. This is the
     * direction that compiles and then throws, so it is the one worth reporting.
     * `behind` = API the host has is invisible to the compiler; limiting, not wrong.
     */
    relation: 'ahead' | 'behind';
}

/**
 * Read `libraryVersion` from an installed `@girs/*` package.
 *
 * Resolves the package's MAIN entry and walks up to its root `package.json`
 * rather than resolving the `package.json` subpath: `@girs/*` exports maps do not
 * expose `./package.json` (verified on all 32 installed packages), so
 * `require.resolve('@girs/gtk-4.0/package.json')` throws
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`. The same trap silently disabled the
 * `@nativescript/vite` major-version gate until it was found by measurement.
 */
function readGirsLibraryVersion(cwd: string, typePackage: string): string | null {
    for (const from of [pathToFileURL(join(cwd, '_girs_.js')).href, import.meta.url]) {
        let dir: string;
        try {
            dir = dirname(createRequire(from).resolve(typePackage));
        } catch {
            continue;
        }
        // Walk up to the package root — the entry may sit in a subdirectory.
        for (let i = 0; i < 5; i++) {
            const manifest = join(dir, 'package.json');
            if (existsSync(manifest)) {
                try {
                    const parsed = JSON.parse(readFileSync(manifest, 'utf-8')) as {
                        name?: string;
                        libraryVersion?: string;
                    };
                    if (parsed.name === typePackage) return parsed.libraryVersion ?? null;
                } catch {
                    return null; // present but unreadable — nothing to compare against
                }
            }
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    }
    return null;
}

/** `[major, minor]`, or null when the string is not a comparable version. */
function majorMinor(version: string): [number, number] | null {
    const match = /^(\d+)\.(\d+)/.exec(version.trim());
    if (!match) return null;
    return [Number(match[1]), Number(match[2])];
}

/**
 * True when `libraryVersion` is ts-for-gir's namespace-version fallback rather
 * than a real upstream release — `@girs/gdk-4.0`'s `4.0.0` against namespace `4.0`.
 *
 * Compares against every `.0`-padded spelling of the namespace version, not just
 * the three-component one: `4.0` and `4.0.0` are the same claim, and matching only
 * the padded form let the bare spelling through as a bogus 18-minor "behind"
 * finding. Deliberately NOT a major.minor comparison — `@girs/adw-1` has namespace
 * `1` and a real `libraryVersion` of `1.10.0`, which any major-only rule discards.
 */
function isDegenerate(declared: string, namespaceVersion: string): boolean {
    const trimmed = declared.trim();
    const parts = namespaceVersion.split('.');
    for (let n = parts.length; n <= 3; n++) {
        if (trimmed === [...parts, ...Array<string>(n - parts.length).fill('0')].join('.')) return true;
    }
    return false;
}

/**
 * Readers the comparison depends on, injectable so every branch is unit-testable
 * from ANY host. Same reasoning as `resolvePrebuildDirName`, which is a pure
 * function of injected values precisely so its darwin/win32 branches are tested
 * from Linux: a check whose only test is "run it on the maintainer's machine and
 * look" is a check whose skew cases are never exercised.
 */
export interface TypeSkewReaders {
    /** `libraryVersion` of an installed `@girs/*` package, or null when absent. */
    readDeclared?: (cwd: string, typePackage: string) => string | null;
    /** `pkg-config --modversion` of a library, or null when absent. */
    readInstalled?: (pkgConfig: string) => string | null;
}

/**
 * Compare each installed `@girs/*` package's declared upstream version against the
 * library the host actually has. Only reports a `major.minor` difference: a micro
 * difference does not change the API set, and reporting it would train people to
 * ignore the output.
 */
export function checkTypeSkew(cwd: string, readers: TypeSkewReaders = {}): TypeSkew[] {
    const readDeclared = readers.readDeclared ?? readGirsLibraryVersion;
    const readInstalled =
        readers.readInstalled ?? ((pkgConfig: string) => tryExecFile('pkg-config', ['--modversion', pkgConfig]));
    const findings: TypeSkew[] = [];

    for (const binding of TYPE_PACKAGE_BINDINGS) {
        const declared = readDeclared(cwd, binding.typePackage);
        if (declared === null) continue; // types not installed, or no declaration
        if (isDegenerate(declared, binding.namespaceVersion)) continue;

        const installed = readInstalled(binding.pkgConfig);
        if (installed === null) continue; // library absent — the presence check owns that

        const want = majorMinor(declared);
        const have = majorMinor(installed.split('\n')[0] ?? installed);
        if (!want || !have) continue;
        if (want[0] === have[0] && want[1] === have[1]) continue;

        findings.push({
            typePackage: binding.typePackage,
            pkgConfig: binding.pkgConfig,
            declared,
            installed: installed.split('\n')[0] ?? installed,
            relation: want[0] > have[0] || (want[0] === have[0] && want[1] > have[1]) ? 'ahead' : 'behind',
        });
    }

    return findings;
}
