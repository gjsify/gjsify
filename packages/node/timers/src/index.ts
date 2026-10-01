// Node.js timers module for GJS
// Reference: Node.js lib/timers.js

import { Timeout, Immediate } from './timeout.js';

export { Timeout, Immediate };

/**
 * Structural shape of a Node timer handle, as `@types/node` declares it for
 * `NodeJS.Timeout`.
 *
 * This is what makes the return value usable WITHOUT a cast: a consumer's
 * `setInterval(...).unref()` type-checks because the object we return satisfies
 * this interface, which is why the globals register path and this module agree
 * on the same members.
 *
 * `close(): unknown` because `@types/node` declares `close(): void` while ours
 * returns `this` for chaining — a `this` return satisfies a `void` one.
 */
export interface NodeTimerHandle {
    ref(): unknown;
    unref(): unknown;
    hasRef(): boolean;
    refresh(): unknown;
    close(): unknown;
    [Symbol.toPrimitive](): number;
    [Symbol.dispose](): void;
}

/** A Node `Immediate` has no `refresh`/`toPrimitive`, so it gets its own shape. */
export interface NodeImmediateHandle {
    ref(): unknown;
    unref(): unknown;
    hasRef(): boolean;
    [Symbol.dispose](): void;
}

/**
 * Structural test for a Node timer handle.
 *
 * `close` is checked, not just `unref`/`hasRef`, because the whole point is to
 * reach a `close()`: a duck-type that accepted an object without one would
 * throw at the call site instead of falling through to the numeric branch.
 */
function isNodeTimerHandle(value: unknown): value is NodeTimerHandle {
    if (typeof value !== 'object' || value === null) return false;
    const probe = value as Partial<NodeTimerHandle>;
    return typeof probe.unref === 'function' && typeof probe.hasRef === 'function' && typeof probe.close === 'function';
}

/**
 * Cancel a timeout created by setTimeout.
 *
 * Accepts the Node spellings, not just our own instance: `setTimeout` may have
 * come from a third-party module, from a `worker_threads` realm, or as a bare
 * number (a browser handle). Anything with the `unref`/`hasRef`/`close` trio is
 * structurally a Node `Timeout`, so duck-type it rather than `instanceof` — the
 * check has to survive a duplicate copy of this module in the bundle, which is
 * exactly the situation that made consumers cast in the first place.
 */
function _clearTimeout(timeout: NodeTimerHandle | number | undefined): void {
    if (isNodeTimerHandle(timeout)) {
        timeout.close();
    } else if (timeout != null) {
        // `clearTimeout` is the globalThis builtin here (DOM signature takes
        // `number`, Node signature takes `Timeout | string | number`). The
        // narrowed branch can only see `number` since a handle was matched
        // above, so a structural cast through `number` keeps it safe.
        clearTimeout(timeout as number);
    }
}

/**
 * Schedule a callback to be called after `delay` milliseconds.
 *
 * The returned handle satisfies {@link NodeTimerHandle}, so a consumer typed
 * against `@types/node` calls `.unref()` on it without a cast.
 */
function _setTimeout<T extends unknown[]>(callback: (...args: T) => void, delay = 0, ...args: T): Timeout {
    return new Timeout(callback, delay, args, false);
}

/**
 * Schedule a callback to be called repeatedly every `delay` milliseconds.
 * Returns the same handle shape as {@link _setTimeout}.
 */
function _setInterval<T extends unknown[]>(callback: (...args: T) => void, delay = 0, ...args: T): Timeout {
    return new Timeout(callback, delay, args, true);
}

/**
 * Cancel an interval created by setInterval. Accepts the same shapes as
 * {@link _clearTimeout}.
 */
function _clearInterval(timeout: NodeTimerHandle | number | undefined): void {
    if (isNodeTimerHandle(timeout)) {
        timeout.close();
    } else if (timeout != null) {
        clearInterval(timeout as number);
    }
}

/**
 * Schedule a callback to be called on the next iteration of the event loop.
 * Returns an Immediate object with ref/unref methods.
 */
function _setImmediate<T extends unknown[]>(callback: (...args: T) => void, ...args: T): Immediate {
    return new Immediate(callback, args);
}

/**
 * Cancel an immediate created by setImmediate. Accepts a foreign Node `Immediate`
 * through the same duck-type as {@link _clearTimeout}, because `instanceof` fails
 * across a duplicated module and callers hold whatever `setImmediate` gave them.
 */
function _clearImmediate(immediate: Immediate | NodeImmediateHandle | number | undefined): void {
    // The same `unref`/`hasRef`/`close` trio as a timer: every Node-shaped
    // `Immediate` exposes `close()` to cancel. `NodeImmediateHandle` differs only
    // in its `refresh`-free TYPE, which is a typing question, not a runtime one.
    if (isNodeTimerHandle(immediate)) {
        immediate.close();
    } else if (immediate != null) {
        clearTimeout(immediate as number);
    }
}

export {
    _setTimeout as setTimeout,
    _clearTimeout as clearTimeout,
    _setInterval as setInterval,
    _clearInterval as clearInterval,
    _setImmediate as setImmediate,
    _clearImmediate as clearImmediate,
};

export default {
    setTimeout: _setTimeout,
    clearTimeout: _clearTimeout,
    setInterval: _setInterval,
    clearInterval: _clearInterval,
    setImmediate: _setImmediate,
    clearImmediate: _clearImmediate,
    Timeout,
    Immediate,
};
