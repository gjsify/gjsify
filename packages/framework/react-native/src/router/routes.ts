// The file convention, as a pure function. No React, no `gi://`, no filesystem.
//
// ADR 0032 § 8's measurement: of `expo-router`, "the API surface used is five names
// … what is large is the file convention: 27 route files using `(group)`,
// `[param]`, `_layout`, `+not-found`". This module is that large half, and it is
// exactly four rules plus the arithmetic of turning them into a tree.
//
// WHY THIS LIVES IN THE RUNTIME PACKAGE AND NOT IN THE BUNDLER PLUGIN. The plugin
// (`@gjsify/rolldown-plugin-gjsify`' `rnRouteManifestPlugin`) walks a directory and
// emits a module listing what it found; it does not know what a name MEANS. Putting
// the conventions here rather than there has one concrete consequence and it is the
// reason: ADR 0032 § 12 says the build chain belongs to the consumer, so a consumer
// on another bundler — or one who writes the manifest by hand, which is nine lines —
// gets the same refusals as one using our plugin. A parser in the plugin would leave
// them with none. It also means there is ONE parser: a second copy in the plugin
// would be the second truth this repository keeps paying for.
//
// The cost of that choice is that the refusals are raised when the tree is built
// rather than when the bundle is written, which for a `RouterRoot` at the top of an
// application is its first render. Stated so nobody reads a runtime throw as an
// oversight: it is a deliberate trade for one parser and bundler independence.
//
// WHAT A "CONVENTION" IS, EXACTLY. Four, and no fifth is inferred:
//
//   (group)     a directory that groups without contributing a URL segment
//   [param]     a dynamic segment; its value lands in useLocalSearchParams()
//   _layout     the file that OWNS its directory — it renders the navigator
//   +not-found  the fallback route
//
// A directory with no `_layout` is NOT a navigator. Its routes flatten into the
// nearest ancestor that is one, under a slash-joined name — which is expo-router's
// own behaviour and the reason `detail/[id].tsx` needs no `detail/_layout.tsx` to
// work. Recorded because the opposite guess (every directory is a navigator) reads
// as the simpler rule and produces a stack of empty navigators.

import { RouterError } from './errors.js';

/** Extensions a route file may carry. Anything else is not a route. */
const ROUTE_EXTENSIONS: readonly string[] = ['.tsx', '.ts', '.jsx', '.js', '.mts', '.mjs'];

/** One entry of the manifest a bundler plugin emits, or a consumer writes by hand. */
export interface RouteManifestEntry {
    /**
     * The file's path relative to the routes directory, extension included —
     * `(tabs)/home.tsx`. expo-router calls this the context key and so does this,
     * because it is the string every diagnostic quotes back.
     */
    readonly contextKey: string;
    /**
     * The module the file exported, ALREADY EVALUATED.
     *
     * Eager, not `() => import(…)`, and that is a decision rather than a shortcut.
     * A lazy route needs a Suspense boundary, and `@gjsify/gtk-host/react`'s
     * `render()` is synchronous by construction — a boundary that suspends on the
     * first commit leaves the container EMPTY and returns cleanly, which is the
     * silent-empty-window failure that host exists to refuse. A desktop application
     * also ships as one bundle (ADR 0024), so there is no download for laziness to
     * defer. `unknown` rather than a React type keeps this module framework-free;
     * `screens.ts` is where the shape is checked, by name.
     */
    readonly module: unknown;
}

/** What a bundler plugin emits: every route file it found, in a stable order. */
export type RouteManifest = readonly RouteManifestEntry[];

/** A node of the route tree — one navigator, or one screen inside one. */
export interface RouteNode {
    /** `layout` renders a navigator and has children; `screen` renders a route file. */
    readonly kind: 'layout' | 'screen';
    /**
     * The React Navigation route name: this node's path RELATIVE to the navigator
     * that holds it. `index`, `home`, `(tabs)`, `detail/[id]`, `+not-found`.
     */
    readonly name: string;
    /** The URL pattern this node contributes, in React Navigation's `:param` spelling. */
    readonly path: string;
    /** Param names this node's own pattern introduces, in declaration order. */
    readonly params: readonly string[];
    /** The file behind it. `null` for the synthesised root, which has no `_layout`. */
    readonly contextKey: string | null;
    /** That file's evaluated module. `null` when `contextKey` is. */
    readonly module: unknown;
    /** Children. Non-empty exactly when `kind` is `layout`. */
    readonly children: readonly RouteNode[];
    /** The `+not-found` route. Its pattern is `*`, so it matches last. */
    readonly notFound: boolean;
}

