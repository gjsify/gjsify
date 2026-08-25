// The Vue adapter, through the real `@vue/runtime-core`.
//
// Vue is the second contract over one host, which is the point: if the same
// descriptor table and the same placement engine satisfy both Vue's
// `RendererOptions` and Solid's universal renderer, the host is framework-agnostic
// in fact and not just in the ADR.

import { expect, it, on } from '@gjsify/unit';

import Gtk from 'gi://Gtk?version=4.0';
import {
    createStaticVNode,
    defineComponent,
    h,
    nextTick,
    popScopeId,
    pushScopeId,
    ref,
    shallowRef,
    KeepAlive,
    Teleport,
    type VNodeArrayChildren,
    type VNodeChild,
} from '@vue/runtime-core';

import { gtkChildTypes, gtkChildren, installDiagnosticsGate } from '../conformance/index.js';
import { runAdapterVectors, type VectorElement, type VectorHarness, type VectorNode } from '../conformance/vectors.mjs';
import { GTK_HOSTS, gated } from '../testing/gate.mjs';
import { registerBuiltinWidgets } from '../descriptors/index.js';
import type { GtkHostError } from '../index.js';
import { mount } from './vue.js';

const labelsOf = (w: Gtk.Widget) => gtkChildren(w).map((c) => (c as Gtk.Label).label);

/**
 * The shared vector table as Vue vnodes.
 *
 * Children are handed over as an ARRAY even when there is one string in it, and
 * that is the whole point of the text half: `h(tag, props, 'text')` sets
 * `TEXT_CHILDREN` and reaches `setElementText`, while `h(tag, props, ['text'])`
 * normalises the string into a Text vnode and reaches `createText`/`insert` —
 * which is what the SFC compiler emits for `<gtk-label>{{ count }}</gtk-label>`
 * and what nothing in this suite had ever exercised.
 */
const toVueTree = (node: VectorNode): VNodeChild => {
    if (typeof node === 'string') return node;
    const children = (node.children ?? []).map(toVueTree);
    return h(node.tag, node.props ?? null, children.length > 0 ? (children as VNodeArrayChildren) : undefined);
};

