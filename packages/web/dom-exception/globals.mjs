/**
 * Re-exports native DOMException global for use in Node.js builds.
 * On Node.js 17+, DOMException is a native global.
 */
export const DOMException = globalThis.DOMException;
