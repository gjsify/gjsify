// E2E for ADR 0032 § 2 (the alias line) and § 8 (the build-time gate), over a
// real `gjsify build --app gjs`.
//
// WHY THIS SUITE HAS TO BE AN E2E. Both halves make a claim no unit test can
// make. § 2's claim is that an UNMODIFIED React Native application builds — the
// specifier a real application writes is `react-native`, and whether it reaches
// `@gjsify/react-native` depends on the plugin being composed, ordered before the
// externals policy, and resolving in an installed tree. § 8's claim is that the
// gate reads the REAL support table out of the project's own installed layer;
// the unit suite passes a three-row fixture, precisely because a fixture cannot
// prove that a resolve plus a dynamic import of `@gjsify/react-native/support-table`
// works in a consumer's node_modules.
//
// THE OPT-IN IS THE FIRST VECTOR, not an afterthought. Without `--dialect react-native`
// the same entry must build EXACTLY as it did before this feature existed: the
// specifier is not redirected and the gate does not run. That vector also records
// the state ADR 0032 § 2 describes as the problem — `Could not resolve
// 'react-native'` — so the suite carries the before-picture next to the after.
//
// `transform.jsx: false` on the fixture is the CLI's own JSX gate, not a property
// under test: these entries hold imports, not markup.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTestEnvironment, cleanupTestEnvironment, setupProject } from '../helpers.mjs';

const RN_PKG = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'framework', 'react-native');

/**
 * The refused name this suite builds against — DERIVED, never written down.
 *
 * It used to be `FlatList`, and that is exactly the bug: the fixture's premise is
 * "this name is `planned`", which is a status the layer is in the business of
 * CHANGING. When `FlatList` became `partial` the gate correctly let it through and
 * three assertions in here failed — a vector that goes red because the product
 * improved is a vector that will be deleted rather than fixed.
 *
 * So the name comes out of the generated artifacts, which move with the table:
 * the README's `### Planned` block gives a name AND its GTK counterpart, and the
 * generated refusing-exports module is asked to agree. Both are written by
 * `scripts/generate-exports.mjs` from the one table, so a name that graduates
 * disappears from both in the same commit and this picker moves to the next one.
 *
 * `planned` specifically, not any refusing status: only that branch of
 * `explainUnsupported` prints "The GTK counterpart is …", which is the assertion
 * that proves the message came from the real table rather than from the plugin.
 */
