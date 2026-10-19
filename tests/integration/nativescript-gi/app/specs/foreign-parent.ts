// ADR 0105 § 2, ROUTE D: `GObject.registerClass(meta, class MyLabel extends Label {})`. The JS
// object IS the `@nativescript/core` widget — node-gi registers a GType rooted at
// `GObject.Object` and ATTACHES a real GObject to it, instead of wrapping or re-prototyping.
// Where the 2026-10-18 inversion spike needed `widget.view` at every layout call, this needs
// none: the thing handed to `addChild` is a `Label`.
//
// The desktop suite (packages/node-gi/node-gi/test/foreign-parent.test.mjs) already covers
// registration, attach, notify, signals and identity against a real GObject. THIS file exists
// for the half that only a device can answer: layout, rendering, NativeScript's own event
// system beside GObject's, lifetime under the V8/Java runtime, and the cost against the twin.
import { Application, Frame, GestureTypes, GridLayout, Label, StackLayout, View, ViewBase } from '@nativescript/core';
import { registeredEngine } from '@gjsify/adwaita-core';
import { createRealGioEngine, runGObjectBench } from '@gjsify/adwaita-gobject-native';

import { describe, expect, info, it } from '../reporter.js';
import { requireGi } from '../opt-in.js';

/** Where `main-page.ts` finds the view to put into the page's layout (the screenshot). */
export const foreignParentMount: { view: View | null } = { view: null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const gcFn = (): void => {
    (globalThis as Any).gc?.();
    try {
        (globalThis as Any).java?.lang?.Runtime?.getRuntime()?.gc();
    } catch {
        // no Java bridge (host run)
    }
};
const tick = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Captures the EMITTER ARGUMENT, never an enclosing `this`. Written that way because the prior
 * spike measured a `this`-capturing handler as immortal on node-gi; that cycle is gone (signal
 * closures hold their callback weakly now, as in GJS) and `FpSelfCapture` asserts it, so this
 * stays the idiomatic shape rather than a workaround.
 */
function driveTextFromProp(widget: Any): void {
    widget.connect('notify::caption', (emitter: Any) => {
        emitter.text = emitter.caption;
    });
}

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

/** How many tap GESTURE observers a view carries — `on('tap')` lands here, not in the observer map. */
function tapObservers(view: Any): number {
    return (view.getGestureObservers(GestureTypes.tap) ?? []).length;
}

/**
 * A real tap: a `MotionEvent` DOWN/UP pair through `View.handleGestureTouch`, the very method
 * `@nativescript/core`'s `OnTouchListener` calls on a touch. Only the OS's delivery of the
 * event is elided — the `GestureDetectorCompat`, the `TapAndDoubleTapGestureListener` and the
 * observer callback are the production ones, and with no `doubleTap` observer registered the
 * listener fires the tap synchronously on the UP.
 */
function synthesizeTap(view: Any): boolean {
    const Android = (globalThis as Any).android;
    if (!Android?.view?.MotionEvent) return false;
    const ME = Android.view.MotionEvent;
    const t0 = Android.os.SystemClock.uptimeMillis();
    const down = ME.obtain(t0, t0, ME.ACTION_DOWN, 4, 4, 0);
    const up = ME.obtain(t0, t0 + 20, ME.ACTION_UP, 4, 4, 0);
    try {
        view.handleGestureTouch(down);
        view.handleGestureTouch(up);
    } finally {
        down.recycle();
        up.recycle();
    }
    return true;
}

export default async function foreignParentSpec(): Promise<void> {
    const GObject = requireGi('GObject', '2.0') as Any;
    const Gio = requireGi('Gio', '2.0') as Any;
    const P = GObject.ParamSpec;
    const F = GObject.ParamFlags;

    /**
     * The subject: a real `Label` subclass carrying a registered GObject property and signal.
     * `caption` is deliberately NOT a Label property — the collision case (a declared name the
     * host chain already owns) is covered by the desktop suite, and mixing the two here would
     * make a layout failure ambiguous.
     */
    const meta = (name: string): Any => ({
        GTypeName: name,
        Properties: { caption: P.string('caption', '', '', F.READWRITE, '') },
        Signals: { activated: { param_types: [] } },
    });
    const FpLabel = GObject.registerClass(meta('GjsifyFpLabel'), class FpLabel extends Label {});
    const FpWired = GObject.registerClass(
        meta('GjsifyFpWired'),
        class FpWired extends Label {
            constructor() {
                super();
                // Built OUTSIDE the constructor body: V8 shares one context between sibling
                // closures, so an arrow written here would carry `this` along and pin the object.
                driveTextFromProp(this);
            }
        },
    );
    const FpSelfCapture = GObject.registerClass(
        meta('GjsifyFpSelfCapture'),
        class FpSelfCapture extends Label {
            constructor() {
                super();
                (this as Any).connect('notify::caption', () => {
                    this.text = (this as Any).caption;
                });
            }
        },
    );
    const FpStack = GObject.registerClass(meta('GjsifyFpStack'), class FpStack extends StackLayout {});
    const Plain = GObject.registerClass(
        { GTypeName: 'GjsifyFpPlain', Properties: { caption: P.string('caption', '', '', F.READWRITE, '') } },
        class Plain extends GObject.Object {},
    );

    await describe('ADR 0105 § 2 route D: registerClass over a NativeScript parent class', async () => {
        // CRITERION 1 — one object, both worlds.
        await it('an instance is a Label, a View, a ViewBase AND a GObject.Object', () => {
            const w = new FpLabel();
            info(
                // `$gtype` is a GType HANDLE, not a class — it carries no `.name` on any host,
                // registered or introspected; `GObject.type_name` is what reads it.
                `ctor=${w.constructor?.name} gtype=${GObject.type_name((FpLabel as Any).$gtype)} ` +
                    `skipped=[${((FpLabel as Any).$foreignSkipped ?? []).join(',')}]`,
            );
            expect(w instanceof Label).toBe(true);
            expect(w instanceof View).toBe(true);
            expect(w instanceof ViewBase).toBe(true);
            expect(w instanceof GObject.Object).toBe(true);
            // The host half is untouched: no wrapper, no re-prototyping.
            w.text = 'host property';
            expect(w.text).toBe('host property');
        });

        // CRITERION 2 — layout, with ZERO unwraps. This is the whole point of route D.
        await it('a layout takes the widget itself: addChild, getChildAt, parent', () => {
            const slot = new StackLayout();
            const w = new FpLabel();
            w.caption = 'route D';
            slot.addChild(w);
            info(
                `children=${slot.getChildrenCount()} identity=${slot.getChildAt(0) === w} parent=${w.parent === slot}`,
            );
            expect(slot.getChildrenCount()).toBe(1);
            expect(slot.getChildAt(0) === w).toBe(true);
            expect(w.parent === slot).toBe(true);
            slot.removeChild(w);
            expect(slot.getChildrenCount()).toBe(0);
        });

        await it('a registered LAYOUT class accepts children, including another registered one', () => {
            const stack = new FpStack();
            const child = new FpLabel();
            stack.addChild(child);
            expect(stack instanceof StackLayout).toBe(true);
            expect(stack instanceof GObject.Object).toBe(true);
            expect(stack.getChildAt(0) === child).toBe(true);
        });

        // CRITERION 2 (the screenshot) — a real layout pass over the registered widget.
        await it('the widget mounts into the page and renders', async () => {
            const mounted = new FpWired();
            (mounted as Any).fontSize = 22;
            mounted.caption = 'route D: the Label IS the GObject';
            foreignParentMount.view = mounted;
            (globalThis as Any).__fpMounted = mounted;
            const host = await pageHost();
            info(`page host=${host?.constructor?.name ?? 'none'}`);
            expect(host !== null).toBe(true);
            host.addChild(mounted);
            GridLayout.setRow(mounted, 0);
            (mounted as Any).verticalAlignment = 'top';
            (mounted as Any).horizontalAlignment = 'center';
            // Clear of the inversion spike's own mount, which sits at the top of row 0.
            (mounted as Any).marginTop = 48;
            expect(host.getChildAt(host.getChildrenCount() - 1) === mounted).toBe(true);
            // The notify wiring reached the host property through the GObject property.
            expect(mounted.text).toBe('route D: the Label IS the GObject');
        });

        // CRITERION 3 — the GObject property, its notify, and binding both ways.
        await it('a declared property notifies, in every spelling, and drives Label.text', () => {
            const w = new FpWired();
            const seen: string[] = [];
            w.connect('notify::caption', (emitter: Any) => seen.push(emitter.caption));
            w.caption = 'one';
            w['caption'] = 'two';
            info(`spellings: caption=${w.caption}; text now ${w.text}`);
            expect(seen.join(',')).toBe('one,two');
            expect(w.text).toBe('two');
            // GJS's equal-value guard: setting the same value emits nothing.
            w.caption = 'two';
            expect(seen.length).toBe(2);
        });

        await it('bind_property binds the widget to a plain GObject and back', () => {
            const w = new FpLabel();
            const plain = new Plain();
            const binding = w.bind_property('caption', plain, 'caption', GObject.BindingFlags.BIDIRECTIONAL);
            w.caption = 'from widget';
            expect(plain.caption).toBe('from widget');
            plain.caption = 'from plain';
            expect(w.caption).toBe('from plain');
            binding.unbind();
            plain.caption = 'after unbind';
            info(`after unbind, widget caption stayed ${w.caption}`);
            expect(w.caption).toBe('from plain');
        });

        // CRITERION 4 — both event systems, side by side, on the same object.
        await it('a registered signal connects and emits', () => {
            const w = new FpLabel();
            let n = 0;
            const id = w.connect('activated', () => n++);
            w.emit('activated');
            w.emit('activated');
            w.disconnect(id);
            w.emit('activated');
            expect(n).toBe(2);
        });

        await it('NativeScript events still work beside GObject signals on one object', () => {
            const w = new FpLabel();
            const control = new Label();
            let gsignals = 0;
            let gnotify = 0;
            let nsNotify = 0;
            const onCustom = (): void => {
                nsNotify++;
            };
            w.on('custom', onCustom);
            w.connect('activated', () => gsignals++);
            w.connect('notify::caption', () => gnotify++);
            // NativeScript's own dispatch: the inherited Observable.notify({ eventName }).
            w.notify({ eventName: 'custom', object: w });
            // GObject's dispatch, same method name, resolved by argument type.
            w.notify('caption');
            w.emit('activated');
            info(`nsCustom=${nsNotify} gsignal=${gsignals} gnotify=${gnotify}`);
            expect(nsNotify).toBe(1);
            expect(gsignals).toBe(1);
            expect(gnotify).toBe(1);
            // And the host's own bookkeeping is intact: `notify` answers GObject for a string
            // argument without the Observable half losing a single listener.
            expect(w.hasListeners('custom')).toBe(true);
            w.off('custom', onCustom);
            expect(w.hasListeners('custom')).toBe(false);
            // A GESTURE name takes a DIFFERENT route in @nativescript/core:
            // View.addEventListener sends 'tap' to a GesturesObserver, never to the Observable
            // observer map, so `hasListeners('tap')` is false and `notify({eventName:'tap'})`
            // reaches nothing — on a plain Label just as much as here. The assertion is
            // therefore PARITY with the control, and the gesture is driven for real below.
            const onTap = (): void => {};
            w.on('tap', onTap);
            control.on('tap', onTap);
            info(
                `tap observers: routeD=${tapObservers(w)} plainLabel=${tapObservers(control)} ` +
                    `hasListeners=${w.hasListeners('tap')}/${control.hasListeners('tap')}`,
            );
            expect(tapObservers(w)).toBe(1);
            expect(tapObservers(w)).toBe(tapObservers(control));
            expect(w.hasListeners('tap')).toBe(control.hasListeners('tap'));
            w.off('tap', onTap);
            control.off('tap', onTap);
            expect(tapObservers(w)).toBe(0);
            expect(tapObservers(w)).toBe(tapObservers(control));
        });

        await it('a mounted widget receives a real android tap, which drives the GObject property', async () => {
            const host = await pageHost();
            const w = new FpWired();
            expect(host !== null).toBe(true);
            host.addChild(w);
            GridLayout.setRow(w, 0);
            (w as Any).verticalAlignment = 'top';
            (w as Any).horizontalAlignment = 'center';
            (w as Any).marginTop = 96;
            (w as Any).fontSize = 14;
            w.caption = 'tap target';
            // The gesture observer attaches its detector on `loaded` (or straight away when the
            // view is already loaded), so the listener goes on after the layout pass.
            const loaded = await waitFor(() => (w as Any).isLoaded === true);
            let taps = 0;
            w.on('tap', (args: Any) => {
                taps++;
                // Writes the GOBJECT property; FpWired's notify wiring carries it to Label.text.
                (args.object as Any).caption = 'tapped';
            });
            const drove = synthesizeTap(w);
            info(`loaded=${loaded} observers=${tapObservers(w)} drove=${drove} taps=${taps} text=${w.text}`);
            expect(loaded).toBe(true);
            expect(tapObservers(w)).toBe(1);
            expect(drove).toBe(true);
            expect(taps).toBe(1);
            expect(w.caption).toBe('tapped');
            expect(w.text).toBe('tapped');
            host.removeChild(w);
        });

        // CRITERION 5 — identity through C.
        await it('Gio.ListStore append/get_item returns the same JS object', () => {
            const store = new Gio.ListStore({ item_type: GObject.Object.$gtype });
            const w = new FpLabel();
            w.caption = 'in store';
            w.text = 'host state';
            store.append(w);
            const back = store.get_item(0);
            info(`identity=${back === w} isLabel=${back instanceof Label} text=${back.text}`);
            expect(back === w).toBe(true);
            expect(back instanceof Label).toBe(true);
            expect(back.text).toBe('host state');
        });

        // CRITERION 6 — lifetime. Two witnesses; `WeakRef` alone is no witness on this runtime.
        const finalized = new Set<string>();
        const registry = new FinalizationRegistry<string>((token) => finalized.add(token));
        let serial = 0;
        const waitFinalized = async (tokens: string[], rounds = 8): Promise<boolean> => {
            for (let round = 0; round < rounds; round++) {
                gcFn();
                await tick(60);
                if (tokens.every((t) => finalized.has(t))) return true;
            }
            return tokens.every((t) => finalized.has(t));
        };
        const hasGc = typeof (globalThis as Any).gc === 'function';
        info(`gc() available: ${hasGc}; java gc: ${typeof (globalThis as Any).java?.lang?.Runtime}`);

        await it('lifetime: a dropped plain Label is collected (control)', async () => {
            const token = `c${++serial}`;
            (() => registry.register(new Label(), token))();
            const gone = await waitFinalized([token]);
            info(`plain Label collected: ${gone}`);
            expect(gone).toBe(true);
        });

        await it('lifetime: removed from the tree and dropped, the widget is finalized', async () => {
            const slot = new StackLayout();
            const token = `w${++serial}`;
            (() => {
                const w = new FpWired();
                registry.register(w, token);
                w.caption = 'transient';
                slot.addChild(w);
                slot.removeChild(w);
            })();
            const gone = await waitFinalized([token]);
            info(`removed foreign-parent widget finalized: ${gone}; slot children ${slot.getChildrenCount()}`);
            expect(gone).toBe(true);
        });

        await it('lifetime: the attached GObject goes too (toggle-ref path)', async () => {
            // A separate witness on the GObject side: once the JS object is gone the toggle-ref
            // must drop the last reference, so a weak notification is the only thing that can
            // still answer. The store holds the only C reference until it is emptied.
            const store = new Gio.ListStore({ item_type: GObject.Object.$gtype });
            const token = `g${++serial}`;
            (() => {
                const w = new FpLabel();
                registry.register(w, token);
                store.append(w);
                store.remove(0);
            })();
            const gone = await waitFinalized([token]);
            info(`widget held only through a ListStore, then released: finalized=${gone}; n=${store.get_n_items()}`);
            expect(store.get_n_items()).toBe(0);
            expect(gone).toBe(true);
        });

        await it('lifetime: a handler capturing `this` does not pin the widget', async () => {
            const token = `s${++serial}`;
            (() => {
                const w = new FpSelfCapture();
                registry.register(w, token);
                w.caption = 'self';
            })();
            const gone = await waitFinalized([token], 6);
            info(`this-capturing handler: widget finalized=${gone} (prior spike: false)`);
            expect(gone).toBe(true);
        });

        await it('lifetime: a live widget is not collected early, with both halves intact', async () => {
            const token = `l${++serial}`;
            const kept = new FpWired();
            registry.register(kept, token);
            kept.caption = 'alive';
            (globalThis as Any).__fpKeep = kept;
            const gone = await waitFinalized([token], 4);
            info(`live widget collected early: ${gone}`);
            expect(gone).toBe(false);
            expect(kept.caption).toBe('alive');
            expect(kept.text).toBe('alive');
            expect(kept instanceof GObject.Object).toBe(true);
        });

        await it('lifetime: a widget held by C survives GC with identity and host state', async () => {
            const store = new Gio.ListStore({ item_type: GObject.Object.$gtype });
            (globalThis as Any).__fpStore = store;
            const w = new FpLabel();
            w.caption = 'stored';
            w.text = 'stored host';
            store.append(w);
            for (let round = 0; round < 4; round++) {
                gcFn();
                await tick(60);
            }
            const back = store.get_item(0);
            info(`store-held after gc: identity=${back === w} text=${back.text}`);
            expect(back === w).toBe(true);
            expect(back.text).toBe('stored host');
        });

        if (__GJSIFY_GI_BENCH__) {
            await benchForeignParent();
        }
    });

    // CRITERION 7 — the cost, by the method of docs/reports/2026-10-15-adr-0110-gates.md:
    // interleaved rounds against the twin in the same process, first two rounds dropped,
    // median of the rest.
    async function benchForeignParent(): Promise<void> {
        const iterations = 4000;
        const repeats = 7;
        const now = (): number => (globalThis as Any).performance.now() * 1e6;
        const median = (v: number[]): number => [...v].sort((a, b) => a - b)[v.length >> 1]!;

        const bare = new FpLabel();
        let n1 = 0;
        bare.connect('notify::caption', () => n1++);
        bare.connect('activated', () => n1++);
        const wired = new FpWired();
        let n2 = 0;
        wired.connect('notify::caption', () => n2++);
        const hostOnly = new Label();

        const engine = registeredEngine() ?? createRealGioEngine(requireGi);
        const rows: Record<string, number[]> = {
            'route-D bare set+notify': [],
            'route-D wired set+notify (drives Label.text)': [],
            'route-D emit': [],
            'plain Label.text set (host baseline)': [],
            'twin set+notify': [],
            'twin emit': [],
        };
        const timeOne = (name: string, body: () => void): void => {
            const started = now();
            body();
            rows[name]!.push((now() - started) / iterations);
        };
        for (let round = 0; round < repeats + 2; round++) {
            timeOne('route-D bare set+notify', () => {
                for (let i = 0; i < iterations; i++) bare.caption = i % 2 === 0 ? 'a' : 'b';
            });
            timeOne('route-D wired set+notify (drives Label.text)', () => {
                for (let i = 0; i < iterations; i++) wired.caption = i % 2 === 0 ? 'a' : 'b';
            });
            timeOne('route-D emit', () => {
                for (let i = 0; i < iterations; i++) bare.emit('activated');
            });
            timeOne('plain Label.text set (host baseline)', () => {
                for (let i = 0; i < iterations; i++) hostOnly.text = i % 2 === 0 ? 'a' : 'b';
            });
            const twin = runGObjectBench(engine, { iterations, repeats: 1, warmups: 0 });
            rows['twin set+notify']!.push(twin.cases.find((c) => c.name === 'set+notify')!.medianNs);
            rows['twin emit']!.push(twin.cases.find((c) => c.name === 'emit')!.medianNs);
        }
        const medians: Record<string, number> = {};
        for (const [name, values] of Object.entries(rows)) {
            const kept = values.slice(2);
            medians[name] = median(kept);
            info(
                `${name}: median ${medians[name]!.toFixed(0)} ns/op (min ${Math.min(...kept).toFixed(0)}, max ${Math.max(...kept).toFixed(0)}; ${iterations} ops x ${kept.length} interleaved rounds)`,
            );
        }
        info(
            `ratio twin/route-D set+notify: ${(medians['twin set+notify']! / medians['route-D bare set+notify']!).toFixed(2)}x`,
        );
        info(`ratio twin/route-D emit: ${(medians['twin emit']! / medians['route-D emit']!).toFixed(2)}x`);
        await it('the route-D benchmark ran', () => {
            expect(Object.values(medians).every((v) => v > 0 && isFinite(v))).toBe(true);
            expect(n1 + n2 > 0).toBe(true);
        });
    }
}
