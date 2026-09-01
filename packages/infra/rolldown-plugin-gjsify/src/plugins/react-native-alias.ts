// `'react-native'` → `'@gjsify/react-native'`: the alias line ADR 0032 § 2 names.
//
// § 2 puts it this way: the package NAME `@gjsify/react-native` "is the
// documentation of the bundler alias line, and that alias only works if the
// export surface mirrors React Native's". Without the line the mirror has no
// consumer — an unmodified React Native application still cannot build, because
// every one of its files imports `react-native` and nothing rewrites it. This
// repository's own showcase had to import the gjsify name instead, which is the
// measurement: the port that was supposed to be free was a rename per file.
//
// OPT-IN, NEVER UNCONDITIONAL, and this is the part to not "simplify":
//
//   1. A build that is not a React Native port must not have `react-native`
//      redirected under it. A monorepo with a phone leg and a desktop leg has
//      the real `react-native` installed on purpose; rewriting the specifier for
//      every `gjsify build` in that tree changes what the PHONE build resolves,
//      and `--app nativescript` has its own vocabulary that this layer does not
//      speak (ADR 0032, "What this does not decide").
//   2. `@gjsify/react-native` is tier 3 and optional. An unconditional alias
//      makes every build in a tree without it fail on a package nobody asked
//      for — and the failure names a gjsify package, so it reads as our bug.
//
// So the redirect happens only where the consumer asked for it: `gjsify build
// --dialect react-native`, or this plugin composed by hand.
//
// A `resolveId` hook and not an `aliasPlugin` entry, for two reasons the alias
// table cannot express: a deep import into React Native's internals is a NAMED
// REFUSAL rather than a rewrite (see {@link ReactNativeDeepImportError}), and an
// unresolvable target is a named error rather than a silent external — the
// substitution IS the promise, so its failure is the one thing that must not
// exit 0.

import { pathToFileURL } from 'node:url';
import type { Plugin } from 'rolldown';

/** The package whose export surface mirrors React Native's (ADR 0032 § 2). */
export const REACT_NATIVE_ALIAS_TARGET = '@gjsify/react-native';

/** The specifier an unmodified React Native application writes. */
export const REACT_NATIVE_SPECIFIER = 'react-native';

/**
 * One npm package the layer answers for, and the specifier that answers it.
 *
 * ADR 0036 § 2: `react-native` and `expo-router` are the first two rows of a registry
 * rather than two special cases, because a real React Native application imports
 * sixteen more package names and every one of them used to fail at MODULE RESOLUTION —
 * the bundler said npm could not find it, which names npm rather than this layer.
 *
 * READ FROM THE LAYER, never listed here. `@gjsify/react-native/support-table` exports
 * the registry, the gate already imports that subpath to read the table, and a second
 * list in the bundler plugin is the drift this whole arrangement exists to remove: the
 * plugin would then alias a surface whose table it cannot see, or refuse one the layer
 * has grown.
 */
export interface AliasedSurface {
    readonly module: string;
    readonly target: string;
}

/** What a specifier is, as far as this alias is concerned. */
export type ReactNativeSpecifierKind =
    /** Exactly a declared surface's own npm name — the mirrored export surface. */
    | { readonly kind: 'root'; readonly target: string }
    /**
     * `<a declared surface>/<subpath>` — internals, which are not mirrored.
     *
     * The MODULE and the TARGET come along because the refusal names them: `react-native`
     * is no longer the only surface with a subpath layout below it, and
     * `@expo/vector-icons/Ionicons` and `expo-router/entry` are both ordinary things a
     * real application writes.
     */
    | { readonly kind: 'subpath'; readonly module: string; readonly target: string; readonly subpath: string }
    /** Anything else, including `@gjsify/react-native` itself. */
    | { readonly kind: 'other' };

/**
 * Classify an import specifier.
 *
 * EXACT match on the root, never a prefix: `react-native-web`,
 * `react-native-reanimated` and `react-native-gesture-handler` all start with
 * the same eleven characters and none of them is this package. ADR 0032 records
 * the last two as `not-reachable` (they need a Babel worklet transform that is
 * not in this chain) and the first as rejected by design; aliasing any of them
 * onto the mirror would replace a package that legitimately does not work with
 * one that silently does the wrong thing.
 */
