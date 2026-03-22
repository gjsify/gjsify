// Node.js diagnostics_channel module for GJS
// Pure JavaScript implementation — no GNOME library dependency
// Reference: Node.js lib/diagnostics_channel.js

type MessageHandler = (message: unknown, name: string) => void;

const channels = new Map<string, Channel>();

/**
 * A named channel for publishing diagnostic messages.
 */
export class Channel {
  readonly name: string;
  private _subscribers: Set<MessageHandler> = new Set();

  constructor(name: string) {
    this.name = name;
  }

  /** Whether this channel has active subscribers. */
  get hasSubscribers(): boolean {
    return this._subscribers.size > 0;
  }

  /** Publish a message to all subscribers. */
  publish(message: unknown): void {
    if (this._subscribers.size === 0) return;
    for (const subscriber of this._subscribers) {
      subscriber(message, this.name);
    }
  }

  /** Subscribe to this channel. */
  subscribe(onMessage: MessageHandler): void {
    this._subscribers.add(onMessage);
  }

  /** Unsubscribe from this channel. Returns true if the subscriber was found. */
  unsubscribe(onMessage: MessageHandler): boolean {
    return this._subscribers.delete(onMessage);
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
export function channel(name: string): Channel {
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
export function hasSubscribers(name: string): boolean {
  const ch = channels.get(name);
  return ch ? ch.hasSubscribers : false;
}

/**
 * Subscribe to a named channel.
 */
export function subscribe(name: string, onMessage: MessageHandler): void {
  channel(name).subscribe(onMessage);
}

/**
 * Unsubscribe from a named channel.
 */
export function unsubscribe(name: string, onMessage: MessageHandler): boolean {
  const ch = channels.get(name);
  if (!ch) return false;
  return ch.unsubscribe(onMessage);
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
    } else {
      this.start = nameOrChannels.start;
      this.end = nameOrChannels.end;
      this.asyncStart = nameOrChannels.asyncStart;
      this.asyncEnd = nameOrChannels.asyncEnd;
      this.error = nameOrChannels.error;
    }
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

  /** Unsubscribe from all tracing channels. */
  unsubscribe(handlers: {
    start?: MessageHandler;
    end?: MessageHandler;
    asyncStart?: MessageHandler;
    asyncEnd?: MessageHandler;
    error?: MessageHandler;
  }): void {
    if (handlers.start) this.start.unsubscribe(handlers.start);
    if (handlers.end) this.end.unsubscribe(handlers.end);
    if (handlers.asyncStart) this.asyncStart.unsubscribe(handlers.asyncStart);
    if (handlers.asyncEnd) this.asyncEnd.unsubscribe(handlers.asyncEnd);
    if (handlers.error) this.error.unsubscribe(handlers.error);
  }

  /** Execute a function within a tracing context. */
  traceSync<T>(fn: () => T, context?: Record<string, unknown>): T {
    const ctx = context ?? {};
    this.start.publish(ctx);
    try {
      const result = fn();
      (ctx as any).result = result;
      this.end.publish(ctx);
      return result;
    } catch (err) {
      (ctx as any).error = err;
      this.error.publish(ctx);
      throw err;
    }
  }

  /** Execute an async function within a tracing context. */
  async tracePromise<T>(fn: () => Promise<T>, context?: Record<string, unknown>): Promise<T> {
    const ctx = context ?? {};
    this.start.publish(ctx);
    try {
      const result = await fn();
      (ctx as any).result = result;
      this.asyncEnd.publish(ctx);
      return result;
    } catch (err) {
      (ctx as any).error = err;
      this.error.publish(ctx);
      throw err;
    }
  }
}

/**
 * Create a TracingChannel instance.
 */
export function tracingChannel(name: string): TracingChannel {
  return new TracingChannel(name);
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
