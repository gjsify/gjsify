// The file-based route manifest, as a virtual module.
//
// `expo-router` discovers its routes with Metro's `require.context`, which does not
// exist in this chain and is not going to. What replaces it is this: walk a declared
// directory, emit one module that STATICALLY imports every file in it, and let
// `@gjsify/react-native/router` turn that list into a tree.
//
// WHERE THE SPLIT IS, AND WHY IT IS HERE. This plugin knows about a FILESYSTEM: which
// directory, which files, whether the directory exists. It knows nothing about what a
// name MEANS — `(group)`, `[param]`, `_layout` and `+not-found` are the router's
// semantics, and `@gjsify/react-native/router`'s `buildRouteTree` owns them. That is
// not tidiness: ADR 0032 § 12 says the build chain belongs to the consumer, so a
// consumer on another bundler, or one writing the nine-line manifest by hand, has to
// get the same refusals — and they only can if the conventions live in the package
// they import rather than in the plugin they replaced. It also means there is ONE
// parser; a copy here would be the second truth this repository keeps paying for.
//
// So the refusals below are exactly the ones a filesystem can produce, and each names
// the resolved absolute path, because "routes directory not found" without the path it
// looked for is the least useful build error there is.
//
// STATIC IMPORTS, NOT `() => import(…)`. A lazy route needs a Suspense boundary, and
// `@gjsify/gtk-host/react`'s `render()` is synchronous by construction — a boundary
// that suspends on the first commit leaves the container EMPTY and returns cleanly,
// which is the silent-empty-window failure that host exists to refuse. A desktop
// application also ships as one artifact (ADR 0024), so there is no download for
// laziness to defer.

import { readdirSync, statSync } from 'node:fs';
import { posix, resolve, sep } from 'node:path';
import type { Plugin } from 'rolldown';

/** The specifier an application imports. Overridable, because a name is a name. */
export const RN_ROUTES_MODULE_ID = 'virtual:gjsify-rn-routes';

/**
 * How deep the walk goes before it refuses.
 *
 * A LOUD limit rather than none: an unbounded walk turns a symlink cycle into a hang
 * or an out-of-memory in the bundler, where the failure is not attributable to the
 * directory that caused it. Ten levels is far past any real route tree — the measured
 * application in ADR 0032 uses three — so hitting this is a finding, not a tuning
 * problem, and the message says which path was at the bottom.
 */
export const MAX_ROUTE_DEPTH = 10;

/** A file the walk found, relative to the routes directory. */
export interface FoundRoute {
    /** Path relative to the routes directory, with `/` separators. */
    readonly contextKey: string;
    /** Absolute path, for the generated import. */
    readonly file: string;
}

export interface RnRouteManifestOptions {
    /** The directory holding the route files — expo-router's `app/`. */
    routesDir: string;
    /** The specifier to answer. Defaults to `virtual:gjsify-rn-routes`. */
    virtualId?: string;
}

/** The error this plugin refuses a build with. */
export class RouteManifestError extends Error {
    override readonly name = 'RouteManifestError';
    constructor(message: string) {
        super(`@gjsify/rolldown-plugin-gjsify: rnRouteManifestPlugin — ${message}`);
    }
}

/**
 * Every file under `root`, deepest last, sorted — WALKED, never globbed.
 *
 * A glob is blind to the first file that lands in a subdirectory it did not think to
 * match, and going blind is the failure this plugin exists to remove: a route file
 * nobody imports is a screen that is simply not there. Sorted in CODE-UNIT order so the
 * emitted module is byte-identical for the same tree on every machine, which is what
 * makes a build cache honest — see the comparator for what a locale-aware sort cost.
 *
 * Directories are walked and every FILE is reported, whatever its extension. Filtering
 * here would be a silent drop with a plausible excuse — the router refuses a file that
 * matches no convention BY NAME, and that message is the one a reader can act on.
 */
