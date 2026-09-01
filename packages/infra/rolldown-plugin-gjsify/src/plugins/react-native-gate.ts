// The build-time half of ADR 0032 § 8's gate: fail the BUILD on an import of a
// React Native name this layer does not answer for.
//
// § 8 makes `packages/framework/react-native/src/support-table.ts` the one source
// three readers share — the bundler gate, the runtime refusals, and the generated
// README. Two of the three existed. This is the first, and the only thing it has
// over the runtime backstop is WHEN and WHERE: it names the importing file and
// the line before anything runs, instead of throwing the first time a code path
// is reached in a window. That is the whole point ADR 0032 states as the project
// goal — "porting is cheap and every divergence is knowable at build time rather
// than discoverable in a window".
//
// IT READS THE TABLE, NEVER A COPY. `@gjsify/react-native/support-table` is a
// published subpath (`./lib/esm/support-table.js`) exporting `isImportable` and
// `explainUnsupported`, and the plugin resolves it through the bundler's own
// resolver and imports it. Reading the SOURCE the way `scripts/check-rn-surface.mjs`
// does is not an option here: `files` on that package ships `lib` and not `src`,
// so in a consumer's `node_modules` there is no `support-table.ts` to parse.
//
// WHAT THAT IMPORT DRAGS IN, measured on the built file rather than assumed: two
// RELATIVE imports, rolldown's two-helper runtime shim and the generated
// `own-exports.js`, which is a string array importing nothing. Relative is the half
// that matters twice over — nothing reachable from here can pull GTK into the
// bundler process, and GJS's ESM loader follows a relative specifier where it does
// not follow `package.json#exports`. This comment used to claim "no imports at all",
// which the runtime shim already disproved before the second one arrived.
//
// AND IT IS NOT A DEPENDENCY, deliberately. `@gjsify/rolldown-plugin-gjsify` is
// tier 1 and `@gjsify/react-native` is tier 3; a tier-1 package may not depend on
// a higher tier (`scripts/audit-runtimes.mjs`). Resolving the table from the
// PROJECT is also the more correct answer than bundling a snapshot would be: the
// gate then states exactly what the build's own copy of the layer supports, so a
// version skew between plugin and layer cannot make the gate lie in either
// direction.

import type { Plugin } from 'rolldown';

import {
    FALLBACK_SURFACES,
    SURFACE_MENTION,
    loadLayer,
    type AliasedSurface,
    type LayerReader,
} from './react-native-alias.js';
import { REWRITE_FILTER } from './rewrite-node-modules-paths.js';
import {
    ImportScanParseError,
    scanNamedImports,
    type NamedImport,
    type OpaqueReference,
} from '../utils/scan-named-imports.js';

/**
 * What the gate needs off the layer, and it is now three things rather than two.
 *
 * `SURFACES` is the addition ADR 0036 makes: the gate has to know WHICH specifiers to
 * watch, and that list is the layer's rather than the plugin's. A structural type, so
 * a spec can pass a three-row fixture and so the plugin never types itself against a
 * tier-3 package it must not import.
 */
export type SupportTableReader = LayerReader;

export { SUPPORT_TABLE_SUBPATH, SupportTableUnreadableError } from './react-native-alias.js';
export type { SupportTableResolver } from './react-native-alias.js';

/**
 * `loadLayer` under its historical name.
 *
 * Kept because it is a published export of `@gjsify/rolldown-plugin-gjsify`, and
 * renaming a published function to say "surfaces" as well as "table" would be a
 * breaking change for nothing — the loader reads one module either way.
 */
export { loadLayer as loadSupportTable } from './react-native-alias.js';

/**
 * Every specifier the gate watches, from the layer's own registry.
 *
 * BOTH SPELLINGS OF EACH SURFACE. A ported application writes `expo-status-bar` (the
 * alias rewrites it, and the rewrite happens in `resolveId` — the SOURCE text still
 * says `expo-status-bar` when this hook reads it). A gjsify-native application, this
 * repository's own showcase included, writes `@gjsify/react-native/expo-status-bar`.
 * The gate is about the SURFACE, not about which name reached it.
 */
