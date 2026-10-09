// GObject-style signal verbs for the plain-TS half of this package: `connect(name, cb) → id`,
// `connect_after`, `disconnect(id)`, and a stoppable emission (`GObject.signal_stop_emission_by_name`).
// The native widget cannot use `@gjsify/adwaita-nativescript`'s `withSignals`
// (it is not part of that package's public surface), and `Buffer` has no NativeScript base at all.

import { STOP_EMISSION, type StoppableEmitter } from '@gjsify/adwaita-core';

type Handler = (...args: never[]) => unknown;

/** Ids are unique across the process and start at 1, as `g_signal_connect`'s do (0 means failure). */
let nextHandlerId = 1;

/** One emission in progress; `stopped` is what `g_signal_stop_emission` sets. */
interface Emission {
    readonly name: string;
    stopped: boolean;
}

export class SignalEmitter implements StoppableEmitter {
    private readonly handlers = new Map<
        number,
        {
            readonly name: string;
            readonly callback: Handler;
            readonly after: boolean;
        }
    >();
    /** The emissions in progress, innermost last. */
    private readonly emissions: Emission[] = [];

    connect(name: string, callback: (self: this, ...args: never[]) => unknown): number {
        return this.add(name, callback, false);
    }

    /** `g_signal_connect_after`: runs once every plain handler and the class handler of the emission have run. */
    connect_after(name: string, callback: (self: this, ...args: never[]) => unknown): number {
        return this.add(name, callback, true);
    }

    /** An emitter that knows its signals overrides this and throws for a name it does not have. */
    protected checkSignal(_name: string): void {}

    private add(name: string, callback: (self: this, ...args: never[]) => unknown, after: boolean): number {
        this.checkSignal(name);
        const id = nextHandlerId++;
        this.handlers.set(id, {
            name,
            callback: callback as unknown as Handler,
            after,
        });
        return id;
    }

    /** Removes exactly the handler `connect` returned this id for; an id nothing holds throws. */
    disconnect(id: number): void {
        if (!this.handlers.delete(id)) throw new Error(`No signal handler with id ${id} on this object`);
    }

    /**
     * The class handler of a RUN_LAST signal: what the emission does by default, after the plain handlers
     * and before the `connect_after` ones. A stopped emission never gets here. A signal with a
     * `true_handled` accumulator (`emitHandled`) answers whether it handled the emission.
     */
    protected classHandler(_name: string, _args: readonly unknown[]): unknown {
        return undefined;
    }

    protected emit(name: string, ...args: unknown[]): void {
        this.run(name, args, false);
    }

    /**
     * A signal whose return value is accumulated with `g_signal_accumulator_true_handled`: the first
     * handler, class handler included, to answer true ends the emission and decides the result.
     */
    protected emitHandled(name: string, ...args: unknown[]): boolean {
        return this.run(name, args, true);
    }

    private run(name: string, args: readonly unknown[], accumulate: boolean): boolean {
        // A snapshot, so a handler may connect or disconnect others while the signal runs.
        const snapshot = Array.from(this.handlers).filter(([, handler]) => handler.name === name);
        const emission: Emission = { name, stopped: false };
        this.emissions.push(emission);
        let handled = false;
        // True when a handler answered "handled": under the accumulator that ends the emission.
        const stage = (after: boolean): boolean => {
            for (const [id, handler] of snapshot) {
                if (emission.stopped) return true;
                // GLib does not run a handler an earlier one of the same emission disconnected.
                if (handler.after !== after || !this.handlers.has(id)) continue;
                const answer = (handler.callback as (...a: unknown[]) => unknown)(this, ...args);
                if (accumulate && answer) {
                    handled = true;
                    return true;
                }
            }
            return emission.stopped;
        };
        try {
            if (stage(false)) return handled;
            const answer = this.classHandler(name, args);
            if (accumulate && answer) return true;
            if (emission.stopped) return handled;
            stage(true);
            return handled;
        } finally {
            this.emissions.splice(this.emissions.lastIndexOf(emission), 1);
        }
    }

    /**
     * `g_signal_stop_emission`: stops the innermost emission in progress of `detailedSignal`, so the
     * handlers after the current one and the class handler do not run. With none in progress GLib warns
     * and does nothing; so does this.
     */
    [STOP_EMISSION](detailedSignal: string): void {
        for (let index = this.emissions.length - 1; index >= 0; index--) {
            const emission = this.emissions[index]!;
            if (emission.name === detailedSignal && !emission.stopped) {
                emission.stopped = true;
                return;
            }
        }
        console.warn(`no emission of signal "${detailedSignal}" to stop`);
    }
}
