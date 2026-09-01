// SPDX-License-Identifier: MIT
// ADR 0032 § 8's build-time gate, and — the larger half of this file — the
// PARSER it stands on, tested the way this repository tests its other
// self-testing gates: fixtures that must parse next to fixtures that must NOT.
//
// WHY THE PARSER GETS MORE VECTORS THAN THE GATE. The gate itself is three
// lines: ask the table, collect what it refuses, throw. Everything that can go
// wrong lives one level down, in "which names does this module import", and it
// can go wrong in both directions:
//
//   • a FALSE NEGATIVE lets an unsupported import through, and the failure moves
//     to the window — the exact thing § 8 exists to prevent;
//   • a FALSE POSITIVE fails a build that is correct, and this repository has
//     already priced that: "a false violation is how a checker teaches people to
//     ignore it" (`check-rn-surface.mjs`, whose own six-vector self-test is the
//     pattern followed here).
//
// The negatives are therefore the point. A comment that contains an import, a
// string that looks like one, a `type` import that erases before it can fail, a
// package whose name merely starts the same way — each of those is a build
// failure a text scan would have produced.
//
// TWO FIXTURES MUST NOT PARSE, and they are a measurement, not an aspiration:
// `acorn-typescript` 1.4.13 (over acorn 8.17.0) rejects a `satisfies` expression
// and a `const` type parameter. They are pinned here so the gap has a name and a
// place; the day the parser gains them these two rows go red, and the fix is to
// move them up into the must-parse list.
//
// The table is a FIXTURE here, never the real one. `loadSupportTable` reading the
// project's own `@gjsify/react-native/support-table` is an end-to-end claim about
// a resolve plus a dynamic import, and it is asserted where it can be asserted
// honestly: `tests/e2e/react-native-gate/`, driving a real `gjsify build`.
//
// Tested from @gjsify/cli's harness because the plugin package has no
// `test:node` script of its own.

import { describe, expect, it } from '@gjsify/unit';
import {
    classifyReactNativeSpecifier,
    findSupportViolations,
    formatOpaqueReference,
    formatSupportViolations,
    ImportScanParseError,
    loadSupportTable,
    ReactNativeDeepImportError,
    scanNamedImports,
    SUPPORT_TABLE_SUBPATH,
    SURFACE_MENTION,
    SupportTableUnreadableError,
    watchedSpecifiers,
    WATCHED_SPECIFIERS,
    type AliasedSurface,
    type SupportTableReader,
} from '@gjsify/rolldown-plugin-gjsify';

const ID = '/proj/src/screen.tsx';

/** A three-row stand-in for the real layer, in the same shape the gate reads. */
const FIXTURE_TABLE: SupportTableReader = {
    SURFACES: [{ module: 'react-native', target: '@gjsify/react-native' }],
    isImportable: (name) => name === 'View' || name === 'Text',
    explainUnsupported: (name) =>
        name === 'FlatList'
            ? '@gjsify/react-native: "FlatList" is not implemented yet (tier P2). GTK virtualises for real.'
            : `@gjsify/react-native: "${name}" is not a React Native export this layer knows about.`,
};

const scan = (code: string) => scanNamedImports(code, ID, WATCHED_SPECIFIERS);
const names = (code: string) => scan(code).named.map((entry) => entry.name);
const forms = (code: string) => scan(code).opaque.map((ref) => ref.form);

/** Did `code` fail to parse with the scanner's own error type? */
function parseFailed(code: string): boolean {
    try {
        scan(code);
        return false;
    } catch (error) {
        if (error instanceof ImportScanParseError) return true;
        throw error;
    }
}

