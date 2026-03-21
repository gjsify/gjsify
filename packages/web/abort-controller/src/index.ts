// Native AbortController/AbortSignal implementation for GJS — no Deno dependency.

import { Event, EventTarget, DOMException } from '@gjsify/dom-events';

const kAbort = Symbol('abort');

export class AbortSignal extends EventTarget {
  aborted: boolean = false;
  reason: any = undefined;

  onabort: ((this: AbortSignal, ev: Event) => any) | null = null;

  get [Symbol.toStringTag]() { return 'AbortSignal'; }

  throwIfAborted(): void {
    if (this.aborted) {
      throw this.reason;
    }
  }

  [kAbort](reason?: any): void {
    if (this.aborted) return;

    this.aborted = true;
    this.reason = reason ?? new DOMException('The operation was aborted.', 'AbortError');

    const event = new Event('abort');
    if (typeof this.onabort === 'function') {
      this.onabort.call(this, event);
    }
    this.dispatchEvent(event);
  }

  static abort(reason?: any): AbortSignal {
    const signal = new AbortSignal();
    signal[kAbort](reason);
    return signal;
  }

  static timeout(milliseconds: number): AbortSignal {
    const signal = new AbortSignal();
    setTimeout(() => {
      signal[kAbort](new DOMException('The operation timed out.', 'TimeoutError'));
    }, milliseconds);
    return signal;
  }

  static any(signals: AbortSignal[]): AbortSignal {
    const combined = new AbortSignal();

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
    this.signal = new AbortSignal();
  }

  abort(reason?: any): void {
    this.signal[kAbort](reason);
  }
}

export { DOMException };

export default { AbortController, AbortSignal };
