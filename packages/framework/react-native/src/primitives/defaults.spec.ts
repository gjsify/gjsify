// The default-divergence ledger, held against the installed GTK and against the table.
//
// `defaults.ts` claims two things a comment cannot: that GTK really gives a fresh
// widget the value the row records, and that the set is CLOSED — every default this
// layer overrides has a row, and every row that says `normalised` is really written.
//
// The second half is the one that matters. Four divergences were normalised one at a
// time before anybody wrote them down, and the fifth (`Gtk.Label:xalign`) survived
// every pass and was found by porting an application: all of its text rendered
// centred, on every screen. The vectors below are what stops a sixth doing the same —
// a `widgetProps` entry with no row fails, and a row that stops being true fails.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { afterEach, beforeEach, describe, expect, it, on, type Runtime } from '@gjsify/unit';
import { lookupEnumNick, registerBuiltinWidgets } from '@gjsify/gtk-host';
import { gtkChildren, installDiagnosticsGate } from '@gjsify/gtk-host/conformance';
import { MINIMAL_TOKENS, type StyleTokens } from '@gjsify/gtk-host/style';
import { createRoot } from '@gjsify/gtk-host/react';
import { createElement } from 'react';

import { Text, View } from '../components.js';
import { configureStyle, resetStyleConfig } from '../style-config.js';
import { DEFAULT_ROWS, NORMALISED_DEFAULTS, defaultRowFor } from './defaults.js';
import { PRIMITIVES, type PrimitiveSpec } from './table.js';

const GTK_HOSTS: Runtime[] = ['Gjs', 'Node.js', 'Bun', 'Deno'];
const TOKENS: StyleTokens = { ...MINIMAL_TOKENS };

/** `max-length` → `maxLength`: the spelling GJS installs the JS accessor under. */
const accessor = (name: string): string => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * A freshly constructed widget of `gtype`, for reading a default off.
 *
 * CONSTRUCTED, not read off the class: the ledger records the value GTK actually hands
 * a fresh widget, which is `get_property` on an instance — a ParamSpec's declared
 * default is a different number whenever a constructor overrides it.
 */
function freshWidget(gtype: string): Gtk.Widget {
    const ctor = (Gtk as unknown as Record<string, new () => Gtk.Widget>)[gtype.replace(/^Gtk/, '')];
    if (typeof ctor !== 'function') throw new Error(`no Gtk constructor for ${gtype}`);
    return new ctor();
}

