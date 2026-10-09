// GObject-style signal verbs for the plain-TS half of this package: `connect(name, cb) → id`,
// `disconnect(id)`. The native widget cannot use `@gjsify/adwaita-nativescript`'s `withSignals`
// (it is not part of that package's public surface), and `Buffer` has no NativeScript base at all.

type Handler = (...args: never[]) => void;

/** Ids are unique across the process and start at 1, as `g_signal_connect`'s do (0 means failure). */
let nextHandlerId = 1;

export class SignalEmitter {
    private readonly handlers = new Map<
        number,
        { readonly name: string; readonly callback: Handler; readonly after: boolean }
    >();

    connect(name: string, callback: (self: this, ...args: never[]) => void): number {
        return this.add(name, callback, false);
    }

    /** `g_signal_connect_after`: runs once every plain handler of the emission has run. */
    connect_after(name: string, callback: (self: this, ...args: never[]) => void): number {
        return this.add(name, callback, true);
    }

    /** An emitter that knows its signals overrides this and throws for a name it does not have. */
    protected checkSignal(_name: string): void {}

    private add(name: string, callback: (self: this, ...args: never[]) => void, after: boolean): number {
        this.checkSignal(name);
        const id = nextHandlerId++;
        this.handlers.set(id, { name, callback: callback as unknown as Handler, after });
        return id;
    }

    /** Removes exactly the handler `connect` returned this id for; an id nothing holds throws. */
    disconnect(id: number): void {
        if (!this.handlers.delete(id)) throw new Error(`No signal handler with id ${id} on this object`);
    }

    protected emit(name: string, ...args: unknown[]): void {
        // A snapshot, so a handler may disconnect itself or others while the signal runs.
        const snapshot = Array.from(this.handlers.values()).filter((handler) => handler.name === name);
        for (const after of [false, true]) {
            for (const handler of snapshot) {
                if (handler.after === after) (handler.callback as (...a: unknown[]) => void)(this, ...args);
            }
        }
    }
}
