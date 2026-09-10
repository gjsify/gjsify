// The placement axis — ADR 0045 (the portal arm) and ADR 0054 (the toplevel arm,
// the structural refusal, and the child-process control at the bottom of the file).
//
// EVERY VECTOR HERE ROOTS ITS PARENT IN A WINDOW, and that is not a detail of the
// fixture. The defect this seam exists for is `g_error()` inside
// `adw_dialog_root()`, which only runs when a widget joins a tree whose root is a
// `Gtk.Window`; a DETACHED box accepts `box.append(dialog)` in silence at exit 0
// (measured), so a suite built on bare boxes would report the seam works and would
// have proved nothing. `rooted()` below is the only fixture, for that reason.
//
// THE ABORT IS NOT ASSERTED IN-PROCESS, AND IT IS NOT LEFT UNASSERTED EITHER. It is
// SIGABRT with a core dump, so a case that triggers it takes the runner with it —
// which means an in-process "it did not abort" proves only that this run is still
// alive, never that the harness could have SEEN an abort at all. The discriminator
// is the last describe in this file: child processes, one running the raw append
// this seam replaces and one running the placement GTK really has, with their exit
// SIGNALS read. Everything in between asserts that the host takes the second route.

import { expect, it, on } from '@gjsify/unit';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { descriptorProblems, gtkChildTypes, gtkChildren, installDiagnosticsGate } from './conformance/index.js';
import { BUILTIN_DESCRIPTORS, registerBuiltinWidgets } from './descriptors/index.js';
import { GtkHostError } from './errors.js';
import { adopt, createElement, destroy, insert, materialize, remove, setProp } from './host.js';
import { isPortal, isUnparented, outsideParentOf, placementOf, portalOf } from './policies.js';
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

/** POSIX signal 6. Spelled once, so the assertion below reads as the name it means. */
const SIGABRT = 6;

/**
 * The interpreter the child cases need, or null.
 *
 * A LOOKUP RATHER THAN AN ASSUMPTION, because this suite is ONE program across two
 * legs (ADR 0030): `test:gjs` runs it under gjs, `test:gjs-on-node` runs the same
 * corpus under node-gi, and the second host is not obliged to carry a gjs binary.
 * That is a precondition genuinely outside this package, which is what
 * `it.failing`'s `when` is for — the cases RUN and are red the day a host that has
 * gjs stops reproducing the abort.
 */
const GJS = GLib.find_program_in_path('gjs');
/**
 * An argv prefix that keeps the abort and drops the 2.8 MB it writes.
 *
 * THE SIGNAL IS THE ASSERTION AND THE CORE FILE IS THE COST. Measured on this
 * machine: the raw case writes a `gjs-console` SIGABRT dump of 2.8 MB on every run
 * of this suite, and CI pays it on every run too. Under `prlimit --core=0` the very
 * same spawn still answers `signalled=true, term=6` with `Adwaita-ERROR` on stderr,
 * and `coredumpctl` lists the abort with `COREFILE: none` — the two rows sit next
 * to each other in one run, which is the control for the claim.
 *
 * AN ARGV PREFIX AND NOT A SHELL: `prlimit` execs the program, so `waitpid` still
 * reports the CHILD's signal rather than a shell's `128 + n` exit code, and there
 * is no command line to interpolate a path into.
 *
 * PROBED, because `prlimit` is util-linux and this suite also runs on darwin and
 * win32 (`gtk-os-suites.yml`). A host without it spawns exactly as before and the
 * vectors assert exactly the same things — it only pays the dump. That is a
 * capability probe on an external tool, not a platform guard on a test.
 */
const CORE_FREE = GLib.find_program_in_path('prlimit');

interface ChildOutcome {
    /** True when the child was killed by a signal rather than exiting. */
    signalled: boolean;
    /** The signal that killed it, or -1. */
    termSig: number;
    /** Its exit status, or -1 when it was signalled. */
    exitStatus: number;
    stdout: string;
    stderr: string;
}