/** One parsed path segment. */
type Segment =
    | { readonly kind: 'static'; readonly name: string }
    | { readonly kind: 'group'; readonly name: string }
    | { readonly kind: 'param'; readonly name: string };

interface ParsedFile {
    readonly contextKey: string;
    readonly module: unknown;
    /** The directory segments, parsed. */
    readonly dir: readonly Segment[];
    /** The file's own segment, parsed. `null` for a `_layout`, which names its directory. */
    readonly leaf: Segment | null;
    readonly isLayout: boolean;
    readonly isNotFound: boolean;
}

// ---------------------------------------------------------------------------
// One file name
// ---------------------------------------------------------------------------

/**
 * One path segment → what the conventions say it is.
 *
 * Every rejection names the segment and the four conventions, because the reader is
 * looking at a file they just created and the useful answer is which of the four
 * they meant.
 */
function parseSegment(segment: string, contextKey: string): Segment {
    if (segment.startsWith('(')) {
        if (!segment.endsWith(')')) {
            throw new RouterError(
                'unknown-convention',
                contextKey,
                `the segment "${segment}" opens a (group) and never closes it. A group directory is spelled ` +
                    '`(name)` and contributes no URL segment',
            );
        }
        const name = segment.slice(1, -1);
        if (name.includes(',')) {
            throw new RouterError(
                'shared-group-unsupported',
                contextKey,
                `"${segment}" is a shared group — expo-router lets one directory belong to several navigators at ` +
                    'once, and this layer answers for one navigator per directory. Split it into `(' +
                    name.split(',')[0]?.trim() +
                    ')` and a sibling, or drop the parentheses to make it an ordinary directory',
            );
        }
        if (name === '') {
            throw new RouterError(
                'unknown-convention',
                contextKey,
                'the segment "()" is an empty group. A group directory is spelled `(name)`',
            );
        }
        return { kind: 'group', name };
    }

    if (segment.startsWith('[')) {
        if (!segment.endsWith(']')) {
            throw new RouterError(
                'unknown-convention',
                contextKey,
                `the segment "${segment}" opens a [param] and never closes it. A dynamic segment is spelled ` +
                    '`[name]`',
            );
        }
        const inner = segment.slice(1, -1);
        if (inner.startsWith('...')) {
            const rest = inner.slice(3);
            if (rest === '') {
                throw new RouterError(
                    'param-without-name',
                    contextKey,
                    `the segment "${segment}" is a catch-all with no name. Name it — \`[...rest]\` — although this ` +
                        'layer does not answer for catch-alls yet either',
                );
            }
            throw new RouterError(
                'deep-dynamic-unsupported',
                contextKey,
                `"${segment}" is a catch-all segment. React Navigation's path config has no multi-segment ` +
                    'wildcard that also carries its parts as a param, so honouring it would mean matching the URL ' +
                    'in one place and splitting it in another. Use one `[param]` per segment, or `+not-found` for ' +
                    'the fallback',
            );
        }
        if (inner.trim() === '') {
            throw new RouterError(
                'param-without-name',
                contextKey,
                `the segment "${segment}" is a dynamic segment with no name, so nothing could read its value. ` +
                    'Write `[id]` and read it with useLocalSearchParams().id',
            );
        }
        if (inner !== inner.trim() || /[^A-Za-z0-9_$]/.test(inner)) {
            throw new RouterError(
                'unknown-convention',
                contextKey,
                `the segment "${segment}" names a param "${inner}", which is not usable as a key — a param name ` +
                    'is letters, digits, `_` and `$`, because useLocalSearchParams() hands it back as a property',
            );
        }
        return { kind: 'param', name: inner };
    }

    if (segment.startsWith('+')) {
        throw new RouterError(
            'unknown-convention',
            contextKey,
            `the segment "${segment}" uses expo-router's \`+\` prefix, and \`+not-found\` is the only one this ` +
                'layer answers for. `+html`, `+native-intent` and the rest describe a web or a mobile host that ' +
                'a GTK window does not have',
        );
    }

    if (segment.startsWith('_')) {
        throw new RouterError(
            'unknown-convention',
            contextKey,
            `the segment "${segment}" is \`_\`-prefixed, and \`_layout\` is the only one this layer answers for. ` +
                'expo-router treats other `_` names as private and silently leaves them out of the tree; a file ' +
                'that is not a route belongs outside the routes directory, where nothing has to guess',
        );
    }

    if (segment === '' || segment === '.' || segment === '..') {
        throw new RouterError(
            'unknown-convention',
            contextKey,
            `"${contextKey}" has an empty or relative path segment. A context key is a plain relative path`,
        );
    }

    return { kind: 'static', name: segment };
}

