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
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

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

export type PackageManager = 'apt' | 'dnf' | 'pacman' | 'zypper' | 'apk' | 'unknown';

/** Run a binary and return its stdout trimmed, or null if it fails. */
function tryExecFile(binary: string, args: string[]): string | null {
    try {
        return execFileSync(binary, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return null;
    }
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
    const version = parseVersion ? parseVersion(out) : out.split('\n')[0] ?? out;
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
    } catch { /* not in project, try CLI fallback */ }

    // 2. Fallback: CLI's own node_modules
    try {
        const requireFromCli = createRequire(import.meta.url);
        requireFromCli.resolve(packageName);
        return { id, name, found: true, severity, requiredBy };
    } catch {
        return { id, name, found: false, severity, requiredBy };
    }
}

export function detectPackageManager(): PackageManager {
    const managers: PackageManager[] = ['apt', 'dnf', 'pacman', 'zypper', 'apk'];
    for (const pm of managers) {
        const result = tryExecFile('which', [pm]);
        if (result !== null) return pm;
    }
    return 'unknown';
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

/** Optional system deps keyed by their DepCheck id. */
const OPTIONAL_DEPS: Record<string, OptionalDep> = {
    manette:    { id: 'manette',    name: 'libmanette',     pkgName: 'manette-0.2' },
    gstreamer:  { id: 'gstreamer',  name: 'GStreamer',      pkgName: 'gstreamer-1.0' },
    'gst-app':  { id: 'gst-app',    name: 'GStreamer App',  pkgName: 'gstreamer-app-1.0' },
    'gdk-pixbuf':{ id: 'gdk-pixbuf', name: 'GdkPixbuf',     pkgName: 'gdk-pixbuf-2.0' },
    pango:      { id: 'pango',      name: 'Pango',          pkgName: 'pango' },
    pangocairo: { id: 'pangocairo', name: 'PangoCairo',     pkgName: 'pangocairo' },
    webkitgtk:  { id: 'webkitgtk',  name: 'WebKitGTK',      pkgName: 'webkitgtk-6.0' },
    cairo:      { id: 'cairo',      name: 'Cairo',          pkgName: 'cairo' },
};

/**
 * Map of @gjsify/* package name → ids of OPTIONAL_DEPS this package needs.
 * Generated by walking each package's `gi://` imports (excluding the always-
 * available trio GLib/GObject/Gio).
 *
 * Used to compute the set of optional deps to check for a given project.
 */
const PACKAGE_DEPS: Record<string, string[]> = {
    '@gjsify/gamepad':       ['manette'],
    '@gjsify/webaudio':      ['gstreamer', 'gst-app'],
    '@gjsify/iframe':        ['webkitgtk'],
    '@gjsify/canvas2d':      ['gdk-pixbuf', 'pango', 'pangocairo', 'cairo'],
    '@gjsify/canvas2d-core': ['gdk-pixbuf', 'pango', 'pangocairo', 'cairo'],
    '@gjsify/dom-elements':  ['gdk-pixbuf'],
    // @gjsify/webgl, @gjsify/event-bridge only need gtk4/gdk which are
    // already in the required set, so they don't need optional entries.
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
    } catch { /* ignore */ }

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
    } catch { /* ignore */ }

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
    return [...runMinimalChecks(), ...runRequiredChecks(cwd), ...runOptionalChecks(needed, cwd)];
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
    results.push(checkBinary('gjs', 'GJS', 'gjs', ['--version'], 'required',
        (out) => out.replace(/^GJS\s+/i, '').split('\n')[0] ?? out));

    return results;
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
    results.push(checkBinary('blueprint-compiler', 'Blueprint Compiler',
        'blueprint-compiler', ['--version'], 'required'));
    results.push(checkBinary('pkg-config', 'pkg-config', 'pkg-config', ['--version'], 'required'));
    results.push(checkBinary('meson', 'Meson', 'meson', ['--version'], 'required'));

    // Foundational libraries
    results.push(checkPkgConfig('gtk4', 'GTK4', 'gtk4', 'required'));
    results.push(checkPkgConfig('libadwaita', 'libadwaita', 'libadwaita-1', 'required'));
    results.push(checkPkgConfig('libsoup3', 'libsoup3', 'libsoup-3.0', 'required'));
    results.push(checkPkgConfig('gobject-introspection', 'GObject Introspection',
        'gobject-introspection-1.0', 'required'));

    return results;
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

    // gwebgl npm package — special case (not a pkg-config lib).
    // Always reported (the npm package is bundled with the CLI), but marked
    // optional because only @gjsify/webgl users need it.
    results.push(checkGwebgl(cwd));

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
    },
    dnf: {
        gjs: 'gjs',
        'blueprint-compiler': 'blueprint-compiler',
        'pkg-config': 'pkgconf-pkg-config',
        meson: 'meson',
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
    },
    pacman: {
        gjs: 'gjs',
        'blueprint-compiler': 'blueprint-compiler',
        'pkg-config': 'pkgconf',
        meson: 'meson',
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
    },
    zypper: {
        gjs: 'gjs',
        'blueprint-compiler': 'blueprint-compiler',
        'pkg-config': 'pkg-config',
        meson: 'meson',
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
    },
    apk: {
        gjs: 'gjs',
        'blueprint-compiler': 'blueprint-compiler',
        'pkg-config': 'pkgconf',
        meson: 'meson',
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
    },
    unknown: {},
};

const PM_INSTALL_PREFIX: Record<PackageManager, string> = {
    apt: 'sudo apt install',
    dnf: 'sudo dnf install',
    pacman: 'sudo pacman -S',
    zypper: 'sudo zypper install',
    apk: 'sudo apk add',
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

    for (const dep of missing) {
        if (dep.id === 'gwebgl') {
            npmDeps.push('@gjsify/webgl');
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

    return lines.length > 0 ? lines.join('\n  ') : null;
}
