// The Vue adapter, through the real `@vue/runtime-core`.
//
// Vue is the second contract over one host, which is the point: if the same
// descriptor table and the same placement engine satisfy both Vue's
// `RendererOptions` and Solid's universal renderer, the host is framework-agnostic
// in fact and not just in the ADR.

import { describe, expect, it, on } from '@gjsify/unit';

import Gtk from 'gi://Gtk?version=4.0';
import { defineComponent, h, ref, nextTick } from '@vue/runtime-core';

import { gtkChildTypes, gtkChildren, installDiagnosticsGate } from '../conformance/index.js';
import { registerBuiltinWidgets } from '../descriptors/index.js';
import { mount } from './vue.js';

const labelsOf = (w: Gtk.Widget) => gtkChildren(w).map((c) => (c as Gtk.Label).label);

export default async () => {
    await on('Gjs', async () => {
        Gtk.init();
        registerBuiltinWidgets();
        const diagnostics = installDiagnosticsGate();

        await describe('@vue/runtime-core over the GTK host', async () => {
            await it('runs without a DOM at all', async () => {
                // `@vue/runtime-core` is DOM-free in FACT: every `document`,
                // `navigator`, `location` and `HTMLElement` reference in it sits in
                // a dev/HMR/devtools path behind `typeof window !== 'undefined'` or
                // `__DEV__`. But `--globals auto` is a STATIC analysis and injects a
                // polyfill for each identifier it sees — which made this bundle
                // require gi://Gdk, GdkPixbuf, Pango and PangoCairo at load.
                //
                // Vue's four production defines (in `build:test:gjs`) let dead-code
                // elimination remove those branches, and then nothing is injected.
                // If a `document` exists here, the recipe was lost.
                const g = globalThis as unknown as Record<string, unknown>;
                expect(typeof g.document).toBe('undefined');
                expect(typeof g.navigator).toBe('undefined');
            });

            await it('renders a tree into a widget the application owns', async () => {
                const container = new Gtk.Box();
                const app = mount(
                    defineComponent({
                        render: () => h('GtkBox', null, [h('GtkLabel', { label: 'hello' })]),
                    }),
                    container,
                );
                expect(gtkChildTypes(container)).toStrictEqual(['GtkBox']);
                expect(labelsOf(gtkChildren(container)[0])).toStrictEqual(['hello']);
                app.unmount();
                diagnostics.assertQuiet();
            });

            await it('a reactive property reaches GTK after the first render', async () => {
                const container = new Gtk.Box();
                const text = ref('first');
                const app = mount(defineComponent({ render: () => h('GtkLabel', { label: text.value }) }), container);
                expect(labelsOf(container)).toStrictEqual(['first']);
                text.value = 'second';
                await nextTick();
                expect(labelsOf(container)).toStrictEqual(['second']);
                app.unmount();
                diagnostics.assertQuiet();
            });

            await it('a v-if branch does not shift its siblings — anchors stay out of GTK', async () => {
                // Vue marks the branch with `createComment`, which the host turns
                // into an anchor that never enters the GTK tree.
                const container = new Gtk.Box();
                const shown = ref(false);
                const app = mount(
                    defineComponent({
                        render: () =>
                            h('GtkBox', null, [
                                h('GtkLabel', { label: 'before' }),
                                shown.value ? h('GtkLabel', { label: 'middle' }) : null,
                                h('GtkLabel', { label: 'after' }),
                            ]),
                    }),
                    container,
                );
                const box = gtkChildren(container)[0];
                expect(labelsOf(box)).toStrictEqual(['before', 'after']);
                shown.value = true;
                await nextTick();
                expect(labelsOf(box)).toStrictEqual(['before', 'middle', 'after']);
                shown.value = false;
                await nextTick();
                expect(labelsOf(box)).toStrictEqual(['before', 'after']);
                app.unmount();
                diagnostics.assertQuiet();
            });

            await it('a keyed reorder moves the same widgets', async () => {
                const container = new Gtk.Box();
                const items = ref(['a', 'b', 'c']);
                const app = mount(
                    defineComponent({
                        render: () =>
                            h(
                                'GtkBox',
                                null,
                                items.value.map((t) => h('GtkLabel', { key: t, label: t })),
                            ),
                    }),
                    container,
                );
                const box = gtkChildren(container)[0];
                const before = gtkChildren(box);
                expect(labelsOf(box)).toStrictEqual(['a', 'b', 'c']);

                items.value = ['c', 'b', 'a'];
                await nextTick();
                expect(labelsOf(box)).toStrictEqual(['c', 'b', 'a']);
                const after = gtkChildren(box);
                // Identity, not just order. It also proves Vue moves a node with
                // `insert` alone — which is what makes `remove` safe to treat as a
                // teardown in this adapter, unlike Solid's.
                const reused = after.filter((w) => before.includes(w)).length;
                expect(reused).toBe(before.length);
                app.unmount();
                diagnostics.assertQuiet();
            });

            await it('reconciles into a container that can only append', async () => {
                const container = new Gtk.Box();
                const rows = ref(['R0', 'R1']);
                const app = mount(
                    defineComponent({
                        render: () =>
                            h(
                                'AdwPreferencesGroup',
                                null,
                                rows.value.map((t) => h('AdwActionRow', { key: t, title: t })),
                            ),
                    }),
                    container,
                );
                const titles = () => {
                    const out: string[] = [];
                    const walk = (w: Gtk.Widget) => {
                        const t = (w as unknown as { title?: string }).title;
                        if (typeof t === 'string' && /^R\d$/.test(t)) out.push(t);
                        for (const c of gtkChildren(w)) walk(c);
                    };
                    walk(container);
                    return out;
                };
                expect(titles()).toStrictEqual(['R0', 'R1']);
                rows.value = ['R1', 'R0'];
                await nextTick();
                expect(titles()).toStrictEqual(['R1', 'R0']);
                app.unmount();
                diagnostics.assertQuiet();
            });

            await it('unmount disconnects the handlers', async () => {
                const container = new Gtk.Box();
                let clicks = 0;
                const app = mount(
                    defineComponent({
                        render: () =>
                            h('GtkButton', {
                                label: 'go',
                                onClicked: () => {
                                    clicks += 1;
                                },
                            }),
                    }),
                    container,
                );
                const button = gtkChildren(container)[0] as Gtk.Button;
                button.emit('clicked');
                expect(clicks).toBe(1);
                app.unmount();
                button.emit('clicked');
                // GJS blocks JS callbacks during GC, so a handler nobody
                // disconnects fires for the life of the process.
                expect(clicks).toBe(1);
                diagnostics.assertQuiet();
            });
        });
    });
};
