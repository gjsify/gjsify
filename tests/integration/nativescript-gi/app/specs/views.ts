// THE APP-LEVEL LEG of the dual emulator run (ADR 0110 § 3) — a real NativeScript View over
// whichever engine backs the subset, asserted the same way in both legs.
//
// WHY THIS EXISTS BESIDE THE VECTORS. `specs/gobject.vectors.ts` drives `GOBJECT_VECTORS` against
// `createSubsetSubject(...)`, which is GObject logic over a plain door: it never constructs a
// NativeScript widget. The thing it therefore cannot see is the seam ADR 0110 § 3 names — the
// layer `@gjsify/adwaita-nativescript/gobject`'s `registerClass` splices BETWEEN the application
// class and the port widget, where the engine's property/signal registry meets
// `@nativescript/core`'s own `Observable` and the port's construct-props bag. Once Android stops
// shipping the subset by default, nothing else exercises that seam on the pure-JS engine at all.
//
// EVERY CASE RUNS IN BOTH LEGS, and that is the point: the assertions below are statements about
// the DOOR, not about an engine, so a difference between the two runs is a defect in whichever
// engine disagrees. The engine is named in the suite title (from `app/app.ts`, which takes it from
// the build-time define) so a logcat line says which leg it came from without counting runs.
import * as GObject from '@gjsify/adwaita-nativescript/gobject';
import { Adw, Gtk } from '@gjsify/adwaita-nativescript';
import { bindProperties, type GObjectInstance } from '@gjsify/adwaita-core';
import type { View } from '@nativescript/core';

import { describe, expect, info, it } from '../reporter.js';

/** `connect`/`emit`/`notify(string)` come from the spliced layer, not from the port widget. */
type Registered = GObjectInstance & { notify(name: string): void };

/**
 * A composite widget written the GNOME way over a REAL port widget: `Adw.Bin` is an
 * `@nativescript/core` `GridLayout` subclass, so everything below is happening on a live view.
 */
class DualEngineBin extends Adw.Bin {
    declare label: string;
    declare ticks: number;
    constructor(params?: Record<string, unknown>) {
        super(params as never);
    }
}

GObject.registerClass(
    {
        GTypeName: 'GjsifyDualEngineBin',
        Properties: {
            label: GObject.ParamSpec.string('label', '', '', GObject.ParamFlags.READWRITE, ''),
            ticks: GObject.ParamSpec.int('ticks', '', '', GObject.ParamFlags.READWRITE, 0, 1000, 0),
        },
        Signals: { tapped: { param_types: [GObject.TYPE_STRING] } },
    },
    DualEngineBin,
);

/** The one child class, so the `instanceof` below is about the slot and not about two classes. */
class DualEngineLeaf extends Adw.Bin {
    declare caption: string;
}

GObject.registerClass(
    {
        GTypeName: 'GjsifyDualEngineLeaf',
        Properties: { caption: GObject.ParamSpec.string('caption', '', '', GObject.ParamFlags.READWRITE, '') },
    },
    DualEngineLeaf,
);

/**
 * @param engine the engine this leg runs on — reported, never branched on. A case that only holds
 *   for one engine would defeat the purpose of running the suite twice.
 */
