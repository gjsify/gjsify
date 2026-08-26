// The measured widget-property table, re-measured against the GTK that is running.
//
// `gtk-css.spec.ts`'s reasoning, one authority over: `gtk-props.ts` is a claim about
// another program's type system, and a claim nothing re-checks is one that decays.
// A GTK release that renamed `width-request` or gave `Gtk.Widget` a `padding` would
// leave the layout half routing properties by a table describing a version nobody
// runs.
//
// BOTH DIRECTIONS, and here the negative one is not merely load-bearing, it is the
// whole point: every routing decision in `layout.ts` rests on an ABSENCE. Padding
// is CSS because no widget has a padding property; `ml-*` is CSS because no widget
// has `margin-left`; `flex-row` is an intent-adjacent property rather than a
// universal one because `orientation` is not on `Gtk.Widget`. A table that only
// asserted presences would agree with a GTK in which all three were false.

import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import { expect, it, on } from '@gjsify/unit';

import { GTK_WIDGET_PROPERTY_PROBES, NOT_GTK_WIDGET_PROPERTIES } from './gtk-props.js';
import { paramSpecs } from '../props.js';
import { GTK_HOSTS, gated } from '../testing/gate.mjs';
import { installDiagnosticsGate } from '../conformance/index.js';

/**
 * The GType names the table uses → the class object to read them from.
 *
 * `Gtk.Widget` is abstract and is read anyway: `list_properties()` is a CLASS
 * operation, and the abstract base is exactly where the universal rows have to be
 * proven — proving them on `Gtk.Box` would only show that a box has them.
 */
const CLASSES: Readonly<Record<string, GObject.ObjectClass>> = {
    GtkWidget: Gtk.Widget as unknown as GObject.ObjectClass,
    GtkBox: Gtk.Box as unknown as GObject.ObjectClass,
    GtkLabel: Gtk.Label as unknown as GObject.ObjectClass,
    GtkCenterBox: Gtk.CenterBox as unknown as GObject.ObjectClass,
    GtkFlowBox: Gtk.FlowBox as unknown as GObject.ObjectClass,
};

/** The class's ParamSpecs by kebab name — the host's own reader, not a second one. */
const specsOf = (gtype: string): Map<string, GObject.ParamSpec> => {
    const klass = CLASSES[gtype];
    if (klass === undefined) throw new Error(`gtk-props.ts names ${gtype}, which this spec cannot construct`);
    return paramSpecs(klass, gtype);
};

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        const diagnostics = installDiagnosticsGate();

        await gated(diagnostics, 'the measured GTK widget-property table', async () => {
            await it('GTK installs every property the table claims, with the value type it claims', async () => {
                // The value type travels with the name because the layout half acts
                // on it: `margin-top` being a `gint` is why a `rem` spacing token is
                // refused there and accepted in CSS.
                const wrong = GTK_WIDGET_PROPERTY_PROBES.filter(([gtype, property, valueType]) => {
                    const spec = specsOf(gtype).get(property);
                    return spec === undefined || GObject.type_name(spec.value_type) !== valueType;
                }).map(([gtype, property, valueType]) => `${gtype}:${property} is not ${valueType}`);
                expect(wrong).toStrictEqual([]);
            });

            await it('GTK installs none of the properties the table claims are absent', async () => {
                const present = NOT_GTK_WIDGET_PROPERTIES.filter(
                    ([gtype, property]) => specsOf(gtype).get(property) !== undefined,
                ).map(([gtype, property]) => `${gtype}:${property}`);
                expect(present).toStrictEqual([]);
            });

            await it('the GtkWidget rows really are inherited by every class in the table', async () => {
                // What lets the layout half emit `margin-start`, `hexpand` and
                // `overflow` without knowing which tag an element becomes. Asserted
                // rather than assumed: GObject inheritance makes it true, and this is
                // the line that would go red if a row were filed under `GtkWidget`
                // that is actually a subclass's.
                const universal = GTK_WIDGET_PROPERTY_PROBES.filter(([gtype]) => gtype === 'GtkWidget');
                const missing: string[] = [];
                for (const gtype of Object.keys(CLASSES)) {
                    const specs = specsOf(gtype);
                    for (const [, property] of universal) {
                        if (!specs.has(property)) missing.push(`${gtype}:${property}`);
                    }
                }
                expect(missing).toStrictEqual([]);
            });

            await it('reports padding as absent everywhere, which is what makes it CSS-only', async () => {
                // Called out on its own for the same reason `gtk-css.spec.ts` calls
                // out `text-align`: it is the absence a reader is most likely to
                // assume away. A widget has margins, so it looks like it must have
                // paddings — and `p-*` would then have a channel it does not have.
                const withPadding = Object.keys(CLASSES).filter((gtype) => {
                    const specs = specsOf(gtype);
                    return [...specs.keys()].some((name) => name === 'padding' || name.startsWith('padding-'));
                });
                expect(withPadding).toStrictEqual([]);
            });

            await it('reports the widget margins as LOGICAL and only logical', async () => {
                // The other half of the sentence `gtk-css.spec.ts` proves: CSS has
                // the physical names and not the logical ones, the widget has the
                // logical names and not the physical ones. Neither file can state it
                // alone, and the layout half is the two put together.
                const specs = specsOf('GtkWidget');
                expect(specs.has('margin-start') && specs.has('margin-end')).toBe(true);
                expect(specs.has('margin-left') || specs.has('margin-right')).toBe(false);
            });
        });
    });
};
