// Yarn PnP-aware resolution for `@gjsify/module`'s `createRequire`.
//
// Yarn-PnP keeps every package in `.yarn/cache/<pkg>.zip` and `.yarn/unplugged/`,
// addressed via a `.pnp.cjs` manifest at the workspace root.  No real
// `node_modules/` tree exists on disk, so the standard "walk up
// `node_modules/`" resolver fails for any consumer running inside a
// PnP-built workspace — including a freshly-bundled GJS executable that
// uses `createRequire(import.meta.url)` to find a sibling package's
// `package.json`.
//
// We don't execute Yarn's manifest (it pulls in Node-specific APIs and is
// 5-10 MB of code).  Instead we parse the `RAW_RUNTIME_STATE` JSON literal
// at the top of `.pnp.cjs` — that's the entire resolution table.  Every
// package's `packageDependencies` lists the *resolved reference* for each
// requested dependency, so we don't need to run version selection: we just
// look up the locator and return its `packageLocation`.
//
// What this implementation supports
// ---------------------------------
//
//   * `linkType: "SOFT"` packages — workspaces and unplugged deps; their
//     `packageLocation` is a real on-disk directory, so resolved paths are
//     usable directly with `readFileSync` / `Gio.File`.
//   * `linkType: "HARD"` packages — zip-cached deps.  The resolved path
//     points into a `.yarn/cache/<pkg>.zip/...` virtual directory; reads
//     against it require the `@yarnpkg/fslib` ZipFS layer that the gjsify
//     plugin uses at build time.  We surface the path so callers can
//     decide what to do with it; runtime read support for zips is tracked
//     separately in gjsify STATUS.md.
//
// What is NOT supported
// ---------------------
//
//   * Resolution of bare specifiers FROM a PnP-virtual location (e.g. a
//     module loaded from inside a zip resolving its own dependencies).
//     We could reach this via `dependencyTreeRoots` indirection but no
//     current consumer needs it.
//   * Conditional exports / package.json `exports` map.  We respect
//     `main`/`module`/`/<sub-path>` splits like the rest of
//     `@gjsify/module`'s resolver, but we don't honour `exports`-only
//     entries.

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';

interface PnpPackageInformation {
    packageLocation: string;
    packageDependencies?: ReadonlyArray<readonly [string, string | null]>;
    linkType: 'SOFT' | 'HARD';
    discardFromLookup?: boolean;
}

interface PnpRuntimeState {
    packageRegistryData: ReadonlyArray<
        readonly [
            string | null,
            ReadonlyArray<readonly [string | null, PnpPackageInformation]>,
        ]
    >;
}

/**
 * Parsed manifest, indexed for O(1) lookup. Cached per file path so repeat
 * `createRequire(...)` calls on the same workspace don't re-parse.
 */
export interface PnpManifest {
    /** Absolute path of the `.pnp.cjs` file's parent directory. */
    readonly rootDir: string;
    /** Map<packageName, Map<packageReference, info>> — null name = workspace root. */
    readonly packages: Map<
        string | null,
        Map<string | null, PnpPackageInformation>
    >;
    /** Locator-by-location reverse index for "which package owns this path". */
    readonly locatorsByLocation: Map<
        string,
        { name: string | null; reference: string | null }
    >;
}

const manifestCache = new Map<string, PnpManifest | null>();

/** Walk up from `startDir` looking for the nearest `.pnp.cjs`. */
export function findPnpManifest(startDir: string): string | null {
    let dir = Gio.File.new_for_path(startDir);
    while (dir.has_parent(null)) {
        const candidate = dir.resolve_relative_path('.pnp.cjs');
        if (candidate.query_exists(null)) return candidate.get_path();
        dir = dir.get_parent()!;
    }
    return null;
}

/** Read + parse `.pnp.cjs`'s `RAW_RUNTIME_STATE`. Cached. */
export function loadPnpManifest(pnpCjsPath: string): PnpManifest | null {
    const cached = manifestCache.get(pnpCjsPath);
    if (cached !== undefined) return cached;

    const file = Gio.File.new_for_path(pnpCjsPath);
    let text: string;
    try {
        const [ok, bytes] = file.load_contents(null);
        if (!ok) {
            manifestCache.set(pnpCjsPath, null);
            return null;
        }
        text = new TextDecoder().decode(bytes);
    } catch {
        manifestCache.set(pnpCjsPath, null);
        return null;
    }

    const state = extractRawRuntimeState(text);
    if (!state) {
        manifestCache.set(pnpCjsPath, null);
        return null;
    }

    const rootDir = GLib.path_get_dirname(pnpCjsPath);
    const packages = new Map<
        string | null,
        Map<string | null, PnpPackageInformation>
    >();
    const locatorsByLocation = new Map<
        string,
        { name: string | null; reference: string | null }
    >();

    for (const [name, store] of state.packageRegistryData) {
        const inner = new Map<string | null, PnpPackageInformation>();
        for (const [reference, info] of store) {
            inner.set(reference, info);
            if (!info.discardFromLookup) {
                // Yarn keys locations on the trailing-slash form; preserve it.
                locatorsByLocation.set(info.packageLocation, { name, reference });
            }
        }
        packages.set(name, inner);
    }

    const manifest: PnpManifest = { rootDir, packages, locatorsByLocation };
    manifestCache.set(pnpCjsPath, manifest);
    return manifest;
}

