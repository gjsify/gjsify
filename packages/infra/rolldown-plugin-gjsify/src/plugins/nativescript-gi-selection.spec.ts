// SPDX-License-Identifier: MIT
// The ADR 0117 § 2 gate as the VITE path runs it: same planner, but the input is the
// emitted bundle rather than a list somebody passed in.
//
// What is tested here and NOT in `utils/gi-selection.spec.ts`: the three things the
// plugin adds on top of `planGiSelection` — when the shape of the key is checked
// (composition time, not bundle time), that the scan reads the CHUNKS of the bundle
// and not its assets, and that a refusal names the file the namespace was read from.
// The reconciliation itself has its own suite; repeating it here would be two
// definitions of the same rule.

import { describe, expect, it } from '@gjsify/unit';

import { nativescriptGiSelectionPlugin } from './nativescript-gi-selection.js';

type Hook = { handler: (this: unknown, ...args: unknown[]) => unknown };

/** A rolldown hook is either the function or `{ handler }`; the spec must not care. */
const generateBundleOf = (plugin: ReturnType<typeof nativescriptGiSelectionPlugin>) => {
    const hook = plugin.generateBundle as unknown;
    return typeof hook === 'function' ? (hook as Hook['handler']) : (hook as Hook).handler;
};

/** Run the hook over a `fileName → code` map, collecting what it warned about. */
const run = (declared: readonly string[], chunks: Record<string, string>) => {
    const warnings: string[] = [];
    const bundle: Record<string, unknown> = {};
    for (const [fileName, code] of Object.entries(chunks)) bundle[fileName] = { type: 'chunk', code };
    const plugin = nativescriptGiSelectionPlugin({ declared });
    generateBundleOf(plugin).call({ warn: (message: string) => warnings.push(message) }, {}, bundle);
    return warnings;
};

export default async () => {
    await describe('nativescriptGiSelectionPlugin', async () => {
        await it('passes a bundle whose imports the config covers', async () => {
            expect(run(['Soup'], { 'bundle.js': `import "gi://Soup?version=3.0";` })).toStrictEqual([]);
        });

        await it('FAILS naming a namespace the bundle imports and the config omits', async () => {
            // The whole point of the Vite half: without it this key is accepted by the
            // config loader and acted on by nothing, and the APK dies at this import.
            expect(() => run([], { 'bundle.js': `import "gi://Soup?version=3.0";` })).toThrow(/Soup/);
        });

        await it('names the FILE the namespace was read from, so the refusal is actionable', async () => {
            // `planGiSelection` is pure and knows only namespaces. A NativeScript build
            // emits many chunks, and "the bundle imports Soup" without a file sends the
            // reader grepping.
            expect(() => run([], { 'vendor.js': `import "gi://Soup";` })).toThrow(/vendor\.js/);
        });

        await it('reads every chunk, not just the entry', async () => {
            expect(() => run([], { 'index.js': 'export const a = 1;', 'chunk-b.js': `import "gi://Soup";` })).toThrow(
                /Soup/,
            );
        });

        await it('ignores assets, which are not JavaScript', async () => {
            // `generateBundle` sees the `.mo` catalogues `nativescriptLocalePlugin` emits
            // and every other asset alongside the chunks. Parsing one as a module would
            // throw acorn's syntax error out of a build that is fine.
            const plugin = nativescriptGiSelectionPlugin({ declared: [] });
            const bundle = { 'locale/de/LC_MESSAGES/app.mo': { type: 'asset', source: '\u00de\u0012\u0004\u0095' } };
            expect(() => generateBundleOf(plugin).call({ warn: () => {} }, {}, bundle)).not.toThrow();
        });

        await it('warns, without failing, about a declared namespace the bundle does not import', async () => {
            const warnings = run(['Soup'], { 'bundle.js': 'export const a = 1;' });
            expect(warnings.length).toBe(1);
            expect(warnings[0]).toContain('Soup');
        });

        await it('checks the shape of the key when the plugin is COMPOSED', async () => {
            // Before the NativeScript build, not after it: a typo should not cost a
            // full Gradle run to surface.
            expect(() => nativescriptGiSelectionPlugin({ declared: ['gi://Gtk'] })).toThrow(/not a GI namespace/);
        });

        await it('points at the key as a Vite-path config spells it', async () => {
            expect(() => nativescriptGiSelectionPlugin({ declared: ['Gtk 4.0'] })).toThrow(/giNamespaces/);
        });
    });
};