/**
 * One manifest entry → its segments and its role.
 *
 * The extension is stripped FIRST and its absence is the first refusal, because a
 * `README.md` next to the routes is the most ordinary way to end up here and
 * "matches no convention" is a better answer than "`README` is not a valid segment".
 */
function parseFile(entry: RouteManifestEntry): ParsedFile {
    const contextKey = entry.contextKey;
    if (contextKey.startsWith('/') || contextKey.includes('\\')) {
        throw new RouterError(
            'bad-manifest',
            contextKey,
            'a context key is a path RELATIVE to the routes directory, with `/` separators. An absolute path or ' +
                'a backslash means the manifest was built against the wrong root',
        );
    }
    const extension = ROUTE_EXTENSIONS.find((candidate) => contextKey.endsWith(candidate));
    if (extension === undefined) {
        throw new RouterError(
            'unknown-convention',
            contextKey,
            `a route file ends in one of ${ROUTE_EXTENSIONS.join(', ')} — this one does not, so it is not a ` +
                'route. The routes directory holds routes: move it somewhere else, and nothing has to guess ' +
                'whether it was meant to be a screen',
        );
    }
    const withoutExtension = contextKey.slice(0, -extension.length);
    const parts = withoutExtension.split('/');
    const rawLeaf = parts[parts.length - 1] as string;
    const rawDir = parts.slice(0, -1);

    const isLayout = rawLeaf === '_layout';
    const isNotFound = rawLeaf === '+not-found';
    const dir = rawDir.map((segment) => parseSegment(segment, contextKey));
    // `_layout` and `+not-found` are the two leaf names the conventions spell
    // themselves, so they never reach `parseSegment` — which would refuse both, one
    // for the `_` prefix and one for the `+`.
    const leaf = isLayout
        ? null
        : isNotFound
          ? { kind: 'static' as const, name: '+not-found' }
          : parseSegment(rawLeaf, contextKey);

    return { contextKey, module: entry.module, dir, leaf, isLayout, isNotFound };
}

// ---------------------------------------------------------------------------
// Segments → a URL pattern
// ---------------------------------------------------------------------------

/** React Navigation's spelling of one segment, or `null` when it contributes none. */
function patternOf(segment: Segment, isNotFound: boolean): string | null {
    if (isNotFound) return '*';
    switch (segment.kind) {
        // A group is the whole point: it groups without appearing in the URL.
        case 'group':
            return null;
        // `index` is the directory's own route, so it adds nothing either.
        case 'static':
            return segment.name === 'index' ? null : segment.name;
        case 'param':
            return `:${segment.name}`;
    }
}

/** The URL pattern a run of segments contributes, and the params it introduces. */
function patternFor(
    segments: readonly Segment[],
    isNotFound: boolean,
): { readonly path: string; readonly params: readonly string[] } {
    const pieces: string[] = [];
    const params: string[] = [];
    for (const [index, segment] of segments.entries()) {
        const piece = patternOf(segment, isNotFound && index === segments.length - 1);
        if (piece !== null) pieces.push(piece);
        if (segment.kind === 'param') params.push(segment.name);
    }
    return { path: pieces.join('/'), params };
}

/**
 * A parent's pattern plus a child's own — the one place that join is spelled.
 *
 * `*` is the not-found wildcard and must stay the WHOLE pattern: prefixing it would
 * make it match `/prefix/anything` only, and a fallback that catches one subtree is
 * not the fallback the author asked for.
 */
const joinPattern = (prefix: string, node: RouteNode): string =>
    node.notFound ? node.path : [prefix, node.path].filter((piece) => piece !== '').join('/');

/** The name React Navigation addresses a node by: its segments, verbatim, joined. */
const nameFor = (segments: readonly Segment[]): string =>
    segments
        .map((segment) => {
            switch (segment.kind) {
                case 'group':
                    return `(${segment.name})`;
                case 'param':
                    return `[${segment.name}]`;
                case 'static':
                    return segment.name;
            }
        })
        .join('/');

// ---------------------------------------------------------------------------
// Files → a tree
// ---------------------------------------------------------------------------

/** A directory that owns a `_layout`, keyed by its joined raw path (`''` is the root). */
const dirKey = (segments: readonly Segment[]): string => nameFor(segments);

/**
 * The routes directory → the navigator tree.
 *
 * @throws RouterError for every one of the conventions' failure modes: a file that
 * matches none of them, a `[param]` with no name, two files claiming one URL, a
 * `_layout` with nothing under it, and a manifest that is empty or misshapen.
 */
