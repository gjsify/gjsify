// Native EventEmitter implementation for GJS
// Reference: Node.js lib/events.js, Deno ext/node/polyfills/_events.mjs

import type { EventEmitterOptions, OnOptions, OnceOptions } from 'node:events';

type EventListener = (...args: any[]) => void;

/** An EventListener that may have been wrapped by `once`, carrying the original listener. */
interface WrappedEventListener extends EventListener {
  listener?: EventListener;
}

/** Error subtype with optional `code` and `cause` fields (used for abort errors, etc.). */
interface NodeError extends Error {
  code?: string;
  cause?: unknown;
  context?: unknown;
}

/** Array of listeners augmented with a `warned` flag for max-listener leak detection. */
interface WarnableListenerArray extends Array<EventListener> {
  warned?: boolean;
}

// Internal symbols
const kCapture = Symbol('kCapture');
const kRejection = Symbol.for('nodejs.rejection');

/**
 * Wraps a once listener so it removes itself after first invocation.
 */
function onceWrapper(this: { target: EventEmitter; type: string | symbol; listener: EventListener; wrapperFn?: EventListener }) {
  const { target, type, listener } = this;
  if (this.wrapperFn) target.removeListener(type, this.wrapperFn);
  const result = listener.apply(target, arguments as any);
  return result;
}

function _onceWrap(target: EventEmitter, type: string | symbol, listener: EventListener): EventListener {
  const state = { target, type, listener, wrapperFn: undefined as EventListener | undefined };
  const wrapped = onceWrapper.bind(state) as EventListener & { listener: EventListener };
  state.wrapperFn = wrapped;
  wrapped.listener = listener;
  return wrapped;
}

function arrayClone(arr: EventListener[]): EventListener[] {
  switch (arr.length) {
    case 0: return [];
    case 1: return [arr[0]];
    case 2: return [arr[0], arr[1]];
    case 3: return [arr[0], arr[1], arr[2]];
    default: return arr.slice();
  }
}

function checkListener(listener: unknown): void {
  if (typeof listener !== 'function') {
    throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
  }
}

function validateNumber(value: unknown, name: string): void {
  if (typeof value !== 'number' || value !== value) {
    throw new TypeError(`The "${name}" argument must be of type number. Received type ${typeof value}`);
  }
}

function spliceOne(list: unknown[], index: number): void {
  for (; index + 1 < list.length; index++) {
    list[index] = list[index + 1];
  }
  list.pop();
}

/**
 * Node.js-compatible EventEmitter for GJS.
 */
export class EventEmitter {
  static defaultMaxListeners = 10;
  static readonly errorMonitor: unique symbol = Symbol('events.errorMonitor') as unknown as typeof EventEmitter.errorMonitor;
  static readonly captureRejectionSymbol: symbol = kRejection;

  private static _captureRejections = false;

  static get captureRejections(): boolean {
    return EventEmitter._captureRejections;
  }

  static set captureRejections(value: boolean) {
    if (typeof value !== 'boolean') {
      throw new TypeError('The "captureRejections" argument must be of type boolean.');
    }
    EventEmitter._captureRejections = value;
  }

  _events: Record<string | symbol, EventListener | EventListener[]>;
  _eventsCount: number;
  _maxListeners: number | undefined;
  [kCapture]: boolean;

  constructor(opts?: EventEmitterOptions) {
    this._events = Object.create(null);
    this._eventsCount = 0;
    this._maxListeners = undefined;
    this[kCapture] = opts?.captureRejections ?? EventEmitter._captureRejections;
  }

