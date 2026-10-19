// THE ADR 0105 § 2 SPIKE: can a REAL `GObject.registerClass` widget own its NativeScript `View`
// instead of a `View` owning a GObject twin? Report: docs/reports/2026-10-18-adr-0105-inversion-spike.md.
//
// The widget is a `GObject.Object` subclass that holds a `Label` by composition. The probes
// below are the proof points the report lists; every attempt that is expected to fail records
// the exact NativeScript message with `info`, because the message IS the finding.
import { Application, Frame, GridLayout, Label, StackLayout, View } from '@nativescript/core';
import { PURE_JS_ENGINE, registeredEngine } from '@gjsify/adwaita-core';
import { createRealGioEngine, runGObjectBench } from '@gjsify/adwaita-gobject-native';

import { describe, expect, info, it } from '../reporter.js';
import { requireGi } from '../opt-in.js';

/** Where `main-page.ts` finds the view to put into the page's layout (the screenshot). */
export const inversionMount: { view: View | null } = { view: null };

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

/** Captures the view and the emitter ARGUMENT, never the widget. */
function bindTextToView(widget: Any, view: Label): void {
    widget.connect('notify::text', (emitter: Any) => {
        view.text = emitter.text;
    });
}

export default async function inversionSpec(): Promise<void> {
    const GObject = requireGi('GObject', '2.0') as Any;
    const Gio = requireGi('Gio', '2.0') as Any;
    const P = GObject.ParamSpec;
    const F = GObject.ParamFlags;

    const makeClass = (name: string, bindHandler: boolean | 'emitter-only', backRef = false): Any =>
        GObject.registerClass(
            {
                GTypeName: name,
                Properties: { text: P.string('text', '', '', F.READWRITE, '') },
                Signals: { tapped: { param_types: [] } },
            },
            class extends GObject.Object {
                view: Label;
                constructor() {
                    super();
                    this.view = new Label();
                    if (backRef) (this.view as Any).owner = this;
                    if (bindHandler === 'emitter-only') {
                        // The closure is built OUTSIDE this constructor: V8 shares one context
                        // between sibling closures, so an arrow here would carry `this` along.
                        bindTextToView(this, this.view);
                    } else if (bindHandler) {
                        // The realistic wiring: the property drives the owned view. The closure
                        // captures `this`, which is the cycle candidate the lifetime cases probe.
                        this.connect('notify::text', () => {
                            this.view.text = (this as Any).text;
                        });
                    }
                }
            },
        );

    const InvLabel = makeClass('GjsifyInvLabel', true);
    const InvBare = makeClass('GjsifyInvBare', false);
    const InvEmitterOnly = makeClass('GjsifyInvEmitterOnly', 'emitter-only');
    const InvBackRef = makeClass('GjsifyInvBackRef', false, true);
    const InvPlain2 = GObject.registerClass(
        {
            GTypeName: 'GjsifyInvPlain2',
            Properties: { text: P.string('text', '', '', F.READWRITE, '') },
            Signals: { tapped: { param_types: [] } },
        },
        class extends GObject.Object {},
    );
    // The view-less control: the same registerClass shape with nothing NativeScript inside it.
    const InvPlain = GObject.registerClass(
        { GTypeName: 'GjsifyInvPlain', Properties: { text: P.string('text', '', '', F.READWRITE, '') } },
        class extends GObject.Object {},
    );

    await describe('ADR 0105 § 2 spike: a real GObject widget owning its NativeScript View', async () => {
        await it('constructs through a JS constructor and is a real GObject', () => {
            const widget = new InvLabel();
            info(`typeof widget.view=${typeof widget.view} constructor=${widget.constructor?.name}`);
            expect(widget instanceof GObject.Object).toBe(true);
            expect(widget.view instanceof Label).toBe(true);
        });

        await it('properties, notify and a signal work without a twin', () => {
            const widget = new InvLabel();
            const seen: string[] = [];
            widget.connect('notify::text', () => seen.push(widget.text));
            widget.text = 'one';
            widget.text = 'two';
            let tapped = 0;
            widget.connect('tapped', () => tapped++);
            widget.emit('tapped');
            expect(seen.join(',')).toBe('one,two');
            expect(widget.view.text).toBe('two');
            expect(tapped).toBe(1);
        });

        await it('Gio.ListStore append/get_item returns the same JS object', () => {
            const store = new Gio.ListStore({ item_type: GObject.Object.$gtype });
            const widget = new InvLabel();
            store.append(widget);
            const back = store.get_item(0);
            info(`list store identity: ${back === widget}; back instanceof InvLabel: ${back instanceof InvLabel}`);
            expect(back === widget).toBe(true);
            expect(back.view === widget.view).toBe(true);
        });

        await it('the narrow unwrap lays out: widget.view in a layout, one pass', () => {
            const slot = new StackLayout();
            const widget = new InvLabel();
            widget.text = 'inverted GObject widget';
            slot.addChild(widget.view);
            expect(widget.view.parent === slot).toBe(true);
            expect(slot.getChildrenCount()).toBe(1);
            const mounted = new InvLabel();
            mounted.text = 'inverted: GObject owns the View';
            (mounted.view as Any).fontSize = 22;
            inversionMount.view = mounted.view;
            // Mount into whatever page is current once the UI exists (this suite starts before
            // Application.run), so the screenshot shows one real layout pass over the owned view.
            const tryMount = (attempt: number): void => {
                const root = Application.getRootView() as Any;
                const page = root?.content !== undefined ? root : (Frame.topmost()?.currentPage ?? root?.currentPage);
                const host = page?.content as Any;
                if (host instanceof GridLayout) {
                    host.addChild(mounted.view);
                    GridLayout.setRow(mounted.view, 0);
                    (mounted.view as Any).verticalAlignment = 'top';
                    (mounted.view as Any).horizontalAlignment = 'center';
                    console.log(
                        `__GJSIFY_NS__ INFO mount :: mounted into ${host.constructor.name} after ${attempt} tries`,
                    );
                } else if (attempt < 200) {
                    setTimeout(() => tryMount(attempt + 1), 100);
                }
            };
            tryMount(0);
            (globalThis as Any).__invMounted = mounted;
        });

        await it('passing the widget itself to NativeScript is refused (names the failure)', () => {
            const slot = new StackLayout();
            const widget = new InvLabel();
            const attempts: [string, () => void][] = [
                ['LayoutBase.addChild(widget)', () => slot.addChild(widget as Any)],
                ['Page-like content = widget', () => ((slot as Any).content = widget)],
                ['widget instanceof View', () => expect(widget instanceof View).toBe(true)],
            ];
            for (const [label, run] of attempts) {
                let said = 'NO ERROR';
                try {
                    run();
                } catch (error) {
                    said = error instanceof Error ? error.message : String(error);
                }
                info(`${label}: ${said}`);
            }
            info(`slot children after direct addChild: ${slot.getChildrenCount()}`);
            expect(widget instanceof View).toBe(false);
        });

        await it('a View subclass cannot be a GObject subclass (names the failure)', () => {
            let said = 'NO ERROR';
            try {
                const Mixed = GObject.registerClass({ GTypeName: 'GjsifyInvMixed' }, class extends Label {});
                const mixed = new Mixed();
                said = `constructed: instanceof GObject.Object=${mixed instanceof GObject.Object}`;
            } catch (error) {
                said = error instanceof Error ? error.message : String(error);
            }
            info(`registerClass(class extends Label): ${said}`);
        });

        // Lifetime. `gc` needs --expose_gc (nativescript.config.ts); a collected object then
        // needs the main loop to turn for node-gi's toggle-ref teardown (g_idle_add).
        // Two independent witnesses, because V8's WeakRef keeps its target alive until the
        // embedder clears kept objects, and a runtime that never does would make every probe
        // read "alive": the FinalizationRegistry callback is the second opinion.
        const registry = new FinalizationRegistry<string>((token) => finalized.add(token));
        const finalized = new Set<string>();
        let serial = 0;
        const collectedAfter = async (
            create: (watch: (target: object) => string) => { weak?: WeakRef<object>; keep?: unknown },
            keep = false,
        ) => {
            let token = '';
            const made = create((target) => {
                token = `t${++serial}`;
                registry.register(target, token);
                return token;
            });
            (globalThis as Any).__invKeep = keep ? made.keep : undefined;
            for (let round = 0; round < 8; round++) {
                gcFn();
                await tick(60);
                if (!keep && finalized.has(token)) break;
            }
            const byWeak = made.weak !== undefined && made.weak.deref() === undefined;
            const byRegistry = finalized.has(token);
            info(`witnesses: finalization callback=${byRegistry}, weakref cleared=${byWeak}`);
            return byWeak || byRegistry;
        };
        const hasGc = typeof (globalThis as Any).gc === 'function';
        info(`gc() available: ${hasGc}; java gc: ${typeof (globalThis as Any).java?.lang?.Runtime}`);

        await it('lifetime: a dropped plain JS object is collected (probe control)', async () => {
            const gone = await collectedAfter((watch) => {
                const plain = { payload: Array.from({ length: 1000 }, () => 1) };
                watch(plain);
                return {};
            });
            info(`plain JS object collected: ${gone}`);
            expect(gone).toBe(true);
        });

        await it('lifetime: a dropped plain Label is collected (control)', async () => {
            const gone = await collectedAfter((watch) => {
                const label = new Label();
                watch(label);
                return {};
            });
            info(`plain Label collected: ${gone}`);
            expect(gone).toBe(true);
        });

        await it('lifetime: a dropped view-less registerClass GObject is collected (control)', async () => {
            const gone = await collectedAfter((watch) => {
                const plain = new InvPlain();
                watch(plain);
                return {};
            });
            info(`view-less GObject collected: ${gone}`);
            expect(gone).toBe(true);
        });

        await it('lifetime: a dropped GObject with no handler is collected', async () => {
            const gone = await collectedAfter((watch) => {
                const bare = new InvBare();
                watch(bare);
                return {};
            });
            info(`bare inverted widget collected: ${gone}`);
            expect(gone).toBe(true);
        });

        await it('lifetime: removed from the tree and dropped, the widget AND its view are finalized', async () => {
            const slot = new StackLayout();
            let widgetToken = '';
            let viewToken = '';
            (() => {
                const widget = new InvEmitterOnly();
                widgetToken = `w${++serial}`;
                viewToken = `v${++serial}`;
                registry.register(widget, widgetToken);
                registry.register(widget.view, viewToken);
                slot.addChild(widget.view);
                slot.removeChild(widget.view);
            })();
            for (let round = 0; round < 8 && !(finalized.has(widgetToken) && finalized.has(viewToken)); round++) {
                gcFn();
                await tick(60);
            }
            info(
                `emitter-only widget finalized: ${finalized.has(widgetToken)}; its view finalized: ${finalized.has(viewToken)}`,
            );
            expect(finalized.has(widgetToken) && finalized.has(viewToken)).toBe(true);
        });

        await it('lifetime: a handler capturing `this` does not pin the widget', async () => {
            const slot = new StackLayout();
            let widgetToken = '';
            (() => {
                const widget = new InvLabel();
                widgetToken = `w${++serial}`;
                registry.register(widget, widgetToken);
                slot.addChild(widget.view);
                slot.removeChild(widget.view);
            })();
            for (let round = 0; round < 8 && !finalized.has(widgetToken); round++) {
                gcFn();
                await tick(60);
            }
            info(`this-capturing handler: widget finalized=${finalized.has(widgetToken)}`);
            expect(finalized.has(widgetToken)).toBe(true);
        });

        for (const [label, Klass, text] of [
            ['handler that captures only the view and the emitter argument', InvEmitterOnly, 'true'],
            ['View -> widget back-reference (a pure JS cycle, no handler)', InvBackRef, 'true'],
        ] as [string, Any, string][]) {
            await it(`lifetime: ${label} is collected`, async () => {
                const gone = await collectedAfter((watch) => {
                    const widget = new Klass();
                    widget.text = 'x';
                    watch(widget);
                    return {};
                });
                info(`${label}: collected=${gone}`);
                expect(String(gone)).toBe(text);
            });
        }

        for (const [label, wire] of [
            ['connect(noop) on a view-less GObject', (w: Any) => w.connect('notify::text', () => {})],
            ['connect(noop) then disconnect', (w: Any) => w.disconnect(w.connect('notify::text', () => {}))],
            ['connect_object-free signal "tapped" noop', (w: Any) => w.connect('tapped', () => {})],
        ] as [string, (w: Any) => void][]) {
            await it(`lifetime probe: ${label}`, async () => {
                const gone = await collectedAfter((watch) => {
                    const widget = new InvPlain2();
                    wire(widget);
                    watch(widget);
                    return {};
                });
                info(`${label}: collected=${gone}`);
            });
        }

        await it('lifetime: WeakRef semantics on this runtime (probe note)', async () => {
            let weak!: WeakRef<object>;
            (() => {
                weak = new WeakRef({ payload: Array.from({ length: 1000 }, () => 1) });
            })();
            for (let round = 0; round < 4; round++) {
                gcFn();
                await tick(60);
            }
            info(`plain object behind a WeakRef cleared: ${weak.deref() === undefined}`);
        });

        await it('lifetime: a live widget is not collected early', async () => {
            const alive = await collectedAfter((watch) => {
                const widget = new InvLabel();
                watch(widget);
                widget.text = 'alive';
                return { keep: widget };
            }, true);
            const kept = (globalThis as Any).__invKeep;
            info(`live widget collected early: ${alive}`);
            expect(alive).toBe(false);
            expect(kept.text).toBe('alive');
            expect(kept.view.text).toBe('alive');
        });

        await it('lifetime: a widget held only by C (ListStore) survives GC with identity', async () => {
            const store = new Gio.ListStore({ item_type: GObject.Object.$gtype });
            (globalThis as Any).__invStore = store;
            let weak!: WeakRef<object>;
            let view!: WeakRef<object>;
            (() => {
                const widget = new InvLabel();
                widget.text = 'in store';
                weak = new WeakRef(widget);
                view = new WeakRef(widget.view);
                store.append(widget);
            })();
            for (let round = 0; round < 4; round++) {
                gcFn();
                await tick(60);
            }
            const back = store.get_item(0);
            info(`store-held: wrapper alive=${weak.deref() !== undefined}; view alive=${view.deref() !== undefined}`);
            expect(back.text).toBe('in store');
            // After the wrapper is collected the toggle-ref makes a NEW wrapper: its own JS state
            // (the owned view) would be gone. That is the finding, so it is read, not assumed.
            info(`store-held: view still reachable from item: ${back.view instanceof Label}`);
            expect(back.view instanceof Label).toBe(true);
        });

        if (__GJSIFY_GI_BENCH__) {
            await benchInverted();
        }
    });

    async function benchInverted(): Promise<void> {
        const iterations = 4000;
        const repeats = 7;
        const now = (): number => (globalThis as Any).performance.now() * 1e6;
        const median = (v: number[]): number => [...v].sort((a, b) => a - b)[v.length >> 1]!;

        const bare = new InvBare();
        let n1 = 0;
        bare.connect('notify::text', () => n1++);
        bare.connect('tapped', () => n1++);
        const wired = new InvLabel();
        let n2 = 0;
        wired.connect('notify::text', () => n2++);

        const engine = registeredEngine() ?? createRealGioEngine(requireGi);
        // The twin rows come from the benchmark's own body, once per round, interleaved below.
        const rows: Record<string, number[]> = {
            'inverted bare set+notify': [],
            'inverted wired set+notify (drives the owned Label)': [],
            'inverted emit': [],
            'twin set+notify': [],
            'twin emit': [],
        };
        const timeOne = (name: string, body: () => void): void => {
            const started = now();
            body();
            rows[name]!.push((now() - started) / iterations);
        };
        const rounds = repeats + 2;
        for (let round = 0; round < rounds; round++) {
            timeOne('inverted bare set+notify', () => {
                for (let i = 0; i < iterations; i++) bare.text = i % 2 === 0 ? 'a' : 'b';
            });
            timeOne('inverted wired set+notify (drives the owned Label)', () => {
                for (let i = 0; i < iterations; i++) wired.text = i % 2 === 0 ? 'a' : 'b';
            });
            timeOne('inverted emit', () => {
                for (let i = 0; i < iterations; i++) bare.emit('tapped');
            });
            const twin = runGObjectBench(engine, { iterations, repeats: 1, warmups: 0 });
            rows['twin set+notify']!.push(twin.cases.find((c) => c.name === 'set+notify')!.medianNs);
            rows['twin emit']!.push(twin.cases.find((c) => c.name === 'emit')!.medianNs);
        }
        // The first two rounds are the warm-up.
        const medians: Record<string, number> = {};
        for (const [name, values] of Object.entries(rows)) {
            const kept = values.slice(2);
            medians[name] = median(kept);
            info(
                `${name}: median ${medians[name]!.toFixed(0)} ns/op (min ${Math.min(...kept).toFixed(0)}, max ${Math.max(...kept).toFixed(0)}; ${iterations} ops x ${kept.length} interleaved rounds)`,
            );
        }
        info(
            `ratio twin/inverted set+notify: ${(medians['twin set+notify']! / medians['inverted bare set+notify']!).toFixed(2)}x`,
        );
        info(`ratio twin/inverted emit: ${(medians['twin emit']! / medians['inverted emit']!).toFixed(2)}x`);
        await it('the inversion benchmark ran', () => {
            expect(Object.values(medians).every((v) => v > 0 && isFinite(v))).toBe(true);
            expect(n1 + n2 > 0).toBe(true);
        });
        void PURE_JS_ENGINE;
    }
}