export const viewsSpec = (engine: 'real-gio' | 'pure-js') => async (): Promise<void> => {
    await describe(`the NativeScript View door on '${engine}' (ADR 0110 § 3)`, async () => {
        await it('a registered class constructs from the bag and is still a real NativeScript View', () => {
            const bin = new DualEngineBin({ label: 'hello', ticks: 3 });
            expect(bin.label).toBe('hello');
            expect(bin.ticks).toBe(3);
            // `Adw.Bin` is a `GridLayout`: if the spliced layer had replaced the prototype chain
            // rather than been inserted into it, the widget would no longer be the view the port
            // lays out, and every XML and construct-props door over it would be building something
            // NativeScript cannot mount.
            expect(bin instanceof Adw.Bin).toBe(true);
            expect(typeof (bin as unknown as { eachChildView?: unknown }).eachChildView).toBe('function');
        });

        await it('the port keeps its own construct door: an undeclared key is refused', () => {
            // `applyConstructProps` runs on the REMAINDER the engine's registry did not claim, so
            // this is the one assertion that the two doors are chained rather than one shadowing
            // the other. A key that silently stuck would be a dead own-property on a live widget.
            let message = '';
            try {
                new DualEngineBin({ label: 'ok', nonsense: 1 });
            } catch (error) {
                message = error instanceof Error ? error.message : String(error);
            }
            info(`undeclared construct key said: ${message}`);
            expect(message).toContain('nonsense');
        });

        await it('a declared property notifies through the layer, and only on a real change', () => {
            const bin = new DualEngineBin();
            const seen: string[] = [];
            const id = (bin as unknown as Registered).connect('notify::label', () => seen.push(bin.label));
            bin.label = 'one';
            bin.label = 'one';
            bin.label = 'two';
            (bin as unknown as Registered).disconnect(id);
            bin.label = 'three';
            expect(seen.join(',')).toBe('one,two');
            expect(bin.label).toBe('three');
        });

        await it("NativeScript's own payload `notify` still reaches addEventListener", () => {
            // The layer overloads `notify`: a STRING is the engine's property notification, an
            // OBJECT is `Observable.notify` — the call every port widget makes to announce
            // `textChange` and friends. Losing the object form would silence the port's own
            // events on every registered class, which no vector would notice.
            const bin = new DualEngineBin();
            const seen: string[] = [];
            const listener = (data: unknown): void => {
                seen.push(String((data as { eventName: string }).eventName));
            };
            (bin as unknown as { addEventListener(n: string, l: (d: unknown) => void): void }).addEventListener(
                'customEvent',
                listener,
            );
            (bin as unknown as { notify(d: object): void }).notify({ eventName: 'customEvent', object: bin });
            (bin as unknown as Registered).notify('label');
            expect(seen.join(',')).toBe('customEvent');
        });

        await it('a declared signal carries its argument, and disconnect stops it', () => {
            const bin = new DualEngineBin();
            const seen: string[] = [];
            const id = (bin as unknown as Registered).connect('tapped', (_self: unknown, where: unknown) => {
                seen.push(String(where));
            });
            (bin as unknown as Registered).emit('tapped', 'first');
            (bin as unknown as Registered).disconnect(id);
            (bin as unknown as Registered).emit('tapped', 'second');
            expect(seen.join(',')).toBe('first');
        });

        await it('the child slot still takes a view, and the view reaches the NativeScript tree', () => {
            const bin = new DualEngineBin({ label: 'parent' });
            const leaf = new DualEngineLeaf();
            leaf.caption = 'inner';
            bin.child = leaf as unknown as View;
            expect(bin.get_child() === (leaf as unknown as View)).toBe(true);

            const children: unknown[] = [];
            (bin as unknown as { eachChildView(cb: (v: unknown) => boolean): void }).eachChildView((view) => {
                children.push(view);
                return true;
            });
            expect(children.length).toBe(1);
            expect(children[0] === (leaf as unknown as View)).toBe(true);
        });

        await it('bindProperties keeps two live widgets in step', () => {
            // `sync-create` is what transfers at bind time; without it the target keeps its own
            // value until the first `notify::` — the same contract as `g_object_bind_property`.
            const source = new DualEngineBin({ label: 'start' });
            const target = new DualEngineLeaf();
            const binding = bindProperties(
                source as unknown as GObjectInstance,
                'label',
                target as unknown as GObjectInstance,
                'caption',
                ['sync-create'],
            );
            expect(target.caption).toBe('start');
            source.label = 'moved';
            expect(target.caption).toBe('moved');

            binding.unbind();
            source.label = 'after unbind';
            expect(target.caption).toBe('moved');
        });

        await it('a port widget that is not registered is untouched by the engine', () => {
            // The layer is spliced per registered class. A plain `Gtk.Box` must keep the port's
            // own `append` and its NativeScript children — the control for everything above.
            const box = new Gtk.Box();
            const label = new Gtk.Label();
            label.label = 'plain';
            box.append(label as unknown as View);
            const children: unknown[] = [];
            box.eachChildView((view: unknown) => {
                children.push(view);
                return true;
            });
            expect(children.length).toBe(1);
            expect(label.label).toBe('plain');
        });
    });
};
