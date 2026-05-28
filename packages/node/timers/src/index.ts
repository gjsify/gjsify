// Node.js timers module for GJS
// Reference: Node.js lib/timers.js

import { Timeout, Immediate } from './timeout.js';

export { Timeout, Immediate };

/**
 * Schedule a callback to be called after `delay` milliseconds.
 * Returns a Timeout object with ref/unref/refresh methods.
 */
function _setTimeout<T extends unknown[]>(callback: (...args: T) => void, delay = 0, ...args: T): Timeout {
    return new Timeout(callback, delay, args, false);
}

/**
 * Cancel a timeout created by setTimeout.
 */
function _clearTimeout(timeout: Timeout | number | undefined): void {
    if (timeout instanceof Timeout) {
        timeout.close();
    } else if (timeout != null) {
        // `clearTimeout` is the globalThis builtin here (DOM signature takes
        // `number`, Node signature takes `Timeout | string | number`). The
        // narrowed branch can only see `number` since `Timeout` was matched
        // above, so a structural cast through `number` keeps it safe.
        clearTimeout(timeout as number);
    }
}

/**
 * Schedule a callback to be called repeatedly every `delay` milliseconds.
 * Returns a Timeout object with ref/unref/refresh methods.
 */
function _setInterval<T extends unknown[]>(callback: (...args: T) => void, delay = 0, ...args: T): Timeout {
    return new Timeout(callback, delay, args, true);
}

/**
 * Cancel an interval created by setInterval.
 */
function _clearInterval(timeout: Timeout | number | undefined): void {
    if (timeout instanceof Timeout) {
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
 * Cancel an immediate created by setImmediate.
 */
function _clearImmediate(immediate: Immediate | number | undefined): void {
    if (immediate instanceof Immediate) {
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
