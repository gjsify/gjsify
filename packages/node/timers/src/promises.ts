// Node.js timers/promises module for GJS
// Reference: Node.js lib/timers/promises.js

import { Timeout, Immediate } from './timeout.js';

/**
 * Returns a promise that resolves after `delay` milliseconds.
 * Supports AbortSignal for cancellation.
 */
export function setTimeout<T = void>(delay = 0, value?: T, options?: { signal?: AbortSignal; ref?: boolean }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
      return;
    }

    const timeout = new Timeout(() => {
      cleanup();
      resolve(value as T);
    }, delay, [], false);

    if (options?.ref === false) timeout.unref();

    let onAbort: (() => void) | undefined;

    function cleanup() {
      if (onAbort && options?.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
    }

    if (options?.signal) {
      onAbort = () => {
        timeout.close();
        reject(options!.signal!.reason ?? new DOMException('The operation was aborted', 'AbortError'));
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Returns a promise that resolves on the next event loop iteration.
 * Supports AbortSignal for cancellation.
 */
export function setImmediate<T = void>(value?: T, options?: { signal?: AbortSignal; ref?: boolean }): Promise<T> {
  return setTimeout(0, value, options);
}

/**
 * Returns an async iterable that yields at `delay` ms intervals.
 * Supports AbortSignal for cancellation.
 */
export async function* setInterval<T = void>(delay = 0, value?: T, options?: { signal?: AbortSignal; ref?: boolean }): AsyncGenerator<T> {
  if (options?.signal?.aborted) {
    throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
  }

  while (true) {
    if (options?.signal?.aborted) {
      throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
    }

    yield await new Promise<T>((resolve, reject) => {
      const timeout = new Timeout(() => {
        cleanup();
        resolve(value as T);
      }, delay, [], false);

      if (options?.ref === false) timeout.unref();

      let onAbort: (() => void) | undefined;

      function cleanup() {
        if (onAbort && options?.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
      }

      if (options?.signal) {
        onAbort = () => {
          timeout.close();
          reject(options!.signal!.reason ?? new DOMException('The operation was aborted', 'AbortError'));
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
}
