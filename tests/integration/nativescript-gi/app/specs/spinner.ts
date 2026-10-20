// THE SECOND MIGRATED PORT WIDGET ON A DEVICE (ADR 0105 § 2, route D), and the first whose
// properties are not strings. `Adw.Spinner` declares `spinning` (boolean) and `size` (double); the
// seam coerces an XML string to the declared type on BOTH legs, so the first suite runs in both
// and a difference between the two runs is a defect in whichever engine disagrees. The second
// suite is real-GObject only: a GType, typed `get_property` and `bind_property` are what route D
// buys. See `specs/window-title.ts` for the shape this copies.
import { Adw } from '@gjsify/adwaita-nativescript';
import { ActivityIndicator, GridLayout, View, ViewBase } from '@nativescript/core';

import { describe, expect, info, it } from '../reporter.js';
import { requireGi } from '../opt-in.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const indicatorOf = (widget: Adw.Spinner): ActivityIndicator =>
    (widget as unknown as { _indicator: ActivityIndicator })._indicator;

/** Attaches the widget the way a page does, so `isLoaded` flips and `spinning` can take effect. */
function mount(widget: Adw.Spinner): void {
    (widget as Any).callLoaded?.();
}

export const spinnerSpec = (engine: 'real-gio' | 'pure-js') => async (): Promise<void> => {
    const mixin = Object.getPrototypeOf(Adw.Spinner) as Any;

    await describe(`Adw.Spinner on '${engine}' (ADR 0105 § 2, route D)`, async () => {
        await it('constructs as a real NativeScript GridLayout with an ActivityIndicator', () => {
            const widget = new Adw.Spinner();
            info(`gtypeName=${mixin.$gtypeName ?? 'none'} skipped=[${(mixin.$foreignSkipped ?? []).join(',')}]`);
            expect(widget instanceof GridLayout).toBe(true);
            expect(widget instanceof View).toBe(true);
            expect(widget instanceof ViewBase).toBe(true);
            expect(indicatorOf(widget) instanceof ActivityIndicator).toBe(true);
        });

        await it('starts spinning at the minimum size, typed boolean and number', () => {
            const widget = new Adw.Spinner();
            expect(widget.spinning).toBe(true);
            expect(widget.size).toBe(16);
            expect(typeof widget.spinning).toBe('boolean');
            expect(typeof widget.size).toBe('number');
            expect(widget.width).toBe(16);
        });

        await it('coerces XML strings to the declared type', () => {
            const widget = new Adw.Spinner();
            (widget as Any).spinning = 'false';
            expect(widget.spinning).toBe(false);
            expect(typeof widget.spinning).toBe('boolean');
            (widget as Any).size = '96';
            expect(widget.size).toBe(96);
            expect(typeof widget.size).toBe('number');
            (widget as Any).size = '24px';
            expect(widget.size).toBe(24);
            (widget as Any).size = 4;
            expect(widget.size).toBe(16);
            expect(() => {
                (widget as Any).spinning = 'maybe';
            }).toThrow();
        });

        await it('a write reaches the box and the ring through notify::', () => {
            const widget = new Adw.Spinner();
            widget.size = 200;
            info(`box=${widget.width} ring=${indicatorOf(widget).width}`);
            expect(widget.width).toBe(200);
            expect(widget.height).toBe(200);
            expect(indicatorOf(widget).width).toBe(64);
            mount(widget);
            expect(indicatorOf(widget).busy).toBe(true);
            widget.spinning = false;
            expect(indicatorOf(widget).busy).toBe(false);
        });

        await it('notifies on a change, stays silent on an equal write, and stops on disconnect', () => {
            const widget = new Adw.Spinner();
            expect(widget.spinning).toBe(true);
            const seen: boolean[] = [];
            const id = widget.connect('notify::spinning', (self: Adw.Spinner) => seen.push(self.spinning));
            widget.spinning = true;
            widget.spinning = false;
            widget.spinning = false;
            widget.disconnect(id);
            widget.spinning = true;
            info(`seen=[${seen.join(',')}]`);
            expect(seen.join(',')).toBe('false');
            expect(() => widget.disconnect(id)).toThrow();
        });

        await it('takes both properties as construct props, strings included', () => {
            const widget = new Adw.Spinner({ spinning: false, size: 48 });
            expect(widget.spinning).toBe(false);
            expect(widget.size).toBe(48);
            const fromXml = new Adw.Spinner({ spinning: 'false', size: '32' } as Any);
            expect(fromXml.spinning).toBe(false);
            expect(fromXml.size).toBe(32);
        });
    });

    if (engine !== 'real-gio') return;

    const GObject = requireGi('GObject', '2.0') as Any;
    const Gio = requireGi('Gio', '2.0') as Any;
    const Plain = GObject.registerClass(
        {
            GTypeName: 'GjsifySpPlain',
            Properties: {
                spinning: GObject.ParamSpec.boolean('spinning', '', '', GObject.ParamFlags.READWRITE, true),
            },
        },
        class Plain extends GObject.Object {},
    );

    await describe('Adw.Spinner IS a GObject on the real engine', async () => {
        await it('the widget is a GObject.Object and its GType carries the declared name', () => {
            const widget = new Adw.Spinner();
            info(`gtype=${GObject.type_name(mixin.$gtype)} skipped=[${(mixin.$foreignSkipped ?? []).join(',')}]`);
            expect(widget instanceof GObject.Object).toBe(true);
            expect(mixin.$gtypeName).toBe('AdwSpinner');
            expect(GObject.type_name(mixin.$gtype)).toBe('AdwSpinner');
            expect([...(mixin.$foreignSkipped ?? [])].sort().join(',')).toBe('get_property,setProperty,set_property');
        });

        await it('typed properties survive the native store', () => {
            const widget = new Adw.Spinner();
            (widget as Any).set_property('size', 40);
            expect(widget.get_property('size')).toBe(40);
            expect(typeof widget.get_property('spinning')).toBe('boolean');
            expect(widget.width).toBe(40);
        });

        await it('bind_property binds spinning to a plain GObject and back, driving the ring', () => {
            const widget = new Adw.Spinner();
            mount(widget);
            const plain = new Plain();
            const binding = (widget as Any).bind_property(
                'spinning',
                plain,
                'spinning',
                GObject.BindingFlags.BIDIRECTIONAL,
            );
            widget.spinning = false;
            expect(plain.spinning).toBe(false);
            plain.spinning = true;
            info(`after plain write: spinning=${widget.spinning} busy=${indicatorOf(widget).busy}`);
            expect(widget.spinning).toBe(true);
            expect(indicatorOf(widget).busy).toBe(true);
            binding.unbind();
        });

        await it('Gio.ListStore append/get_item returns the same widget', () => {
            const store = new Gio.ListStore({ item_type: GObject.Object.$gtype });
            const widget = new Adw.Spinner({ size: 32 });
            store.append(widget);
            const back = store.get_item(0);
            expect(back === widget).toBe(true);
            expect(back.size).toBe(32);
        });
    });
};

export default spinnerSpec;
