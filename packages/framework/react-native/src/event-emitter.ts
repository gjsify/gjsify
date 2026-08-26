// React Native's `EventEmitter`, which is pure JavaScript and therefore ours to
// answer for rather than to refuse.
//
// It is listed `supported` in the table instead of being omitted, and the
// distinction is deliberate: "it happens to work because nothing in it is native"
// and "this layer answers for it" are different promises, and only the second one
// survives a refactor.
//
// The API is React Native's, including the parts that read oddly on their own:
// `addListener` returns a SUBSCRIPTION rather than the emitter (so removal needs no
// identity comparison on the function), and a listener added during an emit does not
// receive the event being emitted — both pinned by the spec, because both are
// observable and neither is obvious.

/** What `addListener` hands back. Removal is by object, never by function identity. */
export interface EventSubscription {
    remove(): void;
}

// Widened once, here, rather than cast at each call site: a listener's
// parameter types are the caller's business and the registry only stores it.
type Listener = (...args: unknown[]) => void;

interface Registration {
    readonly listener: Listener;
    readonly context: unknown;
    removed: boolean;
}

export class EventEmitter<TEvents extends Record<string, readonly unknown[]> = Record<string, readonly unknown[]>> {
    readonly #registrations = new Map<string, Registration[]>();

    /**
     * Call `listener` on every `emit` of `eventType`, until the subscription is removed.
     *
     * `context` is React Native's own third parameter: the `this` the listener is
     * called with. Kept because code in the wild passes it, even though a bound
     * function or an arrow is the better spelling.
     */
    addListener<K extends keyof TEvents & string>(
        eventType: K,
        listener: (...args: TEvents[K]) => void,
        context?: unknown,
    ): EventSubscription {
        const registration: Registration = { listener: listener as unknown as Listener, context, removed: false };
        const list = this.#registrations.get(eventType);
        if (list === undefined) this.#registrations.set(eventType, [registration]);
        else list.push(registration);

        return {
            remove: () => {
                if (registration.removed) return;
                registration.removed = true;
                const current = this.#registrations.get(eventType);
                if (current === undefined) return;
                const index = current.indexOf(registration);
                if (index !== -1) current.splice(index, 1);
                if (current.length === 0) this.#registrations.delete(eventType);
            },
        };
    }

    /**
     * Call every current listener of `eventType`.
     *
     * The list is COPIED before iterating. Without that, a listener that removes
     * itself shifts the array under the loop and the next listener is skipped — a
     * self-unsubscribing listener is the common case, so this is not a corner. The
     * `removed` flag then covers the other half: a listener removed by an EARLIER
     * listener in the same emit must not be called from the copy.
     */
    emit<K extends keyof TEvents & string>(eventType: K, ...args: TEvents[K]): void {
        const list = this.#registrations.get(eventType);
        if (list === undefined || list.length === 0) return;
        // `.slice()`, not `[...list]`: this is a defensive COPY, not iteration
        // sugar, and the spread spelling reads as the latter (oxlint's
        // `unicorn/no-useless-spread` says so, and for a plain iteration it is right).
        for (const registration of list.slice()) {
            if (registration.removed) continue;
            // `[...args]` rather than `args`: the rest parameter is a READONLY tuple
            // and `Function.prototype.apply` wants a mutable array. Copying is also
            // what stops a listener mutating the arguments the next one receives.
            registration.listener.apply(registration.context, [...args]);
        }
    }

    /** Drop every listener of `eventType`, or every listener of every type. */
    removeAllListeners<K extends keyof TEvents & string>(eventType?: K): void {
        if (eventType === undefined) {
            for (const list of this.#registrations.values()) {
                for (const registration of list) registration.removed = true;
            }
            this.#registrations.clear();
            return;
        }
        const list = this.#registrations.get(eventType);
        if (list === undefined) return;
        for (const registration of list) registration.removed = true;
        this.#registrations.delete(eventType);
    }

    /** How many listeners `eventType` currently has. */
    listenerCount<K extends keyof TEvents & string>(eventType: K): number {
        return this.#registrations.get(eventType)?.length ?? 0;
    }
}
