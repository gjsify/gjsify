// Global-install helpers for `gjsify install -g <pkg>`.
//
// Layout (XDG-compliant, ~ = $HOME):
//
//   ~/.local/share/gjsify/global/
//     node_modules/<pkg>/                  ← extracted package contents
//       package.json
//       bin/<pkg>                          ← original npm bin
//       bin/<pkg>-gjs                      ← GJS bundle (declared via `gjsify.bin`)
//       <pkg-data-files>                   ← e.g. `dist-templates/` for ts-for-gir
//   ~/.local/bin/<bin-name>                ← symlink to the matching bin under node_modules
//
// Unlike the project install path (`gjsify install <pkg>` without -g), this
// mode installs the requested top-level packages plus their runtime deps into
// a user-owned XDG location, never mutates a project package.json, and links
// bins into the user's PATH so the package is invocable as `<bin-name>` from
// anywhere — the closest GJS equivalent of `npm i -g`.
//
// `gjsify.bin` (when declared) wins over the standard npm `bin` field on this
// path because the user explicitly asked for the GJS-runnable artifact: e.g.
// `ts-for-gir` (npm bin = bin/ts-for-gir Node script) becomes a symlink to
// `bin/ts-for-gir-gjs` (the self-contained GJS bundle) instead.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface GlobalLayout {
    /** Where extracted package trees live: `<prefix>/node_modules/<pkg>/`. */
    prefix: string;
    /** Where bin-name symlinks land. Typically `~/.local/bin`. */
    binDir: string;
}

/**
 * Compute the canonical global install layout for the current user. Honours
 * `XDG_DATA_HOME` (per the XDG Base Directory Spec) plus
 * `GJSIFY_GLOBAL_PREFIX` and `GJSIFY_GLOBAL_BIN_DIR` escape hatches for tests.
 */
export function defaultGlobalLayout(): GlobalLayout {
    const prefixOverride = process.env.GJSIFY_GLOBAL_PREFIX;
    const binOverride = process.env.GJSIFY_GLOBAL_BIN_DIR;
    const home = os.homedir();
    const xdgData = process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share');
    return {
        prefix: prefixOverride ?? path.join(xdgData, 'gjsify', 'global'),
        binDir: binOverride ?? path.join(home, '.local', 'bin'),
    };
}

export interface LinkedBin {
    /** The bin-name (key from `bin` / `gjsify.bin`). */
    name: string;
    /** Absolute path to the file the symlink points at. */
    target: string;
    /** Absolute path to the symlink (under `binDir`). */
    link: string;
}

/**
 * Install each top-level package's bin entries into `binDir` as small POSIX
 * `sh` launchers that exec the real bin. Reads each package's installed
 * `package.json` to discover bins; prefers `gjsify.bin` (GJS-bundled bins)
 * over the npm `bin` field, falling back to npm `bin` when no GJS map is
 * declared. Stale launchers are replaced (latest install wins).
 *
 * Why launchers instead of symlinks:
 *
 *   When a GJS bundle is invoked via a symlink in $PATH, the kernel follows
 *   the symlink to find the executable but passes the original (symlink)
 *   path to it. The bundle's shebang then runs as `gjs -m <symlink-path>`,
 *   which makes `import.meta.url` resolve to the symlink directory — so any
 *   path computation relative to `import.meta.url` (e.g. ts-for-gir's
 *   `findTemplatesRoot()`, version-discovery `readFileSync`s, gjsify's own
 *   `import.meta.url` rewrites) looks for assets in the wrong place.
 *
 *   A `sh` launcher invokes the real path explicitly, so the bundle sees its
 *   real install location in `import.meta.url` and every relative read works.
 *   This costs ~50 bytes per bin and one extra `exec` per launch — both
 *   negligible compared to `gjs -m` cold-start time.
 *
 *   Plain Node bins are unaffected by either approach (Node defaults to
 *   resolving symlinks in ESM module URLs); launchers are uniform for
 *   simplicity and so we don't need to discriminate by runtime here.
 */
export function linkGlobalBins(packageNames: string[], layout: GlobalLayout): LinkedBin[] {
    fs.mkdirSync(layout.binDir, { recursive: true });
    const created: LinkedBin[] = [];

    for (const pkgName of packageNames) {
        const pkgDir = path.join(layout.prefix, 'node_modules', pkgName);
        const pkgJsonPath = path.join(pkgDir, 'package.json');
        if (!fs.existsSync(pkgJsonPath)) continue;

        const pkgJson = readJson(pkgJsonPath);
        const binMap = pickBinMap(pkgName, pkgJson);
        if (!binMap || binMap.size === 0) continue;

        for (const [binName, binTarget] of binMap) {
            const targetAbs = path.join(pkgDir, binTarget);
            if (!fs.existsSync(targetAbs)) continue;
            try {
                fs.chmodSync(targetAbs, 0o755);
            } catch {
                /* best effort */
            }
            const linkPath = path.join(layout.binDir, binName);
            fs.rmSync(linkPath, { force: true });
            // Inline `${target}` directly — this file is rewritten on every
            // install, paths are user-owned, and POSIX `sh` quoting via
            // single-quotes plus `'\''` for embedded quotes is well-defined.
            const launcher = `#!/bin/sh\nexec ${shQuote(targetAbs)} "$@"\n`;
            fs.writeFileSync(linkPath, launcher);
            fs.chmodSync(linkPath, 0o755);
            created.push({ name: binName, target: targetAbs, link: linkPath });
        }
    }

    return created;
}

function shQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

function pickBinMap(
    pkgName: string,
    pkgJson: Record<string, unknown>,
): Map<string, string> | null {
    const gjsifyEntry = pkgJson.gjsify as { bin?: string | Record<string, string> } | undefined;
    if (gjsifyEntry?.bin !== undefined) {
        return normalizeBin(pkgName, gjsifyEntry.bin);
    }
    const npmBin = pkgJson.bin as string | Record<string, string> | undefined;
    if (npmBin !== undefined) {
        return normalizeBin(pkgName, npmBin);
    }
    return null;
}

function normalizeBin(
    pkgName: string,
    bin: string | Record<string, string>,
): Map<string, string> {
    const out = new Map<string, string>();
    if (typeof bin === 'string') {
        const baseName = pkgName.startsWith('@')
            ? pkgName.slice(pkgName.indexOf('/') + 1)
            : pkgName;
        out.set(baseName, bin);
        return out;
    }
    for (const [k, v] of Object.entries(bin)) out.set(k, v);
    return out;
}

function readJson(file: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
}

/** Returns `true` if `binDir` is on the user's PATH. */
export function binDirOnPath(binDir: string): boolean {
    const PATH = process.env.PATH ?? '';
    const sep = process.platform === 'win32' ? ';' : ':';
    const want = path.resolve(binDir);
    return PATH.split(sep).some((entry) => entry && path.resolve(entry) === want);
}

/**
 * Extracts the package name from a spec like `name@1.2`, `@scope/name`,
 * or `@scope/name@latest`. Returns the unchanged string for plain names.
 */
export function specToPackageName(spec: string): string {
    if (spec.startsWith('@')) {
        const slash = spec.indexOf('/');
        if (slash < 0) return spec;
        const at = spec.indexOf('@', slash);
        return at < 0 ? spec : spec.slice(0, at);
    }
    const at = spec.indexOf('@');
    return at < 0 ? spec : spec.slice(0, at);
}
