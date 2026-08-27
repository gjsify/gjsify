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

import type { Plugin } from 'rolldown';

/** The package whose export surface mirrors React Native's (ADR 0032 § 2). */
export const REACT_NATIVE_ALIAS_TARGET = '@gjsify/react-native';

/** The specifier an unmodified React Native application writes. */
export const REACT_NATIVE_SPECIFIER = 'react-native';

/** What a specifier is, as far as this alias is concerned. */
export type ReactNativeSpecifierKind =
    /** Exactly `react-native` — the package root, which is the mirrored surface. */
    | { readonly kind: 'root' }
    /** `react-native/<subpath>` — internals, which are not mirrored. */
    | { readonly kind: 'subpath'; readonly subpath: string }
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
export function classifyReactNativeSpecifier(source: string): ReactNativeSpecifierKind {
    if (source === REACT_NATIVE_SPECIFIER) return { kind: 'root' };
    if (source.startsWith(`${REACT_NATIVE_SPECIFIER}/`)) {
        return { kind: 'subpath', subpath: source.slice(REACT_NATIVE_SPECIFIER.length + 1) };
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
    ) {
        super(
            `gjsify react-native alias: "${specifier}" (imported by ${importer}) reaches into React ` +
                `Native's internals. The alias to ${REACT_NATIVE_ALIAS_TARGET} covers the PACKAGE ROOT, ` +
                `because that is the export surface ADR 0032 § 2 mirrors; the subpath layout below it ` +
                `belongs to Metro and the native bridge and has no counterpart here. Import the name from ` +
                `"${REACT_NATIVE_SPECIFIER}" instead, or from "${REACT_NATIVE_ALIAS_TARGET}" directly if ` +
                `it is a gjsify-only addition.`,
        );
    }
}

/** Thrown when the alias target itself cannot be resolved. */
export class ReactNativeAliasTargetMissingError extends Error {
    override readonly name = 'ReactNativeAliasTargetMissingError';
    constructor(readonly importer: string) {
        super(
            `gjsify react-native alias: "${REACT_NATIVE_SPECIFIER}" (imported by ${importer}) is aliased ` +
                `to ${REACT_NATIVE_ALIAS_TARGET}, which does not resolve from this project. Install it, or ` +
                `drop the react-native opt-in. NOT falling back to the real react-native on purpose: it is ` +
                `written for a React Native runtime, so the bundle would build and then fail in the window ` +
                `on a NativeModules bridge that does not exist here.`,
        );
    }
}

/**
 * Rewrite the bare `react-native` specifier onto `@gjsify/react-native`.
 *
 * `order: 'pre'` so the claim lands before the externals policy and the
 * substitution-table alias layer get a look — the same position
 * `platformResolvePlugin` holds, and for the same reason: a redirect that runs
 * after `externalsPlugin` would find the specifier already externalised.
 */
export function reactNativeAliasPlugin(): Plugin {
    return {
        name: 'gjsify-react-native-alias',
        resolveId: {
            order: 'pre' as const,
            async handler(source, importer, extraOptions) {
                const classified = classifyReactNativeSpecifier(source);
                if (classified.kind === 'other') return null;
                // An ENTRY has no importer to name; report the specifier itself
                // rather than the string "undefined".
                const from = importer ?? source;
                if (classified.kind === 'subpath') throw new ReactNativeDeepImportError(source, from);

                // `skipSelf: true` keeps the nested resolve out of this hook. The
                // target is a plain package name, so the normal chain (workspace
                // link, node_modules, the exports map) answers it.
                const resolved = await this.resolve(REACT_NATIVE_ALIAS_TARGET, importer, {
                    skipSelf: true,
                    ...(extraOptions?.kind ? { kind: extraOptions.kind } : {}),
                });
                if (!resolved || resolved.external) throw new ReactNativeAliasTargetMissingError(from);
                return resolved;
            },
        },
    };
}
