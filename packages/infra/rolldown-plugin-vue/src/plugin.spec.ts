// The PLUGIN, through its own hooks — and specifically through its DEFAULTS.
//
// `compile.spec.ts` calls `compileSfc` with every option spelled out, which is what
// makes each option's effect visible. That is also its blind spot, measured: pointing
// `DEFAULT_RUNTIME_MODULE_NAME` at `vue` — which drags `@vue/runtime-dom` and the DOM
// renderer into a bundle with no DOM — left that suite green, because nothing in it
// ever asked the plugin what its default was.
//
// So this suite drives `resolveId` and `load` for real, off a real file, with no
// options passed at all.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';

import { vuePlugin } from './index.js';

/** What `resolveId` appends; kept in one place so a rename shows up here. */
const SUFFIX = '.gjsify-vue.ts';

/** A minimal plugin context: the two members these hooks use. */
function context(resolved: string | null) {
    const warnings: string[] = [];
    const ctx = {
        resolve: async () => (resolved === null ? null : { id: resolved }),
        warn: (message: string) => warnings.push(message),
    };
    return { ctx, warnings };
}

type ObjectHook<T> = { handler: T };

/** `resolveId`'s handler, which the plugin declares in `{ order, handler }` form. */
function resolveIdOf(plugin: ReturnType<typeof vuePlugin>) {
    const hook = plugin.resolveId as unknown as ObjectHook<
        (this: unknown, source: string, importer: string | undefined) => Promise<string | null>
    >;
    return hook.handler;
}

function loadOf(plugin: ReturnType<typeof vuePlugin>) {
    return plugin.load as unknown as (this: unknown, id: string) => Promise<{ code: string; map: unknown } | null>;
}

const SFC = `<script setup lang="ts">const n: number = 6;</script>
<template><gtk-box :spacing="n"><GtkLabel label="hi" /></gtk-box></template>
`;

export default async () => {
    await describe('vuePlugin hooks, with no options', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'gjsify-vue-plugin-'));
        const file = join(dir, 'App.vue');
        await writeFile(file, SFC);
        const plugin = vuePlugin();
        const resolveId = resolveIdOf(plugin);
        const load = loadOf(plugin);

        await it('names itself so a build diagnostic can be attributed', async () => {
            expect(plugin.name).toBe('gjsify-vue');
        });

        await it('renames a .vue specifier to the resolved path plus the virtual suffix', async () => {
            const { ctx } = context(file);
            expect(await resolveId.call(ctx, './App.vue', join(dir, 'main.ts'))).toBe(`${file}${SUFFIX}`);
        });

        await it('leaves every other specifier alone', async () => {
            const { ctx } = context(file);
            for (const source of ['./main.ts', 'gi://Gtk', '@gjsify/gtk-host/vue', './App.vue.gjsify-vue.ts']) {
                expect(await resolveId.call(ctx, source, join(dir, 'main.ts'))).toBe(null);
            }
        });

        await it('declines when the specifier does not resolve', async () => {
            // A `.vue` import of a file that is not there must reach the bundler's
            // own unresolved-import diagnostic, not become a virtual id nothing can
            // read.
            const { ctx } = context(null);
            expect(await resolveId.call(ctx, './Missing.vue', join(dir, 'main.ts'))).toBe(null);
        });

        await it('loads only the ids it minted', async () => {
            const { ctx } = context(file);
            for (const id of [file, join(dir, 'main.ts'), 'gi://Gtk']) {
                expect(await load.call(ctx, id)).toBe(null);
            }
        });

        await it('compiles with @vue/runtime-core and the GTK tag rule by DEFAULT', async () => {
            const { ctx } = context(file);
            const result = await load.call(ctx, `${file}${SUFFIX}`);
            const code = result?.code ?? '';
            // The default that a green `compile.spec.ts` did not hold.
            expect(code).toContain('from "@vue/runtime-core"');
            expect(code.split('from "vue"').length - 1).toBe(0);
            // …and the default predicate, in both tag spellings.
            expect(code).toContain('_createElementBlock("gtk-box"');
            expect(code).toContain('_createElementVNode("GtkLabel"');
            expect(code.split('_resolveComponent(').length - 1).toBe(0);
            // The TypeScript survives, which is the whole reason for the `.ts` id.
            expect(code).toContain('const n: number = 6;');
        });

        await it('records the REAL path on the component, not the virtual id', async () => {
            const { ctx } = context(file);
            const result = await load.call(ctx, `${file}${SUFFIX}`);
            expect(result?.code ?? '').toContain(`__sfc__.__file = ${JSON.stringify(file)};`);
        });

        await it('routes a custom block through the plugin context warn', async () => {
            const extra = join(dir, 'Docs.vue');
            await writeFile(extra, `<template><gtk-box /></template>\n<docs>read me</docs>\n`);
            const { ctx, warnings } = context(extra);
            await load.call(ctx, `${extra}${SUFFIX}`);
            expect(warnings.length).toBe(1);
            expect(warnings[0]).toContain('<docs> block');
        });

        await it('hands rolldown a map that resolves into the .vue file', async () => {
            // `map: null` was what this returned, so every stack frame and every build
            // diagnostic pointed at a generated line.
            const { ctx } = context(file);
            const result = await load.call(ctx, `${file}${SUFFIX}`);
            const map = result?.map as { sources?: string[]; sourcesContent?: string[]; mappings?: string } | null;
            expect(map === null || map === undefined).toBe(false);
            expect(map?.sources).toStrictEqual([file]);
            expect(map?.sourcesContent?.[0]).toBe(SFC);
            expect((map?.mappings ?? '').length > 0).toBe(true);
        });

        await it('honours a caller-supplied include filter in BOTH hooks', async () => {
            // Both, because the pair that mints an id and the pair that reads it have
            // to agree: a `load` that matched a literal `.vue` would hijack an id its
            // own `resolveId` never minted, and a narrowed filter would then compile
            // a file the caller excluded.
            const narrowed = vuePlugin({ include: /\.sfc$/ });
            const { ctx } = context(file);
            expect(await resolveIdOf(narrowed).call(ctx, './App.vue', join(dir, 'main.ts'))).toBe(null);
            expect(await loadOf(narrowed).call(ctx, `${file}${SUFFIX}`)).toBe(null);
        });

        await rm(dir, { recursive: true, force: true });
    });
};
