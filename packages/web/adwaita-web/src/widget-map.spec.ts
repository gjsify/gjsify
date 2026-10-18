// `Gtk.Widget::map` / `::unmap` and `get_mapped()` on an element: WIDGET_MAP_VECTORS, plus the
// program that found the gap — a registered `Adw.PreferencesDialog` subclass connecting `map` in
// its constructor (Learn6502's preferences dialog), which threw "declares no signal 'map'".
import { describe, expect, it } from '@gjsify/unit';
import { driveWidgetMapVectors, WIDGET_MAP_VECTORS, type WidgetMapSubject } from '@gjsify/adwaita-core/conformance';

import { Adw, GObject } from './index.js';
import { installElementApi } from './gobject-elements.js';
import type { WidgetElement } from './widget-element.js';

type Connectable = HTMLElement & { connect(signal: string, handler: (...args: unknown[]) => unknown): number };

function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve));
}

const hosts: HTMLElement[] = [];

const subject: WidgetMapSubject = {
    name: 'adwaita-web',
    isOracle: false,
    box() {
        const el = document.createElement('gtk-box');
        installElementApi(el);
        return el;
    },
    append: (parent, child) => void (parent as HTMLElement).append(child as HTMLElement),
    remove: (_parent, child) => void (child as HTMLElement).remove(),
    present(widget) {
        const host = document.createElement('div');
        host.append(widget as HTMLElement);
        document.body.append(host);
        hosts.push(host);
    },
    setVisible: (widget, visible) => void ((widget as WidgetElement).visible = visible),
    connect: (widget, signal, handler) => (widget as Connectable).connect(signal, handler),
    isMapped: (widget) => (widget as WidgetElement).get_mapped(),
    settle,
    dispose() {
        for (const host of hosts.splice(0)) host.remove();
    },
};

class GoWebMapDialog extends Adw.PreferencesDialog {
    log: string[] = [];
    constructor(params?: Record<string, unknown>) {
        // @ts-expect-error the element's own constructor takes none; the registered class's takes the params
        super(params);
        const self = this as unknown as Connectable & { get_mapped(): boolean };
        self.connect('map', () => this.log.push(`map:${self.get_mapped()}`));
        self.connect('unmap', () => this.log.push(`unmap:${self.get_mapped()}`));
    }
}
GObject.registerClass({ GTypeName: 'GoWebMapDialog' }, GoWebMapDialog);

export const WidgetMapTest = async () => {
    await driveWidgetMapVectors(subject, { describe, it, expect }, WIDGET_MAP_VECTORS);

    await describe('adwaita-web: map / unmap on an element', async () => {
        await it('every widget declares both, a subclass with its own signals too', () => {
            for (const tag of ['gtk-box', 'gtk-button', 'adw-preferences-dialog']) {
                const el = document.createElement(tag);
                installElementApi(el);
                expect(() => (el as Connectable).connect('map', () => {})).not.toThrow();
                expect(() => (el as Connectable).connect('unmap', () => {})).not.toThrow();
            }
            // `<gtk-button>` declares `clicked` itself and still has `map`.
            const button = document.createElement('gtk-button');
            installElementApi(button);
            expect(() => (button as Connectable).connect('clicked', () => {})).not.toThrow();
        });

        await it('a registered dialog connecting `map` in its constructor maps on present() and unmaps on close()', async () => {
            const dialog = new (GoWebMapDialog as unknown as new () => GoWebMapDialog)();
            await settle();
            expect(dialog.log).toStrictEqual([]);
            (dialog as unknown as { present(): void }).present();
            await settle();
            expect(dialog.log).toStrictEqual(['map:true']);
            (dialog as unknown as { close(): void }).close();
            await settle();
            expect(dialog.log).toStrictEqual(['map:true', 'unmap:false']);
            dialog.remove();
        });

        await it('a disconnected handler stops the watch: no emission after it', async () => {
            const box = subject.box() as Connectable & { disconnect(id: number): void };
            let emitted = 0;
            const id = box.connect('map', () => void emitted++);
            box.disconnect(id);
            subject.present(box);
            await settle();
            expect(emitted).toBe(0);
            subject.dispose();
        });

        await it('a popover that opens maps, one that closes unmaps', async () => {
            const host = document.createElement('div');
            const popover = document.createElement('div');
            popover.setAttribute('popover', '');
            const inner = subject.box() as Connectable;
            popover.append(inner);
            host.append(popover);
            document.body.append(host);
            const log: string[] = [];
            inner.connect('map', () => void log.push('map'));
            inner.connect('unmap', () => void log.push('unmap'));
            popover.showPopover();
            await settle();
            popover.hidePopover();
            await settle();
            host.remove();
            expect(log).toStrictEqual(['map', 'unmap']);
        });
    });
};
