// Why the descriptor table exists — asserted against the toolkit rather than argued.
//
// ADR 0027, this package's README, `types.ts` and `policies.ts` all justified the
// curated table with the same sentence: GTK4 deleted `GtkContainer`, and
// `Gtk.Buildable.add_child` "is introspected as a vfunc only, so it is not an escape
// hatch either". The first half is true. **The conclusion was wrong**, and it stood in
// four places for as long as the table has existed.
//
// `vfunc_add_child` is callable from GJS and dispatches correctly. Two React-for-GJS
// projects were found building on exactly that: `peachy` routes every insertion through
// it, and its whole widget table is one `Gtk.Buildable` entry.
//
// So the honest justification is narrower, and it is what this file pins: the generic
// call is REAL but UNSAFE AS A DEFAULT. It accepts what a table refuses, and GTK's
// failure mode for the difference is exit 0.
//
// The rows below are therefore not a wish list. Each one is a fact the table is paid
// for, and if GTK ever starts refusing these, the table could be simplified — which is
// the day this suite should go red and tell somebody.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import { describe, expect, on } from '@gjsify/unit';

import { installDiagnosticsGate } from './conformance/index.js';
import { gated } from './testing/gate.mjs';

export default async () => {
    // GJS only, and `Gtk.init()` before any widget: these rows construct real
    // containers, and an uninitialised GTK aborts the process rather than throwing.
    await on('Gjs', async () => {
        Gtk.init();
        await describe('Gtk.Buildable — what the generic adder really does', async () => {
            // Every row asserts against real widgets, so a GTK critical raised by one
            // of them has to fail its own row rather than the next one.
            const diagnostics = installDiagnosticsGate();
            await gated(diagnostics, 'the vfunc form is callable, which the docs used to deny', async () => {
                // The introspection fact everyone quotes: the plain name is absent — and
                // `@girs/*` does not declare it either, which is the same fact seen from the
                // type side, hence the cast rather than a property access.
                const header = new Adw.HeaderBar() as unknown as Record<string, unknown>;
                expect(typeof header.add_child).toBe('undefined');
                // The part that was missing: the vfunc form is not.
                expect(typeof new Adw.HeaderBar().vfunc_add_child).toBe('function');
                expect(typeof new Gtk.Box().vfunc_add_child).toBe('function');
            });

            await gated(diagnostics, 'and it places correctly, including the slotted containers', async () => {
                // If this row ever fails, the paragraph above is wrong again and the
                // curated slot tables in `descriptors/adw.ts` are the only route left.
                const builder = Gtk.Builder.new();

                const box = new Gtk.Box();
                const boxChild = new Gtk.Label({ label: 'x' });
                box.vfunc_add_child(builder, boxChild, null);
                expect(boxChild.get_parent()).toBe(box);

                const header = new Adw.HeaderBar();
                const title = new Gtk.Label({ label: 't' });
                header.vfunc_add_child(builder, title, 'title');
                expect(header.get_title_widget()).toBe(title);

                const list = new Gtk.ListBox();
                list.vfunc_add_child(builder, new Gtk.Label({ label: 'r' }), null);
                // GTK wraps the child in a row exactly as `insert()` would.
                expect(list.get_row_at_index(0) === null).toBe(false);
            });

            await gated(diagnostics, 'a CHILDLESS widget accepts a child and says nothing', async () => {
                // THE ROW THAT PAYS FOR THE TABLE.
                //
                // `Gtk.Label` holds no children. The generic adder does not refuse it —
                // it falls through to `gtk_widget_set_parent`, and the only diagnostic
                // arrives at teardown as `Finalizing GtkLabel …, but it still has children
                // left`, long after the frame that caused it, with exit code 0.
                //
                // `registry`'s `uncurated` refusal is what turns that into an error naming
                // the tag, at the call that made it.
                const label = new Gtk.Label({ label: 'parent' });
                const orphan = new Gtk.Label({ label: 'child' });
                label.vfunc_add_child(Gtk.Builder.new(), orphan, null);

                expect(orphan.get_parent()).toBe(label);

                // Undo it, or the teardown warning lands in whichever test runs last and
                // reads as that test's fault.
                orphan.unparent();
            });

            await gated(diagnostics, 'a keyed container loses the name the key is read from', async () => {
                // `GtkStack` is why `{ kind: 'keyed' }` names its adder: the generic call
                // adds the page but leaves `page.name` null, so `visible-child-name` —
                // the whole point of a stack — addresses nothing.
                const stack = new Gtk.Stack();
                const child = new Gtk.Label({ label: 's' });
                stack.vfunc_add_child(Gtk.Builder.new(), child, null);

                const page = stack.get_page(child);
                expect(page === null).toBe(false);
                expect(page.name).toBe(null);

                // And it is recoverable, which is why `keyed` can be a policy rather than
                // a special case: naming the page afterwards makes the lookup work.
                page.name = 'first';
                expect(stack.get_child_by_name('first')).toBe(child);
            });
        });
    });
};