export const watchedSpecifiers = (surfaces: readonly AliasedSurface[]): readonly string[] =>
    surfaces.flatMap((surface) => [surface.module, surface.target]);

/**
 * The two specifiers that are known WITHOUT reading the layer.
 *
 * Kept as a published constant because it was one, and it is now the FALLBACK rather
 * than the whole list: `watchedSpecifiers(layer.SURFACES)` is what a real build uses.
 */
export const WATCHED_SPECIFIERS: readonly string[] = watchedSpecifiers(FALLBACK_SURFACES);

/** One refused import, with everything the message needs. */
export interface SupportViolation {
    readonly name: string;
    readonly specifier: string;
    readonly line: number;
    readonly column: number;
    /** The table's own sentence for this name. */
    readonly reason: string;
}

/** Thrown for every refused import in one module, in one message. */
export class ReactNativeUnsupportedImportError extends Error {
    override readonly name = 'ReactNativeUnsupportedImportError';
    constructor(
        readonly id: string,
        readonly violations: readonly SupportViolation[],
    ) {
        super(formatSupportViolations(id, violations));
    }
}

/**
 * All violations for one module as one message.
 *
 * One message and not one per name: an application that imports `FlatList`,
 * `Animated` and `Image` from the same file has one porting decision to make,
 * and three separate build failures would show it one third of that decision per
 * run.
 */
export function formatSupportViolations(id: string, violations: readonly SupportViolation[]): string {
    const lines = violations.map(
        (v) => `  ${id}:${v.line}:${v.column}  ${v.name} (from "${v.specifier}")\n      ${v.reason}`,
    );
    return (
        `gjsify react-native gate: ${violations.length} import(s) this layer does not answer for:\n` +
        `${lines.join('\n')}\n` +
        `Each sentence above is the support table's own (ADR 0032 § 8), so it is the same reason the ` +
        `runtime would give. A "not implemented yet" entry is where to contribute; a refusal names what ` +
        `to write instead.`
    );
}

/** The refused subset of a scan, in the table's words. */
export function findSupportViolations(
    named: readonly NamedImport[],
    table: SupportTableReader,
): readonly SupportViolation[] {
    const out: SupportViolation[] = [];
    for (const entry of named) {
        // THE SPECIFIER IS PASSED, and after ADR 0036 it is load-bearing rather than
        // extra context: `StatusBar` is a `react-native` export AND the whole of
        // `expo-status-bar`, `Image` is `react-native`'s and `expo-image`'s. Without
        // the module the lookup answers from whichever surface the registry lists
        // first, so `import { Image } from 'expo-image'` would report react-native's
        // "is available" and the build would go green on a name nothing implements.
        if (table.isImportable(entry.name, entry.specifier)) continue;
        out.push({
            name: entry.name,
            specifier: entry.specifier,
            line: entry.line,
            column: entry.column,
            // The table's sentence, never a rephrasing of it: `explainUnsupported`
            // exists so the build error and the runtime throw cannot describe the
            // same gap differently.
            reason: table.explainUnsupported(entry.name, entry.specifier),
        });
    }
    return out;
}

/** The warning for a reference whose names the scan cannot see. */
export function formatOpaqueReference(id: string, ref: OpaqueReference): string {
    const forms: Record<OpaqueReference['form'], string> = {
        namespace: 'a namespace import (`import * as …`)',
        default: 'a default import',
        'export-all': 'a star re-export (`export * from …`)',
        'dynamic-import': 'a dynamic `import()`',
        require: 'a `require()`',
    };
    return (
        `gjsify react-native gate: ${id}:${ref.line}:${ref.column} reaches "${ref.specifier}" through ` +
        `${forms[ref.form]}, so the NAMES it uses are not knowable at build time and this gate cannot ` +
        `check them. The runtime refusal still covers them — it reads the same table (ADR 0032 § 8) — but ` +
        `it fires when the code path runs, not now. Import the names you use to move the answer back to ` +
        `build time.`
    );
}