  setMaxListeners(n: number): this {
    validateNumber(n, 'n');
    if (n < 0) {
      throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n);
    }
    this._maxListeners = n;
    return this;
  }

  getMaxListeners(): number {
    return this._maxListeners ?? EventEmitter.defaultMaxListeners;
  }

  emit(type: string | symbol, ...args: any[]): boolean {
    const events = this._events;
    let doError = (type === 'error');

    if (events !== undefined) {
      // If error event and errorMonitor listeners exist, emit to them first
      if (doError && events[EventEmitter.errorMonitor] !== undefined) {
        this.emit(EventEmitter.errorMonitor, ...args);
      }
      doError = doError && events.error === undefined;
    } else if (!doError) {
      return false;
    }

    // If no error listeners and it's an error event, throw
    if (doError) {
      let er: Error;
      if (args.length > 0) {
        er = args[0];
      } else {
        er = new Error('Unhandled error.');
      }
      if (er instanceof Error) {
        throw er;
      }
      const err = new Error('Unhandled error. (' + er + ')') as NodeError;
      err.context = er;
      throw err;
    }

    const handler = events[type];

    if (handler === undefined) {
      return false;
    }

    if (typeof handler === 'function') {
      const result = handler.apply(this, args);
      if (result !== undefined && result !== null && this[kCapture]) {
        this._addCatch(result, type, args);
      }
    } else {
      const listeners = arrayClone(handler);
      const len = listeners.length;
      for (let i = 0; i < len; ++i) {
        const result = listeners[i].apply(this, args);
        if (result !== undefined && result !== null && this[kCapture]) {
          this._addCatch(result, type, args);
        }
      }
    }

    return true;
  }

  private _addCatch(result: PromiseLike<unknown> | unknown, type: string | symbol, args: unknown[]): void {
    if (typeof (result as PromiseLike<unknown>)?.then === 'function') {
      (result as PromiseLike<unknown>).then(undefined, (err: Error) => {
        // Check if instance has a custom rejection handler
        const handler = (this as Record<symbol, unknown>)[kRejection];
        if (typeof handler === 'function') {
          handler.call(this, err, type, ...args);
        } else {
          // Temporarily disable capture to avoid infinite loop
          const prev = this[kCapture];
          try {
            this[kCapture] = false;
            this.emit('error', err);
          } finally {
            this[kCapture] = prev;
          }
        }
      });
    }
  }

  addListener(type: string | symbol, listener: EventListener): this {
    return this._addListener(type, listener, false);
  }

  on(type: string | symbol, listener: EventListener): this {
    return this._addListener(type, listener, false);
  }

  prependListener(type: string | symbol, listener: EventListener): this {
    return this._addListener(type, listener, true);
  }

  private _addListener(type: string | symbol, listener: EventListener, prepend: boolean): this {
    checkListener(listener);

    let events = this._events;

    // Emit newListener before adding
    if (events.newListener !== undefined) {
      this.emit('newListener', type, (listener as WrappedEventListener).listener ?? listener);
      // Re-read in case newListener handler modified _events
      events = this._events;
    }

    let existing = events[type];

    if (existing === undefined) {
      events[type] = listener;
      ++this._eventsCount;
    } else if (typeof existing === 'function') {
      events[type] = prepend ? [listener, existing] : [existing, listener];
    } else {
      if (prepend) {
        existing.unshift(listener);
      } else {
        existing.push(listener);
      }
    }

    // Check for listener leak
    const m = this.getMaxListeners();
    if (m > 0) {
      const count = typeof events[type] === 'function' ? 1 : (events[type] as EventListener[]).length;
      if (count > m && !(events[type] as WarnableListenerArray).warned) {
        if (typeof events[type] !== 'function') {
          (events[type] as WarnableListenerArray).warned = true;
        }
        const w = new Error(
          `Possible EventEmitter memory leak detected. ${count} ${String(type)} listeners ` +
          `added to [${this.constructor.name}]. Use emitter.setMaxListeners() to increase limit`
        );
        w.name = 'MaxListenersExceededWarning';
        console.warn(w.message);
      }
    }

    return this;
  }

  once(type: string | symbol, listener: EventListener): this {
    checkListener(listener);
    this.on(type, _onceWrap(this, type, listener));
    return this;
  }

  prependOnceListener(type: string | symbol, listener: EventListener): this {
    checkListener(listener);
    this.prependListener(type, _onceWrap(this, type, listener));
    return this;
  }

  removeListener(type: string | symbol, listener: EventListener): this {
    checkListener(listener);

    const events = this._events;
    const list = events[type];
    if (list === undefined) {
      return this;
    }

    if (list === listener || (list as WrappedEventListener).listener === listener) {
      if (--this._eventsCount === 0) {
        this._events = Object.create(null);
      } else {
        delete events[type];
        if (events.removeListener) {
          this.emit('removeListener', type, (list as WrappedEventListener).listener ?? listener);
        }
      }
    } else if (typeof list !== 'function') {
      let position = -1;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i] === listener || (list[i] as WrappedEventListener).listener === listener) {
          position = i;
          break;
        }
      }

      if (position < 0) {
        return this;
      }

      if (position === 0) {
        list.shift();
      } else {
        spliceOne(list, position);
      }

      if (list.length === 1) {
        events[type] = list[0];
      }

      if (events.removeListener !== undefined) {
        this.emit('removeListener', type, (listener as WrappedEventListener).listener ?? listener);
      }
    }

    return this;
  }

  off(type: string | symbol, listener: EventListener): this {
    return this.removeListener(type, listener);
  }

  removeAllListeners(type?: string | symbol): this {
    const events = this._events;

    // Not listening for removeListener, no need to emit
    if (events.removeListener === undefined) {
      if (arguments.length === 0) {
        this._events = Object.create(null);
        this._eventsCount = 0;
      } else if (events[type!] !== undefined) {
        if (--this._eventsCount === 0) {
          this._events = Object.create(null);
        } else {
          delete events[type!];
        }
      }
      return this;
    }

    // Emit removeListener for all listeners
    if (arguments.length === 0) {
      const keys = Object.keys(events);
      for (let i = 0; i < keys.length; ++i) {
        const key = keys[i];
        if (key === 'removeListener') continue;
        this.removeAllListeners(key);
      }
      this.removeAllListeners('removeListener');
      this._events = Object.create(null);
      this._eventsCount = 0;
      return this;
    }

    const listeners = events[type!];
    if (typeof listeners === 'function') {
      this.removeListener(type!, listeners);
    } else if (listeners !== undefined) {
      // LIFO order
      for (let i = listeners.length - 1; i >= 0; i--) {
        this.removeListener(type!, listeners[i]);
      }
    }

    return this;
  }

  listeners(type: string | symbol): EventListener[] {
    const events = this._events;
    const evlistener = events[type];

    if (evlistener === undefined) {
      return [];
    }

    if (typeof evlistener === 'function') {
      return [(evlistener as WrappedEventListener).listener ?? evlistener];
    }

    return unwrapListeners(evlistener);
  }

  rawListeners(type: string | symbol): EventListener[] {
    const events = this._events;
    const evlistener = events[type];

    if (evlistener === undefined) {
      return [];
    }

    if (typeof evlistener === 'function') {
      return [evlistener];
    }

    return arrayClone(evlistener);
  }

  listenerCount(type: string | symbol): number {
    const events = this._events;
    const evlistener = events[type];

    if (evlistener === undefined) {
      return 0;
    }

    if (typeof evlistener === 'function') {
      return 1;
    }

    return evlistener.length;
  }

  eventNames(): (string | symbol)[] {
    return this._eventsCount > 0
      ? Reflect.ownKeys(this._events)
      : [];
  }

  // -- Static methods --

  /**
   * Returns a promise that resolves when the emitter emits the given event,
   * or rejects if the emitter emits 'error' while waiting.
   */
  static once(emitter: EventEmitter | EventTarget, name: string | symbol, options?: OnceOptions): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      const signal = options?.signal;
      if (signal?.aborted) {
        reject(createAbortError(signal));
        return;
      }

      // EventTarget support
      if (typeof (emitter as EventTarget).addEventListener === 'function') {
        const eventTarget = emitter as EventTarget;
        const handler = (...args: any[]) => {
          if (signal) {
            signal.removeEventListener('abort', abortHandler);
          }
          resolve(args);
        };
        const errorHandler = (err: unknown) => {
          if (signal) {
            signal.removeEventListener('abort', abortHandler);
          }
          eventTarget.removeEventListener('error', errorHandler);
          reject(err);
        };
        const abortHandler = () => {
          eventTarget.removeEventListener(name as string, handler);
          eventTarget.removeEventListener('error', errorHandler);
          reject(createAbortError(signal!));
        };
        eventTarget.addEventListener(name as string, handler, { once: true });
        if (name !== 'error') {
          eventTarget.addEventListener('error', errorHandler, { once: true });
        }
        if (signal) {
          signal.addEventListener('abort', abortHandler, { once: true });
        }
        return;
      }

      // EventEmitter support
      const ee = emitter as EventEmitter;
      const eventHandler = (...args: any[]) => {
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }
        if (errorHandler !== undefined) {
          ee.removeListener('error', errorHandler);
        }
        resolve(args);
      };

      let errorHandler: EventListener | undefined;
      if (name !== 'error') {
        errorHandler = (err: Error) => {
          ee.removeListener(name, eventHandler);
          if (signal) {
            signal.removeEventListener('abort', abortHandler);
          }
          reject(err);
        };
        ee.once('error', errorHandler);
      }

      ee.once(name, eventHandler);

      const abortHandler = () => {
        ee.removeListener(name, eventHandler);
        if (errorHandler) {
          ee.removeListener('error', errorHandler);
        }
        reject(createAbortError(signal!));
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }
    });
  }

  /**
   * Returns an async iterator that yields event arguments each time the emitter emits.
   */
  static on(emitter: EventEmitter, event: string | symbol, options?: OnOptions): AsyncIterableIterator<unknown[]> {
    const signal = options?.signal;
    if (signal?.aborted) {
      throw createAbortError(signal);
    }

    const highWaterMark = options?.highWaterMark ?? Number.MAX_SAFE_INTEGER;
    const lowWaterMark = options?.lowWaterMark ?? 1;

    validateNumber(highWaterMark, 'highWaterMark');
    validateNumber(lowWaterMark, 'lowWaterMark');

    const unconsumedEvents: unknown[][] = [];
    const unconsumedPromises: { resolve: (value: IteratorResult<unknown[]>) => void; reject: (reason?: unknown) => void }[] = [];
    let error: Error | null = null;
    let finished = false;
    let paused = false;

    const eventHandler = (...args: any[]) => {
      if (unconsumedPromises.length > 0) {
        const { resolve } = unconsumedPromises.shift()!;
        resolve({ value: args, done: false });
      } else {
        unconsumedEvents.push(args);
        if (unconsumedEvents.length >= highWaterMark && !paused) {
          paused = true;
          if (typeof (emitter as unknown as Record<string, unknown>).pause === 'function') {
            ((emitter as unknown as Record<string, () => void>).pause)();
          }
        }
      }
    };

    const errorHandler = (err: Error) => {
      error = err;
      if (unconsumedPromises.length > 0) {
        const { reject } = unconsumedPromises.shift()!;
        reject(err);
      }
      iterator.return!();
    };

    const abortHandler = () => {
      errorHandler(createAbortError(signal!));
    };

    emitter.on(event, eventHandler);
    if (event !== 'error') {
      emitter.on('error', errorHandler);
    }
    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    const cleanup = () => {
      emitter.removeListener(event, eventHandler);
      emitter.removeListener('error', errorHandler);
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
      finished = true;
      // Resolve remaining promises
      for (const { resolve } of unconsumedPromises) {
        resolve({ value: undefined, done: true as const });
      }
      unconsumedPromises.length = 0;
      unconsumedEvents.length = 0;
    };

    const iterator: AsyncIterableIterator<unknown[]> = {
      next(): Promise<IteratorResult<unknown[]>> {
        if (unconsumedEvents.length > 0) {
          const value = unconsumedEvents.shift()!;
          if (paused && unconsumedEvents.length < lowWaterMark) {
            paused = false;
            if (typeof (emitter as unknown as Record<string, unknown>).resume === 'function') {
              ((emitter as unknown as Record<string, () => void>).resume)();
            }
          }
          return Promise.resolve({ value, done: false });
        }

        if (error) {
          const p = Promise.reject(error);
          error = null;
          return p;
        }

        if (finished) {
          return Promise.resolve({ value: undefined, done: true as const });
        }

        return new Promise((resolve, reject) => {
          unconsumedPromises.push({ resolve, reject });
        });
      },

      return(): Promise<IteratorResult<unknown[]>> {
        cleanup();
        return Promise.resolve({ value: undefined, done: true as const });
      },

      throw(err: Error): Promise<IteratorResult<unknown[]>> {
        if (!finished) {
          error = err;
          cleanup();
        }
        return Promise.reject(err);
      },

      [Symbol.asyncIterator]() {
        return this;
      }
    };

    return iterator;
  }

  /**
   * Returns the number of listeners listening to the event name.
   * @deprecated Use emitter.listenerCount() instead.
   */
  static listenerCount(emitter: EventEmitter, type: string | symbol): number {
    return emitter.listenerCount(type);
  }

  /**
   * Returns a copy of the array of listeners for the event named eventName.
   */
  static getEventListeners(emitter: EventEmitter | EventTarget, name: string | symbol): EventListener[] {
    if (typeof (emitter as EventEmitter).listeners === 'function') {
      return (emitter as EventEmitter).listeners(name);
    }
    return [];
  }

  /**
   * Set max listeners on one or more emitters.
   */
  static setMaxListeners(n: number, ...emitters: (EventEmitter | EventTarget)[]): void {
    validateNumber(n, 'n');
    if (n < 0) {
      throw new RangeError('The value of "n" is out of range.');
    }
    if (emitters.length === 0) {
      EventEmitter.defaultMaxListeners = n;
    } else {
      for (const emitter of emitters) {
        if (typeof (emitter as EventEmitter).setMaxListeners === 'function') {
          (emitter as EventEmitter).setMaxListeners(n);
        }
      }
    }
  }

  /**
   * Returns the currently set max listeners on the emitter.
   */
  static getMaxListeners(emitter: EventEmitter | EventTarget): number {
    if (typeof (emitter as EventEmitter).getMaxListeners === 'function') {
      return (emitter as EventEmitter).getMaxListeners();
    }
    return EventEmitter.defaultMaxListeners;
  }

  /**
   * Listens once to an abort event on the provided signal and returns a disposable.
   */
  static addAbortListener(signal: AbortSignal, listener: EventListener): { [Symbol.dispose](): void } {
    if (signal.aborted) {
      Promise.resolve().then(() => listener());
    }
    const handler = () => listener();
    signal.addEventListener('abort', handler, { once: true });
    return {
      [Symbol.dispose]() {
        signal.removeEventListener('abort', handler);
      }
    };
  }
}

// Make EventEmitter reference itself for backwards compatibility
(EventEmitter as unknown as Record<string, typeof EventEmitter>).EventEmitter = EventEmitter;

function unwrapListeners(arr: EventListener[]): EventListener[] {
  const ret = new Array(arr.length);
  for (let i = 0; i < ret.length; ++i) {
    ret[i] = (arr[i] as WrappedEventListener).listener ?? arr[i];
  }
  return ret;
}

function createAbortError(signal?: AbortSignal): NodeError {
  const err: NodeError = new Error('The operation was aborted');
  err.name = 'AbortError';
  err.code = 'ABORT_ERR';
  if (signal?.reason) {
    err.cause = signal.reason;
  }
  return err;
}
