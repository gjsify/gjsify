// GTK's ARIA surface, against the GTK that is actually installed.
//
// The adapter vectors in `conformance/vectors.mts` drive the same surface through Vue,
// React and Solid, and they are what proves a framework can reach it. This suite holds the
// refusals a framework cannot reach — a tag that is not a `Gtk.Accessible` cannot be
// mounted as a child at all — and the WITNESS every one of them exists for: a mis-typed
// write that GTK takes, logs a critical for, and still reports as SET.

import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { expect, it, on } from '@gjsify/unit';

import { planAccessibility } from './accessibility.js';
import { installDiagnosticsGate, withAtContext } from './conformance/index.js';
import { registerBuiltinWidgets } from './descriptors/index.js';
import { ARIA_SLOTS } from './generated/accessibility.js';
import { createElement, materialize, setProp } from './host.js';
import { GTK_HOSTS, gated } from './testing/gate.mjs';
import { codeOf } from './testing/refusal.mjs';

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        registerBuiltinWidgets();

        const diagnostics = installDiagnosticsGate();

        await gated(diagnostics, 'the process has an accessibility tree to write into', async () => {
            await it('installs an AT context backend, and a fresh widget really gets one', async () => {
                // THE PRECONDITION EVERY VECTOR BELOW RESTS ON, asserted once and by name.
                // `gtk_accessible_update_*` writes into the widget's `GtkATContext` and
                // `gtk_test_accessible_has_*` reads back out of it; with `GTK_A11Y=none`
                // there is no context, so the writes record nothing, the reads answer
                // false, and NOTHING IS LOGGED. Six vectors went red on exactly that, on
                // the three legs that set it — a shape that reads as a runtime defect and
                // is an env var. `src/test.mts` calls `installAccessibilityBackend()`.
                //
                // BOTH HALVES, because either alone is satisfiable while the other is not:
                // the variable can hold `test` while the answer was already cached as
                // `null` (GTK reads it once, at the first `get_at_context()`), and a
                // desktop supplies a context through `GtkAtSpiContext` with the variable
                // unset — which is why this asserts the CONTEXT and only reports the name.
                expect(GLib.getenv('GTK_A11Y')).toBe('test');
                expect(new Gtk.Label({}).get_at_context() !== null).toBe(true);
            });

            await it('refuses a widget that has none, rather than reading false off it', async () => {
                // The guard's own red half — it cannot be measured by switching GTK's
                // backend off mid-process (the answer is cached for the process's life),
                // so it is measured on the branch itself. Without this, `withAtContext`
                // could be an identity function and every call site would still be green
                // here and silent in the one environment it exists for.
                const contextless = { get_at_context: () => null } as unknown as Gtk.Label;
                expect(() => withAtContext(contextless)).toThrow('has no GtkATContext');
                // NOT a `GtkHostError`, deliberately: this is the harness saying the
                // environment cannot answer, and a refusal code here would let it be read
                // as the host refusing the authored object — the opposite finding.
                expect(codeOf(() => withAtContext(contextless)).startsWith('not-a-GtkHostError')).toBe(true);
                // …and it hands back the widget it was given, so wrapping a call site
                // cannot quietly change what that call site asserts against.
                const real = new Gtk.Label({});
                expect(withAtContext(real) === real).toBe(true);
            });
        });

        await gated(diagnostics, 'accessibility reaches the three GTK calls', async () => {
            await it('writes a property, a state and a relation in one object', async () => {
                // One authored object, three tables, three calls. `row-index` is a RELATION
                // that carries an integer rather than a reference, which is why the relation
                // table is reachable at all while `labelled-by` is not.
                const el = createElement('gtk-label', {
                    label: 'row',
                    accessibility: { description: 'the third row', busy: true, 'row-index': 3 },
                });
                const widget = withAtContext(materialize(el) as Gtk.Label);
                expect(Gtk.test_accessible_has_property(widget, Gtk.AccessibleProperty.DESCRIPTION)).toBe(true);
                expect(Gtk.test_accessible_has_state(widget, Gtk.AccessibleState.BUSY)).toBe(true);
                expect(Gtk.test_accessible_has_relation(widget, Gtk.AccessibleRelation.ROW_INDEX)).toBe(true);
            });

            await it('survives the rebuild a construct-only write forces', async () => {
                // `el.accessibility` is not in `el.props`, so construction does not carry it
                // and `replayInto` has to. A construct-only property is the one thing that
                // discards the widget and builds a second one from the same authored intent.
                const el = createElement('gtk-label', { accessibility: { description: 'kept' } });
                const first = withAtContext(materialize(el) as Gtk.Label);
                expect(Gtk.test_accessible_has_property(first, Gtk.AccessibleProperty.DESCRIPTION)).toBe(true);
                setProp(el, 'cssName', 'relabelled');
                const second = withAtContext(el.widget as Gtk.Label);
                expect(second === first).toBe(false);
                expect(Gtk.test_accessible_has_property(second, Gtk.AccessibleProperty.DESCRIPTION)).toBe(true);
            });

            await it('clears everything it set when the whole object is removed', async () => {
                const el = createElement('gtk-label', { accessibility: { description: 'a', level: 2 } });
                const widget = withAtContext(materialize(el) as Gtk.Label);
                setProp(el, 'accessibility', undefined);
                expect(Gtk.test_accessible_has_property(widget, Gtk.AccessibleProperty.DESCRIPTION)).toBe(false);
                expect(Gtk.test_accessible_has_property(widget, Gtk.AccessibleProperty.LEVEL)).toBe(false);
                expect(el.accessibility).toBe(null);
            });

            await it('records nothing a refusal rejected', async () => {
                // The property path's own contract, on this axis: `el.accessibility` is
                // replayed verbatim by `replayInto`, so a refused object kept there would
                // throw again from inside the next rebuild.
                const el = createElement('gtk-label', { accessibility: { description: 'good' } });
                materialize(el);
                expect(codeOf(() => setProp(el, 'accessibility', { description: 'good', level: 'two' }))).toBe(
                    'bad-aria-value',
                );
                expect(el.accessibility).toStrictEqual({ description: 'good' });
            });
        });

        await gated(diagnostics, 'accessibility refuses what GTK would take at exit 0', async () => {
            await it('names every refusal by code', async () => {
                const el = createElement('gtk-label');
                expect(codeOf(() => setProp(el, 'accessibility', { labell: 'x' }))).toBe('unknown-aria');
                expect(codeOf(() => setProp(el, 'accessibility', { 'value-now': 'three' }))).toBe('bad-aria-value');
                expect(codeOf(() => setProp(el, 'accessibility', { checked: 'perhaps' }))).toBe('bad-aria-enum');
                expect(codeOf(() => setProp(el, 'accessibility', { 'labelled-by': 'other' }))).toBe('aria-reference');
                expect(codeOf(() => setProp(el, 'accessibility', 'label'))).toBe('bad-accessibility');
                // Not vacuous: the same call with a value each slot accepts.
                expect(codeOf(() => setProp(el, 'accessibility', { 'value-now': 3, checked: 'mixed' }))).toBe(
                    'no throw',
                );
            });

            await it('refuses a row of the table that is not a Gtk.Accessible', async () => {
                // Four of the 169 generated rows are not `Gtk.Accessible` — `GtkListItem`,
                // `GtkListHeader`, `GtkColumnViewCell` and `AdwToggle`, the carriers that HOLD
                // a widget rather than being one — and they have no `update_property` at all.
                // `GtkListItem` is the sharp case: it is one of exactly two classes in GTK that
                // DO install real `accessible-label`/`accessible-description` properties, so the
                // one row where accessibility looks most available is a row where the ARIA
                // object cannot go. Asked of the CLASS, so the refusal lands at the call that
                // authored it rather than inside a later materialisation.
                const el = createElement('gtk-list-item');
                expect(codeOf(() => setProp(el, 'accessibility', { description: 'x' }))).toBe('not-accessible');
                expect(GObject.type_is_a(Gtk.ListItem.$gtype, Gtk.Accessible.$gtype)).toBe(false);
                expect(GObject.type_is_a(Gtk.Label.$gtype, Gtk.Accessible.$gtype)).toBe(true);
                // …and the real property IS writable there, which is what makes the pair
                // confusing enough to assert.
                expect(el.descriptor.ctor().find_property('accessible-label') !== null).toBe(true);
            });

            await it('plans without touching a widget, so a refusal costs nothing', async () => {
                // `planAccessibility` is total over the authored object: every name resolved,
                // every GValue built, before the first GTK call. A half-applied object would
                // leave the element claiming state the widget never took, and the next patch
                // would compute its resets against it.
                expect(() => planAccessibility('GtkLabel', null, { level: 'two' })).toThrow('is typed integer');
                expect(planAccessibility('GtkLabel', { level: 2 }, null).resets.length).toBe(1);
                expect(planAccessibility('GtkLabel', null, { level: 2 }).writes.length).toBe(1);
            });
        });

        await gated(diagnostics, 'the ARIA table types what the widget cannot', async () => {
            await it('takes a value type from GTK and not from the widget', async () => {
                // `orientation` is a `GtkAccessibleProperty` on EVERY widget; `GtkLabel`
                // implements no `GtkOrientable` and has no such property. A host inferring the
                // value type from the widget has nothing to infer it from here.
                const el = createElement('gtk-label', { accessibility: { orientation: 'vertical' } });
                const widget = withAtContext(materialize(el) as Gtk.Label);
                expect(Gtk.test_accessible_has_property(widget, Gtk.AccessibleProperty.ORIENTATION)).toBe(true);
                expect(el.descriptor.ctor().find_property('orientation')).toBe(null);
                expect(ARIA_SLOTS['orientation']?.enumGType).toBe('GtkOrientation');
            });
        });

        // OUTSIDE the diagnostics gate ON PURPOSE: every call below is one GTK refuses
        // with a critical, which is exactly what `gated` fails on.
        await it('witnesses the exit-0 failure every refusal above prevents', async () => {
            // THE MEASUREMENT THIS WHOLE SURFACE RESTS ON, gjs 1.88.1 / GTK 4.22.5. GJS
            // guesses a GValue type from the JS value's integrality, and GTK reads it back
            // with a fixed `g_value_get_*`. Two of these three still report the slot as SET
            // afterwards — so `test_accessible_has_*` alone would pass the defect, and it is
            // the SILENCE the gated blocks above assert that separates a correct write from
            // this one.
            const double = withAtContext(new Gtk.Label({}));
            double.update_property([Gtk.AccessibleProperty.VALUE_NOW], [3] as never);
            expect(Gtk.test_accessible_has_property(double, Gtk.AccessibleProperty.VALUE_NOW)).toBe(true);

            const tristate = new Gtk.Label({});
            tristate.update_state([Gtk.AccessibleState.CHECKED], [true] as never);
            expect(Gtk.test_accessible_has_state(tristate, Gtk.AccessibleState.CHECKED)).toBe(true);

            const text = new Gtk.Label({});
            text.update_property([Gtk.AccessibleProperty.DESCRIPTION], [5] as never);
            expect(Gtk.test_accessible_has_property(text, Gtk.AccessibleProperty.DESCRIPTION)).toBe(false);

            // Every one of the three logged. The gate is reset rather than asserted: this
            // test exists to produce the diagnostics the others exist to be free of.
            expect(diagnostics.seen.length >= 3).toBe(true);
            diagnostics.reset();
        });
    });
};