/**
 * The warning for a module the parser could not read.
 *
 * A WARNING and not a build error, which is the one place this gate deliberately
 * does not fail. `acorn-typescript` 1.4.13 cannot parse a `satisfies` expression
 * or a `const` type parameter (measured; see `scan-named-imports.ts`), both of
 * which are ordinary TypeScript in a tree pinned to `typescript: "^6.0.3"`.
 * Erroring there would refuse a program that is correct, and this repository has
 * already written down what that costs: "a false violation is how a checker
 * teaches people to ignore it" (`check-rn-surface.mjs`). The shape used instead
 * is the one that file also uses — degrade to the weaker half and SAY SO, out
 * loud, per file, rather than degrade quietly.
 */
export function formatUnreadableModule(error: ImportScanParseError): string {
    return (
        `${error.message} The build continues: the runtime refusal reads the same table (ADR 0032 § 8) and ` +
        `still covers this module, but it fires when the code path runs rather than now.`
    );
}

export interface ReactNativeSupportGateOptions {
    /**
     * The table, when the caller already has it. Left unset in a real build,
     * where {@link loadSupportTable} reads the project's own copy on the first
     * module that mentions the layer.
     */
    table?: SupportTableReader;
}

/**
 * Fail the build on an import of a React Native name whose status is not
 * `supported` or `partial`.
 *
 * A `transform` hook at `order: 'pre'`, which is what makes `import type` visible
 * — by the time a normal-order hook runs, the annotations may already have been
 * stripped, and the gate would then be unable to tell the five type-only imports
 * ADR 0032 measured from five value imports. Same reason `deepkitPlugin` is
 * composed as a prePlugin.
 */
export function reactNativeSupportGatePlugin(options: ReactNativeSupportGateOptions = {}): Plugin {
    let table: SupportTableReader | undefined = options.table;

    return {
        name: 'gjsify-react-native-gate',
        transform: {
            order: 'pre' as const,
            filter: { id: REWRITE_FILTER },
            async handler(code: string, id: string) {
                // Re-applied inside the handler, the way
                // `nodeModulesPathRewritePlugin` does: the object-form `filter` is
                // engine plumbing (under GJS `toNativePlugin` lifts `filter.id`
                // into `@gjsify/rolldown-native`'s plugin-level `idFilter`), and a
                // gate must not depend on plumbing to stay off `.css` / `.blp` /
                // a data URL, all of which acorn would reject as invalid JS.
                if (!REWRITE_FILTER.test(id)) return null;
                // Text prefilter before the parse AND before the layer is read.
                // ADR 0036 turned two watched specifiers into eighteen surfaces with
                // two spellings each, and the list of those is the LAYER's — so the
                // gate cannot know what to scan for until it has read it, and reading
                // it on every module would make the one module that mentions a surface
                // in a comment pay for the whole build. `SURFACE_MENTION` is anchored
                // on the opening quote of a module specifier, which is why a bare
                // `expo-` test is not enough: the word `export` contains it.
                if (!SURFACE_MENTION.test(code)) return null;

                // The ONE catch in this file, with a real throw path and a
                // stated reason: `scanNamedImports` throws on syntax the pinned
                // acorn-typescript cannot read, and the policy for that lives
                // here rather than in the pure function — see
                // {@link formatUnreadableModule}.
                // The layer FIRST, because its registry is what says which specifiers
                // to scan for. The load is once per build and cached on the closure.
                table ??= await loadLayer(this, id);
                let scanned;
                try {
                    scanned = scanNamedImports(code, id, watchedSpecifiers(table.SURFACES));
                } catch (error) {
                    if (!(error instanceof ImportScanParseError)) throw error;
                    this.warn(formatUnreadableModule(error));
                    return null;
                }
                const { named, opaque } = scanned;
                if (named.length === 0 && opaque.length === 0) return null;

                const violations = findSupportViolations(named, table);
                if (violations.length > 0) throw new ReactNativeUnsupportedImportError(id, violations);

                for (const ref of opaque) this.warn(formatOpaqueReference(id, ref));

                // A gate, not a transform: the source is returned unchanged and
                // the module goes on through the chain.
                return null;
            },
        },
    };
}
