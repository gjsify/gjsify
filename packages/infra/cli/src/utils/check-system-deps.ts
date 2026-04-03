// System dependency checker for gjsify CLI.
// Uses execFileSync with explicit argument arrays — no shell injection possible.
// All binary names are hardcoded constants, never derived from user input.

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export interface DepCheck {
    /** Stable key used for install command lookup, e.g. "gjs" */
    id: string;
    /** Human-readable display name, e.g. "GJS" */
    name: string;
    found: boolean;
    /** Version string when found, e.g. "1.86.0" */
    version?: string;
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
function checkBinary(id: string, name: string, binary: string, versionArgs: string[], parseVersion?: (out: string) => string): DepCheck {
    const out = tryExecFile(binary, versionArgs);
    if (out === null) return { id, name, found: false };
    const version = parseVersion ? parseVersion(out) : out.split('\n')[0] ?? out;
    return { id, name, found: true, version };
}

/** Check a pkg-config library. pkg-config --modversion returns version on stdout. */
function checkPkgConfig(id: string, name: string, libName: string): DepCheck {
    const version = tryExecFile('pkg-config', ['--modversion', libName]);
    if (version === null) return { id, name, found: false };
    return { id, name, found: true, version: version.split('\n')[0] };
}

/**
 * Check for an npm package by resolving it via Node.js module resolution from cwd.
 * Mirrors the resolution logic used by esbuild / the build command.
 */
function checkNpmPackage(id: string, name: string, packageName: string, cwd: string): DepCheck {
    try {
        const requireFromCwd = createRequire(pathToFileURL(join(cwd, '_check_.js')).href);
        requireFromCwd.resolve(packageName);
        return { id, name, found: true };
    } catch {
        return { id, name, found: false };
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

export function runAllChecks(cwd: string): DepCheck[] {
    const results: DepCheck[] = [];

    // Node.js — always present
    results.push({ id: 'nodejs', name: 'Node.js', found: true, version: process.version });

    // GJS
    results.push(checkBinary('gjs', 'GJS', 'gjs', ['--version'],
        (out) => out.replace(/^GJS\s+/i, '').split('\n')[0] ?? out));

    // Blueprint Compiler
    results.push(checkBinary('blueprint-compiler', 'Blueprint Compiler',
        'blueprint-compiler', ['--version']));

    // pkg-config (needed for library checks)
    results.push(checkBinary('pkg-config', 'pkg-config', 'pkg-config', ['--version']));

    // Meson (for building native extensions)
    results.push(checkBinary('meson', 'Meson', 'meson', ['--version']));

    // GTK4
    results.push(checkPkgConfig('gtk4', 'GTK4', 'gtk4'));

    // libadwaita
    results.push(checkPkgConfig('libadwaita', 'libadwaita', 'libadwaita-1'));

    // libsoup3
    results.push(checkPkgConfig('libsoup3', 'libsoup3', 'libsoup-3.0'));

    // WebKitGTK — try 4.1 first, fall back to 4.0
    const webkitCheck = checkPkgConfig('webkitgtk', 'WebKitGTK', 'webkit2gtk-4.1');
    if (webkitCheck.found) {
        results.push(webkitCheck);
    } else {
        results.push(checkPkgConfig('webkitgtk', 'WebKitGTK', 'webkitgtk-6.0'));
    }

    // GObject Introspection
    results.push(checkPkgConfig('gobject-introspection', 'GObject Introspection', 'gobject-introspection-1.0'));

    // gwebgl — resolve via Node.js module resolution from cwd, same as esbuild would.
    results.push(checkNpmPackage('gwebgl', 'gwebgl (@gjsify/webgl)', '@gjsify/webgl', cwd));

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
        webkitgtk: 'libwebkit2gtk-4.1-dev',
        'gobject-introspection': 'gobject-introspection libgirepository1.0-dev',
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
    },
    pacman: {
        gjs: 'gjs',
        'blueprint-compiler': 'blueprint-compiler',
        'pkg-config': 'pkgconf',
        meson: 'meson',
        gtk4: 'gtk4',
        libadwaita: 'libadwaita',
        libsoup3: 'libsoup3',
        webkitgtk: 'webkit2gtk-4.1',
        'gobject-introspection': 'gobject-introspection',
    },
    zypper: {
        gjs: 'gjs',
        'blueprint-compiler': 'blueprint-compiler',
        'pkg-config': 'pkg-config',
        meson: 'meson',
        gtk4: 'gtk4-devel',
        libadwaita: 'libadwaita-devel',
        libsoup3: 'libsoup-3_0-devel',
        webkitgtk: 'webkit2gtk3-devel',
        'gobject-introspection': 'gobject-introspection-devel',
    },
    apk: {
        gjs: 'gjs',
        'blueprint-compiler': 'blueprint-compiler',
        'pkg-config': 'pkgconf',
        meson: 'meson',
        gtk4: 'gtk4.0-dev',
        libadwaita: 'libadwaita-dev',
        libsoup3: 'libsoup3-dev',
        webkitgtk: 'webkit2gtk-4.1-dev',
        'gobject-introspection': 'gobject-introspection-dev',
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
