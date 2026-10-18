// `Gtk.Widget`'s `map` / `unmap` signals and `gtk_widget_get_mapped` as observable behaviour.
//
// A widget is MAPPED while it is on screen: it is visible, and so is every ancestor up to a
// shown window. `gtk_widget_map` emits `map` on the transition into that state and
// `gtk_widget_unmap` emits `unmap` on the way out; nothing is emitted for a widget that already
// is in the state, so connecting to a mapped widget runs no handler.
//
// THE ORDER IS POST-ORDER, AND IT FOLLOWS FROM `G_SIGNAL_RUN_FIRST`. The class handler runs
// before the user's: `gtk_widget_real_map` sets `mapped = TRUE` and then maps each visible
// child, and `gtk_widget_real_unmap` sets `mapped = FALSE` and then unmaps each child. So a
// child's handlers have run by the time its parent's run, in both directions, and
// `get_mapped()` already answers the new state inside a handler.
//
// THE TIMING IS NOT A ROW. GTK maps synchronously inside `gtk_widget_show`; a port learns about
// a change from its platform (a DOM mutation, a NativeScript `loaded`) and may emit later. The
// rows therefore read after the subject has settled, and a hide immediately undone in the same
// turn is not asserted — GTK emits `unmap` + `map` for it, a port that batches may emit nothing.
//
// Reference: GTK gtk/gtkwidget.c (gtk_widget_map, gtk_widget_unmap, gtk_widget_real_map,
// gtk_widget_real_unmap, gtk_widget_get_mapped), gtk/gtkwindow.c (gtk_window_show)
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import type { ConstructHarness } from './constructs.js';

export const WIDGET_MAP_ROWS = ['map', 'unmap', 'get-mapped'] as const;
export type WidgetMapRow = (typeof WIDGET_MAP_ROWS)[number];

type Handler = (...args: unknown[]) => unknown;

/** What a driver hands the vectors. */
export interface WidgetMapSubject {
    readonly name: string;
    /** True for real GJS. */
    readonly isOracle: boolean;
    /** A new `Gtk.Box`, not on screen. */
    box(): object;
    append(parent: object, child: object): void;
    remove(parent: object, child: object): void;
    /** Puts `widget` on screen: the child of a shown window. */
    present(widget: object): void;
    setVisible(widget: object, visible: boolean): void;
    connect(widget: object, signal: string, handler: Handler): number;
    isMapped(widget: object): boolean;
    /** Lets the platform deliver what the last change caused. */
    settle(): Promise<void>;
    /** Takes everything {@link present} put on screen off it again. */
    dispose(): void;
}

export interface WidgetMapVector {
    readonly row: WidgetMapRow;
    readonly rule: string;
    readonly observe: (subject: WidgetMapSubject) => Promise<unknown>;
    readonly shows: unknown;
}

/** `outer` holding `inner` holding `leaf`, each logging `<name>:<signal>:<get_mapped()>`. */
function logged(s: WidgetMapSubject, signals: readonly string[]) {
    const log: string[] = [];
    const outer = s.box();
    const inner = s.box();
    const leaf = s.box();
    s.append(outer, inner);
    s.append(inner, leaf);
    for (const [name, widget] of [
        ['outer', outer],
        ['inner', inner],
        ['leaf', leaf],
    ] as const) {
        for (const signal of signals) {
            s.connect(widget, signal, () => void log.push(`${name}:${signal}:${s.isMapped(widget)}`));
        }
    }
    return { log, outer, inner, leaf };
}

export const WIDGET_MAP_VECTORS: readonly WidgetMapVector[] = [
    {
        row: 'get-mapped',
        rule: 'a widget that is not on screen is not mapped, and connecting `map` to it emits nothing',
        async observe(s) {
            const { log, outer } = logged(s, ['map', 'unmap']);
            await s.settle();
            return { mapped: s.isMapped(outer), log };
        },
        shows: { mapped: false, log: [] },
    },
    {
        row: 'map',
        rule:
            'putting a tree on screen maps every visible widget in it, children before the parent ' +
            '(map is RUN_FIRST and gtk_widget_real_map maps the children), get_mapped() TRUE inside',
        async observe(s) {
            const { log, outer } = logged(s, ['map']);
            s.present(outer);
            await s.settle();
            return log;
        },
        shows: ['leaf:map:true', 'inner:map:true', 'outer:map:true'],
    },
    {
        row: 'map',
        rule: 'a hidden widget is not mapped and neither is its subtree; showing it maps both, deepest first',
        async observe(s) {
            const { log, outer, inner, leaf } = logged(s, ['map']);
            s.setVisible(inner, false);
            s.present(outer);
            await s.settle();
            const hidden = { log: [...log], inner: s.isMapped(inner), leaf: s.isMapped(leaf) };
            log.length = 0;
            s.setVisible(inner, true);
            await s.settle();
            return { hidden, shown: log };
        },
        shows: {
            hidden: { log: ['outer:map:true'], inner: false, leaf: false },
            shown: ['leaf:map:true', 'inner:map:true'],
        },
    },
    {
        row: 'map',
        rule: 'connecting `map` to a widget that is already mapped emits nothing: only a transition does',
        async observe(s) {
            const outer = s.box();
            s.present(outer);
            await s.settle();
            let emitted = 0;
            s.connect(outer, 'map', () => void emitted++);
            await s.settle();
            return { mapped: s.isMapped(outer), emitted };
        },
        shows: { mapped: true, emitted: 0 },
    },
    {
        row: 'unmap',
        rule:
            'hiding a mapped widget unmaps it and its subtree, children first, with get_mapped() FALSE ' +
            'inside; its parent stays mapped',
        async observe(s) {
            const { log, outer, inner } = logged(s, ['unmap']);
            s.present(outer);
            await s.settle();
            s.setVisible(inner, false);
            await s.settle();
            return { log, outer: s.isMapped(outer) };
        },
        shows: { log: ['leaf:unmap:false', 'inner:unmap:false'], outer: true },
    },
    {
        row: 'unmap',
        rule: 'removing a mapped widget from its parent unmaps it, and a later append to a mapped parent maps it again',
        async observe(s) {
            const { log, outer, inner } = logged(s, ['map', 'unmap']);
            s.present(outer);
            await s.settle();
            log.length = 0;
            s.remove(outer, inner);
            await s.settle();
            const removed = [...log];
            log.length = 0;
            s.append(outer, inner);
            await s.settle();
            return { removed, appended: log };
        },
        shows: {
            removed: ['leaf:unmap:false', 'inner:unmap:false'],
            appended: ['leaf:map:true', 'inner:map:true'],
        },
    },
];

/** Run the rows against `subject`, disposing what each row put on screen. */
export async function driveWidgetMapVectors(
    subject: WidgetMapSubject,
    harness: ConstructHarness,
    vectors: readonly WidgetMapVector[] = WIDGET_MAP_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: Gtk.Widget map / unmap`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, async () => {
                try {
                    const observed = await vector.observe(subject);
                    expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
                } finally {
                    subject.dispose();
                }
            });
        }
    });
}