export function classifyReactNativeSpecifier(
    source: string,
    surfaces: readonly AliasedSurface[] = [{ module: REACT_NATIVE_SPECIFIER, target: REACT_NATIVE_ALIAS_TARGET }],
): ReactNativeSpecifierKind {
    for (const surface of surfaces) {
        if (source === surface.module) return { kind: 'root', target: surface.target };
    }
    // A DEEP IMPORT is only a deep import of a surface this layer answers for. The
    // exact-match loop above runs FIRST for the same reason it always did:
    // `react-native-web`, `react-native-reanimated` and `react-native-svg` all start
    // with the same eleven characters and none of them is `react-native`, so the
    // prefix test has to come after every exact name — including the surface names
    // `react-native-safe-area-context` and `react-native-gesture-handler`, which a
    // prefix test on `react-native/` would not catch but a careless `react-native-`
    // one would.
    //
    // EVERY SURFACE, not only `react-native`, and that gap was reachable from ordinary
    // code: `@expo/vector-icons/Ionicons` is the spelling `@expo/vector-icons`' own
    // documentation uses, and `expo-router/entry` is what an Expo application's
    // `package.json#main` points at. Both classified as `other` before this, so the
    // alias returned null and the build failed at MODULE RESOLUTION — npm's "cannot
    // find package", which is the exact failure ADR 0036 exists to replace with a
    // sentence.
    for (const surface of surfaces) {
        if (source.startsWith(`${surface.module}/`)) {
            return {
                kind: 'subpath',
                module: surface.module,
                target: surface.target,
                subpath: source.slice(surface.module.length + 1),
            };
        }
    }
    return { kind: 'other' };
}

/**
 * Thrown for `react-native/<subpath>` — an import of React Native's internals.
 *
 * The alias rests on the export SURFACE being mirrored (§ 2), and a subpath is
 * by definition not part of that surface: `react-native/Libraries/Components/…`
 * reaches into a module layout that exists because of Metro and the native
 * bridge. There is nothing to map it to and nothing honest to stub it with, so
 * the build says so with the importer named rather than resolving to the real
 * React Native source and failing later on `NativeModules`.
 */
export class ReactNativeDeepImportError extends Error {
    override readonly name = 'ReactNativeDeepImportError';
    constructor(
        readonly specifier: string,
        readonly importer: string,
        readonly module: string = REACT_NATIVE_SPECIFIER,
        readonly target: string = REACT_NATIVE_ALIAS_TARGET,
    ) {
        super(
            `gjsify react-native alias: "${specifier}" (imported by ${importer}) reaches into ` +
                `"${module}"'s internals. The alias to ${target} covers the PACKAGE ROOT, because that is ` +
                `the export surface ADR 0032 § 2 mirrors and ADR 0036 § 1 gives one subpath each; the ` +
                `module layout below it has no counterpart here` +
                (module === REACT_NATIVE_SPECIFIER
                    ? ` — react-native's own exists because of Metro and the native bridge`
                    : '') +
                `. Import the name from "${module}" instead, or from "${target}" directly if it is a ` +
                `gjsify-only addition.`,
        );
    }
}

/** Thrown when the alias target itself cannot be resolved. */
export class ReactNativeAliasTargetMissingError extends Error {
    override readonly name = 'ReactNativeAliasTargetMissingError';
    constructor(
        readonly specifier: string,
        readonly target: string,
        readonly importer: string,
    ) {
        super(
            `gjsify react-native alias: "${specifier}" (imported by ${importer}) is aliased ` +
                `to ${target}, which does not resolve from this project. Install ${REACT_NATIVE_ALIAS_TARGET} ` +
                `(and build it, if it is a workspace link), or drop the react-native opt-in. NOT falling back ` +
                `to the real package on purpose: it is written for a React Native runtime, so the bundle ` +
                `would build and then fail in the window on a native module that does not exist here.`,
        );
    }
}

// --- reading the layer (ADR 0036 § 2) ----------------------------------------
//
// BOTH PLUGINS READ THE LAYER, NEVER A COPY. `@gjsify/react-native/support-table` is
// a published subpath exporting the surface registry plus `isImportable` and
// `explainUnsupported`, and it is resolved through the BUNDLER's own resolver from a
// module of the project being built — so the answer describes the layer this bundle
// will actually contain, and a version skew between plugin and layer cannot make
// either lie. Reading the SOURCE the way `scripts/check-rn-surface.mjs` does is not an
// option here: `files` ships `lib` and not `src`, so a consumer's `node_modules` has
// no `support-table.ts` to parse.
//
// AND IT IS NOT A DEPENDENCY, deliberately. `@gjsify/rolldown-plugin-gjsify` is tier 1
// and `@gjsify/react-native` is tier 3; a tier-1 package may not depend on a higher
// tier (`scripts/audit-runtimes.mjs`).

