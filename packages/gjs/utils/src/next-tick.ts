// Microtask scheduling utility for GJS
// Shared by @gjsify/stream, @gjsify/web-streams, and other packages
// Matches Node.js process.nextTick semantics with cross-platform fallbacks

declare const queueMicrotask: ((cb: () => void) => void) | undefined;

/**
 * Schedule a function on the microtask queue.
 * Fallback chain: process.nextTick → queueMicrotask → Promise.resolve().then()
 */
export const nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => void =
  typeof globalThis.process?.nextTick === 'function'
    ? globalThis.process.nextTick
    : typeof globalThis.queueMicrotask === 'function'
      ? (fn: (...args: unknown[]) => void, ...args: unknown[]) => queueMicrotask!(() => fn(...args))
      : (fn: (...args: unknown[]) => void, ...args: unknown[]) => { Promise.resolve().then(() => fn(...args)); };
