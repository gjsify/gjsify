/**
 * Re-exports native WebCrypto globals for use in Node.js builds.
 * On Node.js, crypto.subtle is a native global.
 */
export default globalThis.crypto;
export const subtle = globalThis.crypto.subtle;
