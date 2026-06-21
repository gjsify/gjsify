// Coverage for the `--app gjs` side-effect entry wrapper's `default`-export
// preservation (`preserveDefaultExport`). `@gjsify/rolldown-plugin-gjsify` has
// no test runner of its own, so this lives in the CLI's `test:node` harness.
//
// When `--globals auto` injects register modules it wraps the entry in a
// virtual module that re-exports it with `export * from <entry>` — which
// carries named bindings but NOT `default`. That's fine for an executable, but
// the plugin loader bundles a by-name bundler plugin (whose factory is the
// default export) for GJS through this same path; without preservation the
// plugin imports as "no default export". This asserts the wrapper re-exports
// `default` only when asked.

import { describe, it, expect } from '@gjsify/unit';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gjsifyPlugin } from '@gjsify/rolldown-plugin-gjsify';

interface VirtualEntryPlugin {
    name?: string;
    load?: (this: { resolve: (p: string) => Promise<{ id: string }> }, id: string) => Promise<{ code: string } | null>;
}

async function wrapperCode(entry: string, outFile: string, preserveDefaultExport: boolean): Promise<string> {
    // A non-empty autoGlobalsInject forces the side-effect entry wrapper to
    // engage (mirrors `--globals auto` having found a register to inject).
    const cfg = await gjsifyPlugin(
        { input: entry, output: { file: outFile } },
        { app: 'gjs', autoGlobalsInject: '/virtual/__globals_stub.js', preserveDefaultExport },
    );
    const plugins = cfg.plugins as VirtualEntryPlugin[];
    const vplugin = plugins.find((p) => p && p.name === 'gjsify-virtual-entry');
    if (!vplugin?.load) throw new Error('virtual-entry plugin not found — wrapper did not engage');
    // `globToEntryPoints` normalizes a single input to an array of entry ids.
    const inp = cfg.options.input;
    const wrappedId = Array.isArray(inp)
        ? (inp[0] as string)
        : typeof inp === 'string'
          ? inp
          : (Object.values(inp as Record<string, string>)[0] as string);
    const ctx = { resolve: async (p: string) => ({ id: p }) };
    const loaded = await vplugin.load.call(ctx, wrappedId);
    if (!loaded) throw new Error('virtual-entry load() returned null for the wrapped id');
    return loaded.code;
}

export default async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-entry-wrap-'));
    const entry = join(dir, 'entry.ts');
    writeFileSync(entry, 'export default function factory() { return 1; }\nexport const named = 2;\n');

    await describe('--app gjs entry wrapper: preserveDefaultExport', async () => {
        await it('re-exports default when preserveDefaultExport is set', async () => {
            const code = await wrapperCode(entry, join(dir, 'out-with.js'), true);
            expect(code).toContain('export * from');
            expect(code).toContain('export default __gjsify_entry__.default');
            // The namespace import doubles as the side-effect (body-running) import.
            expect(code).toContain('import * as __gjsify_entry__ from');
            // The injected globals stub is still imported first.
            expect(code).toContain('__globals_stub.js');
        });

        await it('does NOT re-export default by default (executable shape)', async () => {
            const code = await wrapperCode(entry, join(dir, 'out-without.js'), false);
            expect(code).toContain('export * from');
            expect(code).not.toContain('export default');
            expect(code).not.toContain('__gjsify_entry__');
        });
    });

    rmSync(dir, { recursive: true, force: true });
};
