// The `Animated` subset, asked of the GTK that is installed and of a real reconciler.
//
// Three questions, and they need three different kinds of vector:
//
//   1. **Does the property table describe GTK?** A misspelled GObject property name
//      assigned from JavaScript creates an expando and reports nothing (measured:
//      `box.notAProperty = 1` reads back `1`), so the claim is held against the
//      typelib — the same thing `widgets.spec.ts` does for the primitive table.
//   2. **Does the run lifecycle settle exactly once?** Four things can end a run and
//      two of them arrive from GTK's side. The value's half is gi-free BY DESIGN
//      (`value.ts`), so a stub run drives every transition deterministically, with no
//      display and no frame clock.
//   3. **Does an animated style reach the widget without re-rendering React?** Only a
//      mount can answer that, and it asserts the WIDGET's property — never the plan,
//      which agrees with itself.
//
// WHAT IS NOT ASSERTED HERE, said out loud rather than left as a gap: an animation
// interpolating over several frames. `Adw.Animation.play()` on an unrealized widget
// SKIPS (measured — FINISHED, end value, `done` synchronously), and every widget in a
// suite that never presents a window is unrealized. So the frame path needs a
// compositor, and a vector that presented a window would be asserting the runner's
// display rather than this code. The skip itself IS pinned below, because it is the
// behaviour a desktop actually shows when animations are switched off.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { afterEach, beforeEach, describe, expect, it, on, type Runtime } from '@gjsify/unit';
import { registerBuiltinWidgets } from '@gjsify/gtk-host';
import { gtkChildren, installDiagnosticsGate } from '@gjsify/gtk-host/conformance';
import { MINIMAL_TOKENS, type StyleTokens } from '@gjsify/gtk-host/style';
import { createRoot } from '@gjsify/gtk-host/react';
import { createElement, type ReactNode } from 'react';

import { AnimatedView, View } from '../components.js';
import { PrimitiveError } from '../primitives/errors.js';
import { configureStyle, resetStyleConfig } from '../style-config.js';
import { Easing } from './easing.js';
import { Animated } from './index.js';
import { ANIMATED_PROPERTIES } from './properties.js';
import { AnimatedValue, type ValueRun } from './value.js';

/** Named identities, not a capability — the list `widgets.spec.ts` stands down on. */
const GTK_HOSTS: Runtime[] = ['Gjs', 'Node.js', 'Bun', 'Deno'];

const TOKENS: StyleTokens = {
    ...MINIMAL_TOKENS,
    spacing: { ...MINIMAL_TOKENS.spacing, '2': '8px' },
};

/** The two widgets a `View` can become — the overlay switch must not change the answer. */
const viewWidgets = (): readonly { readonly gtype: string; readonly specs: readonly GObject.ParamSpec[] }[] => {
    const of = (ctor: { list_properties(): GObject.ParamSpec[] }) => ctor.list_properties();
    return [
        { gtype: 'GtkBox', specs: of(Gtk.Box as never) },
        { gtype: 'GtkOverlay', specs: of(Gtk.Overlay as never) },
    ];
};

/** The one place a mount happens, so nothing forgets to tear its root down. */
function mounted(element: ReactNode, body: (container: Gtk.Box) => void): void {
    const container = new Gtk.Box();
    const root = createRoot(container);
    try {
        root.render(element);
        body(container);
    } finally {
        root.unmount();
    }
}