export function buildRouteTree(manifest: RouteManifest): RouteNode {
    if (!Array.isArray(manifest)) {
        throw new RouterError(
            'bad-manifest',
            '',
            'the route manifest is not an array. A bundler plugin emits `[{ contextKey, module }, …]`; see ' +
                '`rnRouteManifestPlugin` in @gjsify/rolldown-plugin-gjsify',
        );
    }
    if (manifest.length === 0) {
        throw new RouterError(
            'bad-manifest',
            '',
            'the route manifest is empty, so there is nothing to route to. Point the plugin at the directory ' +
                'that holds your route files, or add an `index.tsx` to the one it is pointed at',
        );
    }
    for (const entry of manifest) {
        if (entry === null || typeof entry !== 'object' || typeof entry.contextKey !== 'string') {
            throw new RouterError(
                'bad-manifest',
                JSON.stringify(entry ?? null),
                'a route manifest entry needs a string `contextKey` and a `module`',
            );
        }
    }

    const files = manifest.map(parseFile);

    // The navigator directories: the root always, plus every directory holding a
    // `_layout`. Anything else flattens into its nearest navigator ancestor.
    const layouts = new Map<string, ParsedFile>();
    for (const file of files) {
        if (!file.isLayout) continue;
        const key = dirKey(file.dir);
        const existing = layouts.get(key);
        if (existing !== undefined) {
            throw new RouterError(
                'duplicate-route',
                `${existing.contextKey} and ${file.contextKey}`,
                `both are the \`_layout\` of "${key === '' ? '.' : key}", and a directory has one navigator. ` +
                    'Delete one',
            );
        }
        layouts.set(key, file);
    }

    /** The deepest navigator directory that contains `segments`, and the rest of the path. */
    const ownerOf = (segments: readonly Segment[]): { readonly owner: string; readonly rest: readonly Segment[] } => {
        for (let depth = segments.length; depth > 0; depth--) {
            const key = dirKey(segments.slice(0, depth));
            if (layouts.has(key)) return { owner: key, rest: segments.slice(depth) };
        }
        return { owner: '', rest: segments };
    };

    interface Draft {
        readonly key: string;
        readonly node: RouteNode;
        readonly children: Draft[];
    }

    const drafts = new Map<string, Draft>();
    const rootLayout = layouts.get('');
    const root: Draft = {
        key: '',
        node: {
            kind: 'layout',
            name: '',
            path: '',
            params: [],
            contextKey: rootLayout?.contextKey ?? null,
            module: rootLayout?.module ?? null,
            children: [],
            notFound: false,
        },
        children: [],
    };
    drafts.set('', root);

    // Every non-root navigator becomes a `layout` node inside ITS owner, named by
    // the path between the two. Deepest last, so a parent draft always exists by the
    // time a child looks for it.
    const nested = [...layouts.entries()]
        .filter(([key]) => key !== '')
        .sort((left, right) => left[0].split('/').length - right[0].split('/').length);
    for (const [key, file] of nested) {
        const { owner, rest } = ownerOf(file.dir.slice(0, -1));
        const own = file.dir[file.dir.length - 1] as Segment;
        const segments = [...rest, own];
        const { path, params } = patternFor(segments, false);
        const draft: Draft = {
            key,
            node: {
                kind: 'layout',
                name: nameFor(segments),
                path,
                params,
                contextKey: file.contextKey,
                module: file.module,
                children: [],
                notFound: false,
            },
            children: [],
        };
        drafts.set(key, draft);
        (drafts.get(owner) as Draft).children.push(draft);
    }

    for (const file of files) {
        if (file.isLayout) continue;
        const { owner, rest } = ownerOf(file.dir);
        const segments = [...rest, file.leaf as Segment];
        const { path, params } = patternFor(segments, file.isNotFound);
        (drafts.get(owner) as Draft).children.push({
            key: `${owner}::${nameFor(segments)}`,
            node: {
                kind: 'screen',
                name: nameFor(segments),
                path,
                params,
                contextKey: file.contextKey,
                module: file.module,
                children: [],
                notFound: file.isNotFound,
            },
            children: [],
        });
    }

    for (const [key, file] of layouts) {
        if (key === '') continue;
        if ((drafts.get(key) as Draft).children.length === 0) {
            throw new RouterError(
                'layout-without-routes',
                file.contextKey,
                'is the navigator for a directory that holds no routes, so it would render an empty navigator. ' +
                    'Add a route file beside it, or delete it and let the parent navigator hold the routes',
            );
        }
    }

    // ORDER IS THE INITIAL ROUTE, so it is declared rather than incidental. React
    // Navigation focuses a navigator's FIRST screen when nothing says otherwise, and
    // `index` is the one a directory means by "itself". `+not-found` goes last for
    // the same reason its pattern is `*`: a fallback that is tried first is not a
    // fallback. Everything between is alphabetical, which makes the emitted tree
    // deterministic — a manifest read in directory order is not.
    const rank = (node: RouteNode): number => (node.notFound ? 2 : node.name === 'index' ? 0 : 1);
    const finish = (draft: Draft): RouteNode => {
        const children = draft.children
            .map(finish)
            .sort((left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name));
        return { ...draft.node, children };
    };
    const tree = finish(root);

    // Duplicate URLs, over the FINISHED tree — the only place the full pattern of a
    // node is known, because it is the join of every ancestor's. Two files under
    // different groups are the ordinary way in: `(app)/settings.tsx` and
    // `(admin)/settings.tsx` are both `/settings`, and a group contributes nothing
    // that would tell them apart.
    const byUrl = new Map<string, string>();
    const walk = (node: RouteNode, prefix: string): void => {
        for (const child of node.children) {
            const url = joinPattern(prefix, child);
            if (child.kind === 'screen') {
                const previous = byUrl.get(url);
                if (previous !== undefined) {
                    throw new RouterError(
                        'duplicate-route',
                        `${previous} and ${child.contextKey as string}`,
                        `both resolve to "/${url}", and a URL addresses one screen. A (group) contributes no ` +
                            'segment, so two files in different groups collide unless one of the groups has its ' +
                            'own `_layout`',
                    );
                }
                byUrl.set(url, child.contextKey as string);
            } else {
                walk(child, url);
            }
        }
    };
    walk(tree, '');

    return tree;
}

