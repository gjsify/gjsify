// Reference: W3C DOM Abort API
// Reimplemented for GJS

// oxlint-disable typescript/no-explicit-any -- W3C AbortSignal/AbortController spec types abort `reason` and the `onabort` return value as `any` in lib.dom (an abort reason is intentionally an arbitrary JS value). Mirror the public surface verbatim so consumers compose with our impl exactly as with the native one.
import { Event, EventTarget, DOMException } from '@gjsify/dom-events';

const kAbort = Symbol('abort');
const kInternal = Symbol('internal');

export class AbortSignal extends EventTarget {
    #aborted: boolean = false;
    // A prototype GETTER, like `aborted` beside it and like the platform — not
    // a public field. A class field is an own ENUMERABLE property, so `reason`
    // showed up in `for…in` over a signal where the real one does not. Found by
    // the key-enumeration spec the moment it was uncommented, immediately after
    // the same shape was fixed in `EventTarget` (`_listeners` → `#listeners`).
    #reason: any = undefined;

    onabort: ((this: AbortSignal, ev: Event) => any) | null = null;

    constructor(key?: symbol) {
        super();
        if (key !== kInternal) {
            throw new TypeError('Illegal constructor.');
        }
    }

    get aborted(): boolean {
        if (!(this instanceof AbortSignal)) {
            throw new TypeError("'get aborted' called on an object that is not a valid instance of AbortSignal.");
        }
        return this.#aborted;
    }

    get reason(): any {
        return this.#reason;
    }

    get [Symbol.toStringTag]() {
        return 'AbortSignal';
    }

    throwIfAborted(): void {
        if (this.#aborted) {
            throw this.#reason;
        }
    }

    [kAbort](reason?: any): void {
        if (this.#aborted) return;

        this.#aborted = true;
        this.#reason = reason ?? new DOMException('The operation was aborted.', 'AbortError');

        const event = new Event('abort');
        if (typeof this.onabort === 'function') {
            this.onabort.call(this, event);
        }
        this.dispatchEvent(event);
    }

    static abort(reason?: any): AbortSignal {
        const signal = new AbortSignal(kInternal);
        signal[kAbort](reason);
        return signal;
    }

    static timeout(milliseconds: number): AbortSignal {
        const signal = new AbortSignal(kInternal);
        setTimeout(() => {
            signal[kAbort](new DOMException('The operation timed out.', 'TimeoutError'));
        }, milliseconds);
        return signal;
    }

    static any(signals: AbortSignal[]): AbortSignal {
        const combined = new AbortSignal(kInternal);

        for (const signal of signals) {
            if (signal.aborted) {
                combined[kAbort](signal.reason);
                return combined;
            }
        }

        const onAbort = () => {
            if (!combined.aborted) {
                const aborted = signals.find((s) => s.aborted);
                combined[kAbort](aborted?.reason);
            }
        };

        for (const signal of signals) {
            signal.addEventListener('abort', onAbort, { once: true });
        }

        return combined;
    }
}

export class AbortController {
    readonly signal: AbortSignal;

    constructor() {
        this.signal = new AbortSignal(kInternal);
    }

    // `AbortSignal` has carried one since it was written; the controller never
    // did, so `String(new AbortController())` said `[object Object]` where the
    // platform says `[object AbortController]`. Nothing noticed because the
    // spec asserting it was commented out in the same file that asserts the
    // signal's — two siblings, one checked.
    get [Symbol.toStringTag]() {
        return 'AbortController';
    }

    abort(reason?: any): void {
        if (!(this instanceof AbortController)) {
            throw new TypeError("'abort' called on an object that is not a valid instance of AbortController.");
        }
        this.signal[kAbort](reason);
    }
}

export { DOMException };

// Note: globals are no longer registered at import time. Use the `/register`
// subpath (`import '@gjsify/abort-controller/register'`) if you need
// globalThis.AbortController / AbortSignal to be set.

export default { AbortController, AbortSignal };
