// Reference: W3C DOM Abort API
// Reimplemented for GJS

import { Event, EventTarget, DOMException } from '@gjsify/dom-events';

const kAbort = Symbol('abort');
const kInternal = Symbol('internal');

export class AbortSignal extends EventTarget {
  #aborted: boolean = false;
  reason: any = undefined;

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

  get [Symbol.toStringTag]() { return 'AbortSignal'; }

  throwIfAborted(): void {
    if (this.#aborted) {
      throw this.reason;
    }
  }

  [kAbort](reason?: any): void {
    if (this.#aborted) return;

    this.#aborted = true;
    this.reason = reason ?? new DOMException('The operation was aborted.', 'AbortError');

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
        const aborted = signals.find(s => s.aborted);
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

  abort(reason?: any): void {
    if (!(this instanceof AbortController)) {
      throw new TypeError("'abort' called on an object that is not a valid instance of AbortController.");
    }
    this.signal[kAbort](reason);
  }
}

export { DOMException };

// Register globals on GJS if needed (pattern: @gjsify/web-streams)
if (typeof globalThis.AbortController === 'undefined') {
  (globalThis as any).AbortController = AbortController;
}
if (typeof globalThis.AbortSignal === 'undefined') {
  (globalThis as any).AbortSignal = AbortSignal;
}

export default { AbortController, AbortSignal };
