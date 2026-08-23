// The Solid adapter, through the real `solid-js/universal` renderer.
//
// The load-bearing test is the SECOND assertion of each pair, not the first.
// `solid-js`'s own export map routes the `node` and `deno` conditions to
// `dist/server.js` — the SSR build, which renders a perfect initial tree and then
// has no reactivity at all, with no error. Every render smoke test passes against
// it. Only an update after the first render can tell the two apart, so every case
// here renders, mutates, and asserts again.

import { expect, it, on } from '@gjsify/unit';

import Gtk from 'gi://Gtk?version=4.0';
import { createSignal } from 'solid-js';

import { installDiagnosticsGate, gtkChildren, gtkChildTypes } from '../conformance/index.js';
import { gated } from '../testing/gate.mjs';
import { registerBuiltinWidgets } from '../descriptors/index.js';
import {
    Dynamic,
    For,
    createComponent,
    createElement,
    effect,
    insert,
    insertNode,
    mount,
    setSolidProp,
} from './solid.js';

const labelsOf = (w: Gtk.Widget) => gtkChildren(w).map((c) => (c as Gtk.Label).label);

export default async () => {
    await on('Gjs', async () => {
        Gtk.init();
        registerBuiltinWidgets();
        const diagnostics = installDiagnosticsGate();

        await gated(diagnostics, 'solid-js/universal over the GTK host', async () => {
            await it('renders a tree into a widget the application owns', async () => {
                const container = new Gtk.Box();
                const dispose = mount(() => {
                    const box = createElement('GtkBox');
                    const label = createElement('GtkLabel');
                    setSolidProp(label, 'label', 'hello');
                    insertNode(box, label);
                    return box;
                }, container);

                expect(gtkChildTypes(container)).toStrictEqual(['GtkBox']);
                expect(labelsOf(gtkChildren(container)[0])).toStrictEqual(['hello']);
                dispose();
            });

            await it('updates a property after the first render — the reactivity discriminator', async () => {
                const container = new Gtk.Box();
                const [text, setText] = createSignal('first');
                const dispose = mount(() => {
                    const label = createElement('GtkLabel');
                    // what compiled JSX emits for a dynamic prop
                    effect(() => setSolidProp(label, 'label', text()));
                    return label;
                }, container);

                expect(labelsOf(container)).toStrictEqual(['first']);
                setText('second');
                // An SSR build renders 'first' and stops. This line is the only
                // thing that can tell the two builds apart.
                expect(labelsOf(container)).toStrictEqual(['second']);
                dispose();
            });

            await it('reconciles a list, and a reorder reaches GTK', async () => {
                const container = new Gtk.Box();
                const [items, setItems] = createSignal(['a', 'b', 'c']);
                const dispose = mount(() => {
                    const box = createElement('GtkBox');
                    insert(box, () =>
                        items().map((t) => {
                            const label = createElement('GtkLabel');
                            setSolidProp(label, 'label', t);
                            return label;
                        }),
                    );
                    return box;
                }, container);

                const box = gtkChildren(container)[0];
                expect(labelsOf(box)).toStrictEqual(['a', 'b', 'c']);
                setItems(['c', 'b', 'a']);
                expect(labelsOf(box)).toStrictEqual(['c', 'b', 'a']);
                setItems(['b']);
                expect(labelsOf(box)).toStrictEqual(['b']);
                dispose();
            });

            await it('<For> keeps widget identity across a reorder', async () => {
                const container = new Gtk.Box();
                const [items, setItems] = createSignal(['a', 'b', 'c']);
                mount(() => {
                    const box = createElement('GtkBox');
                    // What `<For each={items}>` compiles to. A bare `items().map()`
                    // re-creates every node on every change by construction — that
                    // is the authoring pattern, not the renderer — so identity can
                    // only be asked of the keyed component.
                    // Hand-written exactly as JSX compiles it: `each` is a GETTER on
                    // the props object (so `For` tracks it), and the component is
                    // created ONCE — wrapping it in an effect would rebuild `For`
                    // itself on every change and no node could be reused.
                    insert(
                        box,
                        createComponent(For, {
                            get each() {
                                return items();
                            },
                            children: (t: string) => {
                                const label = createElement('GtkLabel');
                                setSolidProp(label, 'label', t);
                                return label;
                            },
                        }),
                    );
                    return box;
                }, container);
                const box = gtkChildren(container)[0];
                const before = gtkChildren(box);
                setItems(['c', 'b', 'a']);
                const after = gtkChildren(box);
                const reused = after.filter((w) => before.includes(w)).length;
                expect(labelsOf(box)).toStrictEqual(['c', 'b', 'a']);
                // Identity is the point of a keyed list: a reorder that recreates
                // widgets destroys focus, scroll position and any widget state.
                expect(reused).toBe(before.length);
            });

            // Every width, because the defect only lived at SOME of them.
            //
            // `reconcileArrays`' swap fast path emits `insertNode(parent, b, b)`
            // — a node anchored on ITSELF, which the DOM defines as a no-op — and
            // it fires only when the two swapped rows are ADJACENT. At width 3 a
            // full reversal moves non-adjacent rows and takes a different branch,
            // so the one reorder vector this suite had was the one width that
            // could not see it. Reversing two items HUNG the process.
            for (const [from, to] of [
                [
                    ['a', 'b'],
                    ['b', 'a'],
                ],
                [
                    ['a', 'b', 'c'],
                    ['b', 'a', 'c'],
                ],
                [
                    ['a', 'b', 'c'],
                    ['c', 'b', 'a'],
                ],
                [
                    ['a', 'b', 'c', 'd'],
                    ['a', 'c', 'b', 'd'],
                ],
                [
                    ['a', 'b', 'c', 'd'],
                    ['d', 'c', 'b', 'a'],
                ],
                [
                    ['h', 'a', 'b', 't'],
                    ['h', 'b', 'a', 't'],
                ],
            ] as const) {
                await it(`<For> reorders ${from.join('')} to ${to.join('')} without self-anchoring`, async () => {
                    const container = new Gtk.Box();
                    const [items, setItems] = createSignal<readonly string[]>(from);
                    mount(() => {
                        const box = createElement('GtkBox');
                        insert(
                            box,
                            createComponent(For, {
                                get each() {
                                    return items();
                                },
                                children: (t: string) => {
                                    const label = createElement('GtkLabel');
                                    setSolidProp(label, 'label', t);
                                    return label;
                                },
                            }),
                        );
                        return box;
                    }, container);
                    const box = gtkChildren(container)[0];
                    const before = gtkChildren(box);
                    setItems(to);
                    const after = gtkChildren(box);
                    expect(labelsOf(box)).toStrictEqual([...to]);
                    // Same widget objects: a keyed reorder that recreates widgets
                    // throws away focus, scroll position and every widget state.
                    expect(after.filter((w) => before.includes(w)).length).toBe(before.length);
                });
            }

            await it('reconciles into a container that can only append', async () => {
                // `Adw.PreferencesGroup` has no `insert()`, so the host rotates its
                // tail. A renderer must not have to know that.
                const container = new Gtk.Box();
                const [rows, setRows] = createSignal(['R0', 'R1']);
                const dispose = mount(() => {
                    const group = createElement('AdwPreferencesGroup');
                    insert(group, () =>
                        rows().map((t) => {
                            const row = createElement('AdwActionRow');
                            setSolidProp(row, 'title', t);
                            return row;
                        }),
                    );
                    return group;
                }, container);

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
                setRows(['R1', 'R0']);
                expect(titles()).toStrictEqual(['R1', 'R0']);
                dispose();
            });

            await it('mounts AFTER what the application already put in the container', async () => {
                // Every other vector here uses a fresh empty Box, which is exactly
                // why this was invisible: an adopted root has an empty shadow tree,
                // so the first insertion resolved to `insert_child_after(w, null)` —
                // GTK's "make first" — and the rendered tree landed above the app's
                // own chrome.
                const container = new Gtk.Box();
                const chrome = new Gtk.Label({ label: 'app-owned' });
                container.append(chrome);
                const dispose = mount(() => {
                    const label = createElement('GtkLabel');
                    setSolidProp(label, 'label', 'rendered');
                    return label;
                }, container);
                expect(labelsOf(container)).toStrictEqual(['app-owned', 'rendered']);
                dispose();
            });

            await it('a dynamic list keeps its place among static siblings', async () => {
                // The shape every other vector here avoided: the dynamic expression
                // is NOT the only child, so Solid inserts before a marker and
                // `reconcileArrays` reads `getNextSibling` off the last old node.
                // A cleanup that unlinked made every trailing insertion append at
                // the end instead — `head | foot | c` rather than `head | c | foot`.
                const container = new Gtk.Box();
                const [items, setItems] = createSignal(['a', 'b']);
                mount(() => {
                    const box = createElement('GtkBox');
                    const head = createElement('GtkLabel');
                    setSolidProp(head, 'label', 'head');
                    const foot = createElement('GtkLabel');
                    setSolidProp(foot, 'label', 'foot');
                    insertNode(box, head);
                    insertNode(box, foot);
                    insert(
                        box,
                        createComponent(For, {
                            get each() {
                                return items();
                            },
                            children: (t: string) => {
                                const label = createElement('GtkLabel');
                                setSolidProp(label, 'label', t);
                                return label;
                            },
                        }),
                        foot,
                    );
                    return box;
                }, container);

                const box = gtkChildren(container)[0];
                expect(labelsOf(box)).toStrictEqual(['head', 'a', 'b', 'foot']);

                // replacing EVERY item is the case with no survivors, which is where
                // the sibling read happens
                setItems(['c']);
                expect(labelsOf(box)).toStrictEqual(['head', 'c', 'foot']);

                setItems(['x', 'y']);
                expect(labelsOf(box)).toStrictEqual(['head', 'x', 'y', 'foot']);
            });

            await it('a row dropped by reconciliation is torn down, not just detached', async () => {
                // `mount`'s teardown can only reach what is still attached, so a node
                // removed by an earlier reconciliation would keep its handlers for
                // the life of the process — GJS blocks JS callbacks during GC. The
                // per-node reactive scope is the only signal that says "gone".
                const container = new Gtk.Box();
                const [items, setItems] = createSignal(['a', 'b']);
                let fired = 0;
                const buttons: Gtk.Button[] = [];
                mount(() => {
                    const box = createElement('GtkBox');
                    insert(
                        box,
                        createComponent(For, {
                            get each() {
                                return items();
                            },
                            children: (t: string) => {
                                const btn = createElement('GtkButton');
                                setSolidProp(btn, 'label', t);
                                setSolidProp(btn, 'onClicked', () => {
                                    fired += 1;
                                });
                                return btn;
                            },
                        }),
                    );
                    return box;
                }, container);

                const box = gtkChildren(container)[0];
                for (const w of gtkChildren(box)) buttons.push(w as Gtk.Button);
                expect(buttons.length).toBe(2);
                buttons[0].emit('clicked');
                expect(fired).toBe(1);

                setItems(['b']); // 'a' is gone for good
                expect(labelsOf(box)).toStrictEqual(['b']);
                buttons[0].emit('clicked');
                expect(fired).toBe(1); // its handler died with it
            });

            // --- <Dynamic> ----------------------------------------------------
            //
            // `solid-js/web`'s own `Dynamic` is the DOM renderer's and cannot be
            // used here: its string branch is `document.createElement(tag)` plus
            // the DOM's `spread`, so nothing arrives through these host ops.
            // Measured in an isolated bundle: container `["GtkBox"]`, the box's
            // children just the static sibling, no throw, no GTK diagnostic,
            // exit 0. Importing it into THIS bundle is not an option either — it
            // makes `--globals auto` inject `document`, `HTMLCanvasElement` and
            // `Path2D` and pull gi://Gdk, GdkPixbuf, Pango and PangoCairo.

            await it('<Dynamic component="tag"> renders, and a new tag replaces it', async () => {
                const container = new Gtk.Box();
                const [tag, setTag] = createSignal('GtkLabel');
                mount(() => {
                    const box = createElement('GtkBox');
                    insert(
                        box,
                        createComponent(Dynamic, {
                            get component() {
                                return tag();
                            },
                            label: 'dyn',
                        }),
                    );
                    return box;
                }, container);
                const box = gtkChildren(container)[0];
                expect(gtkChildTypes(box)).toStrictEqual(['GtkLabel']);
                expect(labelsOf(box)).toStrictEqual(['dyn']);
                setTag('GtkButton');
                expect(gtkChildTypes(box)).toStrictEqual(['GtkButton']);
            });

            await it('<Dynamic component={fn}> calls the component', async () => {
                const container = new Gtk.Box();
                mount(() => {
                    const box = createElement('GtkBox');
                    insert(
                        box,
                        createComponent(Dynamic, {
                            component: (p: { label?: string }) => {
                                const label = createElement('GtkLabel');
                                setSolidProp(label, 'label', p.label ?? '');
                                return label;
                            },
                            label: 'from-fn',
                        }),
                    );
                    return box;
                }, container);
                const box = gtkChildren(container)[0];
                expect(labelsOf(box)).toStrictEqual(['from-fn']);
            });

            await it('<Dynamic> refuses a component that is neither tag nor function', async () => {
                // Solid's own version falls through its switch and returns
                // undefined, so `component={registry[key]}` with a key that missed
                // renders nothing and says nothing.
                const container = new Gtk.Box();
                let error: Error | undefined;
                try {
                    mount(() => {
                        const box = createElement('GtkBox');
                        insert(box, createComponent(Dynamic, { component: undefined as never }));
                        return box;
                    }, container);
                } catch (e) {
                    error = e as Error;
                }
                expect(error === undefined).toBe(false);
                expect(String(error?.message)).toContain('<Dynamic component={…}>');
                expect(String(error?.message)).toContain('<Show when={…}>');
            });

            await it('insertNode refuses a value that is not a node of this renderer', async () => {
                // The seam the DOM `Dynamic` fell through. `insertExpression`'s
                // last branch hands any non-array object to `insertNode`, and the
                // host then wrote its links onto it and did nothing else — a
                // phantom in the shadow tree that never reaches GTK.
                const container = new Gtk.Box();
                let error: Error | undefined;
                try {
                    mount(() => {
                        const box = createElement('GtkBox');
                        // What solid-js/web's Dynamic produces: an object with a
                        // tagName and no `kind`.
                        insert(box, { tagName: 'DIV' } as never);
                        return box;
                    }, container);
                } catch (e) {
                    error = e as Error;
                }
                expect(error === undefined).toBe(false);
                expect(String(error?.message)).toContain('a DOM element <div>');
                expect(String(error?.message)).toContain('solid-js/web');
            });

            await it('a signal bound through the adapter fires, and unmount stops it', async () => {
                const container = new Gtk.Box();
                let clicks = 0;
                let button: Gtk.Button | null = null;
                const dispose = mount(() => {
                    const btn = createElement('GtkButton');
                    setSolidProp(btn, 'label', 'go');
                    setSolidProp(btn, 'onClicked', () => {
                        clicks += 1;
                    });
                    button = (btn as { widget: unknown }).widget as Gtk.Button;
                    return btn;
                }, container);

                // the widget only exists once it was placed
                button = gtkChildren(container)[0] as Gtk.Button;
                button.emit('clicked');
                expect(clicks).toBe(1);
                dispose();
                button.emit('clicked');
                expect(clicks).toBe(1);
            });
        });
    });
};
