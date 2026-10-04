import { describe, expect, it } from '@gjsify/unit';

import { wrapInputWithSideEffects } from './entry-wrapper.js';

type LoadHook = (this: unknown, id: string) => Promise<{ code: string } | null>;

async function loadWrapper(opts: Parameters<typeof wrapInputWithSideEffects>[2], sideEffects: string[] = []) {
    const { input, plugin } = wrapInputWithSideEffects('src/main.ts', sideEffects, opts);
    if (!plugin || typeof input !== 'string') return null;
    const load = (plugin as { load: LoadHook }).load;
    const ctx = { resolve: async () => ({ id: '/app/src/main.ts' }) };
    return (await load.call(ctx, input))?.code ?? null;
}

export default async () => {
    await describe('wrapInputWithSideEffects end-of-main exit', async () => {
        await it('appends a process.exitCode exit after the entry import when asked, even with no side effects', async () => {
            const code = await loadWrapper({ exitOnReportedCode: true });
            expect(code).not.toBe(null);
            expect(code!.includes('import "/app/src/main.ts"')).toBe(true);
            expect(code!.includes('globalThis.process')).toBe(true);
            expect(code!.indexOf('.exit(')).toBeGreaterThan(code!.indexOf('import "/app/src/main.ts"'));
        });

        await it('also appends it when the default export is preserved', async () => {
            const code = await loadWrapper({ exitOnReportedCode: true, preserveDefaultExport: true }, ['x/register']);
            expect(code!.includes('export default __gjsify_entry__.default')).toBe(true);
            expect(code!.includes('.exit(')).toBe(true);
        });

        await it('leaves the wrapper untouched when not asked (node, library)', async () => {
            const code = await loadWrapper({}, ['x/register']);
            expect(code!.includes('.exit(')).toBe(false);
        });

        await it('only exits for a non-zero integer exitCode', async () => {
            const code = (await loadWrapper({ exitOnReportedCode: true }))!;
            const body = code.slice(code.indexOf('const __gjsify_p'));
            const run = (exitCode: unknown) => {
                const calls: number[] = [];
                const g = { process: { exitCode, exit: (c: number) => calls.push(c) } };
                new Function('globalThis', body)(g);
                return calls;
            };
            expect(JSON.stringify(run(1))).toBe(JSON.stringify([1]));
            expect(JSON.stringify(run('2'))).toBe(JSON.stringify([2]));
            expect(JSON.stringify(run(0))).toBe(JSON.stringify([]));
            expect(JSON.stringify(run(undefined))).toBe(JSON.stringify([]));
            expect(JSON.stringify(run('nope'))).toBe(JSON.stringify([]));
        });
    });
};
