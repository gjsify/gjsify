// For `--app node`: keep every Node-API addon PACKAGE external, so Node loads it from
// `node_modules` exactly as it would without a bundler.
//
// An addon package finds its `.node` binary relative to ITS OWN files —
// `require('node-gyp-build')(__dirname)`, `bindings('x')`, `require('../build/Release/x.node')`,
// napi-rs' `require(`./x.${triple}.node`)`. Bundled, `__dirname` / `import.meta.dirname`
// is the bundle's directory, and the lookup misses. Measured on
// `@signalapp/libsignal-client`: `node-gyp-build(import.meta.dirname + '/..')` threw
// "No native build was found" from an `--app node` bundle that ran fine as source.
// `bufferutil` fails SILENTLY instead — its `try { node-gyp-build } catch { fallback }`
// quietly swaps the native build for the JS one.
//
// External, not copied: `--app gjs` has to rewrite an addon (`napiNodeAddonPlugin`
// routes it through `@gjsify/napi`) because GJS cannot load one itself, but Node can,
// and every loader convention resolves against a package-shaped directory, not a flat
// prebuild next to the bundle. So an `--app node` bundle of a native dependency needs
// `node_modules` at runtime, like any `npm install`-ed program.
//
// Detection is by PACKAGE, from its manifest and layout, never by source sniffing, and
// shares the napi-rs + gjsify-bridge rules with `napiNodeAddonPlugin`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type { Plugin } from 'rolldown';

import { type AddonPackageJson, isGjsifyNativeBridge, isNapiRsPackageJson } from './napi-node-addon.js';

// oxlint-disable-next-line no-control-regex -- NUL marks a bundler virtual id, never a package.
const BARE_SPECIFIER_RE = /^[^.\\/:\s\x00][^:\s\x00]*$/;

/** Runtime helpers whose only job is locating an addon binary next to the package. */
const ADDON_LOADER_DEPENDENCIES = [
    'node-gyp-build',
    'node-gyp-build-optional-packages',
    'bindings',
    'prebuild-install',
    'node-pre-gyp',
    '@mapbox/node-pre-gyp',
    'cmake-js',
];

interface NativePackageJson extends AddonPackageJson {
    gypfile?: boolean;
    binary?: unknown;
    dependencies?: Record<string, string>;
}

function readdirSafe(dir: string): string[] {
    try {
        return readdirSync(dir);
    } catch {
        return [];
    }
}

/** A `.node` file in `dir` or one directory below it (`prebuilds/<target>/`, `build/Release/`). */
function hasNodeBinary(dir: string): boolean {
    for (const name of readdirSafe(dir)) {
        if (name.endsWith('.node')) return true;
        if (readdirSafe(join(dir, name)).some((n) => n.endsWith('.node'))) return true;
    }
    return false;
}

/**
 * Is the package at `pkgRoot` a Node-API addon — one whose code loads a `.node`
 * relative to its own directory? True on any of: `gypfile`, a `binding.gyp`, a
 * node-pre-gyp `binary` block, a dependency on an addon loader, the napi-rs manifest
 * signals, or a `.node` under `prebuilds/` or `build/`. A gjsify native bridge is
 * never one: it ships a GI typelib loaded through `gi://`.
 */
export function isNodeAddonPackage(pkgRoot: string, pkg: NativePackageJson): boolean {
    if (isGjsifyNativeBridge(pkg)) return false;
    if (pkg.gypfile === true) return true;
    if (pkg.binary !== null && typeof pkg.binary === 'object') return true;
    if (existsSync(join(pkgRoot, 'binding.gyp'))) return true;
    const deps = { ...pkg.dependencies, ...pkg.optionalDependencies };
    if (ADDON_LOADER_DEPENDENCIES.some((name) => name in deps)) return true;
    if (isNapiRsPackageJson(pkg)) return true;
    return hasNodeBinary(join(pkgRoot, 'prebuilds')) || hasNodeBinary(join(pkgRoot, 'build'));
}

/** `@scope/name/sub` → `@scope/name`, `name/sub` → `name`; null for anything not bare. */
export function packageNameOf(specifier: string): string | null {
    if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('\0')) return null;
    if (specifier.includes(':')) return null; // node:fs, gi://Gtk, data:, C:\…
    const parts = specifier.split('/');
    if (specifier.startsWith('@')) return parts.length >= 2 && parts[1] ? `${parts[0]}/${parts[1]}` : null;
    return parts[0] || null;
}

/**
 * The root of package `name` that `file` belongs to: the nearest ancestor whose
 * `package.json` is NAMED `name`. Matching on the name skips the nested
 * `{ "type": "module" }` manifests dual packages put in `dist/esm/`.
 */
function packageRootFor(file: string, name: string): { root: string; pkg: NativePackageJson } | null {
    let dir = dirname(file);
    for (let i = 0; i < 64; i++) {
        const manifest = join(dir, 'package.json');
        if (existsSync(manifest)) {
            try {
                const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as NativePackageJson;
                if (pkg.name === name) return { root: dir, pkg };
            } catch {
                // An unreadable manifest is not this package's — keep walking up.
            }
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

/** Keeps every import of a Node-API addon package external on `--app node`. */
export function nodeNativeExternalPlugin(): Plugin {
    // Keyed by package name + importer directory: node resolution depends on both.
    const verdicts = new Map<string, boolean>();

    return {
        name: 'gjsify-node-native-external',
        resolveId: {
            order: 'pre' as const,
            // Rust-regex compatible (no lookaround, NUL as \x00): `@gjsify/rolldown-native`
            // hands it to the Rust core as a string. Bare specifiers only.
            filter: { id: BARE_SPECIFIER_RE },
            async handler(source, rawImporter) {
                const name = packageNameOf(source);
                if (name === null) return null;
                const importer = typeof rawImporter === 'string' ? rawImporter : undefined;
                const key = `${name}\0${importer === undefined ? '' : dirname(importer)}`;
                let native = verdicts.get(key);
                if (native === undefined) {
                    native = false;
                    const resolved = await this.resolve(source, importer, { skipSelf: true });
                    if (resolved && !resolved.external && isAbsolute(resolved.id) && existsSync(resolved.id)) {
                        const owner = packageRootFor(resolved.id, name);
                        native = owner !== null && isNodeAddonPackage(owner.root, owner.pkg);
                    }
                    verdicts.set(key, native);
                }
                return native ? { id: source, external: true } : null;
            },
        },
    };
}