const vueVectors: VectorHarness = {
    framework: '@vue/runtime-core',
    async mount(container, tree) {
        // `shallowRef`, not `ref`: a deep ref hands the host a reactive PROXY of
        // every `layout` object, and the host stores what it is given.
        const current = shallowRef<VectorElement>(tree);
        const app = mount(defineComponent({ render: () => toVueTree(current.value) }), container);
        return {
            patch: async (next) => {
                current.value = next;
                await nextTick();
            },
            unmount: () => app.unmount(),
        };
    },
};

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        registerBuiltinWidgets();
        const diagnostics = installDiagnosticsGate();

        await gated(diagnostics, '@vue/runtime-core over the GTK host', async () => {
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
            });

            await it('a prop that disappears is reset, not set to null', async () => {
                // Vue signals removal with `null`, not `undefined`. That reached
                // `set_property` verbatim — a throw for an int property — and
                // `el.props` had already recorded it for the next rebuild.
                const container = new Gtk.Box();
                const wide = ref(true);
                const app = mount(
                    defineComponent({
                        render: () => h('GtkLabel', wide.value ? { label: 'x', widthRequest: 120 } : { label: 'x' }),
                    }),
                    container,
                );
                const label = gtkChildren(container)[0] as Gtk.Label;
                expect(label.widthRequest).toBe(120);
                wide.value = false;
                await nextTick();
                expect(label.widthRequest).toBe(-1); // the ParamSpec default
                app.unmount();
            });

            // --- listener modifiers -------------------------------------------
            //
            // HONEST CAVEAT: `@vue/compiler-dom` is installed nowhere in this
            // monorepo, so the KEY SHAPE below (`onClickedOnce` for
            // `@clicked.once`) comes from upstream compiler behaviour and cannot
            // be measured here. What IS measured is the consequence GIVEN that
            // key — which is the half that was broken: the whole suffix was
            // kebabed, so `.once` asked GTK for a signal called "clicked-once".

            await it('.once binds the signal and disconnects after one emission', async () => {
                const container = new Gtk.Box();
                let fired = 0;
                const app = mount(
                    defineComponent({
                        render: () =>
                            h('GtkButton', {
                                label: 'go',
                                onClickedOnce: () => {
                                    fired += 1;
                                },
                            }),
                    }),
                    container,
                );
                const button = gtkChildren(container)[0] as Gtk.Button;
                button.emit('clicked');
                button.emit('clicked');
                button.emit('clicked');
                expect(fired).toBe(1);
                app.unmount();
            });

            await it(".once is not spent by the host's own property write", async () => {
                // `notify::` fires for OUR patches too, and the host suppresses
                // those. A `.once` consumed by that suppressed emission would
                // leave the user's single callback already spent before the user
                // ever changed anything.
                const container = new Gtk.Box();
                const text = ref('first');
                let fired = 0;
                const app = mount(
                    defineComponent({
                        render: () =>
                            h('GtkLabel', {
                                label: text.value,
                                onNotifyLabelOnce: () => {
                                    fired += 1;
                                },
                            }),
                    }),
                    container,
                );
                const label = gtkChildren(container)[0] as Gtk.Label;
                text.value = 'second';
                await nextTick();
                expect(labelsOf(container)).toStrictEqual(['second']);
                expect(fired).toBe(0); // suppressed, and NOT spent
                label.notify('label');
                label.notify('label');
                expect(fired).toBe(1);
                app.unmount();
            });

            for (const [prop, modifier] of [
                ['onClickedCapture', 'capture'],
                ['onClickedPassive', 'passive'],
            ] as const) {
                await it(`.${modifier} is refused by name, not as a misspelling`, async () => {
                    const container = new Gtk.Box();
                    let error: unknown;
                    try {
                        mount(
                            defineComponent({ render: () => h('GtkButton', { label: 'go', [prop]: () => {} }) }),
                            container,
                        );
                    } catch (e) {
                        error = e;
                    }
                    // The old behaviour was `emits no signal "clicked-capture"` —
                    // a spelling complaint about a name the user spelled right.
                    expect((error as GtkHostError | undefined)?.code).toBe('event-modifier');
                    expect(String((error as Error | undefined)?.message)).toContain(`".${modifier}"`);
                    expect(gtkChildTypes(container)).toStrictEqual([]);
                });
            }

            // --- Vue's four OPTIONAL host ops ---------------------------------
            //
            // Measured before these vectors existed: a `printerr` marker in
            // `setScopeId`, `cloneNode` and `insertStaticContent` was hit ZERO
            // times across the whole suite, and `querySelector` only once (by the
            // teleport vector above). An earlier fix to any of them could be
            // reverted with nothing noticing — making `querySelector` answer
            // falsy instead of throwing left the suite fully green.

            await it('setScopeId turns a scope id into a style class', async () => {
                // `<style scoped>` compiles to an attribute selector, which GTK4
                // CSS does not have, so the scope id becomes a style class. Vue
                // reaches this op through `vnode.scopeId`, which `createBaseVNode`
                // captures from `pushScopeId`.
                const container = new Gtk.Box();
                const app = mount(
                    defineComponent({
                        render: () => {
                            pushScopeId('data-v-abc123');
                            const vnode = h('GtkLabel', { label: 'scoped' });
                            popScopeId();
                            return vnode;
                        },
                    }),
                    container,
                );
                const label = gtkChildren(container)[0];
                expect(label.has_css_class('data-v-abc123')).toBe(true);
                app.unmount();
            });

            await it('insertStaticContent throws — GTK parses no HTML', async () => {
                // Vue's `stringifyStatic` transform. `createStaticVNode` is the
                // shortest path to `mountStaticNode`, which is the only caller.
                const container = new Gtk.Box();
                let error: Error | undefined;
                try {
                    mount(defineComponent({ render: () => createStaticVNode('<b>hoisted</b>', 1) }), container);
                } catch (e) {
                    error = e as Error;
                }
                expect(error === undefined).toBe(false);
                expect(String(error?.message)).toContain('insertStaticContent');
                expect(String(error?.message)).toContain('hoistStatic: false');
                expect(gtkChildTypes(container)).toStrictEqual([]);
            });

            // --- <KeepAlive> --------------------------------------------------
            //
            // `<Suspense>` shares the mechanism and is deliberately NOT imported
            // here: `SuspenseImpl` carries `hydrate: hydrateSuspense`, which
            // contains a literal `document.createElement("div")`, and importing it
            // grows this bundle from 191 032 B to 274 177 B with
            // HTMLCanvasElement/Path2D and gi://Gdk, GdkPixbuf, Pango and
            // PangoCairo (measured; `--exclude-globals document` brings it back to
            // 196 614 B). The README carries that measurement and the escape.

            await it('<KeepAlive> round-trips a component through the scratch container', async () => {
                const container = new Gtk.Box();
                const current = ref('A');
                let bump = () => {};
                const A = defineComponent({
                    name: 'A',
                    setup() {
                        const n = ref(0);
                        bump = () => {
                            n.value += 1;
                        };
                        return () => h('GtkLabel', { label: `A${n.value}` });
                    },
                });
                const B = defineComponent({ name: 'B', setup: () => () => h('GtkLabel', { label: 'B' }) });
                const app = mount(
                    defineComponent({
                        render: () => h(KeepAlive, null, { default: () => h(current.value === 'A' ? A : B) }),
                    }),
                    container,
                );

                // Before the scratch container this line read `[]`: KeepAlive's
                // `createElement("div")` threw inside `setup`, Vue's production
                // error handler printed the code-only object and swallowed it, and
                // mount() returned normally with nothing rendered.
                expect(labelsOf(container)).toStrictEqual(['A0']);
                const widget = gtkChildren(container)[0];
                bump();
                await nextTick();
                expect(labelsOf(container)).toStrictEqual(['A1']);

                current.value = 'B';
                await nextTick();
                expect(labelsOf(container)).toStrictEqual(['B']);
                // Deactivated, not destroyed: it left the visible tree for the
                // detached box, so its widget still has a parent.
                expect(widget.get_parent() === null).toBe(false);
                expect(widget.get_parent() === container).toBe(false);

                current.value = 'A';
                await nextTick();
                // The SAME widget object, and the component's own state with it —
                // which is the only thing that distinguishes a working KeepAlive
                // from a re-mount that merely looks right.
                expect(gtkChildren(container)[0] === widget).toBe(true);
                expect(labelsOf(container)).toStrictEqual(['A1']);
                app.unmount();
            });

            await it('a user element is still refused by name — arity, not a guess', async () => {
                // The scratch container must not become a silent yes for anything
                // a user writes. Vue calls `createElement` with FOUR arguments for
                // a user element and ONE for its own off-screen storage, so the
                // same `<div>` that KeepAlive is granted is still refused here.
                const container = new Gtk.Box();
                let error: GtkHostError | undefined;
                try {
                    mount(defineComponent({ render: () => h('div', null, 'nope') }), container);
                } catch (e) {
                    error = e as GtkHostError;
                }
                expect(error?.code).toBe('unknown-tag');
                expect(gtkChildTypes(container)).toStrictEqual([]);
            });

            // --- <Teleport> ---------------------------------------------------

            await it('<Teleport :to="widget"> renders into the widget', async () => {
                // The form this adapter's own error message and README prescribe.
                // Before the coercion, doing literally that rendered nothing and
                // said nothing: Vue returns a non-string target verbatim, so the
                // host was handed a raw `Gtk.Box` as a parent.
                const container = new Gtk.Box();
                const target = new Gtk.Box();
                const app = mount(
                    defineComponent({
                        render: () =>
                            h('GtkBox', null, [
                                h('GtkLabel', { label: 'MARK' }),
                                h(Teleport, { to: target }, [h('GtkLabel', { label: 'PORTED' })]),
                            ]),
                    }),
                    container,
                );
                expect(labelsOf(gtkChildren(container)[0])).toStrictEqual(['MARK']);
                expect(labelsOf(target)).toStrictEqual(['PORTED']);
                app.unmount();
            });

            await it('a teleport target is adopted ONCE, so order survives', async () => {
                // Every teleported child and both of `TeleportImpl`'s text anchors
                // reach `insert` with the same raw widget. Adopting per call would
                // re-snapshot `foreign` each time, and the second child would be
                // placed against a container that already claims to have held it.
                const container = new Gtk.Box();
                const target = new Gtk.Box();
                const extra = ref(false);
                const app = mount(
                    defineComponent({
                        render: () =>
                            h(Teleport, { to: target }, [
                                h('GtkLabel', { label: 'one' }),
                                extra.value ? h('GtkLabel', { label: 'two' }) : null,
                                h('GtkLabel', { label: 'three' }),
                            ]),
                    }),
                    container,
                );
                expect(labelsOf(target)).toStrictEqual(['one', 'three']);
                extra.value = true;
                await nextTick();
                expect(labelsOf(target)).toStrictEqual(['one', 'two', 'three']);
                extra.value = false;
                await nextTick();
                expect(labelsOf(target)).toStrictEqual(['one', 'three']);
                app.unmount();
            });

            await it('a STRING teleport target throws, naming the form that works', async () => {
                // `querySelector` is one of Vue's four optional host ops and the
                // only one this adapter reaches at all. Answering falsy instead
                // would mount nothing and warn only under `__DEV__`, which the
                // production defines strip — and the whole suite stayed green
                // when it was made to answer falsy, which is why this vector
                // exists.
                const container = new Gtk.Box();
                let error: Error | undefined;
                try {
                    mount(
                        defineComponent({
                            render: () => h(Teleport, { to: '#somewhere' }, [h('GtkLabel', { label: 'x' })]),
                        }),
                        container,
                    );
                } catch (e) {
                    error = e as Error;
                }
                expect(error === undefined).toBe(false);
                expect(String(error?.message)).toContain('<Teleport to="#somewhere">');
                // The advice must be a form that WORKS — it used to prescribe
                // exactly what rendered nothing.
                expect(String(error?.message)).toContain('this adapter adopts it');
                expect(String(error?.message)).toContain('adopt(el)');
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
            });
        });

        await runAdapterVectors(vueVectors, diagnostics);
    });
};
