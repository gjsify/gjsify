// Node.js diagnostics_channel module for GJS
// Pure JavaScript implementation — no GNOME library dependency
// Reference: Node.js lib/diagnostics_channel.js

type MessageHandler = (message: unknown, name: string | symbol) => void;

const channels = new Map<string | symbol, Channel>();

/**
 * A named channel for publishing diagnostic messages.
 */
export class Channel {
  readonly name: string | symbol;
  private _subscribers: MessageHandler[] = [];

  constructor(name: string | symbol) {
    this.name = name;
  }

  /** Whether this channel has active subscribers. */
  get hasSubscribers(): boolean {
    return this._subscribers.length > 0;
  }

  /**
   * Publish a message to all subscribers.
   * Subscriber errors are caught and re-thrown asynchronously so that
   * remaining subscribers still run (matches Node.js behavior).
   */
  publish(message: unknown): void {
    if (this._subscribers.length === 0) return;
    // Snapshot subscribers so that unsubscribes during publish are safe
    const subscribers = this._subscribers;
    for (let i = 0; i < subscribers.length; i++) {
      try {
        subscribers[i](message, this.name);
      } catch (err) {
        // Re-throw asynchronously so remaining subscribers still fire
        Promise.resolve().then(() => { throw err; });
      }
    }
  }

  /** Subscribe to this channel. */
  subscribe(onMessage: MessageHandler): void {
    if (typeof onMessage !== 'function') {
      throw new TypeError('The "subscription" argument must be of type function');
    }
    // Copy-on-write: create a new array so in-progress publish iterations
    // are not affected (matches Node.js ActiveChannel behavior)
    this._subscribers = [...this._subscribers, onMessage];
  }

  /** Unsubscribe from this channel. Returns true if the subscriber was found. */
  unsubscribe(onMessage: MessageHandler): boolean {
    const index = this._subscribers.indexOf(onMessage);
    if (index === -1) return false;
    // Copy-on-write removal
    this._subscribers = [
      ...this._subscribers.slice(0, index),
      ...this._subscribers.slice(index + 1),
    ];
    return true;
  }

  /**
   * Run stores and publish (simplified — no AsyncLocalStorage store support yet).
   * Publishes the data and calls fn with the given thisArg and args.
   */
  runStores(data: unknown, fn: (...args: unknown[]) => unknown, thisArg?: unknown, ...args: unknown[]): unknown {
    this.publish(data);
    return fn.apply(thisArg, args);
  }

  /** Bind a store to this channel (stub — AsyncLocalStorage integration). */
  bindStore(_store: unknown, _transform?: (message: unknown) => unknown): void {
    // Stub: AsyncLocalStorage integration not yet implemented
  }

  /** Unbind a store from this channel (stub). */
  unbindStore(_store: unknown): void {
    // Stub
  }
}

/**
 * Get or create a named channel.
 */
export function channel(name: string | symbol): Channel {
  if (typeof name !== 'string' && typeof name !== 'symbol') {
    throw new TypeError('The "channel" argument must be of type string or symbol');
  }
  let ch = channels.get(name);
  if (!ch) {
    ch = new Channel(name);
    channels.set(name, ch);
  }
  return ch;
}

/**
 * Check if the named channel has subscribers.
 */
export function hasSubscribers(name: string | symbol): boolean {
  const ch = channels.get(name);
  return ch ? ch.hasSubscribers : false;
}

/**
 * Subscribe to a named channel.
 */
export function subscribe(name: string | symbol, onMessage: MessageHandler): void {
  channel(name).subscribe(onMessage);
}

/**
 * Unsubscribe from a named channel.
 */
export function unsubscribe(name: string | symbol, onMessage: MessageHandler): boolean {
  return channel(name).unsubscribe(onMessage);
}

/**
 * TracingChannel — groups related channels for start/end/asyncStart/asyncEnd/error.
 */
export class TracingChannel {
  readonly start: Channel;
  readonly end: Channel;
  readonly asyncStart: Channel;
  readonly asyncEnd: Channel;
  readonly error: Channel;

  constructor(nameOrChannels: string | { start: Channel; end: Channel; asyncStart: Channel; asyncEnd: Channel; error: Channel }) {
    if (typeof nameOrChannels === 'string') {
      const name = nameOrChannels;
      this.start = channel(`tracing:${name}:start`);
      this.end = channel(`tracing:${name}:end`);
      this.asyncStart = channel(`tracing:${name}:asyncStart`);
      this.asyncEnd = channel(`tracing:${name}:asyncEnd`);
      this.error = channel(`tracing:${name}:error`);
    } else if (typeof nameOrChannels === 'object' && nameOrChannels !== null) {
      const traceEvents = ['start', 'end', 'asyncStart', 'asyncEnd', 'error'] as const;
      for (const eventName of traceEvents) {
        const ch = (nameOrChannels as Record<string, unknown>)[eventName];
        if (!(ch instanceof Channel)) {
          throw new TypeError(
            `The "nameOrChannels.${eventName}" property must be an instance of Channel`
          );
        }
      }
      this.start = nameOrChannels.start;
      this.end = nameOrChannels.end;
      this.asyncStart = nameOrChannels.asyncStart;
      this.asyncEnd = nameOrChannels.asyncEnd;
      this.error = nameOrChannels.error;
    } else {
      throw new TypeError(
        'The "nameOrChannels" argument must be of type string or an instance of TracingChannel or Object'
      );
    }
  }

