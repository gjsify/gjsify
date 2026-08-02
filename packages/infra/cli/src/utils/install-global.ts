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

import { detectNativePackages } from './detect-native-packages.js';
import {
    buildLauncherShims,
    buildNativeEnvPreamble,
    buildShLauncher,
    isGjsBundlePath,
    parseShebang,
    pickBinMap,
    type Shebang,
} from './bin-shim.js';

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

/**
 * The GJS-native tooling bridges the global CLI needs to run a build under GJS.
 *
 * These are declared OPTIONAL peer dependencies of `@gjsify/cli` (so a plain
 * `npm install @gjsify/cli` on Node — where the npm `rolldown` / `lightningcss`
 * / `oxfmt` crates work — does not force a linux prebuild fetch). But a *global
 * GJS install* exists precisely to run the GJS CLI, where there is NO npm
 * fallback: `@gjsify/rolldown-native` is the only bundler engine (`gjsify build`
 * hard-fails without it), `@gjsify/lightningcss-native` backs CSS lowering, and
 * `@gjsify/oxfmt-native` backs `gjsify format`/`fix`. So the global installer
 * lays them down explicitly, on top of the cli's resolved runtime deps.
 *
 * `@gjsify/rolldown-native` is the load-bearing one (build is dead without it);
 * the other two degrade gracefully at runtime (CSS / format fall back), so all
 * three are installed best-effort: a platform with no published prebuild for
 * the engine just gets a warning + continue, mirroring how the optional-peer
 * story already degrades on Node.
 */
export const GJS_ENGINE_PACKAGES = [
    '@gjsify/rolldown-native',
    '@gjsify/lightningcss-native',
    '@gjsify/oxfmt-native',
] as const;

/** True when `<prefix>/node_modules/@gjsify/rolldown-native` is laid down. */
export function hasBundlerEngineInstalled(prefix: string): boolean {
    return fs.existsSync(path.join(prefix, 'node_modules', '@gjsify/rolldown-native', 'package.json'));
}

/**
 * Best-effort install of the GJS-native engine packages into a global prefix.
 *
 * Each engine is installed in its own `installPackages` call so one engine that
 * has no published prebuild for the current platform (the resolver throws "No
 * version of … satisfies …", or the registry 404s) does NOT abort the others —
 * it warns and continues. The bundler engine (`@gjsify/rolldown-native`) is the
 * one a build truly needs; the failure surfaces a clear, actionable message.
 *
 * `version` is the dist-tag / version the top-level `@gjsify/cli` resolved to,
 * so the engines move in lockstep with the bundle. It may be a concrete version
 * (`0.11.0`) or a dist-tag (`latest`, `next`); both are valid spec suffixes.
 *
 * @param installFn Injected to keep this unit-testable without a real registry —
 *   defaults to the production `installPackages` backend.
 */
