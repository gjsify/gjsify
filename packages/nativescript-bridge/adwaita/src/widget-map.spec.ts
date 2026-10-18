// `Gtk.Widget::map` / `::unmap` and `get_mapped()` on this port: WIDGET_MAP_VECTORS, plus the shape
// of the program that found the gap — a registered class connecting `map` in its constructor
// (Learn6502's preferences dialog), whose handler never ran. On the TREES entry: mapping is the
// NativeScript lifecycle, which only the `ns-core` double has.
import { driveWidgetMapVectors, WIDGET_MAP_VECTORS, type WidgetMapSubject } from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import * as GObject from './namespace/gobject.js';
import * as Gtk from './namespace/gtk.js';
import { emittedSignalsOf } from './widgets/signals.js';

type Box = InstanceType<typeof Gtk.Box>;
type Handler = (...args: unknown[]) => unknown;

const hosts: Box[] = [];

const subject: WidgetMapSubject = {
    name: 'adwaita-nativescript',
    isOracle: false,
    box: () => new Gtk.Box(),
    append: (parent, child) => (parent as Box).append(child as Box),
    remove: (parent, child) => (parent as Box).remove(child as Box),
    present(widget) {
        // The platform loads a page's tree once it is on screen; `onLoaded` is that call.
        const host = new Gtk.Box();
        host.append(widget as Box);
        host.onLoaded();
        hosts.push(host);
    },
    setVisible: (widget, visible) => void ((widget as Box).visible = visible),
    connect: (widget, signal, handler) => (widget as Box).connect(signal, handler as never),
    isMapped: (widget) => (widget as Box).get_mapped(),
    settle: () => Promise.resolve(),
    dispose() {
        for (const host of hosts.splice(0)) host.onUnloaded();
    },
};

class GoNsMapBox extends Gtk.Box {
    log: string[] = [];
    constructor(params?: Record<string, unknown>) {
        super(params as never);
        const self = this as unknown as { connect(signal: string, handler: Handler): number };
        self.connect('map', () => this.log.push(`map:${this.get_mapped()}`));
        self.connect('unmap', () => this.log.push(`unmap:${this.get_mapped()}`));
    }
}
GObject.registerClass({ GTypeName: 'GoNsMapBox' }, GoNsMapBox);

export const AdwWidgetMapNsTest = async () => {
    await driveWidgetMapVectors(subject, { describe, it, expect }, WIDGET_MAP_VECTORS);

    await describe('adwaita-nativescript: map / unmap on a view', async () => {
        await it('every widget declares both, a class with its own signals too', () => {
            expect(emittedSignalsOf(Gtk.Box).join()).toBe('map,unmap');
            expect(emittedSignalsOf(Gtk.Button).join()).toBe('map,unmap,clicked');
        });

        await it('a builder handler for `map` is connected and runs when the tree is loaded', () => {
            let mapped = 0;
            const root = build(
                { tag: 'GtkBox', children: [{ tag: 'GtkBox', signals: [{ name: 'map', handler: 'onMap' }] }] },
                { scope: { onMap: () => void mapped++ } },
            ) as unknown as Box;
            expect(mapped).toBe(0);
            root.onLoaded();
            expect(mapped).toBe(1);
            root.onUnloaded();
        });

        await it('a registered class connecting `map` in its constructor maps on load and unmaps on unload', () => {
            const box = new (GoNsMapBox as unknown as new () => GoNsMapBox)();
            subject.present(box);
            expect(box.log).toStrictEqual(['map:true']);
            subject.dispose();
            expect(box.log).toStrictEqual(['map:true', 'unmap:false']);
        });

        await it('a disconnected handler stops the watch: no emission after it', () => {
            const box = new Gtk.Box();
            let emitted = 0;
            const id = box.connect('map', () => void emitted++);
            box.disconnect(id);
            subject.present(box);
            expect(emitted).toBe(0);
            subject.dispose();
        });

        await it('an ancestor that collapses unmaps the subtree, deepest first', () => {
            const outer = new Gtk.Box();
            const inner = new Gtk.Box();
            outer.append(inner);
            const log: string[] = [];
            inner.connect('unmap', () => void log.push('inner'));
            outer.connect('unmap', () => void log.push('outer'));
            subject.present(outer);
            (outer.parent as Box).visible = false;
            expect(log).toStrictEqual(['inner', 'outer']);
            subject.dispose();
        });
    });
};