export default async () => {
    await describe('react-native gate: names the scanner MUST find', async () => {
        await it('finds a plain named import', () => {
            expect(names(`import { View, Text } from 'react-native';`)).toStrictEqual(['View', 'Text']);
        });

        // The SOURCE name, not the local alias: the table is keyed by what
        // react-native exports, and `Text as T` still imports `Text`.
        await it('reports the source name, not the local alias', () => {
            expect(names(`import { Text as T } from 'react-native';`)).toStrictEqual(['Text']);
        });

        await it('watches the gjsify spelling too — the showcase writes that one', () => {
            expect(names(`import { View } from '@gjsify/react-native';`)).toStrictEqual(['View']);
        });

        await it('finds a value re-export, which is an import with a different roof', () => {
            expect(names(`export { Switch } from 'react-native';`)).toStrictEqual(['Switch']);
        });

        await it('finds names across several declarations and reports positions', () => {
            const result = scan(`import { View } from 'react-native';\nimport { FlatList } from 'react-native';`);
            expect(result.named.map((entry) => entry.name)).toStrictEqual(['View', 'FlatList']);
            expect(result.named[0]?.line).toBe(1);
            expect(result.named[1]?.line).toBe(2);
        });

        await it('finds value siblings of an inline type specifier', () => {
            expect(names(`import { type ViewProps, View } from 'react-native';`)).toStrictEqual(['View']);
        });

        await it('reads .tsx — JSX, fragments and all', () => {
            const code = [
                `import { View, Text } from 'react-native';`,
                `export default () => (<><View style={{ flex: 1 }}><Text>hi</Text></View></>);`,
            ].join('\n');
            expect(names(code)).toStrictEqual(['View', 'Text']);
        });
    });

    await describe('react-native gate: what the scanner MUST NOT report', async () => {
        // ADR 0032 counted five type-only imports in the measured application and
        // recorded that they cost nothing. A type erases before anything runs, so
        // failing on one refuses a program that cannot fail.
        await it('ignores a wholly type-only import declaration', () => {
            expect(names(`import type { ViewProps, ColorValue } from 'react-native';`)).toStrictEqual([]);
        });

        await it('ignores an inline type specifier', () => {
            expect(names(`import { type LayoutChangeEvent } from 'react-native';`)).toStrictEqual([]);
        });

        await it('ignores a type-only re-export', () => {
            expect(names(`export type { ViewProps } from 'react-native';`)).toStrictEqual([]);
        });

        // The three a text scan gets wrong.
        await it('ignores an import inside a line comment', () => {
            expect(names(`// import { FlatList } from 'react-native';\nexport const x = 1;`)).toStrictEqual([]);
        });

        await it('ignores an import inside a block comment', () => {
            expect(names(`/*\nimport { FlatList } from 'react-native';\n*/\nexport const x = 1;`)).toStrictEqual([]);
        });

        await it('ignores an import that is only a string', () => {
            const code = `export const doc = \`import { FlatList } from 'react-native';\`;`;
            expect(names(code)).toStrictEqual([]);
        });

        // Eleven shared characters, three different packages.
        await it('ignores a package whose name merely starts the same way', () => {
            const code = [
                `import Animated from 'react-native-reanimated';`,
                `import { Gesture } from 'react-native-gesture-handler';`,
                `import { View } from 'react-native-web';`,
            ].join('\n');
            expect(names(code)).toStrictEqual([]);
            expect(forms(code)).toStrictEqual([]);
        });

        await it('ignores a local binding that happens to share a table name', () => {
            expect(names(`const FlatList = 1;\nexport default FlatList;`)).toStrictEqual([]);
        });
    });

    await describe('react-native gate: the forms that carry no name', async () => {
        await it('reports a namespace import as opaque, not as zero imports', () => {
            expect(forms(`import * as RN from 'react-native';`)).toStrictEqual(['namespace']);
            expect(names(`import * as RN from 'react-native';`)).toStrictEqual([]);
        });

        await it('reports a default import as opaque', () => {
            expect(forms(`import RN from 'react-native';`)).toStrictEqual(['default']);
        });

        await it('reports a star re-export as opaque', () => {
            expect(forms(`export * from 'react-native';`)).toStrictEqual(['export-all']);
        });

        await it('reports a dynamic import as opaque', () => {
            expect(forms(`const m = await import('react-native');\nexport default m;`)).toStrictEqual([
                'dynamic-import',
            ]);
        });

        await it('reports a require as opaque', () => {
            expect(forms(`const m = require('react-native');\nexport default m;`)).toStrictEqual(['require']);
        });

        await it('names the form and the position in the warning it produces', () => {
            const ref = scan(`import * as RN from 'react-native';`).opaque[0];
            if (!ref) throw new Error('expected one opaque reference');
            const message = formatOpaqueReference(ID, ref);
            expect(message.includes('namespace import')).toBe(true);
            expect(message.includes(ID)).toBe(true);
            expect(message.includes('runtime refusal')).toBe(true);
        });
    });

    await describe('react-native gate: the parser gap, as a measurement', async () => {
        // Ordinary TypeScript that the pinned parser handles. If one of these
        // ever fails, the gate has lost coverage it currently has.
        await it('parses the modern syntax it does support', () => {
            const supported = [
                `class A { accessor x = 1; }`,
                `import data from './d.json' with { type: 'json' };`,
                `interface Props { a: number }\nexport type X = Props['a'];`,
                `enum E { A, B }\nexport default E;`,
                `const f = <T,>(x: T) => x;\nexport default f;`,
                `@dec class A {}\nexport default A;`,
            ];
            for (const code of supported) {
                expect(parseFailed(`import { View } from 'react-native';\n${code}`)).toBe(false);
            }
        });

        // MEASURED on acorn-typescript 1.4.13 / acorn 8.17.0. Not an aspiration:
        // when the parser gains these, these two rows go red and the fix is to
        // move them into the list above.
        await it('cannot parse a satisfies expression', () => {
            expect(parseFailed(`import { View } from 'react-native';\nconst x = 1 satisfies number;`)).toBe(true);
        });

        await it('cannot parse a const type parameter', () => {
            expect(parseFailed(`import { View } from 'react-native';\nconst f = <const T,>(x: T) => x;`)).toBe(true);
        });

        await it('says which file it could not read, and that the runtime still covers it', () => {
            let thrown: unknown;
            try {
                scan(`import { View } from 'react-native';\nconst x = 1 satisfies number;`);
            } catch (error) {
                thrown = error;
            }
            expect(thrown instanceof ImportScanParseError).toBe(true);
            const message = (thrown as Error).message;
            expect(message.includes(ID)).toBe(true);
            expect(message.includes('satisfies')).toBe(true);
        });
    });

    await describe('react-native gate: the verdict', async () => {
        await it('passes supported and partial names', () => {
            const { named } = scan(`import { View, Text } from 'react-native';`);
            expect(findSupportViolations(named, FIXTURE_TABLE)).toStrictEqual([]);
        });

        await it('refuses everything else, in the table’s own words', () => {
            const { named } = scan(`import { FlatList } from 'react-native';`);
            const violations = findSupportViolations(named, FIXTURE_TABLE);
            expect(violations.length).toBe(1);
            expect(violations[0]?.name).toBe('FlatList');
            // The table's sentence verbatim — the whole reason `explainUnsupported`
            // exists is that the build error and the runtime throw cannot drift.
            expect(violations[0]?.reason).toBe(FIXTURE_TABLE.explainUnsupported('FlatList'));
        });

        // The gate keeps NO allowlist of its own, and this is where that shows.
        // `@gjsify/react-native` exports names react-native does not — `configureStyle`
        // carries ADR 0032 § 3's token scales — and they have no support-table entry,
        // because `check-rn-surface.mjs` holds that key set equal to react-native's own.
        // The layer answers for them through the same `isImportable`, so the gate needs
        // to know nothing about them; a fixture that says yes proves the delegation, and
        // the second half proves it is a delegation and not an open door.
        await it('takes the table’s word on a name react-native does not export', () => {
            const layer: SupportTableReader = {
                isImportable: (name) => name === 'configureStyle',
                explainUnsupported: (name) => `@gjsify/react-native: "${name}" is unknown here.`,
            };
            const own = scan(`import { configureStyle } from '@gjsify/react-native';`).named;
            expect(findSupportViolations(own, layer)).toStrictEqual([]);
            const nonsense = scan(`import { totalNonsense } from 'react-native';`).named;
            expect(findSupportViolations(nonsense, layer).map((v) => v.name)).toStrictEqual(['totalNonsense']);
        });

        await it('reports every refusal in one message, with file:line:col', () => {
            const { named } = scan(`import { FlatList, Image } from 'react-native';`);
            const violations = findSupportViolations(named, FIXTURE_TABLE);
            expect(violations.length).toBe(2);
            const message = formatSupportViolations(ID, violations);
            expect(message.includes(`${ID}:1:9`)).toBe(true);
            expect(message.includes('FlatList')).toBe(true);
            expect(message.includes('Image')).toBe(true);
        });
    });

    await describe('react-native gate: reading the table', async () => {
        const resolverFor = (id: string | null, external = false) => ({
            async resolve() {
                return id === null ? null : { id, external };
            },
        });

        await it('resolves the subpath and takes the two functions off it', async () => {
            const table = await loadSupportTable(resolverFor('/proj/rn/lib/esm/support-table.js'), ID, async () => ({
                SURFACES: [{ module: 'react-native', target: '@gjsify/react-native' }],
                isImportable: () => true,
                explainUnsupported: () => 'x',
            }));
            expect(table.isImportable('View')).toBe(true);
            expect(table.SURFACES.length).toBe(1);
        });

        // No second source to fall back on, by design (§ 8).
        await it('errors by name when the subpath does not resolve', async () => {
            let thrown: unknown;
            try {
                await loadSupportTable(resolverFor(null), ID);
            } catch (error) {
                thrown = error;
            }
            expect(thrown instanceof SupportTableUnreadableError).toBe(true);
            expect((thrown as Error).message.includes(SUPPORT_TABLE_SUBPATH)).toBe(true);
        });

        await it('errors when the subpath resolves EXTERNAL — there is no file to read', async () => {
            let thrown: unknown;
            try {
                await loadSupportTable(resolverFor('/proj/rn/lib/esm/support-table.js', true), ID);
            } catch (error) {
                thrown = error;
            }
            expect(thrown instanceof SupportTableUnreadableError).toBe(true);
        });

        // A version skew, not a missing install — and the message says so, because
        // the two have different fixes.
        await it('errors when the module lacks the two functions', async () => {
            let thrown: unknown;
            try {
                await loadSupportTable(resolverFor('/proj/rn/lib/esm/support-table.js'), ID, async () => ({
                    // The two functions, and NO `SURFACES` — which is the skew ADR 0036
                    // adds: a layer that predates the registry has the table and not the
                    // list of specifiers the gate has to watch.
                    isImportable: () => true,
                    explainUnsupported: () => 'x',
                }));
            } catch (error) {
                thrown = error;
            }
            expect(thrown instanceof SupportTableUnreadableError).toBe(true);
            expect((thrown as Error).message.includes('version skew')).toBe(true);
        });

        await it('errors when the import itself throws', async () => {
            let thrown: unknown;
            try {
                await loadSupportTable(resolverFor('/proj/rn/lib/esm/support-table.js'), ID, async () => {
                    throw new Error('ENOENT');
                });
            } catch (error) {
                thrown = error;
            }
            expect(thrown instanceof SupportTableUnreadableError).toBe(true);
        });
    });

    await describe('react-native gate: the surface registry (ADR 0036)', async () => {
        await it('watches BOTH spellings of every surface', async () => {
            const surfaces: readonly AliasedSurface[] = [
                { module: 'expo-font', target: '@gjsify/react-native/expo-font' },
                { module: '@expo/vector-icons', target: '@gjsify/react-native/vector-icons' },
            ];
            expect(watchedSpecifiers(surfaces)).toStrictEqual([
                'expo-font',
                '@gjsify/react-native/expo-font',
                '@expo/vector-icons',
                '@gjsify/react-native/vector-icons',
            ]);
            // The fallback is what a build without the layer gets, and it is the pair
            // that was the WHOLE list before the registry.
            expect(WATCHED_SPECIFIERS).toStrictEqual(['react-native', '@gjsify/react-native']);
        });

        await it('judges a name against the MODULE it was imported from', async () => {
            // The vector the registry exists for. One name, two surfaces, two answers —
            // and the gate has to pass the specifier for the second one to be reachable
            // at all. Without it, `Image` from `expo-image` gets react-native's verdict.
            const layer: SupportTableReader = {
                SURFACES: [
                    { module: 'react-native', target: '@gjsify/react-native' },
                    { module: 'expo-image', target: '@gjsify/react-native/expo-image' },
                ],
                isImportable: (name, module) => name === 'Image' && module === 'react-native',
                explainUnsupported: (name, module) => `${module}: "${name}" is not implemented yet.`,
            };
            const specifiers = watchedSpecifiers(layer.SURFACES);
            const code = `import { Image } from 'react-native';\nimport { Image as Expo } from 'expo-image';\n`;
            const { named } = scanNamedImports(code, ID, specifiers);
            expect(named.map((entry) => entry.specifier)).toStrictEqual(['react-native', 'expo-image']);
            const violations = findSupportViolations(named, layer);
            expect(violations.map((violation) => violation.specifier)).toStrictEqual(['expo-image']);
            // The message names the specifier, so a reader with two `Image` imports in
            // one file learns which one the gate refused.
            expect(formatSupportViolations(ID, violations)).toContain('from "expo-image"');
        });

        // The vector that holds these prefilters against the LAYER's own eighteen rows
        // lives in `@gjsify/react-native`'s `surfaces/surfaces.spec.ts`, not here: it
        // needs the registry, and `@gjsify/rolldown-plugin-gjsify` is tier 1 while the
        // layer is tier 3 — a tier-1 package may not depend on a higher tier, devDep
        // included. The direction that IS allowed is the layer importing the plugin, so
        // that is where the joint claim is asserted.

        await it('does NOT match the word "export", which a bare fragment test would', async () => {
            // The measurement that shaped `SURFACE_MENTION`: `export` contains `expo`,
            // so an unanchored test matches every module in the tree and the gate would
            // read the layer for all of them.
            expect(SURFACE_MENTION.test('export const a = 1;')).toBe(false);
            expect(SURFACE_MENTION.test('// exposure of an expo-like idea')).toBe(false);
            expect(SURFACE_MENTION.test("import x from 'expo-font';")).toBe(true);
        });

        await it('classifies a surface specifier against the rows it was given', async () => {
            const surfaces: readonly AliasedSurface[] = [
                { module: 'react-native', target: '@gjsify/react-native' },
                {
                    module: 'react-native-safe-area-context',
                    target: '@gjsify/react-native/react-native-safe-area-context',
                },
            ];
            expect(classifyReactNativeSpecifier('react-native', surfaces)).toStrictEqual({
                kind: 'root',
                target: '@gjsify/react-native',
            });
            expect(classifyReactNativeSpecifier('react-native-safe-area-context', surfaces)).toStrictEqual({
                kind: 'root',
                target: '@gjsify/react-native/react-native-safe-area-context',
            });
            // THE ORDER THAT MATTERS. `react-native-web` starts with the same eleven
            // characters as `react-native` and is not a surface; the exact-match pass
            // runs first, and the deep-import test only fires for `react-native/`.
            expect(classifyReactNativeSpecifier('react-native-web', surfaces)).toStrictEqual({ kind: 'other' });
            expect(classifyReactNativeSpecifier('react-native-reanimated', surfaces)).toStrictEqual({ kind: 'other' });
            expect(classifyReactNativeSpecifier('react-native/Libraries/Text', surfaces)).toStrictEqual({
                kind: 'subpath',
                subpath: 'Libraries/Text',
            });
            // A surface that is NOT in the rows handed in is `other`, not a guess: the
            // registry decides, and the prefilter only says "ask".
            expect(classifyReactNativeSpecifier('expo-font', surfaces)).toStrictEqual({ kind: 'other' });
        });

        await it('names the importer for a deep import into React Native’s internals', async () => {
            const error = new ReactNativeDeepImportError('react-native/Libraries/Text', ID);
            expect(error.message).toContain('react-native/Libraries/Text');
            expect(error.message).toContain(ID);
        });
    });
};
