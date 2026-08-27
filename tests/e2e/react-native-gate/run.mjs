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
// THE OPT-IN IS THE FIRST VECTOR, not an afterthought. Without `--react-native`
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
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject } from '../helpers.mjs';

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

    before(() => {
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

        // `FlatList` is `planned` in the table — importable at the type level,
        // refused by the gate. Imported next to a supported name so the vector
        // also shows the gate reporting only what is actually refused.
        writeFileSync(
            join(src, 'refused.ts'),
            ["import { View, FlatList } from 'react-native';", 'export const parts = [View, FlatList];', ''].join('\n'),
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
            '--react-native',
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
            '--react-native',
            '--outfile',
            'dist/refused.mjs',
        ]);
        assert.notEqual(status, 0, `a refused import must fail the build.\n${output}`);
        assert.ok(output.includes('FlatList'), `the refused NAME must be printed.\n${output}`);
        assert.ok(output.includes('refused.ts:1:15'), `the position must be printed.\n${output}`);
        // Read out of the real table, not restated here: `@gjsify/react-native`'s
        // own entry for FlatList names the GTK counterpart.
        assert.ok(output.includes('Gtk.ListView'), `the message must be the support table's own sentence.\n${output}`);
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
            '--react-native',
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
            '--react-native',
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
            '--react-native',
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
