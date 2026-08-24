// Unit coverage for the PRE-build JSX refusal and the syntax-level oracle behind the
// post-build one.
//
// The regression: `gjsify build src/app.tsx --app gjs` with no JSX configuration exited
// 0 and wrote a bundle importing `react/jsx-runtime`, which `gjs -m` refused with
// "ImportError: Module not found". Two facts pinned here were MEASURED against the real
// bundler and are the reason this module cannot be simplified into "read tsconfig":
// `bundler.transform.jsx` OVERRIDES tsconfig, and tsconfig `"jsx": "react-native"` —
// which TypeScript documents as preserving JSX — is NOT preserved by oxc.

import { describe, expect, it } from '@gjsify/unit';
import { collectEntryPaths, describeJsxConfig, findJsxEntryPoint, jsxConfigMissingError } from './jsx-config.js';
import { locateSurvivingJsx, classifyJsxParseFailure } from '@gjsify/rolldown-plugin-gjsify';

export default async () => {
    await describe('jsx-config: describeJsxConfig', async () => {
        await it('reports NOTHING configured when neither source names JSX', () => {
            expect(describeJsxConfig({})).toStrictEqual({ configured: false, preserves: false });
        });

        await it('accepts either source as a configuration', () => {
            expect(describeJsxConfig({ transformJsx: 'react-jsx' }).configured).toBe(true);
            expect(describeJsxConfig({ tsconfigJsx: 'react-jsx' }).configured).toBe(true);
            // `jsxImportSource` alone names the runtime, which is the actual fix.
            expect(describeJsxConfig({ tsconfigJsxImportSource: '@gjsify/gtk-host' }).configured).toBe(true);
            // An object form is a configuration like any other.
            expect(describeJsxConfig({ transformJsx: { importSource: 'solid-js' } }).configured).toBe(true);
        });

        await it('counts `false` as configured — it fails the build loudly from inside oxc', () => {
            expect(describeJsxConfig({ transformJsx: false })).toStrictEqual({ configured: true, preserves: false });
        });

        await it('sees `preserve` in either place', () => {
            expect(describeJsxConfig({ transformJsx: 'preserve' }).preserves).toBe(true);
            expect(describeJsxConfig({ tsconfigJsx: 'preserve' }).preserves).toBe(true);
        });

        await it('lets `transform.jsx` OVERRIDE tsconfig, in both directions', () => {
            // MEASURED: tsconfig react-jsx + transform preserve kept raw JSX in the artifact.
            expect(describeJsxConfig({ transformJsx: 'preserve', tsconfigJsx: 'react-jsx' }).preserves).toBe(true);
            expect(describeJsxConfig({ transformJsx: 'react-jsx', tsconfigJsx: 'preserve' }).preserves).toBe(false);
        });

        await it('does NOT treat tsconfig `react-native` as preserving', () => {
            // TypeScript documents it as preserving; oxc compiled it to runtime calls.
            expect(describeJsxConfig({ tsconfigJsx: 'react-native' })).toStrictEqual({
                configured: true,
                preserves: false,
            });
        });
    });

    await describe('jsx-config: entry points', async () => {
        await it('flattens all three rolldown input shapes', () => {
            expect(collectEntryPaths('src/a.tsx')).toStrictEqual(['src/a.tsx']);
            expect(collectEntryPaths(['src/a.ts', 'src/b.tsx'])).toStrictEqual(['src/a.ts', 'src/b.tsx']);
            expect(collectEntryPaths({ main: 'src/a.jsx' })).toStrictEqual(['src/a.jsx']);
            expect(collectEntryPaths(undefined)).toStrictEqual([]);
        });

        await it('finds the JSX-bearing entry and ignores the rest', () => {
            expect(findJsxEntryPoint(['src/a.ts', 'src/b.tsx'])).toBe('src/b.tsx');
            expect(findJsxEntryPoint(['src/a.jsx'])).toBe('src/a.jsx');
            expect(findJsxEntryPoint(['src/a.ts', 'src/b.mjs'])).toBeUndefined();
            // Not a JSX file just because the name contains the letters.
            expect(findJsxEntryPoint(['src/jsx-helpers.ts'])).toBeUndefined();
        });

        await it('names the file and every fix in the refusal', () => {
            const message = jsxConfigMissingError('src/app.tsx').message;
            expect(message).toContain('src/app.tsx');
            expect(message).toContain('react/jsx-runtime');
            expect(message).toContain('bundler.transform.jsx');
            expect(message).toContain('jsxImportSource');
            expect(message).toContain('preserve');
        });
    });

    await describe('jsx-survival: locateSurvivingJsx', async () => {
        await it('is silent on code that parses', () => {
            expect(locateSurvivingJsx('const a = 1 < 2; export default a;')).toBeNull();
            // A shebang is hoisted to byte 0 by any project bundling its own CLI.
            expect(locateSurvivingJsx('#!/usr/bin/env -S gjs -m\nconst a = 1;')).toBeNull();
        });

        await it('finds every JSX shape, at the `<`', () => {
            const shapes = [
                'const r = <box title="x" />;',
                'const r = <box>hi</box>;',
                'const r = <>frag</>;',
                'const r = <Foo.Bar x={1}>t</Foo.Bar>;',
                'log(<box title="hi"/>);',
                'const r=<box/>,q=2;',
            ];
            for (const code of shapes) {
                const found = locateSurvivingJsx(code);
                expect(found === null).toBe(false);
                expect(code[code.indexOf('<')]).toBe('<');
            }
        });

        await it('does not claim JSX for a parse failure elsewhere', () => {
            expect(locateSurvivingJsx('const a = ;')).toBeNull();
            expect(locateSurvivingJsx('function (')).toBeNull();
        });

        await it('reports nothing without a usable position', () => {
            expect(classifyJsxParseFailure('const r = <box/>;', new Error('no position'))).toBeNull();
        });
    });
};
