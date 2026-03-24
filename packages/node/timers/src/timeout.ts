// Timeout class wrapping the native timer ID.
// Provides ref/unref/hasRef/refresh semantics matching Node.js Timeout.

export class Timeout {
  private _id: ReturnType<typeof setTimeout> | null;
  private _ref = true;
  private _callback: (...args: any[]) => void;
  private _delay: number;
  private _args: any[];
  private _isInterval: boolean;

  constructor(
    callback: (...args: any[]) => void,
    delay: number,
    args: any[],
    isInterval: boolean,
  ) {
    this._callback = callback;
    this._delay = delay;
    this._args = args;
    this._isInterval = isInterval;

    if (isInterval) {
      this._id = setInterval(callback, delay, ...args);
    } else {
      this._id = setTimeout(callback, delay, ...args);
    }
  }

  /**
   * Mark this timeout as referenced (default).
   * Referenced timers keep the event loop alive.
   */
  ref(): this {
    this._ref = true;
    return this;
  }

  /**
   * Mark this timeout as unreferenced.
   * Unreferenced timers do not keep the event loop alive.
   */
  unref(): this {
    this._ref = false;
    return this;
  }

  /** Whether this timeout is referenced. */
  hasRef(): boolean {
    return this._ref;
  }

  /**
   * Reset the timer's start time to now and reschedule.
   */
  refresh(): this {
    if (this._id != null) {
      if (this._isInterval) {
        clearInterval(this._id);
        this._id = setInterval(this._callback, this._delay, ...this._args);
      } else {
        clearTimeout(this._id);
        this._id = setTimeout(this._callback, this._delay, ...this._args);
      }
    }
    return this;
  }

  /** Close/clear this timer. */
  close(): void {
    if (this._id != null) {
      if (this._isInterval) {
        clearInterval(this._id);
      } else {
        clearTimeout(this._id);
      }
      this._id = null;
    }
  }

  /** Get the underlying timer ID (for clearTimeout/clearInterval). */
  [Symbol.toPrimitive](): number {
    return this._id as unknown as number;
  }
}

export class Immediate {
  private _id: ReturnType<typeof setTimeout> | null = null;
  private _ref = true;
  private _cancelled = false;

  constructor(callback: (...args: any[]) => void, args: any[]) {
    // Use a microtask so setImmediate fires before setTimeout(0)
    Promise.resolve().then(() => {
      if (!this._cancelled) {
        callback(...args);
      }
    });
  }

  ref(): this {
    this._ref = true;
    return this;
  }

  unref(): this {
    this._ref = false;
    return this;
  }

  hasRef(): boolean {
    return this._ref;
  }

  close(): void {
    this._cancelled = true;
    if (this._id != null) {
      clearTimeout(this._id);
      this._id = null;
    }
  }

  [Symbol.toPrimitive](): number {
    return this._id as unknown as number;
  }
}