  /** Whether any of the tracing sub-channels has subscribers. */
  get hasSubscribers(): boolean {
    return (
      this.start.hasSubscribers ||
      this.end.hasSubscribers ||
      this.asyncStart.hasSubscribers ||
      this.asyncEnd.hasSubscribers ||
      this.error.hasSubscribers
    );
  }

  /** Subscribe to all tracing channels. */
  subscribe(handlers: {
    start?: MessageHandler;
    end?: MessageHandler;
    asyncStart?: MessageHandler;
    asyncEnd?: MessageHandler;
    error?: MessageHandler;
  }): void {
    if (handlers.start) this.start.subscribe(handlers.start);
    if (handlers.end) this.end.subscribe(handlers.end);
    if (handlers.asyncStart) this.asyncStart.subscribe(handlers.asyncStart);
    if (handlers.asyncEnd) this.asyncEnd.subscribe(handlers.asyncEnd);
    if (handlers.error) this.error.subscribe(handlers.error);
  }

  /** Unsubscribe from all tracing channels. Returns true if all were found. */
  unsubscribe(handlers: {
    start?: MessageHandler;
    end?: MessageHandler;
    asyncStart?: MessageHandler;
    asyncEnd?: MessageHandler;
    error?: MessageHandler;
  }): boolean {
    let done = true;
    if (handlers.start && !this.start.unsubscribe(handlers.start)) done = false;
    if (handlers.end && !this.end.unsubscribe(handlers.end)) done = false;
    if (handlers.asyncStart && !this.asyncStart.unsubscribe(handlers.asyncStart)) done = false;
    if (handlers.asyncEnd && !this.asyncEnd.unsubscribe(handlers.asyncEnd)) done = false;
    if (handlers.error && !this.error.unsubscribe(handlers.error)) done = false;
    return done;
  }

  /**
   * Execute a function within a tracing context.
   * Matches Node.js signature: traceSync(fn, context, thisArg, ...args)
   */
  traceSync(fn: (...args: unknown[]) => unknown, context: Record<string, unknown> = {}, thisArg?: unknown, ...args: unknown[]): unknown {
    if (!this.hasSubscribers) {
      return fn.apply(thisArg, args);
    }

    const { start, end, error } = this;

    // Publish start, run fn, publish end in finally, publish error on throw
    start.publish(context);
    try {
      const result = fn.apply(thisArg, args);
      context.result = result;
      return result;
    } catch (err) {
      context.error = err;
      error.publish(context);
      throw err;
    } finally {
      end.publish(context);
    }
  }

  /**
   * Execute an async function within a tracing context.
   * Matches Node.js signature: tracePromise(fn, context, thisArg, ...args)
   */
  tracePromise(fn: (...args: unknown[]) => unknown, context: Record<string, unknown> = {}, thisArg?: unknown, ...args: unknown[]): unknown {
    if (!this.hasSubscribers) {
      return fn.apply(thisArg, args);
    }

    const { start, end, asyncStart, asyncEnd, error } = this;

    function resolve(result: unknown): unknown {
      context.result = result;
      asyncStart.publish(context);
      asyncEnd.publish(context);
      return result;
    }

    function reject(err: unknown): never {
      context.error = err;
      error.publish(context);
      asyncStart.publish(context);
      asyncEnd.publish(context);
      throw err;
    }

    start.publish(context);
    try {
      const result = fn.apply(thisArg, args) as any;
      if (typeof result?.then !== 'function') {
        context.result = result;
        return result;
      }
      return result.then(resolve, reject);
    } catch (err) {
      context.error = err;
      error.publish(context);
      throw err;
    } finally {
      end.publish(context);
    }
  }

  /**
   * Execute a callback-style function within a tracing context.
   * Matches Node.js signature: traceCallback(fn, position, context, thisArg, ...args)
   */
  traceCallback(fn: (...args: unknown[]) => unknown, position: number = -1, context: Record<string, unknown> = {}, thisArg?: unknown, ...args: unknown[]): unknown {
    if (!this.hasSubscribers) {
      return fn.apply(thisArg, args);
    }

    const { start, end, asyncStart, asyncEnd, error } = this;

    const actualPos = position < 0 ? args.length + position : position;
    const callback = args[actualPos];
    if (typeof callback !== 'function') {
      throw new TypeError('The "callback" argument must be of type function');
    }

    function wrappedCallback(this: unknown, err: unknown, res: unknown) {
      if (err) {
        context.error = err;
        error.publish(context);
      } else {
        context.result = res;
      }

      asyncStart.publish(context);
      try {
        return (callback as Function).apply(this, arguments);
      } finally {
        asyncEnd.publish(context);
      }
    }

    const wrappedArgs = [...args];
    wrappedArgs[actualPos] = wrappedCallback;

    start.publish(context);
    try {
      return fn.apply(thisArg, wrappedArgs);
    } catch (err) {
      context.error = err;
      error.publish(context);
      throw err;
    } finally {
      end.publish(context);
    }
  }
}

/**
 * Create a TracingChannel instance.
 */
export function tracingChannel(nameOrChannels: string | { start: Channel; end: Channel; asyncStart: Channel; asyncEnd: Channel; error: Channel }): TracingChannel {
  return new TracingChannel(nameOrChannels);
}

export default {
  Channel,
  channel,
  hasSubscribers,
  subscribe,
  unsubscribe,
  TracingChannel,
  tracingChannel,
};