const threw = (run: () => unknown): Error => {
    try {
        run();
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected a refusal, and nothing was thrown');
};

/** A stub run, so the value's transitions can be driven with no animation behind them. */
class Recorder implements ValueRun {
    readonly events: string[] = [];
    clockAvailable(widget: object): void {
        this.events.push(
            `clock:${GObject.type_name((widget as { constructor: { $gtype: GObject.GType } }).constructor.$gtype) ?? '?'}`,
        );
    }
    clockLost(): void {
        this.events.push('lost');
    }
    interrupted(): void {
        this.events.push('interrupted');
    }
    rewind(): void {
        this.events.push('rewind');
    }
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

        await gated('the animated property table, against the installed typelib', async () => {
            await it('names a property every widget a View can become really installs', async () => {
                const missing: string[] = [];
                for (const [key, spec] of Object.entries(ANIMATED_PROPERTIES)) {
                    for (const widget of viewWidgets()) {
                        const found = widget.specs.find((p) => p.get_name() === spec.property);
                        if (found === undefined) {
                            missing.push(`${key} → ${widget.gtype} has no "${spec.property}"`);
                            continue;
                        }
                        if ((found.flags & GObject.ParamFlags.WRITABLE) === 0) {
                            missing.push(`${key} → ${widget.gtype}.${spec.property} is read-only`);
                        }
                    }
                }
                expect(missing).toStrictEqual([]);
                // NOT VACUOUS, in both directions: an empty table satisfies an empty
                // problem list, and so does a `list_properties()` that answered nothing
                // — which a runtime whose class-struct statics went wrong really did
                // produce (#1438), so both counts are asserted rather than assumed.
                expect(Object.keys(ANIMATED_PROPERTIES).length > 0).toBe(true);
                for (const widget of viewWidgets()) expect(widget.specs.length > 10).toBe(true);
            });

            await it('refuses a style key it cannot animate, naming the key and the set', async () => {
                const value = new Animated.Value(0);
                const error = threw(() =>
                    mounted(createElement(AnimatedView, { style: { transform: value } }), () => {}),
                );
                expect(error instanceof PrimitiveError).toBe(true);
                expect(error.message).toContain('transform');
                expect(error.message).toContain('Gsk.Transform');
                // A key with no bespoke reason still gets the set it could have used.
                expect(
                    threw(() => mounted(createElement(AnimatedView, { style: { zIndex: value } }), () => {})).message,
                ).toContain('opacity');
            });
        });

        await gated('the value’s own lifecycle, with no animation behind it', async () => {
            await it('writes a new sink immediately, because a subscriber starts out disagreeing', async () => {
                const value = new AnimatedValue(0.25);
                const box = new Gtk.Box();
                const written: number[] = [];
                const detach = value.__attach({ widget: box, write: (v) => written.push(v) });
                expect(written).toStrictEqual([0.25]);
                value.setValue(0.5);
                expect(written).toStrictEqual([0.25, 0.5]);
                expect(value.__getValue()).toBe(0.5);
                detach();
                value.setValue(0.75);
                // Detached means detached: a sink that still received frames would keep
                // an unmounted widget alive and paint it.
                expect(written).toStrictEqual([0.25, 0.5]);
            });

            await it('hands the clock to the first sink, and reports it LOST when that sink goes', async () => {
                const value = new AnimatedValue(0);
                const run = new Recorder();
                // Claimed with no sink: a run started before any view is bound waits
                // rather than doing nothing, which is the ordering a `useEffect` in a
                // parent component produces.
                value.__claim(run);
                expect(run.events).toStrictEqual([]);
                const box = new Gtk.Box();
                const detach = value.__attach({ widget: box, write: () => {} });
                expect(run.events).toStrictEqual(['clock:GtkBox']);
                detach();
                expect(run.events).toStrictEqual(['clock:GtkBox', 'lost']);
                // And it is reported ONCE: the run is released with the clock, so a
                // second detach of a second sink cannot settle it again.
                const second = value.__attach({ widget: new Gtk.Box(), write: () => {} });
                second();
                expect(run.events).toStrictEqual(['clock:GtkBox', 'lost']);
            });

            await it('interrupts the previous run when a second one claims the value', async () => {
                const value = new AnimatedValue(0);
                const first = new Recorder();
                const second = new Recorder();
                value.__attach({ widget: new Gtk.Box(), write: () => {} });
                value.__claim(first);
                value.__claim(second);
                expect(first.events).toStrictEqual(['clock:GtkBox', 'interrupted']);
                expect(second.events).toStrictEqual(['clock:GtkBox']);
            });

            await it('settles the run BEFORE rewinding it, so no frame can undo the reset', async () => {
                const value = new AnimatedValue(0);
                const run = new Recorder();
                value.__attach({ widget: new Gtk.Box(), write: () => {} });
                value.__claim(run);
                value.resetAnimation();
                expect(run.events).toStrictEqual(['clock:GtkBox', 'interrupted', 'rewind']);
            });

            await it('refuses a value that is not a finite number', async () => {
                expect(threw(() => new AnimatedValue(Number.NaN)).message).toContain('finite number');
                expect(threw(() => new AnimatedValue(Number.POSITIVE_INFINITY)).message).toContain('finite number');
                expect(threw(() => new AnimatedValue('0.5' as never)).message).toContain('string');
                const value = new AnimatedValue(0);
                expect(threw(() => value.setValue(Number.NaN)).message).toContain('finite number');
            });
        });

        await gated('an animated style, in a real tree', async () => {
            await it('writes the widget property at RENDER, not only from the effect', async () => {
                // Without this the first committed frame paints at GTK's default
                // opacity and the effect corrects it — a flash on every mount of every
                // faded-in screen.
                //
                // READ FROM A REF CALLBACK, and that is the whole vector. React runs a
                // ref during the COMMIT and a `useEffect` after it, so a ref sees the
                // widget with its rendered props applied and the sink not yet attached.
                // Asserting `box.opacity` after `render()` returns does NOT discriminate
                // — MEASURED: with the render-time write deleted, that assertion stayed
                // green, because the effect had already corrected the property by then.
                const value = new Animated.Value(0);
                let atCommit: number | null = null;
                mounted(
                    createElement(AnimatedView, {
                        style: { opacity: value },
                        className: 'p-2',
                        ref: (widget: unknown) => {
                            if (widget !== null && atCommit === null) atCommit = (widget as Gtk.Box).opacity;
                        },
                    }),
                    (container) => {
                        expect(atCommit).toBe(0);
                        expect((gtkChildren(container)[0] as Gtk.Box).opacity).toBe(0);
                    },
                );
            });

            await it('drives the widget property with NO re-render, and lets go on unmount', async () => {
                const value = new Animated.Value(0);
                let renders = 0;
                const Probe = (): ReactNode => {
                    renders += 1;
                    return createElement(AnimatedView, { style: { opacity: value } });
                };
                const container = new Gtk.Box();
                const root = createRoot(container);
                let box: Gtk.Box;
                try {
                    root.render(createElement(Probe));
                    box = gtkChildren(container)[0] as Gtk.Box;
                    expect(renders).toBe(1);
                    value.setValue(1);
                    // MEASURED: `Gtk.Widget:opacity` is quantised to 8 bits — 0.9 reads
                    // back 0.9019607843137255 — so 0 and 1 are the two values that
                    // round-trip exactly, and everything in between is asserted with a
                    // tolerance.
                    expect(box.opacity).toBe(1);
                    value.setValue(0.5);
                    expect(Math.abs(box.opacity - 0.5) < 0.01).toBe(true);
                    // THE CLAIM OF THE WHOLE DESIGN: a frame is a property write, not a
                    // commit. Three writes, one render.
                    expect(renders).toBe(1);
                } finally {
                    root.unmount();
                }
                const afterUnmount = box.opacity;
                value.setValue(0);
                expect(box.opacity).toBe(afterUnmount);
            });

            await it('refuses an Animated.Value on a PLAIN View, in the layer that can see the type', async () => {
                // The defect this refusal exists for is measured in
                // `@gjsify/gtk-host/style`: `partitionPaint` interpolates the value into
                // a declaration with no type check, so the object would reach GTK as
                // `opacity: [object Object]` and GTK's parser would drop it in silence.
                const value = new Animated.Value(0.5);
                const error = threw(() =>
                    mounted(createElement(View, { style: { opacity: value } as never }), () => {}),
                );
                expect(error instanceof PrimitiveError).toBe(true);
                expect(error.message).toContain('Animated.View');
                // THE NEGATIVE CONTROL. Without it this vector passes just as well when
                // the refusal is thrown for every style object in the tree.
                mounted(createElement(AnimatedView, { style: { opacity: value } }), (container) => {
                    expect(Math.abs((gtkChildren(container)[0] as Gtk.Box).opacity - 0.5) < 0.01).toBe(true);
                });
            });

            await it('refuses an animated opacity beside an authored one, either spelling', async () => {
                const value = new Animated.Value(0.5);
                // Both CLASS spellings, base and variant. NOT the array form
                // `[{ opacity: 0.7 }, { opacity: value }]`: React Native flattens a
                // style array with later entries winning, so the animated value
                // replaces the static one and there is nothing left to clash with —
                // and the reverse order drops the animation, which is React Native's
                // own rule rather than something this layer gets to override.
                for (const props of [
                    { className: 'opacity-70', style: { opacity: value } },
                    { className: 'active:opacity-70', style: { opacity: value } },
                ]) {
                    const error = threw(() => mounted(createElement(AnimatedView, props as never), () => {}));
                    expect(error.message).toContain('two independent channels');
                }
                // The control: the same element with a class that is NOT opacity renders.
                mounted(createElement(AnimatedView, { className: 'p-2', style: { opacity: value } }), (container) => {
                    expect(gtkChildren(container).length).toBe(1);
                });
            });
        });

        await gated('timing, over the animation libadwaita actually builds', async () => {
            await it('SKIPS on an unrealized widget, and reports a real completion', async () => {
                // The measured desktop behaviour: `play()` with no frame clock sets
                // FINISHED, writes the end value and emits `done` synchronously — which
                // is also what libadwaita does when the user has switched animations
                // off. So the end callback is `{ finished: true }` and it is not a lie:
                // the value really did arrive.
                const value = new Animated.Value(0);
                const results: boolean[] = [];
                mounted(createElement(AnimatedView, { style: { opacity: value } }), (container) => {
                    const box = gtkChildren(container)[0] as Gtk.Box;
                    Animated.timing(value, { toValue: 1, duration: 300, useNativeDriver: true }).start((result) =>
                        results.push(result.finished),
                    );
                    expect(results).toStrictEqual([true]);
                    expect(value.__getValue()).toBe(1);
                    expect(box.opacity).toBe(1);
                });
            });

            await it('waits for a frame clock when no view is bound yet', async () => {
                // A run claimed with no sink builds no animation at all, so nothing has
                // happened and nothing is reported — the ordering a `useEffect` in a
                // parent produces, where the child's effect has not run yet.
                const value = new Animated.Value(0);
                const results: boolean[] = [];
                const handle = Animated.timing(value, { toValue: 1, duration: 300, useNativeDriver: false });
                handle.start((result) => results.push(result.finished));
                expect(results).toStrictEqual([]);
                expect(value.__getValue()).toBe(0);
                // `setValue` takes the value over, which ends the pending run as
                // interrupted rather than leaving a callback that never fires.
                value.setValue(0.25);
                expect(results).toStrictEqual([false]);
                expect(value.__getValue()).toBe(0.25);
            });

            await it('calls the end callback EXACTLY once, whatever else is asked of the handle', async () => {
                const value = new Animated.Value(0);
                const results: boolean[] = [];
                mounted(createElement(AnimatedView, { style: { opacity: value } }), () => {
                    const handle = Animated.timing(value, { toValue: 1, duration: 10, useNativeDriver: true });
                    handle.start((result) => results.push(result.finished));
                    expect(results).toStrictEqual([true]);
                    // Both are no-ops on a run that already settled, and a settled run
                    // that could be settled again is how a completion gets reported
                    // twice — once by GTK and once by whoever tidied up.
                    handle.stop();
                    handle.reset();
                    expect(results).toStrictEqual([true]);
                });
            });

            await it('treats useNativeDriver as meaningless, identically for both values', async () => {
                // The flag chooses a bridge, and there is no bridge. Asserting the two
                // are the SAME is what stops it quietly growing a meaning later.
                const outcomes = [true, false].map((useNativeDriver) => {
                    const value = new Animated.Value(0);
                    let finished: boolean | null = null;
                    mounted(createElement(AnimatedView, { style: { opacity: value } }), () => {
                        Animated.timing(value, { toValue: 0.5, duration: 200, useNativeDriver }).start((result) => {
                            finished = result.finished;
                        });
                    });
                    return `${String(finished)}:${value.__getValue()}`;
                });
                expect(outcomes[0]).toBe(outcomes[1]);
                expect(outcomes[0]).toBe('true:0.5');
            });

            await it('refuses every config key it does not answer for, by name', async () => {
                const value = new Animated.Value(0);
                expect(threw(() => Animated.timing(value, { toValue: 1, delay: 50 } as never)).message).toContain(
                    'config.delay',
                );
                expect(threw(() => Animated.timing(value, { toValue: 1, iterations: 2 } as never)).message).toContain(
                    'repeat-count',
                );
                expect(threw(() => Animated.timing(value, { toValue: 1, nonsense: 1 } as never)).message).toContain(
                    'Accepted: toValue, duration, easing, useNativeDriver',
                );
                expect(
                    threw(() => Animated.timing(value, { toValue: new Animated.Value(1) } as never)).message,
                ).toContain('config.toValue');
                expect(threw(() => Animated.timing(value, { toValue: 1, duration: 1.5 } as never)).message).toContain(
                    'non-negative integer',
                );
            });

            await it('takes an Easing token and refuses anything else', async () => {
                const value = new Animated.Value(0);
                mounted(createElement(AnimatedView, { style: { opacity: value } }), () => {
                    // A token that maps: the run reaches its end, which is the only
                    // observable an unrealized widget offers.
                    let finished: boolean | null = null;
                    Animated.timing(value, { toValue: 1, duration: 100, easing: Easing.out(Easing.cubic) }).start(
                        (result) => {
                            finished = result.finished;
                        },
                    );
                    expect(finished).toBe(true);
                });
                // A hole in the family table is refused where it is ASKED for, so a
                // stack names the call the author wrote rather than the animation.
                expect(threw(() => Easing.inOut(Easing.ease)).message).toContain('1.20e-2');
                expect(threw(() => Animated.timing(value, { toValue: 1, easing: (t: number) => t })).message).toContain(
                    'did not mint',
                );
            });
        });

        await gated('the twenty-eight members that refuse', async () => {
            await it('is a present function for each, throwing a reason that names it', async () => {
                const surface = Animated as unknown as Record<string, unknown>;
                const built = new Set(['Value', 'timing', 'View']);
                const names = Object.keys(surface).filter((name) => !built.has(name));
                const bad: string[] = [];
                for (const name of names) {
                    const member = surface[name];
                    // A FUNCTION, so a `typeof Animated.spring === 'function'` feature
                    // check in library code still reads true before anything calls it.
                    if (typeof member !== 'function') {
                        bad.push(`${name}: is ${typeof member}, not a function`);
                        continue;
                    }
                    const error = threw(() => (member as () => unknown)());
                    if (!(error instanceof PrimitiveError)) bad.push(`${name}: threw ${error.name}`);
                    else if (!error.message.includes(name)) bad.push(`${name}: the message does not name it`);
                }
                expect(bad).toStrictEqual([]);
                // The count is the measurement React Native's own export list gives:
                // 25 from `AnimatedImplementation` plus the six components, less the
                // three built here.
                expect(names.length).toBe(28);
            });

            await it('leaves the three built ones alone', async () => {
                expect(typeof Animated.timing).toBe('function');
                expect(typeof Animated.View).toBe('function');
                expect(new Animated.Value(1).__getValue()).toBe(1);
            });
        });
    });
};
