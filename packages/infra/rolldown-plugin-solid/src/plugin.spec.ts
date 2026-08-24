// The compile step, asserted on the EMITTED CODE — and this suite exists because
// the showcase cannot do it.
//
// `showcases/gtk/solid-host-counter` runs the whole pipeline and asserts the real
// widget tree, which is the strongest end-to-end evidence there is. It is also blind
// to every option below, and to the two contracts that make the output loadable at
// all: a showcase built with the wrong `moduleName` fails at import, but a showcase
// is one build with one plugin instance, so it can never see an option that stopped
// being read after the first instance.
//
// What this suite pins that nothing else does:
//
//   - the ops are imported under Solid's LITERAL contract names. A renderer that
//     exports eleven of the twelve builds fine and fails with MISSING_EXPORT on the
//     twelfth, only for the JSX that happens to need it.
//   - `insertNode` is emitted BEFORE `setProp`. ADR 0027 § Decision 5 (the host
//     defers materialisation so a construct-only property can still be a JSX
//     attribute) rests on that order being the compiler's, not ours. If a future
//     `babel-preset-solid` sets properties first, deferred materialisation becomes
//     dead weight and nobody would otherwise notice.
//   - `generate` never leaves `universal` by accident. The `dom` output cannot run
//     under GJS at all, and the failure is an unresolved `document`, thrown at
//     runtime in whatever code path first renders.
//
// WHAT THIS SUITE DOES NOT PROVE: that Babel stays lazily loaded. The claim is
// structural — the imports live inside the transform handler — and observing it
// needs a module registry neither runtime exposes portably. It is asserted by
// reading the code, not by this file.

import { describe, expect, it } from '@gjsify/unit';

import { solidPlugin } from './index.js';

type TransformResult = { code: string; map: unknown } | null;
type TransformHandler = (this: unknown, code: string, id: string) => Promise<TransformResult>;

/** `transform`'s handler, which the plugin declares in `{ order, handler }` form. */
function transformOf(plugin: ReturnType<typeof solidPlugin>): TransformHandler {
    const hook = plugin.transform as unknown as { handler: TransformHandler };
    return hook.handler;
}

/** Transform through a fresh plugin instance, asserting it did not decline. */
async function transform(
    source: string,
    id = '/tmp/app.tsx',
    options: Parameters<typeof solidPlugin>[0] = {},
): Promise<{ code: string; map: unknown }> {
    const result = await transformOf(solidPlugin(options)).call(null, source, id);
    if (result === null) throw new Error(`the plugin declined ${id}, and this call expected it to compile`);
    return result;
}

/** The emitted code alone, which is what most assertions here are about. */
const compile = async (...args: Parameters<typeof transform>) => (await transform(...args)).code;

/** A minimal component: one host element, one attribute, one handler, one child. */
const APP = `
const label: string = 'hi';
export const App = () => (
    <gtk-box orientation="vertical">
        <gtk-button label={label} onClicked={() => undefined} />
    </gtk-box>
);
`;