/** The subpath that carries the registry and the table in an installed layer. */
export const SUPPORT_TABLE_SUBPATH = `${REACT_NATIVE_ALIAS_TARGET}/support-table`;

/** The slice of the layer both plugins need, structurally so a spec can supply a fixture. */
export interface LayerReader {
    /** Every declared surface, in lookup order. */
    readonly SURFACES: readonly AliasedSurface[];
    /** May a build import this name from this module? */
    isImportable(name: string, module?: string): boolean;
    /** The one sentence a build error and a runtime throw both print. */
    explainUnsupported(name: string, module?: string): string;
}

/** The resolver slice the loader needs, so it is testable without a bundler. */
export interface SupportTableResolver {
    resolve(specifier: string, importer: string): Promise<{ id: string; external?: boolean | string } | null>;
}

/** Thrown when a plugin is on but the layer it must read is not reachable. */
export class SupportTableUnreadableError extends Error {
    override readonly name = 'SupportTableUnreadableError';
    constructor(detail: string, cause?: unknown) {
        super(
            `gjsify react-native gate: cannot read ${SUPPORT_TABLE_SUBPATH} — ${detail}. The gate has no ` +
                `second source to fall back on, and ADR 0032 § 8 is explicit that a hand-maintained table ` +
                `beside it would be the second truth this repository has already collected several times. ` +
                `Install ${REACT_NATIVE_ALIAS_TARGET} (and build it, if it is a workspace link), or drop ` +
                `the react-native opt-in.`,
            cause === undefined ? undefined : { cause },
        );
    }
}

/**
 * Resolve and import the layer's support-table subpath.
 *
 * `importer` is a module from the project being built, so the resolve lands in the
 * PROJECT's dependency tree rather than the CLI's.
 */
export async function loadLayer(
    resolver: SupportTableResolver,
    importer: string,
    load: (href: string) => Promise<unknown> = (href) => import(/* @vite-ignore */ href),
): Promise<LayerReader> {
    let resolved: { id: string; external?: boolean | string } | null;
    try {
        resolved = await resolver.resolve(SUPPORT_TABLE_SUBPATH, importer);
    } catch (cause) {
        throw new SupportTableUnreadableError(`the resolver threw for ${importer}`, cause);
    }
    if (!resolved) throw new SupportTableUnreadableError(`it does not resolve from ${importer}`);
    if (resolved.external) {
        throw new SupportTableUnreadableError(`it resolved as EXTERNAL from ${importer}, so there is no file to read`);
    }

    let mod: unknown;
    try {
        // A file path, not the bare specifier: GJS's ESM loader does not follow
        // `package.json#exports`, so the bare form works on Node and fails under the
        // GJS engine — the same limitation the CLI's by-name plugin loader documents.
        // The resolver already did the exports-map hop.
        mod = await load(pathToFileURL(resolved.id).href);
    } catch (cause) {
        throw new SupportTableUnreadableError(`importing ${resolved.id} failed`, cause);
    }

    const candidate = mod as Partial<LayerReader>;
    if (
        typeof candidate.isImportable !== 'function' ||
        typeof candidate.explainUnsupported !== 'function' ||
        !Array.isArray(candidate.SURFACES)
    ) {
        throw new SupportTableUnreadableError(
            `${resolved.id} does not export SURFACES + isImportable + explainUnsupported. ` +
                `That is a version skew between the bundler plugin and the layer, not a missing install`,
        );
    }
    return {
        SURFACES: candidate.SURFACES,
        isImportable: candidate.isImportable,
        explainUnsupported: candidate.explainUnsupported,
    };
}

/**
 * The one row that is known WITHOUT reading the layer.
 *
 * Used when the layer cannot be read at all, and that is a deliberate degradation
 * rather than a default. `gjsify build --dialect react-native` is an opt-in, so a
 * consumer who asked for it and has no layer installed meant `react-native` — the one
 * specifier whose name is a fact rather than a lookup — and that import gets the
 * named "target does not resolve" error it always got. Every other surface then
 * simply fails to resolve the way it did before ADR 0036, which is no worse than
 * before and much better than every `resolveId` in the build throwing.
 */
export const FALLBACK_SURFACES: readonly AliasedSurface[] = [
    { module: REACT_NATIVE_SPECIFIER, target: REACT_NATIVE_ALIAS_TARGET },
];