export async function installGjsEnginePackages(
    prefix: string,
    version: string,
    opts: {
        verbose?: boolean;
        installFn?: (spec: string) => Promise<void>;
    } = {},
): Promise<void> {
    const verbose = opts.verbose ?? false;
    const installOne =
        opts.installFn ??
        (async (spec: string) => {
            // Lazy import to avoid a static cycle (install-backend → … → here)
            // and to keep this module importable from the lighter unit tests.
            const { installPackages } = await import('./install-backend.js');
            await installPackages({ prefix, specs: [spec], verbose });
        });

    for (const name of GJS_ENGINE_PACKAGES) {
        const spec = version ? `${name}@${version}` : name;
        try {
            await installOne(spec);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // `@gjsify/rolldown-native` is the bundler engine — its absence
            // means `gjsify build` (and storybook / anything that builds) will
            // hard-fail under GJS. Make that one loud; the other two degrade
            // gracefully so a plain note suffices.
            if (name === '@gjsify/rolldown-native') {
                console.warn(
                    `\nWarning: could not install the GJS bundler engine ${name}@${version} — ${msg}\n` +
                        `  \`gjsify build\` (and storybook / flatpak) will fail under GJS until it is present.\n` +
                        `  This usually means no prebuild is published for this platform (${process.platform}/${process.arch}).`,
                );
            } else if (verbose) {
                console.warn(`gjsify install: optional GJS engine ${name}@${version} not installed — ${msg}`);
            }
        }
    }
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

    // The launcher exports GI_TYPELIB_PATH / <loader path> for the @gjsify/*
    // native prebuilds (Vala/GObject typelibs + shared libs) installed in this
    // prefix, so `imports.gi.X` resolves at CLI startup — required for the
    // bundler engine `@gjsify/rolldown-native` (without which `gjsify build`
    // hard-fails under GJS) and for e.g. `@gjsify/terminal-native`, without
    // which isTTY / columns / colors fall back to conservative defaults.
    //
    // `runGjsBundle()` does the same dance for `gjsify run <bundle>` at runtime;
    // here it has to be the launcher, because the typelib lookup happens inside
    // the GJS runtime before the bundle's first line runs.
    //
    // The preamble SCANS the prefix at launch time rather than embedding what
    // was there at install time — see `buildNativeEnvPreamble` for why a
    // snapshot is the wrong shape. `nativePrebuildDirs` is still computed: the
    // Windows `.cmd`/`.ps1` shims take the baked list, and a hit in an
    // ANCESTOR's node_modules (which the walk finds and a single-root scan
    // cannot) is embedded verbatim.
    const nativePrebuildDirs = detectNativePackages(layout.prefix).map((p) => p.prebuildsDir);
    const envPreamble = buildNativeEnvPreamble(layout.prefix, nativePrebuildDirs);

    for (const pkgName of packageNames) {
        const pkgDir = path.join(layout.prefix, 'node_modules', pkgName);
        const pkgJsonPath = path.join(pkgDir, 'package.json');
        if (!fs.existsSync(pkgJsonPath)) continue;

        const pkgJson = readJson(pkgJsonPath);
        const picked = pickBinMap(pkgName, pkgJson);
        if (picked === null || picked.map.size === 0) continue;

        for (const [binName, binTarget] of picked.map) {
            const targetAbs = path.join(pkgDir, binTarget);
            if (!fs.existsSync(targetAbs)) continue;
            try {
                fs.chmodSync(targetAbs, 0o755);
            } catch {
                /* best effort */
            }
            const linkPath = path.join(layout.binDir, binName);
            for (const stale of [linkPath, `${linkPath}.cmd`, `${linkPath}.ps1`]) {
                fs.rmSync(stale, { force: true, maxRetries: 10, retryDelay: 100 });
            }
            // Inline `${target}` directly — this file is rewritten on every
            // install, paths are user-owned, and POSIX `sh` quoting via
            // single-quotes plus `'\''` for embedded quotes is well-defined.
            //
            // `.gjs.mjs` and `.mjs` bins are GJS-runnable bundles; we wrap them
            // with `gjs -m` rather than direct-exec because not every published
            // bundle ships a `#!/usr/bin/env -S gjs -m` shebang (the CLI's
            // build:gjs-bundle script gained the `--shebang` flag late in
            // Phase F, but published <=0.4.x tarballs predate it). Direct-
            // exec'ing a shebang-less .mjs file falls back to /bin/sh which
            // then tries to parse JavaScript as shell. Plain Node scripts
            // with shebangs (lib/index.js) keep the direct-exec path.
            const isGjsBundle = isGjsBundlePath(targetAbs);
            // Only GJS bundles need the GI typelib search path. Plain Node
            // scripts ignore GI_TYPELIB_PATH, so skipping the preamble there
            // keeps the launcher minimal.
            fs.writeFileSync(linkPath, buildShLauncher(targetAbs, { envPreamble, isGjsBundle }));
            fs.chmodSync(linkPath, 0o755);
            // Windows runs neither an extension-less file nor a `#!` line, so
            // the `sh` launcher above is only reachable from git-bash/MSYS/WSL.
            // Write the `.cmd`/`.ps1` companions cmd.exe and pwsh need — the
            // same three-file layout npm's cmd-shim produces.
            if (process.platform === 'win32') {
                const joined = nativePrebuildDirs.join(';');
                // No dedicated DLL-search variable on Windows: LoadLibrary
                // searches PATH, and GLib's search-path separator is `;` there
                // too — so both variables take the same `;`-joined value.
                const prependEnv: Record<string, string> =
                    isGjsBundle && nativePrebuildDirs.length > 0 ? { GI_TYPELIB_PATH: joined, PATH: joined } : {};
                // A non-bundle bin is exec'd directly by the sh launcher, which
                // relies on its `#!` line; batch/pwsh have no shebang support,
                // so read the interpreter out of it the way cmd-shim does
                // (defaulting to `node`, what every npm bin declares).
                const shebang = isGjsBundle ? null : readShebangOf(targetAbs);
                const shims = isGjsBundle
                    ? buildLauncherShims({
                          interpreter: 'gjs',
                          interpreterArgs: ['-m'],
                          target: targetAbs,
                          prependEnv,
                      })
                    : buildLauncherShims({
                          interpreter: shebang?.prog || 'node',
                          interpreterArgs: shebang?.args.trim() ? shebang.args.trim().split(/\s+/) : [],
                          target: targetAbs,
                      });
                fs.writeFileSync(`${linkPath}.cmd`, shims.cmd);
                fs.writeFileSync(`${linkPath}.ps1`, shims.ps1);
            }
            created.push({ name: binName, target: targetAbs, link: linkPath });
        }
    }

    return created;
}

/** Parse a bin file's `#!` line; `null` when unreadable or not a shebang. */
function readShebangOf(file: string): Shebang | null {
    try {
        const head = fs.readFileSync(file, 'utf-8');
        return parseShebang(head.trimStart().split(/\r*\n/, 1)[0] ?? '');
    } catch {
        return null;
    }
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
