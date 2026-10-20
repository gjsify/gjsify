// THE FIRST MIGRATED PORT WIDGET ON A DEVICE (ADR 0105 § 2, route D).
//
// `specs/foreign-parent.ts` drives route D against classes written FOR the probe —
// `class FpLabel extends Label {}` with a `caption` nobody ships. This file drives the thing a
// consumer actually imports: `Adw.WindowTitle`, whose `title` and `subtitle` are declared at its
// `extends` and built by `widgets/signals.ts`. On this leg's real engine they are properties of a
// GType registered over `StackLayout`; on the control leg they are the seam's own accessors. The
// widget is the same import either way, which is the claim the migration makes.
//
// EVERY CASE IN THE FIRST SUITE RUNS IN BOTH LEGS, for the reason `specs/views.ts` gives: they
// are statements about the widget, not about an engine, so a difference between the two runs is a
// defect in whichever engine disagrees. The SECOND suite is real-GObject only and says so — a
// GType, `bind_property` and `Gio.ListStore` identity are what route D buys, and on the subset
// there is nothing there to measure rather than something that behaves differently.
//
// What only a device can answer, and the reason this is not just another unit spec: the seam
// deletes `connect`/`disconnect`/`emit` off the mixin prototype and puts routers back over what
// `registerClass` installed, and it does so at the FIRST CONSTRUCTION of the class. Off-device
// that path runs against a stub engine (`signals-gobject.spec.ts`); here it runs against node-gi
// on the V8/Java runtime, with a real layout pass over the two `Label`s afterwards.
import { Adw } from '@gjsify/adwaita-nativescript';
import { Application, Frame, GridLayout, Label, StackLayout, View, ViewBase } from '@nativescript/core';

import { describe, expect, info, it } from '../reporter.js';
import { requireGi } from '../opt-in.js';

/** Where `main-page.ts` finds the view to put into the page's layout (the screenshot). */
export const windowTitleMount: { view: View | null } = { view: null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** The two `Label`s the widget keeps; `_apply()` is their only writer. */
interface Labels {
    _titleLabel: Label;
    _subtitleLabel: Label;
}

function labelsOf(widget: Adw.WindowTitle): Labels {
    return widget as unknown as Labels;
}

const tick = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `pred` until it holds or the budget runs out. Returns its final value. */
async function waitFor(pred: () => boolean, budgetMs = 10000): Promise<boolean> {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
        if (pred()) return true;
        await tick(50);
    }
    return pred();
}

/** The page's `GridLayout`, once the frame has one. `null` if it never appears. */
async function pageHost(): Promise<Any> {
    let host: Any = null;
    await waitFor(() => {
        const root = Application.getRootView() as Any;
        const page = root?.content !== undefined ? root : (Frame.topmost()?.currentPage ?? root?.currentPage);
        const content = page?.content as Any;
        if (content instanceof GridLayout) {
            host = content;
            return true;
        }
        return false;
    });
    return host;
}

/**
 * @param engine the engine this leg runs on — reported, and branched on for the second suite
 *   only, which exists to measure what the real engine adds.
 */
