// The portal seam — ADR 0045.
//
// EVERY VECTOR HERE ROOTS ITS PARENT IN A WINDOW, and that is not a detail of the
// fixture. The defect this seam exists for is `g_error()` inside
// `adw_dialog_root()`, which only runs when a widget joins a tree whose root is a
// `Gtk.Window`; a DETACHED box accepts `box.append(dialog)` in silence at exit 0
// (measured), so a suite built on bare boxes would report the seam works and would
// have proved nothing. `rooted()` below is the only fixture, for that reason.
//
// The abort itself is deliberately NOT asserted in-process: it is SIGABRT with a
// core dump, so a test that triggers it takes the runner with it. What is asserted
// is the seam that makes it unreachable — the node never enters the parent — plus
// the two silent wrongs around it (a stray toplevel, a dialog left up).

import { expect, it, on } from '@gjsify/unit';

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { descriptorProblems, gtkChildTypes, gtkChildren, installDiagnosticsGate } from './conformance/index.js';
import { BUILTIN_DESCRIPTORS, registerBuiltinWidgets } from './descriptors/index.js';
import { GtkHostError } from './errors.js';
import { adopt, createElement, destroy, insert, materialize, remove, setProp } from './host.js';
import { isPortal, placementOf, portalOf } from './policies.js';
import { lookupWidget, registerWidget, registerWidgets } from './registry.js';
import { createRoot as createReactRoot } from './adapters/react.js';
import {
    createElement as solidCreateElement,
    insertNode as solidInsertNode,
    mount as solidMount,
    setProp as solidSetProp,
} from './adapters/solid.js';
import { createElement as reactCreateElement } from 'react';
import { defineComponent, h } from '@vue/runtime-core';
import { mount as vueMount } from './adapters/vue.js';
import { GTK_HOSTS, gated } from './testing/gate.mjs';
import type { HostElement, WidgetDescriptor } from './types.js';

const widgetOf = (el: HostElement) => materialize(el) as unknown as Gtk.Widget;

/**
 * A host parent that is REALLY inside a toplevel, which is the whole fixture.
 *
 * An `Adw.Window` and not a `Gtk.Window`: only the libadwaita windows carry an
 * `AdwDialogHost`, and `adw_dialog_present` documents the other case as opening a
 * separate window. A fixture on a plain `Gtk.Window` would measure the fallback
 * and call it the feature.
 */
