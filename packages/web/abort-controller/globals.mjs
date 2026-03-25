/**
 * Re-exports native AbortController/AbortSignal globals for use in Node.js builds.
 * On Node.js, AbortController and AbortSignal are native globals.
 */
export const AbortController = globalThis.AbortController;
export const AbortSignal = globalThis.AbortSignal;