export default async () => {
    await describe('solidPlugin: which modules it claims', async () => {
        const plugin = solidPlugin();
        const transformHook = transformOf(plugin);

        await it('names itself so a build diagnostic can be attributed', async () => {
            expect(plugin.name).toBe('gjsify-solid');
        });

        await it('compiles every JSX extension', async () => {
            for (const id of ['/a/app.tsx', '/a/app.jsx', '/a/app.mtsx', '/a/app.ctsx']) {
                expect(await transformHook.call(null, APP, id)).not.toBe(null);
            }
        });

        await it('declines a .ts id, which cannot hold JSX', async () => {
            // Widening the filter to `.ts` is the tempting mistake: TypeScript
            // refuses JSX there, so the only thing a `.ts` transform can do is pay
            // Babel's cost on every module in the build.
            expect(await transformHook.call(null, 'export const n = 1;', '/a/app.ts')).toBe(null);
        });

        await it('declines everything that is not a module it was asked for', async () => {
            for (const id of ['/a/style.css', '/a/data.json', '/a/App.vue', '/a/app.tsx.map']) {
                expect(await transformHook.call(null, APP, id)).toBe(null);
            }
        });

        await it('declines a virtual module another plugin minted', async () => {
            // `\0` is rollup's mark for an id that names no file. Compiling one
            // claims someone else's module and puts its unprintable id into every
            // diagnostic this plugin raises.
            expect(await transformHook.call(null, APP, '\0virtual:counter.tsx')).toBe(null);
        });

        await it('matches on the path, so a Vite query suffix still compiles', async () => {
            // `?used`, `?import` and `?t=<ms>` are routine on Vite's HMR path, and an
            // anchored `\.tsx$` declines every one of them — the plugin becomes a
            // silent no-op and raw JSX reaches the next transform.
            for (const id of ['/a/app.tsx?used', '/a/app.tsx?t=1730000000000', '/a/app.jsx?import']) {
                expect(await transformHook.call(null, APP, id)).not.toBe(null);
            }
        });

        await it('honours a caller-supplied include filter', async () => {
            const narrowed = transformOf(solidPlugin({ include: /\.solid\.tsx$/ }));
            expect(await narrowed.call(null, APP, '/a/app.tsx')).toBe(null);
            expect(await narrowed.call(null, APP, '/a/app.solid.tsx')).not.toBe(null);
        });
    });

    await describe('solidPlugin: the output shape the host depends on', async () => {
        await it('imports every op it uses from the renderer module', async () => {
            const code = await compile(APP);
            // The names are Solid's `Renderer<NodeType>` members, spelled exactly.
            for (const op of ['createElement', 'insertNode', 'setProp']) {
                expect(code.includes(`${op} as _$${op}`)).toBe(true);
            }
            expect(code.includes('from "@gjsify/gtk-host/solid"')).toBe(true);
        });

        await it('inserts children BEFORE it sets properties', async () => {
            // ADR 0027 § Decision 5 exists because of this order: `createElement`
            // never sees a prop, so a construct-only property can only survive if
            // the host defers materialisation. Reversing it upstream would make
            // that machinery unnecessary — and silently wrong about why it is there.
            const code = await compile(APP);
            const inserted = code.indexOf('_$insertNode(');
            const set = code.indexOf('_$setProp(');
            // Both present FIRST: `indexOf` returns -1 for an op that vanished, and
            // `-1 < anything` would read a missing `insertNode` as the right order.
            expect(inserted >= 0 && set >= 0).toBe(true);
            expect(inserted < set).toBe(true);
        });

        await it('passes a handler through setProp under its JSX spelling', async () => {
            expect((await compile(APP)).includes('"onClicked"')).toBe(true);
        });

        await it('emits no DOM, which is the only output GJS could not run', async () => {
            const code = await compile(APP);
            for (const dom of ['document.createElement', '_tmpl$', 'template(']) {
                expect(code.includes(dom)).toBe(false);
            }
        });

        await it('emits no React runtime import, which is what an unconfigured build does', async () => {
            // Rolldown's own transformer, pointed at a `.tsx` with no JSX
            // configuration, emits `import { jsx } from "react/jsx-runtime"`, reports
            // the unresolved import as a WARNING and exits 0.
            expect((await compile(APP)).includes('react/jsx-runtime')).toBe(false);
        });

        await it('hands on the source map Babel produced', async () => {
            // Every line moves here, so a dropped map points every later frame —
            // stack traces, the debugger, a bundler warning — at compiled output.
            const { map } = await transform(APP);
            expect(typeof (map as { mappings?: unknown } | null)?.mappings).toBe('string');
        });

        await it('leaves no JSX behind for a later transform to choke on', async () => {
            expect(/<\/?gtk-/.test(await compile(APP))).toBe(false);
        });

        await it('strips the TypeScript annotations', async () => {
            // NOT a test of preset ORDER — reversing the two presets emits
            // byte-identical output on every input tried, and the reason is at the
            // preset array in `index.ts`. This pins only that `preset-typescript` is
            // in the chain at all: without it Babel refuses the file outright.
            const code = await compile(APP);
            expect(code.includes(': string')).toBe(false);
        });
    });

    await describe('solidPlugin: options, per instance', async () => {
        await it('honours moduleName', async () => {
            const code = await compile(APP, '/a/app.tsx', { moduleName: '@example/renderer' });
            expect(code.includes('from "@example/renderer"')).toBe(true);
        });

        await it('honours moduleName on a SECOND instance in the same process', async () => {
            // The regression this pins: caching the assembled preset chain rather
            // than the compiler modules made every option after the first instance
            // inert. One build with one plugin never sees it; a process that builds
            // two packages emits the first one's renderer imports into the second's
            // bundle, and the artifact fails at import with a module that is not
            // there.
            await compile(APP, '/a/first.tsx', { moduleName: '@example/first' });
            const second = await compile(APP, '/a/second.tsx', { moduleName: '@example/second' });
            expect(second.includes('from "@example/second"')).toBe(true);
            expect(second.includes('@example/first')).toBe(false);
        });

        await it('honours generate, and going back to universal is not sticky', async () => {
            const dom = await compile(APP, '/a/dom.tsx', { generate: 'dom' });
            expect(dom.includes('_$template(') || dom.includes('_tmpl$')).toBe(true);
            const universal = await compile(APP, '/a/universal.tsx');
            expect(universal.includes('_$createElement(')).toBe(true);
            expect(universal.includes('_tmpl$')).toBe(false);
        });
    });

    await describe('solidPlugin: what it refuses', async () => {
        await it('names the file when Babel cannot parse it', async () => {
            let message = '';
            try {
                await compile('export const App = () => <gtk-box', '/a/broken.tsx');
            } catch (error) {
                message = String((error as Error).message);
            }
            expect(message.includes('/a/broken.tsx')).toBe(true);
        });
    });
};