/**
 * Rewrite a declared surface's specifier onto the subpath that answers it.
 *
 * `order: 'pre'` so the claim lands before the externals policy and the
 * substitution-table alias layer get a look — the same position
 * `platformResolvePlugin` holds, and for the same reason: a redirect that runs
 * after `externalsPlugin` would find the specifier already externalised.
 */
export interface ReactNativeAliasOptions {
    /** The layer, when the caller already has it. Left unset in a real build. */
    layer?: LayerReader;
}

export function reactNativeAliasPlugin(options: ReactNativeAliasOptions = {}): Plugin {
    let surfaces: readonly AliasedSurface[] | null = options.layer?.SURFACES ?? null;
    let unreadable = false;

    /**
     * The registry, read once.
     *
     * A FAILURE IS CACHED TOO. Without that, a project without the layer installed
     * would retry the resolve for every specifier in the build and throw from every
     * one — including `node:fs`, which has nothing to do with this plugin.
     * {@link FALLBACK_SURFACES} says what the degradation is and why it is the honest
     * one.
     */
    const registry = async (context: SupportTableResolver, importer: string): Promise<readonly AliasedSurface[]> => {
        if (surfaces !== null) return surfaces;
        if (unreadable) return FALLBACK_SURFACES;
        try {
            surfaces = (await loadLayer(context, importer)).SURFACES;
            return surfaces;
        } catch {
            unreadable = true;
            return FALLBACK_SURFACES;
        }
    };

    return {
        name: 'gjsify-react-native-alias',
        resolveId: {
            order: 'pre' as const,
            async handler(source, importer, extraOptions) {
                // A CHEAP PREFILTER BEFORE THE REGISTRY, because this hook runs for
                // every specifier in the build and the registry needs a resolve.
                // {@link SURFACE_NAME_PREFIXES} says why the list is a prefilter and
                // what holds it against the layer's own rows.
                if (!couldBeSurfaceSpecifier(source)) return null;
                // An ENTRY has no importer to name; report the specifier itself
                // rather than the string "undefined".
                const from = importer ?? source;
                const classified = classifyReactNativeSpecifier(source, await registry(this, importer ?? source));
                if (classified.kind === 'other') return null;
                if (classified.kind === 'subpath') {
                    throw new ReactNativeDeepImportError(source, from, classified.module, classified.target);
                }

                // `skipSelf: true` keeps the nested resolve out of this hook. The
                // target is a plain package name plus a subpath, so the normal chain
                // (workspace link, node_modules, the exports map) answers it.
                const resolved = await this.resolve(classified.target, importer, {
                    skipSelf: true,
                    ...(extraOptions?.kind ? { kind: extraOptions.kind } : {}),
                });
                if (!resolved || resolved.external) {
                    throw new ReactNativeAliasTargetMissingError(source, classified.target, from);
                }
                return resolved;
            },
        },
    };
}

/**
 * The prefixes every declared surface's npm name starts with.
 *
 * A PREFILTER AND NOT A DECISION: the registry decides, and these exist only so the
 * two hot paths — one `resolveId` per specifier in the build, one `transform` per
 * module — can say "certainly not a surface" without resolving or parsing anything.
 * `react-native-alias.spec.ts` asserts every row of the LAYER's own registry starts
 * with one of them, so a surface named outside this list fails a test rather than
 * being silently skipped by the alias and the gate together.
 *
 * `@gjsify/react-native` is here because a gjsify-native application writes the target
 * directly, and the gate watches both spellings of every surface.
 */
export const SURFACE_NAME_PREFIXES: readonly string[] = [
    'react-native',
    'expo-',
    '@expo/',
    '@react-native-',
    'nativewind',
    REACT_NATIVE_ALIAS_TARGET,
];

/** Could this specifier be a declared surface? Cheap, and deliberately over-inclusive. */
export const couldBeSurfaceSpecifier = (specifier: string): boolean =>
    SURFACE_NAME_PREFIXES.some((prefix) => specifier.startsWith(prefix));

/**
 * Does this SOURCE mention a specifier that could be a surface?
 *
 * Anchored on the opening QUOTE, which is the whole point: a bare `expo-` test over
 * source text would match the word `export`, so the fragment has to sit where a module
 * specifier sits. Over-inclusive by design (a string literal in a comment matches);
 * under-inclusive never, which is the direction that matters for a gate.
 */
export const SURFACE_MENTION = new RegExp(
    `['"\`](?:${SURFACE_NAME_PREFIXES.map((prefix) => prefix.replace(/[/@.]/g, '\\$&')).join('|')})`,
);