export function walkRoutes(root: string, depth = 0, prefix = ''): readonly FoundRoute[] {
    if (depth > MAX_ROUTE_DEPTH) {
        throw new RouteManifestError(
            `the routes directory nests more than ${MAX_ROUTE_DEPTH} levels deep at "${prefix}". That is past any ` +
                'real route tree, so this is almost certainly a symlink cycle — an unbounded walk would hang the ' +
                'bundler instead of naming the path',
        );
    }
    const entries = readdirSync(root, { withFileTypes: true });
    const found: FoundRoute[] = [];
    // CODE-UNIT ORDER, NOT `localeCompare`. Measured: `localeCompare` put
    // `_layout.tsx` before `README.md` here and `index.tsx` between them under ICU's
    // default collation, which treats `_` as variable punctuation and letters
    // case-insensitively — an order that depends on the machine's collation data. A
    // build whose emitted module text depends on the host's locale is a build cache
    // that misses for no reason, and a diff that appears on someone else's laptop.
    for (const entry of [...entries].sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )) {
        const absolute = `${root}${sep}${entry.name}`;
        const contextKey = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        // `statSync` rather than the dirent's own kind, so a SYMLINK to a directory is
        // walked like the directory it points at — which is what a monorepo doing
        // route sharing produces, and `isDirectory()` on the dirent answers false for.
        if (statSync(absolute).isDirectory()) found.push(...walkRoutes(absolute, depth + 1, contextKey));
        else found.push({ contextKey, file: absolute });
    }
    return found;
}

/**
 * The virtual module's source.
 *
 * Exported so a spec can assert the text rather than run a bundler for it, and so a
 * consumer's own tooling can produce the same module for a different bundler.
 *
 * The generated imports use POSIX separators even on Windows, because a module
 * specifier is not a path and a backslash in one is an escape.
 */
export function renderRouteManifest(routes: readonly FoundRoute[], routesDir: string): string {
    if (routes.length === 0) {
        throw new RouteManifestError(
            `the routes directory "${routesDir}" holds no files, so there is nothing to route to. Add an ` +
                '`index.tsx` and a `_layout.tsx` to it, or point `routesDir` at the directory that has them',
        );
    }
    const lines = [
        '// GENERATED by rnRouteManifestPlugin — do not edit, and do not commit.',
        '//',
        '// One static import per route file, and the manifest `@gjsify/react-native/router`',
        `// takes. Walked from ${JSON.stringify(routesDir)}.`,
        '',
    ];
    routes.forEach((route, index) => {
        lines.push(`import * as route${index} from ${JSON.stringify(route.file.split(sep).join(posix.sep))};`);
    });
    lines.push('', 'export const manifest = [');
    routes.forEach((route, index) => {
        lines.push(`    { contextKey: ${JSON.stringify(route.contextKey)}, module: route${index} },`);
    });
    lines.push('];', '', 'export default manifest;', '');
    return lines.join('\n');
}

/**
 * Serve the route manifest for `routesDir` as a virtual module.
 *
 * ```ts
 * gjsifyPlugin({ … }),
 * rnRouteManifestPlugin({ routesDir: 'app' }),
 * ```
 * ```ts
 * import { manifest } from 'virtual:gjsify-rn-routes';
 * ```
 */
export function rnRouteManifestPlugin(options: RnRouteManifestOptions): Plugin {
    const virtualId = options.virtualId ?? RN_ROUTES_MODULE_ID;
    // `\0` is rollup's own convention for "this id is mine": it survives the resolver
    // chain and makes any other plugin's path handling leave it alone.
    const resolved = `\0${virtualId}`;

    return {
        name: 'gjsify-rn-route-manifest',
        resolveId(source) {
            return source === virtualId ? resolved : null;
        },
        load(id) {
            if (id !== resolved) return null;
            const routesDir = resolve(options.routesDir);
            let stats;
            try {
                stats = statSync(routesDir);
            } catch {
                throw new RouteManifestError(
                    `the routes directory "${routesDir}" does not exist. \`routesDir\` is resolved against the ` +
                        'process working directory, so a relative path means something different when the ' +
                        'bundler is spawned from elsewhere — pass an absolute one if that is in play',
                );
            }
            if (!stats.isDirectory()) {
                throw new RouteManifestError(
                    `"${routesDir}" is a file, not a directory. \`routesDir\` names the directory that holds the route files`,
                );
            }
            const routes = walkRoutes(routesDir);
            // Every file becomes a WATCHED dependency, so adding a route file
            // invalidates this module in a watch build. Without it a new screen needs a
            // restart, which reads as "the router did not pick it up".
            for (const route of routes) this.addWatchFile(route.file);
            return renderRouteManifest(routes, routesDir);
        },
    };
}
