// The compile step, asserted on the EMITTED CODE — and this suite exists because
// the showcase cannot do it.
//
// `showcases/gtk/vue-host-counter` runs the whole pipeline and asserts the real
// widget tree, which is the strongest end-to-end evidence there is. It is also
// blind to every option below, MEASURED: three deliberate breaks — dropping
// `isCustomElement` from the parse options, narrowing the predicate to kebab only,
// and pointing `runtimeModuleName` back at `vue` — all built and all printed
// `PROBE: PASS`.
//
// The reason is worth keeping, because it is why the "green by accident" path is so
// quiet. `resolveComponent` FALLS BACK TO THE TAG STRING when it resolves nothing,
// and `createVNode("gtk-box", …)` is an element vnode — Vue even normalises the
// slots object an unresolved component vnode carries back into element children
// (`normalizeChildren`'s `shapeFlag & ELEMENT` branch calls `children.default()`).
// So the widget tree is identical; what differs is a resolution attempt per tag per
// render and a `__DEV__`-only warning that the required production defines strip.
//
// Hence: the tree is the showcase's subject, the emitted code is this suite's.

import { describe, expect, it } from '@gjsify/unit';

import { compileSfc, isGtkHostTag } from './index.js';

const OPTIONS = { isCustomElement: isGtkHostTag, runtimeModuleName: '@vue/runtime-core' };

/** Compile with the defaults this plugin ships. */
const compile = (source: string, filename = 'App.vue', over: Partial<typeof OPTIONS> = {}) =>
    compileSfc(source, filename, { ...OPTIONS, ...over });

/**
 * The message of the error `fn` must reject with.
 *
 * `expect().toThrow` cannot see a rejected promise, and a helper that returned
 * `null` on success would let a missing refusal read as a pass.
 */
async function refusal(fn: () => Promise<unknown>): Promise<string> {
    try {
        await fn();
    } catch (error) {
        return String((error as Error).message);
    }
    throw new Error('expected the compile to be refused, and it succeeded');
}

/** How many times `needle` occurs in `code`. */
const count = (code: string, needle: string) => code.split(needle).length - 1;

