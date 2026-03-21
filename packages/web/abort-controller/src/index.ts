// Native AbortController/AbortSignal implementation for GJS — no Deno dependency.

import { Event, EventTarget } from '@gjsify/dom-events';

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

  /** @internal — used by AbortController */
  _abort(reason?: any): void {
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
    signal._abort(reason);
    return signal;
  }

  static timeout(milliseconds: number): AbortSignal {
    const signal = new AbortSignal();
    setTimeout(() => {
      signal._abort(new DOMException('The operation timed out.', 'TimeoutError'));
    }, milliseconds);
    return signal;
  }

  static any(signals: AbortSignal[]): AbortSignal {
    const combined = new AbortSignal();

    for (const signal of signals) {
      if (signal.aborted) {
        combined._abort(signal.reason);
        return combined;
      }
    }

    for (const signal of signals) {
      signal.addEventListener('abort', () => {
        if (!combined.aborted) {
          combined._abort(signal.reason);
        }
      }, { once: true });
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
    this.signal._abort(reason);
  }
}

// DOMException polyfill for environments that don't have it
class DOMException extends Error {
  readonly code: number;

  constructor(message?: string, name?: string) {
    super(message);
    this.name = name || 'Error';
    this.code = 0;
  }
}

// Use globalThis.DOMException if available, otherwise our polyfill
const _DOMException = typeof globalThis.DOMException !== 'undefined'
  ? globalThis.DOMException
  : DOMException;

export { _DOMException as DOMException };

export default { AbortController, AbortSignal };