/** Every `(gtype, property)` the primitive table writes as a widget default. */
function tableOverrides(): readonly {
    readonly gtype: string;
    readonly property: string;
    readonly value: unknown;
    readonly where: string;
}[] {
    const out: { gtype: string; property: string; value: unknown; where: string }[] = [];
    const visit = (name: string, spec: PrimitiveSpec): void => {
        const nodes: readonly [string | undefined, Readonly<Record<string, unknown>> | undefined, string][] = [
            [spec.tag, spec.widgetProps, name],
            [spec.content?.tag, spec.content?.widgetProps, `${name}.content`],
            [spec.backdrop?.tag, spec.backdrop?.widgetProps, `${name}.backdrop`],
        ];
        for (const [gtype, props, where] of nodes) {
            if (gtype === undefined || props === undefined) continue;
            for (const [property, value] of Object.entries(props)) out.push({ gtype, property, value, where });
        }
        if (spec.switchOn !== undefined) visit(`${name}[${spec.switchOn.prop}]`, spec.switchOn.whenTrue);
    };
    for (const [name, spec] of Object.entries(PRIMITIVES)) visit(name, spec);
    return out;
}

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        registerBuiltinWidgets();
        const diagnostics = installDiagnosticsGate();
        const gated = (name: string, run: () => Promise<void>): Promise<void> =>
            describe(name, async () => {
                beforeEach(() => {
                    diagnostics.reset();
                    configureStyle({ tokens: TOKENS });
                });
                afterEach(() => {
                    resetStyleConfig();
                    diagnostics.assertQuiet();
                });
                await run();
            }) as Promise<void>;

        await gated('the ledger, against the GTK that is installed', async () => {
            await it('records the value a FRESH widget really reports, for every row', async () => {
                // The GTK half of every row, re-measured. A row that recorded a value
                // GTK stopped giving would otherwise sit here reading true for ever —
                // and the whole point of the ledger is that it is the thing a reader
                // trusts instead of looking.
                const wrong: string[] = [];
                for (const row of DEFAULT_ROWS) {
                    // `GtkWidget` is abstract; its properties are read off any widget.
                    const widget = freshWidget(row.gtype === 'GtkWidget' ? 'GtkBox' : row.gtype);
                    const actual = (widget as unknown as Record<string, unknown>)[accessor(row.property)];
                    const expected = row.gtk;
                    // An enum comes back as a NUMBER; the ledger spells the nick,
                    // because a number in a document nobody can read is not a record.
                    // AN ENUM COMES BACK AS A NUMBER and the ledger spells the NICK,
                    // because a number in a document nobody can read is not a record.
                    // The nick is resolved to a number rather than the other way
                    // round, through `@gjsify/gtk-host`'s own `lookupEnumNick` — the
                    // host already owns that mapping and a second one here would be
                    // the copy that drifts.
                    const matches =
                        typeof expected === 'string' && typeof actual === 'number'
                            ? enumValue(widget, row.property, expected) === actual
                            : actual === expected;
                    if (!matches)
                        wrong.push(`${row.gtype}.${row.property}: ledger ${String(expected)}, GTK ${String(actual)}`);
                }
                expect(wrong).toStrictEqual([]);
                expect(DEFAULT_ROWS.length > 15).toBe(true);
            });

            await it('names a property the widget really installs, for every row', async () => {
                const missing: string[] = [];
                for (const row of DEFAULT_ROWS) {
                    const gtype = row.gtype === 'GtkWidget' ? 'GtkBox' : row.gtype;
                    const widget = freshWidget(gtype);
                    const specs = (
                        widget.constructor as unknown as { list_properties(): GObject.ParamSpec[] }
                    ).list_properties();
                    if (!specs.some((spec) => spec.get_name() === row.property)) {
                        missing.push(`${row.gtype}.${row.property}`);
                    }
                }
                expect(missing).toStrictEqual([]);
            });
        });

        await gated('the ledger, against the primitive table', async () => {
            await it('has a row for EVERY default the table overrides', async () => {
                // THE VECTOR THIS FILE EXISTS FOR. A sixth normalisation written into
                // `widgetProps` without a row here is a divergence nobody enumerated —
                // which is exactly how the fifth one reached a shipped screen.
                const unrecorded = tableOverrides()
                    .filter(({ gtype, property }) => defaultRowFor(gtype, property) === undefined)
                    .map(({ gtype, property, where }) => `${where}: ${gtype}.${property}`);
                expect(unrecorded).toStrictEqual([]);
                expect(tableOverrides().length > 5).toBe(true);
            });

            await it('is really written by the table, for every row that says `normalised`', async () => {
                // The other direction: a row can claim a normalisation the table does
                // not perform, and it would read as covered.
                const overrides = tableOverrides();
                const unperformed = NORMALISED_DEFAULTS.filter(
                    (row) => !overrides.some((o) => o.gtype === row.gtype && o.property === row.property),
                ).map((row) => `${row.gtype}.${row.property}`);
                expect(unperformed).toStrictEqual([]);
                // AND THE VALUE, not only the fact of an override: a ledger that said
                // `xalign: 0` beside a table that wrote 0.5 would read as covered and
                // be exactly as wrong as no ledger at all.
                const disagreeing = NORMALISED_DEFAULTS.filter((row) =>
                    overrides.some(
                        (o) => o.gtype === row.gtype && o.property === row.property && o.value !== row.normalisedTo,
                    ),
                ).map((row) => `${row.gtype}.${row.property}`);
                expect(disagreeing).toStrictEqual([]);
                // Not vacuous — an empty ledger satisfies both lists above.
                expect(NORMALISED_DEFAULTS.length > 5).toBe(true);
            });

            await it('gives every row a reason and a source, and a value exactly when it normalises', async () => {
                const bad: string[] = [];
                for (const row of DEFAULT_ROWS) {
                    const where = `${row.gtype}.${row.property}`;
                    if (row.reason.trim() === '') bad.push(`${where}: no reason`);
                    if (row.source.trim() === '') bad.push(`${where}: no source`);
                    if (row.verdict === 'normalised' && row.normalisedTo === undefined) {
                        bad.push(`${where}: normalised with no value`);
                    }
                    if (row.verdict !== 'normalised' && row.normalisedTo !== undefined) {
                        bad.push(`${where}: a value on a ${row.verdict} row`);
                    }
                }
                expect(bad).toStrictEqual([]);
            });
        });

        await gated('the text a reader actually sees', async () => {
            await it('draws text at the START corner, not centred', async () => {
                // THE MEASUREMENT, and it is a POSITION rather than a property: reading
                // back `xalign === 0` would pass just as well if the label were never
                // allocated any spare room, which is the case every unit test creates.
                // `get_layout_offsets()` is where Pango actually put the glyphs.
                //
                // MEASURED on gtk 4.22.4 with GTK's own defaults, for the record this
                // vector protects: a label allocated 400×100 reports (193, 41).
                const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
                const root = createRoot(container);
                try {
                    root.render(
                        createElement(View, null, createElement(Text, { style: { width: 400, height: 100 } }, 'hi')),
                    );
                    const label = find(container, 'GtkLabel') as Gtk.Label;
                    expect(label.xalign).toBe(0);
                    expect(label.yalign).toBe(0);
                    // The label has to be given the room for the offsets to mean
                    // anything, so the size request is asserted rather than assumed.
                    expect(label.widthRequest).toBe(400);
                    expect(label.heightRequest).toBe(100);
                    const [x, y] = label.get_layout_offsets();
                    expect(x).toBe(0);
                    expect(y).toBe(0);
                } finally {
                    root.unmount();
                }
            });

            await it('still centres when the author ASKS, so the default is a default', async () => {
                // The control. Without it the vector above passes just as well for a
                // layer that hard-wired left alignment and dropped `text-center` —
                // which would be the same defect facing the other way.
                const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
                const root = createRoot(container);
                try {
                    root.render(createElement(View, null, createElement(Text, { className: 'text-center' }, 'hi')));
                    const label = find(container, 'GtkLabel') as Gtk.Label;
                    expect(label.xalign).toBe(0.5);
                } finally {
                    root.unmount();
                }
            });

            await it('keeps wrapping on, which is the divergence that was already known', async () => {
                const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
                const root = createRoot(container);
                try {
                    root.render(createElement(Text, null, 'hi'));
                    expect((gtkChildren(container)[0] as Gtk.Label).wrap).toBe(true);
                } finally {
                    root.unmount();
                }
            });
        });
    });
};

/** The number a nick names on `property`'s enum type, through the host's own mapping. */
function enumValue(widget: Gtk.Widget, property: string, nick: string): number | undefined {
    const spec = (widget.constructor as unknown as { list_properties(): GObject.ParamSpec[] })
        .list_properties()
        .find((candidate) => candidate.get_name() === property);
    if (spec === undefined) return undefined;
    return lookupEnumNick(GObject.type_name(spec.value_type) ?? '', nick);
}

/** First strict descendant of a GType, breadth-first over the REAL tree. */
function find(root: Gtk.Widget, gtype: string): Gtk.Widget {
    const queue: Gtk.Widget[] = [...gtkChildren(root)];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        const name = GObject.type_name(
            (widget as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype,
        );
        if (name === gtype) return widget;
        queue.push(...gtkChildren(widget));
    }
    throw new Error(`no ${gtype} in the tree`);
}