/**
 * Strip the line-continuations (`\\\n`) Yarn writes around the JSON literal
 * and JSON.parse the result.  Returns null if we can't find the literal.
 */
function extractRawRuntimeState(text: string): PnpRuntimeState | null {
    // The literal is `const RAW_RUNTIME_STATE =\n'<json-with-line-conts>';`
    // followed by another JS statement on a new line.  Match it directly.
    const start = text.indexOf("const RAW_RUNTIME_STATE =");
    if (start < 0) return null;
    const openQuote = text.indexOf("'", start);
    if (openQuote < 0) return null;

    // Find the closing `';` — line-continuations escape newlines, NOT
    // single-quotes, so the next un-escaped `';` ends the literal.
    let i = openQuote + 1;
    while (i < text.length) {
        const ch = text.charCodeAt(i);
        if (ch === 0x5c /* \ */) {
            // Skip the escaped char (line-continuation \\\n, escaped quote \', etc.)
            i += 2;
            continue;
        }
        if (ch === 0x27 /* ' */) {
            // End of literal.
            break;
        }
        i++;
    }
    if (i >= text.length) return null;

    let raw = text.slice(openQuote + 1, i);
    // Yarn's only escape in this literal is `\<newline>` (line continuation).
    // Strip them; the result is valid JSON.
    raw = raw.replace(/\\\n/g, '');
    try {
        return JSON.parse(raw) as PnpRuntimeState;
    } catch {
        return null;
    }
}

/**
 * Find which package owns `absolutePath`. Returns the locator + its info, or
 * null when the path isn't covered by any package in the manifest.
 *
 * Uses longest-prefix-match against `packageLocation` entries (Yarn does the
 * same in `findPackageLocator`).
 */
export function findPackageOwning(
    manifest: PnpManifest,
    absolutePath: string,
): {
    locator: { name: string | null; reference: string | null };
    info: PnpPackageInformation;
} | null {
    const relPath = relativeFromRoot(manifest.rootDir, absolutePath);
    if (relPath === null) return null;

    let bestMatch: string | null = null;
    for (const candidateLocation of manifest.locatorsByLocation.keys()) {
        if (
            relPath.startsWith(candidateLocation) &&
            (bestMatch === null || candidateLocation.length > bestMatch.length)
        ) {
            bestMatch = candidateLocation;
        }
    }
    if (bestMatch === null) return null;

    const locator = manifest.locatorsByLocation.get(bestMatch)!;
    const info = manifest.packages.get(locator.name)?.get(locator.reference);
    if (!info) return null;
    return { locator, info };
}

/**
 * Resolve a bare specifier through PnP. Returns the absolute on-disk path,
 * or null when the request can't be resolved this way.
 *
 * `id` is a bare specifier like `@scope/foo` or `@scope/foo/bar/baz.js`.
 * `callerPath` is the absolute path of the file doing the require.
 */
export function resolveBareViaPnp(
    manifest: PnpManifest,
    id: string,
    callerPath: string,
): string | null {
    const owner = findPackageOwning(manifest, callerPath);
    if (!owner) return null;

    // Split `@scope/name/sub/path` → name=`@scope/name`, subPath=`sub/path`.
    const { pkgName, subPath } = splitSpecifier(id);

    const dep = owner.info.packageDependencies?.find(([name]) => name === pkgName);
    if (!dep) return null;
    const [, reference] = dep;
    if (reference === null) return null;

    const target = manifest.packages.get(pkgName)?.get(reference);
    if (!target) return null;

    // `packageLocation` is `./<rel>/` from manifest.rootDir, OR an absolute
    // path under `.yarn/unplugged/...` for unplugged packages — Gio.File
    // handles the join either way.
    const baseFile = target.packageLocation.startsWith('/')
        ? Gio.File.new_for_path(target.packageLocation)
        : Gio.File.new_for_path(manifest.rootDir).resolve_relative_path(
              stripLeadingDotSlash(target.packageLocation),
          );
    const finalFile = subPath
        ? baseFile.resolve_relative_path(subPath)
        : baseFile;
    return finalFile.get_path();
}

/** Split `@scope/foo/sub/path` into `pkgName: '@scope/foo'`, `subPath: 'sub/path'`. */
function splitSpecifier(id: string): { pkgName: string; subPath: string } {
    if (id.startsWith('@')) {
        const slash1 = id.indexOf('/');
        if (slash1 < 0) return { pkgName: id, subPath: '' };
        const slash2 = id.indexOf('/', slash1 + 1);
        if (slash2 < 0) return { pkgName: id, subPath: '' };
        return { pkgName: id.slice(0, slash2), subPath: id.slice(slash2 + 1) };
    }
    const slash = id.indexOf('/');
    if (slash < 0) return { pkgName: id, subPath: '' };
    return { pkgName: id.slice(0, slash), subPath: id.slice(slash + 1) };
}

function stripLeadingDotSlash(p: string): string {
    return p.startsWith('./') ? p.slice(2) : p;
}

/** Returns `<absolutePath>` minus `<rootDir>/`, with a trailing slash on
 *  directory components, matching Yarn's `packageLocation` keys. */
function relativeFromRoot(rootDir: string, absolutePath: string): string | null {
    if (absolutePath === rootDir) return './';
    const prefix = rootDir.endsWith('/') ? rootDir : rootDir + '/';
    if (!absolutePath.startsWith(prefix)) return null;
    return './' + absolutePath.slice(prefix.length);
}