export const windowTitleSpec = (engine: 'real-gio' | 'pure-js') => async (): Promise<void> => {
    // The MIXIN class is where the seam registers, so it is where a GType lands: one per widget
    // class, shared by every port subclass, as GObject inheritance is.
    const mixin = Object.getPrototypeOf(Adw.WindowTitle) as Any;

    await describe(`Adw.WindowTitle on '${engine}' (ADR 0105 § 2, route D)`, async () => {
        await it('constructs as a real NativeScript StackLayout with two labels', () => {
            const widget = new Adw.WindowTitle();
            info(
                `ctor=${widget.constructor?.name} gtypeName=${mixin.$gtypeName ?? 'none'} ` +
                    `skipped=[${(mixin.$foreignSkipped ?? []).join(',')}]`,
            );
            expect(widget instanceof StackLayout).toBe(true);
            expect(widget instanceof View).toBe(true);
            expect(widget instanceof ViewBase).toBe(true);
            expect(labelsOf(widget)._titleLabel instanceof Label).toBe(true);
            expect(labelsOf(widget)._subtitleLabel instanceof Label).toBe(true);
        });

        await it('starts with both properties empty and both labels collapsed', () => {
            const widget = new Adw.WindowTitle();
            expect(widget.title).toBe('');
            expect(widget.subtitle).toBe('');
            expect(labelsOf(widget)._titleLabel.visibility).toBe('collapse');
            expect(labelsOf(widget)._subtitleLabel.visibility).toBe('collapse');
        });

        await it('a write reaches the label through notify::, not through a setter', () => {
            const widget = new Adw.WindowTitle();
            widget.title = 'Inbox';
            widget.subtitle = '12 unread';
            info(`title label=${labelsOf(widget)._titleLabel.text} subtitle=${labelsOf(widget)._subtitleLabel.text}`);
            expect(labelsOf(widget)._titleLabel.text).toBe('Inbox');
            expect(labelsOf(widget)._titleLabel.visibility).toBe('visible');
            expect(labelsOf(widget)._subtitleLabel.text).toBe('12 unread');
            expect(labelsOf(widget)._subtitleLabel.visibility).toBe('visible');
            // The title hides when empty (adw-window-title.c:207-208).
            widget.title = '';
            expect(labelsOf(widget)._titleLabel.visibility).toBe('collapse');
        });

        await it('notifies on a change, stays silent on an equal write, and stops on disconnect', () => {
            const widget = new Adw.WindowTitle();
            const seen: string[] = [];
            const id = widget.connect('notify::title', (self: Adw.WindowTitle) => seen.push(self.title));
            widget.title = 'Inbox';
            widget.title = 'Inbox';
            widget.title = 'Drafts';
            widget.disconnect(id);
            widget.title = 'Sent';
            info(`seen=[${seen.join(',')}] handlerId=${id}`);
            expect(seen.join(',')).toBe('Inbox,Drafts');
            expect(widget.title).toBe('Sent');
            expect(() => widget.disconnect(id)).toThrow();
        });

        await it("answers GJS's notify('title') beside NativeScript's notify({ eventName })", () => {
            const widget = new Adw.WindowTitle();
            let gnotify = 0;
            let nsNotify = 0;
            widget.connect('notify::subtitle', () => gnotify++);
            widget.on('custom', () => nsNotify++);
            widget.notify('subtitle');
            widget.notify({ eventName: 'custom', object: widget as Any });
            info(`gnotify=${gnotify} nsCustom=${nsNotify}`);
            expect(gnotify).toBe(1);
            expect(nsNotify).toBe(1);
        });

        await it('takes both properties as construct props, and the port property door', () => {
            const widget = new Adw.WindowTitle({ title: 'Inbox', subtitle: '12 unread' });
            expect(widget.title).toBe('Inbox');
            expect(labelsOf(widget)._titleLabel.text).toBe('Inbox');
            expect(widget.subtitle).toBe('12 unread');
            widget.set_property('title', 'Drafts');
            expect(widget.get_property('title')).toBe('Drafts');
            expect(labelsOf(widget)._titleLabel.text).toBe('Drafts');
        });

        await it('mounts into the page and renders, with the labels laid out', async () => {
            const widget = new Adw.WindowTitle({ title: 'route D', subtitle: 'the properties are a GObject' });
            windowTitleMount.view = widget as unknown as View;
            (globalThis as Any).__wtMounted = widget;
            const host = await pageHost();
            info(`page host=${host?.constructor?.name ?? 'none'}`);
            expect(host !== null).toBe(true);
            host.addChild(widget);
            GridLayout.setRow(widget as unknown as View, 0);
            (widget as Any).verticalAlignment = 'top';
            (widget as Any).horizontalAlignment = 'center';
            // Clear of the inversion spike's mount and of foreign-parent's two.
            (widget as Any).marginTop = 144;
            const loaded = await waitFor(() => (widget as Any).isLoaded === true);
            // `isLoaded` says the view is attached, NOT that it has been measured: the first
            // layout pass lands a frame or more later, and reading `getActualSize()` on the
            // attach itself measured 0x0 on both legs. So poll for the size rather than the flag.
            const measured = await waitFor(() => {
                const s = labelsOf(widget)._titleLabel.getActualSize();
                return s.width > 0 && s.height > 0;
            });
            const size = labelsOf(widget)._titleLabel.getActualSize();
            info(`loaded=${loaded} measured=${measured} title label size=${size.width}x${size.height}`);
            expect(loaded).toBe(true);
            // A collapsed label measures 0: the title's own size is the evidence that the
            // visibility `_apply()` wrote survived a real layout pass.
            expect(size.width > 0 && size.height > 0).toBe(true);
            // And a write after the layout pass still lands.
            widget.title = 'route D, laid out';
            expect(labelsOf(widget)._titleLabel.text).toBe('route D, laid out');
        });
    });

    if (engine !== 'real-gio') return;

    // WHAT ROUTE D BUYS, and the reason the migration happened at all. These have no counterpart
    // on the subset — a widget whose properties are the seam's own accessors has no GType to name
    // and no `bind_property` to bind — so they are asserted on this leg only rather than written
    // as a difference between two runs.
    const GObject = requireGi('GObject', '2.0') as Any;
    const Gio = requireGi('Gio', '2.0') as Any;
    const Plain = GObject.registerClass(
        {
            GTypeName: 'GjsifyWtPlain',
            Properties: {
                title: GObject.ParamSpec.string('title', '', '', GObject.ParamFlags.READWRITE, ''),
            },
        },
        class Plain extends GObject.Object {},
    );

    await describe('Adw.WindowTitle IS a GObject on the real engine', async () => {
        await it('the widget is a GObject.Object and its GType carries the declared name', () => {
            const widget = new Adw.WindowTitle();
            info(`gtype=${GObject.type_name(mixin.$gtype)} skipped=[${(mixin.$foreignSkipped ?? []).join(',')}]`);
            expect(widget instanceof GObject.Object).toBe(true);
            expect(mixin.$gtypeName).toBe('AdwWindowTitle');
            expect(GObject.type_name(mixin.$gtype)).toBe('AdwWindowTitle');
            // The carry-forward rule of the route-D report, with both kinds of owner in one list:
            // `get_property`/`set_property` are the PORT's own one-argument property door, which
            // answered before node-gi could install the introspected pair, and `setProperty` is
            // NativeScript's (`Observable.setProperty`) — a spelling node-gi would otherwise take
            // over on a class whose chain does not already answer it.
            expect([...(mixin.$foreignSkipped ?? [])].sort().join(',')).toBe('get_property,setProperty,set_property');
        });

        await it('one GType for the class, however many instances', () => {
            const first = new Adw.WindowTitle();
            const second = new Adw.WindowTitle();
            expect(GObject.type_from_instance !== undefined || mixin.$gtype !== undefined).toBe(true);
            expect(Object.getPrototypeOf(Object.getPrototypeOf(first))).toBe(mixin.prototype);
            expect(Object.getPrototypeOf(first)).toBe(Object.getPrototypeOf(second));
        });

        await it('bind_property binds title to a plain GObject and back, driving the label', () => {
            const widget = new Adw.WindowTitle();
            const plain = new Plain();
            const binding = (widget as Any).bind_property('title', plain, 'title', GObject.BindingFlags.BIDIRECTIONAL);
            widget.title = 'from widget';
            expect(plain.title).toBe('from widget');
            plain.title = 'from plain';
            info(`after plain write: title=${widget.title} label=${labelsOf(widget)._titleLabel.text}`);
            expect(widget.title).toBe('from plain');
            // The binding went through GObject, so `_apply()` ran off the notify and nothing else.
            expect(labelsOf(widget)._titleLabel.text).toBe('from plain');
            binding.unbind();
            plain.title = 'after unbind';
            expect(widget.title).toBe('from plain');
        });

        await it('Gio.ListStore append/get_item returns the same widget', () => {
            const store = new Gio.ListStore({ item_type: GObject.Object.$gtype });
            const widget = new Adw.WindowTitle({ title: 'in store' });
            store.append(widget);
            const back = store.get_item(0);
            info(`identity=${back === widget} isStackLayout=${back instanceof StackLayout} title=${back.title}`);
            expect(back === widget).toBe(true);
            expect(back instanceof StackLayout).toBe(true);
            expect(back.title).toBe('in store');
        });
    });
};

export default windowTitleSpec;
