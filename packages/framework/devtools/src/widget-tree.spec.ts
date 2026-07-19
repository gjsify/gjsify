// @gjsify/devtools — widget-path parse/build tests (pure logic).

import { describe, expect, it } from '@gjsify/unit';
import type Gtk from '@girs/gtk-4.0';
import { buildWidgetPath, parseWidgetPath, widgetType } from './widget-tree.js';

// widgetType() is duck-typed on purpose (it reads runtime-provided accessors that
// differ per runtime), so the specs feed it plain shapes cast to Gtk.Widget.
const asWidget = (shape: object): Gtk.Widget => shape as unknown as Gtk.Widget;

export default async () => {
    await describe('parseWidgetPath', async () => {
        await it('parses a toplevel-only path', async () => {
            expect(parseWidgetPath('toplevel:0')).toStrictEqual({ toplevel: 0, children: [] });
        });

        await it('parses a nested path', async () => {
            expect(parseWidgetPath('toplevel:2/child:0/child:3')).toStrictEqual({ toplevel: 2, children: [0, 3] });
        });

        await it('rejects malformed paths', async () => {
            expect(parseWidgetPath('')).toBeNull();
            expect(parseWidgetPath('child:0')).toBeNull();
            expect(parseWidgetPath('toplevel:x')).toBeNull();
            expect(parseWidgetPath('toplevel:0/nope:1')).toBeNull();
        });
    });

    await describe('buildWidgetPath', async () => {
        await it('round-trips with parseWidgetPath', async () => {
            const path = buildWidgetPath(2, [0, 3]);
            expect(path).toBe('toplevel:2/child:0/child:3');
            expect(parseWidgetPath(path)).toStrictEqual({ toplevel: 2, children: [0, 3] });
        });

        await it('builds a toplevel-only path', async () => {
            expect(buildWidgetPath(0, [])).toBe('toplevel:0');
        });
    });

    await describe('widgetType', async () => {
        await it('reads the concrete runtime type off GJS constructor.$gtype.name', async () => {
            // GJS downcasts a returned widget to its concrete class.
            expect(widgetType(asWidget({ constructor: { $gtype: { name: 'AdwBin' } } }))).toBe('AdwBin');
        });

        await it('reads the node-gi wrapper runtime type off $typeName', async () => {
            // node-gi returns a generic wrapper; the runtime GType is on $typeName.
            expect(widgetType(asWidget({ $typeName: 'AdwBreakpointBin' }))).toBe('AdwBreakpointBin');
        });

        await it('prefers $typeName over the generic wrapper constructor', async () => {
            // On node-gi the generic wrapper's constructor.$gtype.name would be the
            // static declared type (or absent) — $typeName must win.
            expect(
                widgetType(asWidget({ $typeName: 'FireworksWindow', constructor: { $gtype: { name: 'GtkWidget' } } })),
            ).toBe('FireworksWindow');
        });

        await it('falls back to GtkWidget when no type is resolvable', async () => {
            // A genuinely type-less object: no constructor chain (so no
            // constructor.$gtype) and no $typeName. (A plain `{}` is unsuitable
            // here: GJS defines Object.$gtype.name === 'JSObject', but a real
            // widget's constructor is always its concrete class, never Object.)
            expect(widgetType(asWidget(Object.create(null)))).toBe('GtkWidget');
            // An empty $typeName must not be treated as a type.
            const noType = Object.create(null) as { $typeName?: string };
            noType.$typeName = '';
            expect(widgetType(asWidget(noType))).toBe('GtkWidget');
        });
    });
};