export default async () => {
    await describe('isGtkHostTag', async () => {
        await it('accepts both spellings of a host tag', async () => {
            for (const tag of ['gtk-box', 'adw-action-row', 'gtk-gl-area', 'GtkBox', 'AdwActionRow', 'GtkGLArea']) {
                expect(isGtkHostTag(tag)).toBe(true);
            }
        });

        await it('is a discriminator and not a rubber stamp', async () => {
            // `gtkbox`/`Gtkbox` are the near misses that make the rule a PREFIX rule
            // rather than a substring test; `div` is the one Vue's own KeepAlive and
            // Suspense ask the host for, and the adapter separates it by ARITY.
            for (const tag of ['div', 'gtkbox', 'Gtkbox', 'MyComponent', 'gtk', 'adw', 'RouterView']) {
                expect(isGtkHostTag(tag)).toBe(false);
            }
        });
    });

    await describe('compileSfc: the tag decision', async () => {
        await it('compiles every host tag to an element vnode carrying the literal tag', async () => {
            const code = await compile(
                `<template><adw-application-window><gtk-box><gtk-button label="x" /><GtkLabel label="y" />` +
                    `<gtk-gl-area /><GtkGLArea /></gtk-box></adw-application-window></template>`,
            );
            expect(count(code, '_resolveComponent(')).toBe(0);
            for (const tag of ['adw-application-window', 'gtk-box', 'gtk-button', 'GtkLabel', 'gtk-gl-area']) {
                expect(code).toContain(`"${tag}"`);
            }
            // The root is a block, the rest are plain element vnodes: 5 children.
            expect(count(code, '_createElementVNode(')).toBe(5);
            expect(count(code, '_createElementBlock(')).toBe(1);
        });

        await it('leaves a NON-host tag as a component lookup', async () => {
            // Without this the suite could not tell a working predicate from one
            // that answers true for everything.
            const code = await compile(`<template><MyThing /></template>`);
            expect(code).toContain('_resolveComponent("MyThing")');
            expect(count(code, '_createElementVNode(')).toBe(0);
        });

        await it('honours a caller-supplied predicate', async () => {
            const code = await compile(`<template><x-thing /></template>`, 'App.vue', {
                isCustomElement: (tag) => tag.startsWith('x-'),
            });
            expect(code).toContain('_createElementBlock("x-thing"');
            expect(count(code, '_resolveComponent(')).toBe(0);
        });

        await it('a kebab-only predicate would lose the Pascal spelling', async () => {
            // The regression this pins: `vue-components.ts` answers `<GtkBox>` and
            // `<gtk-box>` from ONE GlobalComponents key, so a kebab-only rule
            // type-checks the Pascal form and then resolves it as a missing
            // component.
            const code = await compile(`<template><gtk-box><GtkLabel label="y" /></gtk-box></template>`, 'App.vue', {
                isCustomElement: (tag) => /^(gtk|adw)-/.test(tag),
            });
            expect(code).toContain('_resolveComponent("GtkLabel")');
        });
    });

    await describe('compileSfc: what the emitted module imports', async () => {
        await it('imports the runtime from @vue/runtime-core in BOTH halves', async () => {
            const code = await compile(
                `<script setup lang="ts">const n: number = 1;</script>\n` +
                    `<template><gtk-box :spacing="n" /></template>`,
            );
            // The script half is the one that regresses: `compileScript` hardcodes
            // `'vue'` unless the name reaches it through `templateOptions`.
            expect(code).toContain(`import { defineComponent as _defineComponent } from "@vue/runtime-core"`);
            expect(count(code, `from "vue"`)).toBe(0);
            expect(count(code, `from 'vue'`)).toBe(0);
        });

        await it('honours runtimeModuleName in both halves', async () => {
            // `lang="ts"` on purpose: `compileScript` only reaches for
            // `defineComponent` — the import that regressed — on the TypeScript
            // path, so a plain `<script setup>` has one import and would let a
            // half-applied option pass.
            const code = await compile(
                `<script setup lang="ts">const n: number = 1;</script>\n<template><gtk-box :spacing="n" /></template>`,
                'App.vue',
                { runtimeModuleName: 'my-renderer' },
            );
            expect(code).toContain(`import { defineComponent as _defineComponent } from "my-renderer"`);
            expect(count(code, `from "my-renderer"`)).toBe(2);
            expect(count(code, `"@vue/runtime-core"`)).toBe(0);
        });
    });

    await describe('compileSfc: the module it assembles', async () => {
        await it('renames the generated render export out of the user namespace', async () => {
            const code = await compile(`<script setup>const render = 1;</script>\n<template><gtk-box /></template>`);
            expect(code).toContain('function __sfc_render__(');
            expect(count(code, 'export function render(')).toBe(0);
            expect(code).toContain('__sfc__.render = __sfc_render__;');
        });

        await it('gives a script with no default export an empty component', async () => {
            const code = await compile(`<script>const a = 1;</script>\n<template><gtk-box /></template>`);
            expect(code).toContain('const __sfc__ = {}');
            expect(code).toContain('__sfc__.render = __sfc_render__;');
            expect(code).toContain('export default __sfc__;');
        });

        await it('compiles a template-only SFC', async () => {
            const code = await compile(`<template><gtk-box /></template>`);
            expect(code).toContain('const __sfc__ = {};');
            expect(code).toContain('__sfc__.render = __sfc_render__;');
        });

        await it('compiles a script-only SFC and attaches no render', async () => {
            const code = await compile(`<script>export default { name: 'X' }</script>`);
            expect(code).toContain(`const __sfc__ = { name: 'X' }`);
            expect(count(code, '__sfc__.render')).toBe(0);
        });

        await it('records the filename on the component', async () => {
            const code = await compile(`<template><gtk-box /></template>`, '/abs/path/Counter.vue');
            expect(code).toContain('__sfc__.__file = "/abs/path/Counter.vue";');
        });

        await it('passes TypeScript through for rolldown to strip', async () => {
            // The reason the module id gains a `.ts` suffix: this output is not JS.
            const code = await compile(
                `<script setup lang="ts">interface P { n: number }\nconst p: P = { n: 1 };</script>\n` +
                    `<template><gtk-box :spacing="p.n" /></template>`,
            );
            expect(code).toContain('interface P { n: number }');
            expect(code).toContain('const p: P = { n: 1 };');
        });
    });

    await describe('compileSfc: the two pinned parser options', async () => {
        await it('drops source comments, so the output does not follow NODE_ENV', async () => {
            // `comments` defaults to `__DEV__`, i.e. to the BUNDLER's NODE_ENV, which
            // no gjsify build sets — and it is a PARSE-time option, so setting it in
            // `compilerOptions` beside the ast is a silent no-op.
            const code = await compile(
                `<template><gtk-box><!-- a note --><gtk-label label="x" /></gtk-box></template>`,
            );
            expect(count(code, '_createCommentVNode(')).toBe(0);
            expect(code).toContain('_createElementVNode("gtk-label"');
        });

        await it('emits no cached static subtree, which is what the adapter prescribes', async () => {
            // `hoistStatic` defaults to on and turns a static run into
            // `_cache[0] || (_cache[0] = [...])` with patchFlag -1.
            const code = await compile(
                `<template><gtk-box><gtk-label label="a" /><gtk-label label="b" /></gtk-box></template>`,
            );
            expect(count(code, '_cache[')).toBe(0);
        });

        await it('emits no STRINGIFIED static subtree, which the adapter cannot mount', async () => {
            // A SEPARATE fixture, because the small one above cannot show this: with
            // `hoistStatic` on, compiler-dom's `stringifyStatic` turns a big enough
            // static run into `createStaticVNode("<html…>")`, and the adapter's
            // `insertStaticContent` THROWS — GTK parses no HTML. It applies to GTK
            // tags too: measured, 22 `<gtk-label title="t">x</gtk-label>` children
            // stringify exactly like 22 `<div>`s, while 22 self-closing text-free
            // labels do not reach the threshold at all. Asserting the small fixture
            // would have "held" this while measuring nothing.
            const children = Array.from({ length: 22 }, (_, i) => `<gtk-label title="t${i}">x${i}</gtk-label>`).join(
                '',
            );
            const code = await compile(`<template><gtk-box>${children}</gtk-box></template>`);
            expect(count(code, '_createStaticVNode(')).toBe(0);
            expect(count(code, '_createElementVNode("gtk-label"')).toBe(22);
        });
    });

    await describe('compileSfc: what it refuses', async () => {
        await it('refuses a <style> block by name', async () => {
            const message = await refusal(() =>
                compile(`<template><gtk-box /></template>\n<style>.a { color: red }</style>`, 'Styled.vue'),
            );
            expect(message).toContain('Styled.vue');
            expect(message).toContain('1 <style> block');
            expect(message).toContain('Gtk.CssProvider');
        });

        await it('counts a scoped <style> as scoped', async () => {
            const message = await refusal(() =>
                compile(`<template><gtk-box /></template>\n<style scoped>.a { color: red }</style>`),
            );
            expect(message).toContain('(1 scoped)');
        });

        await it('refuses a JSX script dialect by name', async () => {
            const message = await refusal(() => compile(`<script lang="tsx">export default {}</script>`, 'Jsx.vue'));
            expect(message).toContain('lang="tsx"');
            expect(message).toContain('rolldown-plugin-solid');
        });

        await it('accepts no lang, js and ts', async () => {
            for (const lang of ['', ' lang="js"', ' lang="ts"']) {
                const code = await compile(`<script${lang}>export default { name: 'X' }</script>`);
                expect(code).toContain('export default __sfc__;');
            }
        });

        await it('reports a template that does not compile', async () => {
            const message = await refusal(() => compile(`<template><gtk-box v-for="x" /></template>`, 'Bad.vue'));
            expect(message).toContain('Bad.vue');
        });
    });

    await describe('compileSfc: what it says out loud', async () => {
        await it('names a custom block instead of dropping it in silence', async () => {
            const warnings: string[] = [];
            const code = await compileSfc(`<template><gtk-box /></template>\n<docs>read me</docs>`, 'Doc.vue', {
                ...OPTIONS,
                onWarn: (message) => warnings.push(message),
            });
            expect(warnings.length).toBe(1);
            expect(warnings[0]).toContain('<docs> block');
            expect(warnings[0]).toContain('Doc.vue');
            // …and the compile still succeeds: a custom block has no runtime
            // semantics of its own, so refusing one would break a `<docs>` block
            // that harms nothing.
            expect(code).toContain('export default __sfc__;');
        });
    });
};