// ---------------------------------------------------------------------------
// A tree → React Navigation's path config
// ---------------------------------------------------------------------------

/** A navigator's entry in React Navigation's path config: children, and which is first. */
export interface PathConfigTree {
    readonly initialRouteName?: string;
    readonly screens: Readonly<Record<string, PathConfigNode>>;
}
/** A screen's entry: one URL pattern, and no children. */
export interface PathConfigLeaf {
    readonly path: string;
}
/** Either, which is what makes the config a tree. */
export type PathConfigNode = PathConfigLeaf | PathConfigTree;

/**
 * The tree → the config `getStateFromPath` / `getPathFromState` take.
 *
 * REUSED RATHER THAN WRITTEN, and this function is the whole reason the reuse
 * works: React Navigation already turns a URL into navigation state and state back
 * into a URL, correctly, for nested navigators and for params. What it needs is a
 * description of the tree, and the tree is what the file convention produces. So
 * `router.navigate('/detail/7')` is `getStateFromPath` + `getActionFromState`, and
 * `usePathname()` is `getPathFromState` — no matcher of our own in either
 * direction, which is where a second router would have started.
 *
 * ONLY A SCREEN CARRIES A `path`, AND ITS PATH IS THE JOIN OF ITS ANCESTORS'.
 * MEASURED, because the obvious shape does not work: giving the navigator its own
 * `path` (`'(tabs)'` → `''`, `detail` → `'detail'`) makes React Navigation build a
 * config entry for the navigator ITSELF as well as for its screens, and it then
 * refuses the whole config — "Found conflicting screens with the same pattern. The
 * pattern '' resolves to both 'index' and '(tabs)'". A navigator is not a
 * destination; only the screen inside it is. Folding the prefix into the children
 * keeps the `screens` nesting (which is what makes the resulting STATE nest, and
 * therefore what makes a nested navigator work at all) while leaving exactly one
 * pattern per screen.
 */
export function pathConfigOf(tree: RouteNode, prefix = ''): PathConfigTree {
    const screens: Record<string, PathConfigNode> = {};
    for (const child of tree.children) {
        const own = joinPattern(prefix, child);
        screens[child.name] = child.kind === 'screen' ? { path: own } : pathConfigOf(child, own);
    }
    const initial = tree.children[0]?.name;
    return initial === undefined ? { screens } : { initialRouteName: initial, screens };
}

/** Every screen's URL pattern, for a diagnostic that lists what WOULD have matched. */
export function screenUrls(tree: RouteNode, prefix = ''): readonly string[] {
    return tree.children.flatMap((child) => {
        const own = joinPattern(prefix, child);
        return child.kind === 'screen' ? [`/${own}`] : screenUrls(child, own);
    });
}