function rooted(): { window: Adw.Window; parent: HostElement; box: Gtk.Box } {
    const window = new Adw.Window();
    const box = new Gtk.Box();
    window.set_content(box);
    return { window, parent: adopt(box), box };
}

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        registerBuiltinWidgets();

        const diagnostics = installDiagnosticsGate();

        await gated(diagnostics, 'the placement axis', async () => {
            await it('is `parented` for every widget that does not declare one', async () => {
                expect(placementOf(lookupWidget('GtkBox'))).toStrictEqual({ kind: 'parented' });
                expect(portalOf(lookupWidget('GtkBox'))).toBe(null);
                expect(isPortal(createElement('GtkBox'))).toBe(false);
            });

            await it('names present and force_close on the dialog family', async () => {
                expect(portalOf(lookupWidget('AdwDialog'))).toStrictEqual({
                    kind: 'portal',
                    present: 'present',
                    close: 'force_close',
                });
                expect(isPortal(createElement('AdwDialog'))).toBe(true);
            });

            // THE MECHANISM, not a vector. A portal is a fact about the TYPE and
            // registration is EXACT — `lookupWidget('AdwAlertDialog')` answers the
            // generated row, not `AdwDialog`'s — so a subclass the curated table
            // forgets is a tag that aborts the process the first time somebody puts
            // one in a window. libadwaita has five today; this fails on the sixth.
            await it('is declared by every registered Adw.Dialog subclass', async () => {
                const dialogs: string[] = [];
                const withoutPortal: string[] = [];
                for (const d of BUILTIN_DESCRIPTORS) {
                    const Klass = d.ctor() as unknown as { $gtype?: GObject.GType } | undefined;
                    if (!Klass?.$gtype) continue;
                    if (!GObject.type_is_a(Klass.$gtype, Adw.Dialog.$gtype)) continue;
                    dialogs.push(d.gtype);
                    if (!portalOf(d)) withoutPortal.push(d.gtype);
                }
                expect(withoutPortal).toStrictEqual([]);
                // The population is asserted too: an empty walk would satisfy the
                // line above while checking nothing, which is this repository's
                // most expensive shape of green.
                expect(dialogs.includes('AdwDialog')).toBe(true);
                expect(dialogs.includes('AdwAlertDialog')).toBe(true);
                expect(dialogs.length >= 5).toBe(true);
            });

            await it('is checked against the installed class like a child policy is', async () => {
                const liar: WidgetDescriptor = {
                    gtype: 'AdwDialog',
                    ctor: () => Adw.Dialog as never,
                    children: { kind: 'uncurated' },
                    placement: { kind: 'portal', present: 'present', close: 'dismiss_forever' },
                };
                expect(descriptorProblems([liar]).map((p) => p.problem)).toStrictEqual([
                    'declares placement.dismiss_forever(), which AdwDialog does not have',
                ]);
            });

            await it('refuses a method the class does not have AT THE INSERT, not later', async () => {
                // The runtime half of the check above, for a descriptor an
                // application registered — which `descriptorProblems()` never sees.
                // AT THE INSERT is the load-bearing half: the placement can be
                // DEFERRED, so a missing method would otherwise first be reached
                // inside a `notify::root` handler, where a throw is an exception
                // logged from a signal callback with nothing to attribute it to.
                registerWidget({
                    gtype: 'AdwDialog',
                    ctor: () => Adw.Dialog as never,
                    children: { kind: 'single', set: 'set_child' },
                    placement: { kind: 'portal', present: 'present', close: 'dismiss_forever' },
                });
                try {
                    const { parent } = rooted();
                    const broken = createElement('AdwDialog');
                    let caught: unknown;
                    try {
                        insert(broken, parent);
                    } catch (error) {
                        caught = error;
                    }
                    expect((caught as GtkHostError)?.code).toBe('portal-method-missing');
                    expect(broken.portalWatch).toBe(null);
                } finally {
                    // Put the real table back: the registry is module-global and
                    // every describe after this one reads it.
                    registerWidgets(BUILTIN_DESCRIPTORS);
                }
            });

            // The arity is what separates a portal from a toplevel: measured,
            // `adw_dialog_present` takes 1 and `gtk_window_present` takes 0.
            await it('refuses a present() that does not take a parent', async () => {
                const window: WidgetDescriptor = {
                    gtype: 'GtkWindow',
                    ctor: () => Gtk.Window as never,
                    children: { kind: 'single', set: 'set_child' },
                    placement: { kind: 'portal', present: 'present', close: 'close' },
                };
                const problems = descriptorProblems([window]).map((p) => p.problem);
                expect(problems.some((p) => p.includes('takes 0 argument(s)'))).toBe(true);
            });
        });

        await gated(diagnostics, 'portal placement — Adw.Dialog against a rooted parent', async () => {
            await it('presents into the parent’s toplevel and enters no child list', async () => {
                const { window, parent, box } = rooted();
                const dialog = createElement('AdwDialog');
                insert(dialog, parent);

                // The node is NOT in the parent. That is the seam: the very append
                // this replaces is `g_error()` on this exact tree.
                expect(gtkChildTypes(box)).toStrictEqual([]);
                // And it IS on screen, in the right window.
                expect(widgetOf(dialog).get_root() === window).toBe(true);
                expect(window.visibleDialog === (widgetOf(dialog) as unknown as Adw.Dialog)).toBe(true);
                destroy(dialog);
            });

            await it('takes its own children through the ordinary one-child slot', async () => {
                const { parent } = rooted();
                const dialog = createElement('AdwDialog');
                const label = createElement('GtkLabel', { label: 'inside' });
                insert(label, dialog);
                insert(dialog, parent);
                expect((widgetOf(dialog) as unknown as Adw.Dialog).get_child() === widgetOf(label)).toBe(true);
                destroy(dialog);
            });

            await it('closes on unmount even when can-close is false', async () => {
                // `can-close: false` is how `onRequestClose` is honoured one layer
                // up, and it is what makes `close()` the WRONG method here:
                // measured, it returns false, emits `close-attempt` and leaves the
                // dialog on screen. An unmount is not a user request.
                const { window, parent } = rooted();
                const dialog = createElement('AdwDialog', { 'can-close': false });
                insert(dialog, parent);
                expect(window.visibleDialog !== null).toBe(true);
                destroy(dialog);
                expect(window.visibleDialog).toBe(null);
            });

            await it('is quiet when it retracts a node it never presented', async () => {
                // `force_close` and not `close`, the second half of the same choice:
                // measured, `close()` on an unpresented dialog is
                // `Adwaita-CRITICAL **: Trying to close … that's not presented` at
                // exit 0. The gate around this describe is what asserts the quiet.
                const dialog = createElement('AdwDialog');
                materialize(dialog);
                const detached = adopt(new Gtk.Box());
                insert(dialog, detached);
                expect(dialog.attached).toBe(false);
                remove(dialog);
                expect(dialog.portalWatch).toBe(null);
            });
        });

        await gated(diagnostics, 'portal placement — the wait for a toplevel', async () => {
            // The defect: every framework builds bottom-up, so at insert time the
            // parent is usually not in a window yet. Measured, presenting against
            // an unrooted parent opens a SEPARATE GtkWindow at exit 0.
            await it('does not present against a parent that is in no window', async () => {
                const box = new Gtk.Box();
                const parent = adopt(box);
                const dialog = createElement('AdwDialog');
                insert(dialog, parent);
                expect(widgetOf(dialog).get_parent()).toBe(null);
                expect(dialog.attached).toBe(false);
                // The subscription is the thing that makes the wait end.
                expect(dialog.portalWatch !== null).toBe(true);
                destroy(dialog);
            });

            await it('presents as soon as the parent joins a toplevel', async () => {
                const box = new Gtk.Box();
                const parent = adopt(box);
                const dialog = createElement('AdwDialog');
                insert(dialog, parent);
                expect(dialog.attached).toBe(false);

                const window = new Adw.Window();
                window.set_content(box);

                expect(dialog.attached).toBe(true);
                expect(widgetOf(dialog).get_root() === window).toBe(true);
                expect(window.visibleDialog !== null).toBe(true);
                destroy(dialog);
            });

            await it('re-hosts when the parent moves to another toplevel', async () => {
                // Measured: unrooting the parent leaves the dialog in the OLD
                // window's host — `w1.visibleDialog` is still the dialog after
                // `w1.set_content(null)` — so without this a modal keeps showing in
                // a window its own subtree has left. And a bare re-present is
                // `Adwaita-CRITICAL **: Cannot present … as it's already presented
                // for …` plus a Gtk-WARNING, with the move NOT happening; the gate
                // on this describe is what holds the close-then-present order.
                const first = new Adw.Window();
                const box = new Gtk.Box();
                first.set_content(box);
                const parent = adopt(box);
                const dialog = createElement('AdwDialog');
                insert(dialog, parent);
                expect(widgetOf(dialog).get_root() === first).toBe(true);

                const second = new Adw.Window();
                first.set_content(null);
                second.set_content(box);

                expect(widgetOf(dialog).get_root() === second).toBe(true);
                expect(first.visibleDialog).toBe(null);
                expect(second.visibleDialog !== null).toBe(true);
                destroy(dialog);
            });

            await it('comes down when the parent leaves its toplevel and no other takes it', async () => {
                // THE OTHER DIRECTION of the wait, and it was missing. A portal is
                // presented exactly when its anchor is in a toplevel; the insert
                // above enforces that going in, this enforces it coming out.
                // MEASURED on libadwaita 1.9.3: `set_content(null)` does NOT take
                // the dialog down — `w1.visibleDialog` is still the dialog — so the
                // sheet kept showing in a window its own subtree had left. Only a
                // re-root repaired it, and a merely detached subtree never re-roots.
                const window = new Adw.Window();
                const box = new Gtk.Box();
                window.set_content(box);
                const parent = adopt(box);
                const dialog = createElement('AdwDialog');
                insert(dialog, parent);
                expect(window.visibleDialog !== null).toBe(true);
                expect(dialog.attached).toBe(true);

                window.set_content(null);

                // Both facts, and the second is the one that was wrong: the host
                // said "GTK has not taken this node" while GTK still had it up.
                expect(window.visibleDialog).toBe(null);
                expect(dialog.attached).toBe(false);
                expect(widgetOf(dialog).get_root()).toBe(null);

                // And the wait is still armed, so a later window still gets it.
                expect(dialog.portalWatch !== null).toBe(true);
                const second = new Adw.Window();
                second.set_content(box);
                expect(dialog.attached).toBe(true);
                expect(second.visibleDialog !== null).toBe(true);
                destroy(dialog);
            });

            await it('drops the subscription when the node is removed', async () => {
                const box = new Gtk.Box();
                const parent = adopt(box);
                const dialog = createElement('AdwDialog');
                insert(dialog, parent);
                remove(dialog);
                expect(dialog.portalWatch).toBe(null);

                // The proof that the disconnect happened rather than the flag being
                // cleared: rooting the box now must present nothing.
                const window = new Adw.Window();
                window.set_content(box);
                expect(window.visibleDialog).toBe(null);
                expect(dialog.attached).toBe(false);
            });
        });

        await gated(diagnostics, 'portal placement — a portal among ordinary siblings', async () => {
            await it('takes no position in the parent’s child list', async () => {
                const { box, parent } = rooted();
                const first = createElement('GtkLabel', { label: 'A' });
                const dialog = createElement('AdwDialog');
                const last = createElement('GtkLabel', { label: 'B' });
                insert(first, parent);
                insert(dialog, parent);
                insert(last, parent);

                expect(gtkChildTypes(box)).toStrictEqual(['GtkLabel', 'GtkLabel']);
                expect(gtkChildren(box).map((w) => (w as Gtk.Label).label)).toStrictEqual(['A', 'B']);
                destroy(dialog);
            });

            await it('does not shift the siblings that follow it', async () => {
                // A portal counted as a sibling would offset every later child by
                // one, and `insert_child_after` would then be handed a widget that
                // is not in this container at all — a critical at exit 0.
                const { box, parent } = rooted();
                const a = createElement('GtkLabel', { label: 'A' });
                const dialog = createElement('AdwDialog');
                const b = createElement('GtkLabel', { label: 'B' });
                const c = createElement('GtkLabel', { label: 'C' });
                insert(a, parent);
                insert(dialog, parent);
                insert(c, parent);
                insert(b, parent, c);

                expect(gtkChildren(box).map((w) => (w as Gtk.Label).label)).toStrictEqual(['A', 'B', 'C']);
                destroy(dialog);
            });

            await it('does not claim a one-child slot it never entered', async () => {
                // `AdwBin` holds ONE child. A portal sibling carries `slot === null`
                // like every unslotted node, so a `holdsOursInSlot` that counted it
                // would report the slot as taken by us and skip the refusal that
                // protects the application's own widget.
                const { parent } = rooted();
                const bin = createElement('AdwBin');
                insert(bin, parent);
                const dialog = createElement('AdwDialog');
                insert(dialog, bin);
                const label = createElement('GtkLabel', { label: 'content' });
                insert(label, bin);
                expect((widgetOf(bin) as unknown as Adw.Bin).get_child() === widgetOf(label)).toBe(true);
                destroy(dialog);
            });
        });

        await gated(diagnostics, 'portal placement — through the adapters, not only through the host', async () => {
            // THE FRAMEWORK-AGNOSTIC CLAIM, MEASURED. The seam is three functions in
            // `policies.ts`, below every adapter, and no adapter file mentions a
            // dialog — but "below" is a claim about a call graph, and a call graph is
            // exactly the kind of thing that reads true and is not. All THREE
            // adapters mount the same tag here and get the same widget in the same
            // window, and they have nothing in common with each other: a reconciler,
            // a compile-time renderer with no VDOM, and `RendererOptions` over a
            // VDOM. Two measured and one assumed is the asymmetry that later reads
            // as coverage, so the adapter that breaks breaks this suite rather than
            // a consumer's window.
            await it('presents from a React tree mounted into a rooted container', async () => {
                const window = new Adw.Window();
                const box = new Gtk.Box();
                window.set_content(box);
                const root = createReactRoot(box);
                try {
                    root.render(
                        reactCreateElement('adw-dialog', {}, reactCreateElement('gtk-label', { label: 'react' })),
                    );
                    expect(gtkChildTypes(box)).toStrictEqual([]);
                    expect(window.visibleDialog !== null).toBe(true);
                    const child = (window.visibleDialog as Adw.Dialog).get_child() as Gtk.Label;
                    expect(child.label).toBe('react');
                } finally {
                    root.unmount();
                }
                // Unmounting the tree takes the sheet with it — the same forced close,
                // reached from a renderer rather than from `destroy` by hand.
                expect(window.visibleDialog).toBe(null);
            });

            await it('presents from a Solid tree mounted into a rooted container', async () => {
                const window = new Adw.Window();
                const box = new Gtk.Box();
                window.set_content(box);
                const dispose = solidMount(() => {
                    const dialog = solidCreateElement('adw-dialog');
                    const label = solidCreateElement('gtk-label');
                    solidSetProp(label, 'label', 'solid');
                    solidInsertNode(dialog, label);
                    return dialog;
                }, box);
                expect(gtkChildTypes(box)).toStrictEqual([]);
                expect(window.visibleDialog !== null).toBe(true);
                expect(((window.visibleDialog as Adw.Dialog).get_child() as Gtk.Label).label).toBe('solid');
                dispose();
                expect(window.visibleDialog).toBe(null);
            });

            await it('presents from a Vue tree mounted into a rooted container', async () => {
                // THE THIRD ADAPTER, and it is not a formality. Two proving a claim
                // about a call graph and one assumed is the asymmetry that later
                // reads as coverage — the same reason `check-vocabulary-alignment`
                // holds every surface that declares itself one rather than a
                // representative pair. Vue reaches the host through
                // `createRenderer`'s `RendererOptions`, which is a third shape again:
                // neither React's reconciler nor Solid's compile-time renderer.
                //
                // The KEBAB spelling on purpose, matching the two vectors above: the
                // registry round-trips camel <-> kebab, and a vector that quietly
                // used `AdwDialog` here would measure a different lookup from the one
                // React and Solid measure and still look like the same claim.
                const window = new Adw.Window();
                const box = new Gtk.Box();
                window.set_content(box);
                const app = vueMount(
                    defineComponent({ render: () => h('adw-dialog', null, [h('gtk-label', { label: 'vue' })]) }),
                    box,
                );
                expect(gtkChildTypes(box)).toStrictEqual([]);
                expect(window.visibleDialog !== null).toBe(true);
                expect(((window.visibleDialog as Adw.Dialog).get_child() as Gtk.Label).label).toBe('vue');
                app.unmount();
                expect(window.visibleDialog).toBe(null);
            });
        });

        await gated(diagnostics, 'portal placement — the ordinary host operations still hold', async () => {
            await it('rebuilds through a construct-only write without losing the dialog', async () => {
                const { window, parent } = rooted();
                const dialog = createElement('AdwDialog');
                insert(dialog, parent);
                const before = widgetOf(dialog);
                // `css-name` is construct-only on every GtkWidget, so this forces
                // the `rebuild` path: remove, re-materialise, re-attach.
                setProp(dialog, 'css-name', 'sheet');
                expect(widgetOf(dialog) === before).toBe(false);
                expect(window.visibleDialog === (widgetOf(dialog) as unknown as Adw.Dialog)).toBe(true);
                destroy(dialog);
                expect(window.visibleDialog).toBe(null);
            });

            await it('moves between two parents in the same window', async () => {
                const { window, box } = rooted();
                const left = new Gtk.Box();
                const right = new Gtk.Box();
                box.append(left);
                box.append(right);
                const dialog = createElement('AdwDialog');
                insert(dialog, adopt(left));
                expect(window.visibleDialog !== null).toBe(true);
                insert(dialog, adopt(right));
                expect(window.visibleDialog === (widgetOf(dialog) as unknown as Adw.Dialog)).toBe(true);
                expect(gtkChildTypes(right)).toStrictEqual([]);
                destroy(dialog);
            });
        });
    });
};