function pickPlannedName() {
    const readme = readFileSync(join(RN_PKG, 'README.md'), 'utf8');
    const planned = readme.split(/^### Planned\b.*$/m)[1];
    assert.ok(planned, 'the README has no generated "### Planned" section to read a fixture name out of');
    // Stop at the next heading so a later section cannot donate a row.
    const rows = planned.split(/^#{2,3} /m)[0].matchAll(/^\| `(\w+)` \| [^|]*\| ([^|]+)\|/gm);

    const generated = readFileSync(join(RN_PKG, 'src', 'generated', 'unsupported-exports.ts'), 'utf8');
    const refusing = new Set([...generated.matchAll(/^export const (\w+) = unsupported\(/gm)].map((match) => match[1]));

    for (const [, name, gtkCell] of rows) {
        const gtk = gtkCell.trim();
        // `—` is the table's "no counterpart", and the sentence then omits it.
        if (gtk === '' || gtk === '\u2014') continue;
        assert.ok(
            refusing.has(name),
            `${name} is in the README's Planned block but not in the generated refusing exports — ` +
                'the two generated artifacts disagree, which means one of them is stale.',
        );
        return { name, gtk };
    }
    throw new Error('no planned entry with a GTK counterpart — the fixture cannot assert the table wrote the message');
}

/** One `gjsify build` in the fixture, with both streams captured. */
function build(projectDir, args) {
    const run = spawnSync('npx', ['gjsify', 'build', ...args], {
        cwd: projectDir,
        encoding: 'utf8',
        timeout: 300 * 1000,
    });
    return { status: run.status, output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}

describe('--app gjs react-native alias + support gate (ADR 0032 § 2, § 8)', { timeout: 20 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;
    /** `{ name, gtk }` of the planned entry this run builds against. */
    let planned;

    before(() => {
        planned = pickPlannedName();
        const env = createTestEnvironment('gjsify-e2e-react-native-gate-');
        tmpDir = env.tmpDir;

        projectDir = join(tmpDir, 'react-native-gate-project');
        const src = join(projectDir, 'src');
        mkdirSync(src, { recursive: true });

        // Names whose support-table status is supported/partial. `View` and `Text`
        // are the two the measured application uses most; `useColorScheme` is the
        // only fully `supported` entry among them.
        writeFileSync(
            join(src, 'ok.ts'),
            [
                "import { View, Text, useColorScheme } from 'react-native';",
                "export const marker = 'RN_OK_BUILT';",
                'export const parts = [View, Text, useColorScheme];',
                '',
            ].join('\n'),
        );

        // A `planned` name — importable at the type level, refused by the gate.
        // Imported next to a supported one so the vector also shows the gate
        // reporting only what is actually refused. The prefix `import { View, ` is
        // fixed at 15 characters on purpose: the position assertion below then holds
        // whichever name the picker chose.
        writeFileSync(
            join(src, 'refused.ts'),
            [
                `import { View, ${planned.name} } from 'react-native';`,
                `export const parts = [View, ${planned.name}];`,
                '',
            ].join('\n'),
        );

        // The five type-only imports ADR 0032 measured, which cost nothing.
        writeFileSync(
            join(src, 'typeonly.ts'),
            [
                "import type { ViewProps, ColorValue } from 'react-native';",
                "export const marker = 'RN_TYPEONLY_BUILT';",
                'export type Props = ViewProps & { tint: ColorValue };',
                '',
            ].join('\n'),
        );

        // A namespace import: the names are a runtime question, so the gate warns
        // instead of guessing.
        writeFileSync(
            join(src, 'opaque.ts'),
            [
                "import * as RN from 'react-native';",
                "export const marker = 'RN_OPAQUE_BUILT';",
                'export const box = RN;',
                '',
            ].join('\n'),
        );

        // React Native's internals, which the mirrored export surface does not
        // cover — a named refusal rather than a rewrite onto something else.
        writeFileSync(
            join(src, 'deep.ts'),
            [
                "import View from 'react-native/Libraries/Components/View/View';",
                'export const parts = [View];',
                '',
            ].join('\n'),
        );

        setupProject(
            projectDir,
            {
                name: 'test-react-native-gate',
                version: '0.1.0',
                type: 'module',
                private: true,
                dependencies: {
                    '@gjsify/cli': '^0.1.0',
                    '@gjsify/react-native': '^0.1.0',
                    // The layer's peers are declared OPTIONAL, so npm does not
                    // place them; a build that reaches the layer's own module
                    // graph needs them present. Registry packages, not tarballs.
                    react: '^19.2.0',
                    'react-reconciler': '^0.33.0',
                },
                gjsify: { bundler: { transform: { jsx: false } } },
            },
            env.tarballsDir,
            env.tarballMap,
        );
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    // The before-picture: this is the state § 2 calls the problem.
    it('WITHOUT the opt-in, `react-native` is not redirected and the gate is silent', () => {
        const { status, output } = build(projectDir, [
            'src/refused.ts',
            '--app',
            'gjs',
            '--outfile',
            'dist/noflag.mjs',
        ]);
        assert.notEqual(status, 0, `an unresolvable bare specifier must not exit 0.\n${output}`);
        assert.ok(
            output.includes("Could not resolve 'react-native'"),
            `without the opt-in nothing may rewrite the specifier.\n${output}`,
        );
        assert.ok(
            !output.includes('gjsify-react-native-gate') && !output.includes('ReactNativeUnsupportedImportError'),
            `the gate must not run without the opt-in.\n${output}`,
        );
    });

    it('WITH the opt-in, a supported-only import builds through the alias', () => {
        const { status, output } = build(projectDir, [
            'src/ok.ts',
            '--app',
            'gjs',
            '--dialect',
            'react-native',
            '--outfile',
            'dist/ok.mjs',
        ]);
        assert.equal(status, 0, `a supported-only import must build.\n${output}`);
        const outPath = join(projectDir, 'dist', 'ok.mjs');
        assert.ok(existsSync(outPath), 'dist/ok.mjs missing');
        const bundle = readFileSync(outPath, 'utf-8');
        assert.ok(bundle.includes('RN_OK_BUILT'), 'the entry must be in the bundle');
        // The alias resolved: the layer's own code is in the bundle, and the bare
        // specifier is not.
        assert.ok(
            !/from ['"]react-native['"]/.test(bundle),
            'no bare `react-native` import may survive into the bundle',
        );
        assert.ok(bundle.length > 100_000, `the layer must be bundled, got ${bundle.length} bytes`);
    });

    // The one thing the gate has over the runtime backstop: the file and the line,
    // before anything runs, in the table's own words.
    it('fails the build on a refused name, naming file:line:col and the table’s reason', () => {
        const { status, output } = build(projectDir, [
            'src/refused.ts',
            '--app',
            'gjs',
            '--dialect',
            'react-native',
            '--outfile',
            'dist/refused.mjs',
        ]);
        assert.notEqual(status, 0, `a refused import must fail the build.\n${output}`);
        assert.ok(output.includes(planned.name), `the refused NAME must be printed.\n${output}`);
        assert.ok(output.includes('refused.ts:1:15'), `the position must be printed.\n${output}`);
        // Read out of the real table, not restated here: the entry's own GTK
        // counterpart, which only the `planned` branch of `explainUnsupported`
        // prints. A message assembled by the plugin could not contain it.
        assert.ok(
            output.includes(planned.gtk),
            `the message must be the support table's own sentence, naming ${planned.gtk}.\n${output}`,
        );
        // Only what is refused. `View` is `partial` and must not be reported.
        assert.ok(!/^\s+\S+:\d+:\d+\s+View$/m.test(output), `a supported name must not be reported.\n${output}`);
    });

    // The highest-value negative: ADR 0032 counted five type-only imports and
    // recorded that they cost nothing. A gate that failed on them would refuse a
    // program that cannot fail.
    it('does NOT fail on a type-only import, and bundles nothing for it', () => {
        const { status, output } = build(projectDir, [
            'src/typeonly.ts',
            '--app',
            'gjs',
            '--dialect',
            'react-native',
            '--outfile',
            'dist/typeonly.mjs',
        ]);
        assert.equal(status, 0, `a type-only import must build.\n${output}`);
        const bundle = readFileSync(join(projectDir, 'dist', 'typeonly.mjs'), 'utf-8');
        assert.ok(bundle.includes('RN_TYPEONLY_BUILT'), 'the entry must be in the bundle');
    });

    // The gate's blind spot, stated at the place it applies.
    it('warns rather than guesses on a namespace import', () => {
        const { status, output } = build(projectDir, [
            'src/opaque.ts',
            '--app',
            'gjs',
            '--dialect',
            'react-native',
            '--outfile',
            'dist/opaque.mjs',
        ]);
        assert.equal(status, 0, `an unreadable-name form must not fail the build.\n${output}`);
        assert.ok(output.includes('namespace import'), `the form must be named.\n${output}`);
        assert.ok(output.includes('runtime refusal'), `the warning must say what covers the gap instead.\n${output}`);
    });

    it('refuses an import of React Native’s internals by name', () => {
        const { status, output } = build(projectDir, [
            'src/deep.ts',
            '--app',
            'gjs',
            '--dialect',
            'react-native',
            '--outfile',
            'dist/deep.mjs',
        ]);
        assert.notEqual(status, 0, `a deep import must fail the build.\n${output}`);
        assert.ok(
            output.includes('react-native/Libraries/Components/View/View'),
            `the refused specifier must be printed.\n${output}`,
        );
        assert.ok(output.includes('PACKAGE ROOT'), `the message must say what the alias does cover.\n${output}`);
    });
});
