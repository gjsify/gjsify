// Runtime resolver for a GJS bundle's Node-API addon, ADR 0084.
//
// The build enumerates every `.node` an addon package ships, keyed by
// platform (`linux-x64`, `linux-x64-musl`, `darwin-arm64`, …), and bakes the
// table into the bundle. At RUN time the bundle picks the entry for the host
// it finds itself on and resolves the addon's package root through the same
// `__gjsifyBundleUrl` banner + `createRequire` anchor the module-resolve shim
// uses. The addon is never copied and never leaves its package, so a `.node`
// that `dlopen`s a sibling `.so` or reads a data file beside itself keeps
// working.
//
// Three correctness constraints shape the implementation:
//
//  1. *Location anchor.* The resolver anchors at the BUNDLE's URL, not its
//     own. When a consumer bundles this shim it lives under
//     `node_modules/@gjsify/rolldown-plugin-gjsify/...`, so the path rewriter
//     would rewrite this file's own `import.meta.url` too. We therefore take
//     no `import.meta.url` here and read the anchor from `globalThis.
//     __gjsifyBundleUrl`, captured by a one-line banner at byte 0 of the
//     bundle — the single point where `import.meta.url` is unambiguously the
//     bundle's URL.
//
//  2. *exports-map safety.* `createRequire(...).resolve("<pkg>/<deep/path>")`
//     is rejected by strict `"exports"` maps under Node's native
//     `createRequire` (the `--app node` target), and `@gjsify/module` is
//     exports-aware too. So we never resolve the deep path directly: we
//     resolve the PACKAGE ROOT and join the subpath literally, which no
//     `exports` map can block.
//
//  3. *No filesystem work.* libc is read from `process.env.LIBC`, not
//     probed — the shim does no filesystem work. On a musl host with an
//     unset `LIBC` the lookup falls through to the libc-agnostic entry,
//     which is what node-gyp-build's own untagged prebuilds assume; a package
//     shipping a glibc-only and a musl prebuild under one tuple is served the
//     glibc one, which `LIBC=musl` fixes.
//
// The `addons/` layout the resolver names when the package is not installed is
// the declared destination a packaging step would fill. `gjsify ship` does not
// fill it yet — see ADR 0084 § Consequences for the measurement.
//
// @ts-ignore — `node:{module,url,path}` are resolved by the consumer's
// `gjsify build` run (aliased to `@gjsify/{module,url,path}`), not by tsc here.
import { createRequire } from 'node:module';
// @ts-ignore — see above.
import { fileURLToPath } from 'node:url';
// @ts-ignore — see above.
import { dirname, join } from 'node:path';

import { hostAddonKeys, selectAddonTarget } from '../utils/addon-platform.js';

interface BundleAnchorHost {
    __gjsifyBundleUrl?: string;
}

/** The bundle's own URL (set by the byte-0 banner). Throws only if the banner didn't run. */
function bundleAnchorUrl(): string {
    const anchor = (globalThis as unknown as BundleAnchorHost).__gjsifyBundleUrl;
    if (!anchor) {
        throw new Error(
            'gjsify: __gjsifyBundleUrl is not set — the bundle-URL banner did not run. ' +
                'The addon-resolve shim is only valid in single-file app builds (gjsify build --app gjs).',
        );
    }
    return anchor;
}

/**
 * Split a bundled-file spec into its package name and the path within the
 * package. Handles scoped names:
 *   "typedoc/dist/lib/app.js"   → { pkg: "typedoc",        subpath: "dist/lib/app.js" }
 *   "@scope/name/sub/file.js"   → { pkg: "@scope/name",    subpath: "sub/file.js" }
 *   "typedoc"                   → { pkg: "typedoc",        subpath: "" }
 */
function splitPackageSpec(spec: string): { pkg: string; subpath: string } {
    const parts = spec.split('/');
    const segments = spec.startsWith('@') ? 2 : 1;
    return {
        pkg: parts.slice(0, segments).join('/'),
        subpath: parts.slice(segments).join('/'),
    };
}

/**
 * Find the on-disk root directory of `pkg`, exports-map-agnostic.
 *
 * `package.json` is resolvable for nearly every package and points straight at
 * the root. When a strict `exports` map blocks it, fall back to the package's
 * main entry (always an export) and derive the root from the
 * `node_modules/<pkg>` boundary in its path. Returns null when `pkg` is not
 * installed.
 */
function resolvePackageRoot(pkg: string): string | null {
    try {
        const require = createRequire(bundleAnchorUrl());
        return dirname(require.resolve(`${pkg}/package.json`));
    } catch {
        try {
            const require = createRequire(bundleAnchorUrl());
            const main = require.resolve(pkg);
            const marker = `/node_modules/${pkg}/`;
            const idx = main.lastIndexOf(marker);
            return idx >= 0 ? main.slice(0, idx + marker.length - 1) : dirname(main);
        } catch {
            return null;
        }
    }
}

/**
 * Resolve the addon's `.node` for the RUNNING host from the build-time table.
 *
 * `targets` maps platform keys (`linux-x64`, `linux-x64-musl`, …) to
 * `<package>/<subpath>` specs. The host keys are tried most-specific first
 * (exact, then libc-agnostic, then `*`). The package root is resolved at run
 * time through the bundle-URL anchor, which is what makes the bundle relocatable
 * (ADR 0084).
 *
 * Throws when no entry matches the running host, when the table is empty, and
 * when the addon package is not installed next to the bundle. The last one is
 * a LIMIT, not an oversight: identity-based resolution needs the package to be
 * somewhere on disk, so a bundle shipped with no `node_modules` around it cannot
 * load a third-party addon. It throws rather than returning
 * `<bundle dir>/addons/…` because that directory is a declared layout nothing
 * fills yet, and a path that cannot exist reaches `loadAddon` as a bare ENOENT
 * that names neither the package nor the remedy. Both facts are in the message.
 */
export function __gjsifyAddonResolve(targets: Record<string, string>): string {
    const keys = hostAddonKeys(process.platform, process.arch, process.env.LIBC);
    const spec = selectAddonTarget(targets, keys);
    if (spec === null) {
        const known = Object.keys(targets).join(', ') || '(empty)';
        throw new Error(
            `gjsify-napi-addon: no .node for host '${process.platform}-${process.arch}' ` +
                `(libc: ${process.env.LIBC ?? 'unset'}). Addon table knows: ${known}. ` +
                `Install the platform package or build the addon for this host.`,
        );
    }
    const { pkg, subpath } = splitPackageSpec(spec);
    const root = resolvePackageRoot(pkg);
    if (root !== null) {
        return subpath ? join(root, subpath) : root;
    }
    // The package is not installed where this bundle can see it. `<bundle
    // dir>/addons/<package>/` is the declared layout a packaging step would
    // fill — `gjsify ship` does not yet — so name it and the two remedies.
    const staged = join(dirname(fileURLToPath(bundleAnchorUrl())), 'addons', pkg, subpath);
    throw new Error(
        `gjsify-napi-addon: cannot find the addon package '${pkg}' from this bundle. ` +
            `A GJS bundle finds its addon by package identity, so '${pkg}' must be installed in a ` +
            `node_modules reachable from the bundle's own location, or staged at ` +
            `'${staged}' (a layout no gjsify step fills yet). Run the bundle next to its ` +
            "project's node_modules, or rebuild where the package is installed.",
    );
}
