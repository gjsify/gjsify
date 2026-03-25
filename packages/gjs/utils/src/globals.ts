// Shared utility for registering global polyfills.
// Used by web packages (abort-controller, dom-exception, streams, webcrypto, etc.)
// to consistently register globals only when they're missing.

/**
 * Register a value as a global property if it doesn't already exist.
 * This is a no-op in environments where the global is already defined (e.g. Node.js).
 */
export function registerGlobal(name: string, value: unknown): void {
  if (typeof (globalThis as any)[name] === 'undefined') {
    (globalThis as any)[name] = value;
  }
}