/**
 * Run GTK code in its OWN process and report how that process ended.
 *
 * WHY A CHILD AT ALL. `g_error()` is SIGABRT: it takes the calling process down
 * with a core dump, past every `try`, past `installDiagnosticsGate()`, past the
 * test runner. So the abort cannot be asserted where it happens — and an
 * in-process suite that merely FINISHES proves only that this run is alive, not
 * that the harness could have seen the abort at all. Reading the child's exit
 * SIGNAL is what turns "did not abort" into a falsifiable claim.
 *
 * The snippet is spliced into a fixed preamble rather than being a whole file, so
 * a case reads as the three or four GTK calls it is about.
 */
function runInChild(body: string): ChildOutcome {
    const source = `import Adw from 'gi://Adw?version=1';\nimport Gtk from 'gi://Gtk?version=4.0';\nGtk.init();\n${body}\n`;
    // A DIRECTORY rather than `GLib.file_open_tmp`, which hands back an open file
    // DESCRIPTOR that GJS gives no way to close — one leaked fd per case.
    const dir = GLib.Dir.make_tmp('gjsify-placement-XXXXXX');
    const path = `${dir}/case.js`;
    GLib.file_set_contents(path, new TextEncoder().encode(source));
    try {
        const run = [GJS as string, '-m', path];
        const proc = Gio.Subprocess.new(
            CORE_FREE ? [CORE_FREE, '--core=0', ...run] : run,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        );
        const [, stdout, stderr] = proc.communicate_utf8(null, null);
        const signalled = proc.get_if_signaled();
        return {
            signalled,
            // ASKED ONLY WHEN IT APPLIES: `g_subprocess_get_term_sig` and
            // `get_exit_status` each assert on the other case, so reading both
            // unconditionally answers a critical at exit 0 — which is precisely the
            // class this suite is about.
            termSig: signalled ? proc.get_term_sig() : -1,
            exitStatus: signalled ? -1 : proc.get_exit_status(),
            stdout: stdout ?? '',
            stderr: stderr ?? '',
        };
    } finally {
        GLib.unlink(path);
        GLib.rmdir(dir);
    }
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
                    expect((caught as GtkHostError)?.code).toBe('placement-method-missing');
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

            // ... and the other way round, which is the half that did not exist
            // while `portal` was the only non-parented kind. A one-argument
            // `present` declared as a toplevel would be called with nothing.
            await it('refuses a present() that DOES take a parent as a toplevel', async () => {
                const dialog: WidgetDescriptor = {
                    gtype: 'AdwDialog',
                    ctor: () => Adw.Dialog as never,
                    children: { kind: 'single', set: 'set_child' },
                    placement: { kind: 'toplevel', present: 'present', close: 'force_close' },
                };
                const problems = descriptorProblems([dialog]).map((p) => p.problem);
                expect(problems.some((p) => p.includes('takes 1 argument(s)'))).toBe(true);
                expect(problems.some((p) => p.includes('a toplevel is presented with exactly 0'))).toBe(true);
            });

            await it('names present and destroy on the toplevel family', async () => {
                expect(placementOf(lookupWidget('GtkWindow'))).toStrictEqual({
                    kind: 'toplevel',
                    present: 'present',
                    close: 'destroy',
                });
                // The libadwaita half of the same declaration, and the row that is
                // easiest to file on the wrong side: `AdwMessageDialog` reads like
                // the dialog family and IS a `GtkWindow`.
                expect(placementOf(lookupWidget('AdwMessageDialog'))).toStrictEqual({
                    kind: 'toplevel',
                    present: 'present',
                    close: 'destroy',
                });
                expect(portalOf(lookupWidget('AdwMessageDialog'))).toBe(null);
                expect(isUnparented(createElement('GtkWindow'))).toBe(true);
                expect(isPortal(createElement('GtkWindow'))).toBe(false);
                expect(isUnparented(createElement('GtkBox'))).toBe(false);
            });

            // THE MECHANISM for the toplevel arm, and the twin of the walk above.
            // Registration is exact, so a `Gtk.Root` the curated table forgets is a
            // tag that GTK accepts into a child list at exit 0 — a root with a
            // parent, drawn twice and measured by a container. This fails the day
            // GTK ships a twentieth one.
            await it('is declared by every registered Gtk.Root that can present itself', async () => {
                const roots: string[] = [];
                const undeclared: string[] = [];
                const unpresentable: string[] = [];
                for (const d of BUILTIN_DESCRIPTORS) {
                    const Klass = d.ctor() as unknown as { $gtype?: GObject.GType; prototype?: object } | undefined;
                    if (!Klass?.$gtype) continue;
                    if (!GObject.type_is_a(Klass.$gtype, Gtk.Root.$gtype)) continue;
                    roots.push(d.gtype);
                    if (typeof (Klass.prototype as Record<string, unknown>).present !== 'function') {
                        unpresentable.push(d.gtype);
                        continue;
                    }
                    if (outsideParentOf(d)?.kind !== 'toplevel') undeclared.push(d.gtype);
                }
                expect(undeclared).toStrictEqual([]);
                // MEASURED, and named rather than counted: `GtkDragIcon` is the one
                // `Gtk.Root` in the table with no `present`, no `close` and no
                // `destroy` — GTK builds one for a drag operation and nothing else
                // shows one — so it cannot carry the declaration and is refused at
                // the insert instead. A second name appearing here is a new case to
                // decide, not a number to bump.
                expect(unpresentable).toStrictEqual(['GtkDragIcon']);
                // The population, for the same reason the dialog walk asserts its
                // own: an empty walk satisfies both lines above while checking
                // nothing.
                expect(roots.includes('GtkWindow')).toBe(true);
                expect(roots.includes('AdwApplicationWindow')).toBe(true);
                expect(roots.length >= 19).toBe(true);
            });

            // THE CHECK THAT MAKES THE ABSENCE VISIBLE, which is the direction the
            // whole class arrived through: every other check in `descriptorProblems`
            // holds a WRITTEN claim against the class, and nothing held the class
            // against a descriptor that claims nothing.
            await it('reports a class that demands a placement and declares none', async () => {
                const silentWindow: WidgetDescriptor = {
                    gtype: 'GtkWindow',
                    ctor: () => Gtk.Window as never,
                    children: { kind: 'single', set: 'set_child' },
                };
                const silentDialog: WidgetDescriptor = {
                    gtype: 'AdwDialog',
                    ctor: () => Adw.Dialog as never,
                    children: { kind: 'single', set: 'set_child' },
                };
                expect(descriptorProblems([silentWindow])[0]?.problem).toMatch(
                    /implements Gtk\.Root and declares no placement/,
                );
                expect(descriptorProblems([silentDialog])[0]?.problem).toMatch(/aborts the process/);
                // That the SHIPPED table produces none of these is asserted where
                // every other descriptor problem is — `every declared method and
                // text sink exists` in conformance.spec.ts, which reads the same
                // list. A second copy here would be a second place to update.
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

            await it('survives the same remove-then-insert MOVE, because its close is reversible', async () => {
                // THE OTHER HALF OF THE PAIR, and the reason this arm never showed
                // the defect its neighbour shipped with: measured, `force_close()`
                // followed by `present(parent)` re-hosts against the SAME parent
                // with no diagnostic, where `destroy()` followed by `present()` is
                // `Gtk-WARNING **: A window is shown after it has been destroyed`.
                // Asserting it here is what keeps "the arms differ in reversibility"
                // a measurement rather than a sentence in an ADR.
                const first = rooted();
                const second = rooted();
                const dialog = createElement('AdwDialog');
                insert(dialog, first.parent);
                expect(first.window.visibleDialog !== null).toBe(true);

                remove(dialog);
                expect(first.window.visibleDialog).toBe(null);

                insert(dialog, second.parent);
                expect(second.window.visibleDialog === (widgetOf(dialog) as unknown as Adw.Dialog)).toBe(true);
                destroy(dialog);
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

        await gated(diagnostics, 'toplevel placement — a Gtk.Root through the host', async () => {
            await it('presents as its own window and enters no child list', async () => {
                const { parent, box } = rooted();
                const win = createElement('GtkWindow');
                insert(win, parent);

                // THE QUIET HALF OF THE CLASS, closed. MEASURED without the seam:
                // `box.append(new Gtk.Window())` on this exact tree is exit 0, with
                // `win.get_parent()` the box and `win.get_root()` the window ITSELF
                // — a root with a parent, drawn as a toplevel AND measured by the
                // container. Nothing in GTK says a word about it.
                expect(gtkChildTypes(box)).toStrictEqual([]);
                const widget = widgetOf(win) as unknown as Gtk.Window;
                expect(widget.get_parent()).toBe(null);
                expect(widget.get_root() === widget).toBe(true);
                expect(win.attached).toBe(true);
                destroy(win);
            });

            await it('takes its own children through the ordinary one-child slot', async () => {
                const { parent } = rooted();
                const win = createElement('GtkWindow');
                const label = createElement('GtkLabel', { label: 'inside' });
                insert(label, win);
                insert(win, parent);
                expect((widgetOf(win) as unknown as Gtk.Window).get_child() === widgetOf(label)).toBe(true);
                destroy(win);
            });

            await it('honours an authored visible: false instead of overruling it', async () => {
                // `present()` sets the window visible (measured), so presenting
                // unconditionally would make this property a silent no-op — the
                // shape this host exists to refuse. `attached` stays true because
                // GTK holds a root whether or not it is on screen.
                const { parent } = rooted();
                const win = createElement('GtkWindow', { visible: false });
                insert(win, parent);
                expect((widgetOf(win) as unknown as Gtk.Window).get_visible()).toBe(false);
                expect(win.attached).toBe(true);
                // And the ordinary property path still shows it, so the node is not
                // stranded by the decision above.
                setProp(win, 'visible', true);
                expect((widgetOf(win) as unknown as Gtk.Window).get_visible()).toBe(true);
                destroy(win);
            });

            await it('survives the MOVE that remove() documents itself as', async () => {
                // `remove` promises a DETACH: "Frameworks move nodes; `remove` must
                // not destroy one". Running the declared close there — which for
                // this arm is `destroy()`, measured terminal — made a move present
                // the corpse: `Gtk-WARNING **: A window is shown after it has been
                // destroyed`, at exit 0, caught only because the gate was watching.
                // Solid's `removeNode` calls `remove(node)` directly, so this is the
                // ordinary reorder path and not an edge case.
                const first = rooted();
                const second = rooted();
                const win = createElement('GtkWindow');
                insert(win, first.parent);
                const widget = widgetOf(win) as unknown as Gtk.Window;
                expect(widget.get_visible()).toBe(true);

                remove(win);
                expect(widget.get_visible()).toBe(false);
                // A DETACH AND NOT A TEARDOWN, and the toplevel list is what tells
                // them apart: measured, a hidden window is still in it and a
                // destroyed one is not.
                expect(Gtk.Window.list_toplevels().includes(widget)).toBe(true);

                insert(win, second.parent);
                expect(widgetOf(win) === widget).toBe(true);
                expect(widget.get_visible()).toBe(true);
                destroy(win);
            });

            await it('runs the declared retraction ONCE across remove() then destroy()', async () => {
                // The other order of the defect the node leg found. `remove` unlinks
                // the node, so the `destroy` after it sees `parent === null` and
                // takes the no-parent arm — which used to be the terminal one, so it
                // fired twice. The `unmap` count cannot see that (the second call is
                // on an already-hidden window), which is why this counts the CALL.
                const { parent } = rooted();
                const win = createElement('GtkWindow');
                insert(win, parent);
                const widget = widgetOf(win) as unknown as Gtk.Window;
                let retractions = 0;
                const realDestroy = (widget.destroy as () => void).bind(widget);
                (widget as unknown as Record<string, unknown>).destroy = () => {
                    retractions += 1;
                    realDestroy();
                };
                remove(win);
                destroy(win);
                expect(retractions).toBe(1);
                expect(Gtk.Window.list_toplevels().includes(widget)).toBe(false);
            });

            await it('destroy uses the FORCED call, where remove used the reversible one', async () => {
                // `destroy` and not `close`: MEASURED on GTK 4.22.4, a
                // `close-request` handler returning true leaves `close()`'s window
                // mapped and visible. An unmount is not a user request, which is the
                // same choice the portal arm makes with `force_close`.
                const { parent } = rooted();
                const win = createElement('GtkWindow');
                insert(win, parent);
                const widget = widgetOf(win) as unknown as Gtk.Window;
                let vetoed = 0;
                let unmapped = 0;
                widget.connect('close-request', () => {
                    vetoed += 1;
                    return true;
                });
                widget.connect('unmap', () => {
                    unmapped += 1;
                });

                // The POSITIVE CONTROL, and without it the assertion below cannot
                // tell the forced call from the conditional one: the veto has to be
                // shown to work before its absence means anything. Measured,
                // `close()` here emits `close-request`, the handler stops it, and
                // the window stays visible.
                widget.close();
                expect(vetoed).toBe(1);
                expect(unmapped).toBe(0);
                expect(widget.get_visible()).toBe(true);

                destroy(win);

                // THE EFFECT, NOT THE STATE. Measured, the hide emits `unmap` once,
                // the `destroy()` after it adds none, and neither asks
                // `close-request`. Reading a property back off the widget afterwards
                // is what a vector must NOT do here: on gjs the wrapper keeps the
                // object alive and answers `false`, and on node-gi
                // `gtk_window_destroy()` drops GTK's reference and the same read is
                // `TypeError: invalid GObject handle` — a divergence the node leg
                // found and `status/open-todos.md` carries. The toplevel list is
                // read off `Gtk.Window`, not off the corpse.
                expect(unmapped).toBe(1);
                expect(vetoed).toBe(1);
                expect(Gtk.Window.list_toplevels().includes(widget)).toBe(false);
            });

            await it('comes down even when it never had a parent to be removed from', async () => {
                // The asymmetry a toplevel introduces: `removeChild` is reached
                // through a PARENT, and a window may never have had one. Before
                // this, `destroy` closed that gap with a `widget.destroy()` of its
                // own — so a toplevel WITH a parent was retracted twice, which gjs
                // swallows and node-gi answers with an invalid handle.
                const win = createElement('GtkWindow');
                const widget = widgetOf(win) as unknown as Gtk.Window;
                let unmapped = 0;
                widget.connect('unmap', () => {
                    unmapped += 1;
                });
                widget.present();
                expect(widget.get_visible()).toBe(true);
                destroy(win);
                expect(unmapped).toBe(1);
                expect(Gtk.Window.list_toplevels().includes(widget)).toBe(false);
            });

            await it('rebuilds through a construct-only write without leaking the old window', async () => {
                // `rebuild` DISCARDS `el.widget`, which is the one caller of
                // `removeChild` that wants the terminal call rather than the
                // reversible one — a toplevel is held by GTK's own list, not by a
                // parent, so a detach there leaks a hidden window per write.
                const { parent } = rooted();
                const win = createElement('GtkWindow');
                insert(win, parent);
                const before = widgetOf(win) as unknown as Gtk.Window;
                const toplevelsBefore = Gtk.Window.list_toplevels().length;
                // `css-name` is construct-only on every GtkWidget.
                setProp(win, 'css-name', 'secondary');
                const after = widgetOf(win) as unknown as Gtk.Window;
                expect(after === before).toBe(false);
                expect(Gtk.Window.list_toplevels().includes(before)).toBe(false);
                expect(Gtk.Window.list_toplevels().length).toBe(toplevelsBefore);
                expect(after.get_visible()).toBe(true);
                destroy(win);
            });

            await it('does not shift the siblings that follow it', async () => {
                // The same four sibling walks the portal arm needed, now reached by a
                // second kind: counting a toplevel offsets every later child by one
                // and `insert_child_after` is then handed a widget that is not in
                // this container at all.
                const { box, parent } = rooted();
                const a = createElement('GtkLabel', { label: 'A' });
                const win = createElement('GtkWindow');
                const b = createElement('GtkLabel', { label: 'B' });
                const c = createElement('GtkLabel', { label: 'C' });
                insert(a, parent);
                insert(win, parent);
                insert(c, parent);
                insert(b, parent, c);

                expect(gtkChildTypes(box)).toStrictEqual(['GtkLabel', 'GtkLabel', 'GtkLabel']);
                expect(gtkChildren(box).map((w) => (w as Gtk.Label).label)).toStrictEqual(['A', 'B', 'C']);
                destroy(win);
            });

            await it('does not claim a one-child slot it never entered', async () => {
                const { parent } = rooted();
                const bin = createElement('AdwBin');
                insert(bin, parent);
                const win = createElement('GtkWindow');
                insert(win, bin);
                const label = createElement('GtkLabel', { label: 'content' });
                insert(label, bin);
                expect((widgetOf(bin) as unknown as Adw.Bin).get_child() === widgetOf(label)).toBe(true);
                destroy(win);
            });

            await it('presents from a React tree mounted into a rooted container', async () => {
                // The framework-agnostic claim again, for the second arm. One
                // adapter is enough here where the portal arm needed three: what
                // three proved is that the seam sits BELOW every adapter, and this
                // arm enters through the identical two functions in `policies.ts`.
                const window = new Adw.Window();
                const box = new Gtk.Box();
                window.set_content(box);
                const root = createReactRoot(box);
                try {
                    root.render(reactCreateElement('gtk-window', {}, reactCreateElement('gtk-label', { label: 'rn' })));
                    expect(gtkChildTypes(box)).toStrictEqual([]);
                } finally {
                    root.unmount();
                }
            });
        });

        await gated(diagnostics, 'the refusal that replaces the abort', async () => {
            // `descriptorProblems()` says the same thing about the shipped TABLE up
            // front. These are about `registerWidget`, which takes descriptors from
            // applications and is checked by nobody — and for the dialog family the
            // consequence of not checking is not a wrong window but a dead process.
            const withoutPlacement = (gtype: string, ctor: () => unknown): WidgetDescriptor => ({
                gtype,
                ctor: ctor as never,
                children: { kind: 'single', set: 'set_child' },
            });

            const refusalFor = (gtype: string, ctor: () => unknown): GtkHostError | undefined => {
                registerWidget(withoutPlacement(gtype, ctor));
                try {
                    const { parent } = rooted();
                    const child = createElement(gtype);
                    try {
                        insert(child, parent);
                    } catch (error) {
                        return error as GtkHostError;
                    }
                    return undefined;
                } finally {
                    registerWidgets(BUILTIN_DESCRIPTORS);
                }
            };

            await it('refuses an application-registered dialog BEFORE the adder runs', async () => {
                // THE ONE CASE IN THIS FILE WHERE FAILING IS NOT A RED TEST. Without
                // the refusal this line reaches `box.append(dialog)` on a rooted box,
                // which is `g_error()` — the runner dies with SIGABRT and this suite
                // reports nothing at all. The child process in the next describe is
                // what makes that difference observable rather than assumed.
                const error = refusalFor('AdwDialog', () => Adw.Dialog);
                expect(error?.code).toBe('unparentable-child');
                expect(error?.message).toMatch(/AdwDialog\.present\(\) takes a parent/);
                expect(error?.message).toMatch(/kind: 'portal'/);
            });

            await it('refuses an application-registered toplevel, which GTK would take in silence', async () => {
                const error = refusalFor('GtkWindow', () => Gtk.Window);
                expect(error?.code).toBe('unparentable-child');
                expect(error?.message).toMatch(/implements Gtk\.Root/);
                expect(error?.message).toMatch(/kind: 'toplevel'/);
            });

            await it('refuses the one Gtk.Root that cannot present itself', async () => {
                // `GtkDragIcon` is in the shipped table, is a `Gtk.Root`, and has no
                // `present`/`close`/`destroy` at all (measured), so it carries no
                // placement — the refusal is its whole answer, and this is what says
                // the two mechanisms cover the class between them rather than each
                // covering half of it.
                const { parent } = rooted();
                const icon = createElement('GtkDragIcon');
                let caught: unknown;
                try {
                    insert(icon, parent);
                } catch (error) {
                    caught = error;
                }
                expect((caught as GtkHostError)?.code).toBe('unparentable-child');
                expect((caught as GtkHostError)?.message).toMatch(/implements Gtk\.Root/);
            });

            await it('lets an explicit parented placement through, because the oracle is not the author', async () => {
                // THE ESCAPE HATCH, and it is measured on the SILENT half on purpose:
                // a consumer whose own widget trips the structural oracle while
                // really being a child needs a way back, and demonstrating it with a
                // dialog would abort this process rather than document anything.
                registerWidget({
                    gtype: 'GtkWindow',
                    ctor: () => Gtk.Window as never,
                    children: { kind: 'single', set: 'set_child' },
                    placement: { kind: 'parented' },
                });
                try {
                    const { parent, box } = rooted();
                    const win = createElement('GtkWindow');
                    insert(win, parent);
                    expect(gtkChildTypes(box)).toStrictEqual(['GtkWindow']);
                    remove(win);
                } finally {
                    registerWidgets(BUILTIN_DESCRIPTORS);
                }
            });
        });

        // THE DISCRIMINATOR. Everything above runs in THIS process, and a process
        // that aborts reports nothing — so "the host no longer aborts" is a claim no
        // in-process assertion can make. These two cases run the same GTK calls in a
        // CHILD and read how it died.
        await gated(diagnostics, 'the abort is real, and the placement avoids it', async () => {
            await it.failing(
                'kills a child process with SIGABRT on the raw append the seam replaces',
                async () => {
                    const outcome = runInChild(`
                        const outer = new Adw.Window();
                        const box = new Gtk.Box();
                        outer.set_content(box);
                        box.append(new Adw.Dialog());
                        print('SURVIVED');
                    `);
                    // The NEGATIVE CONTROL: without this line passing, every "does
                    // not abort" in this file is unfalsifiable — a harness that
                    // cannot see an abort reports the same green either way.
                    expect(outcome.signalled).toBe(true);
                    expect(outcome.termSig).toBe(SIGABRT);
                    expect(outcome.stderr).toMatch(/Adwaita-ERROR/);
                    expect(outcome.stdout.includes('SURVIVED')).toBe(false);
                },
                'needs a gjs interpreter on PATH to run the case in its own process',
                { when: GJS === null },
            );

            await it.failing(
                'exits 0 on the placement the host uses instead',
                async () => {
                    // The same intent, expressed the way `presentPortal` expresses
                    // it. Same process shape, same fixture, opposite outcome — which
                    // is what makes the row above a control rather than a lone fact.
                    const outcome = runInChild(`
                        const outer = new Adw.Window();
                        const box = new Gtk.Box();
                        outer.set_content(box);
                        const dialog = new Adw.Dialog();
                        dialog.present(box);
                        print('parent=' + (dialog.get_parent() !== null) + ' visibleDialog=' + (outer.visibleDialog === dialog));
                    `);
                    expect(outcome.signalled).toBe(false);
                    expect(outcome.exitStatus).toBe(0);
                    expect(outcome.stdout).toMatch(/parent=true visibleDialog=true/);
                },
                'needs a gjs interpreter on PATH to run the case in its own process',
                { when: GJS === null },
            );

            await it.failing(
                'shows the toplevel half is a silent accept rather than a second abort',
                async () => {
                    // Case K of ADR 0045, re-measured here because the fix for it is
                    // in this PR: the neighbour does NOT abort, which is exactly why
                    // it survived a seam built only for the loud one.
                    const outcome = runInChild(`
                        const outer = new Adw.Window();
                        const box = new Gtk.Box();
                        outer.set_content(box);
                        const win = new Gtk.Window();
                        box.append(win);
                        print('parent=' + (win.get_parent() === box) + ' rootIsSelf=' + (win.get_root() === win));
                    `);
                    expect(outcome.signalled).toBe(false);
                    expect(outcome.exitStatus).toBe(0);
                    expect(outcome.stdout).toMatch(/parent=true rootIsSelf=true/);
                    expect(outcome.stderr).toBe('');
                },
                'needs a gjs interpreter on PATH to run the case in its own process',
                { when: GJS === null },
            );
        });
    });
};
