// GObject-style signal verbs for the plain-TS half of this package: `connect(name, cb) → id`,
// `disconnect(id)`. The native widget cannot use `@gjsify/adwaita-nativescript`'s `withSignals`
// (it is not part of that package's public surface), and `Buffer` has no NativeScript base at all.

type Handler = (...args: never[]) => void;

/** Ids are unique across the process and start at 1, as `g_signal_connect`'s do (0 means failure). */
let nextHandlerId = 1;

export class SignalEmitter {
    private readonly handlers = new Map<number, { readonly name: string; readonly callback: Handler }>();

    connect(name: string, callback: (self: this, ...args: never[]) => void): number {
        const id = nextHandlerId++;
        this.handlers.set(id, { name, callback: callback as unknown as Handler });
        return id;
    }

    /** Removes exactly the handler `connect` returned this id for; an id nothing holds throws. */
    disconnect(id: number): void {
        if (!this.handlers.delete(id)) throw new Error(`No signal handler with id ${id} on this object`);
    }

    protected emit(name: string, ...args: unknown[]): void {
        // A snapshot, so a handler may disconnect itself or others while the signal runs.
        for (const handler of Array.from(this.handlers.values())) {
            if (handler.name === name) (handler.callback as (...a: unknown[]) => void)(this, ...args);
        }
    }
}
