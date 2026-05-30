/**
 * Re-exports native XMLHttpRequest globals for browser builds.
 *
 * XHR is universal in every browser (legacy but always-on).
 *
 * The dynamic resolver in `@gjsify/resolve-npm/runtime-aliases.mjs` routes
 * `@gjsify/xmlhttprequest` here when `package.json#gjsify.runtimes.browser === "native"`.
 *
 * NOT used on Node — Node has no XHR global. `URL.createObjectURL` /
 * `revokeObjectURL` are exposed via `@gjsify/url`'s `globals.mjs`.
 */

export const XMLHttpRequest = globalThis.XMLHttpRequest;
export const XMLHttpRequestUpload = globalThis.XMLHttpRequestUpload;
export const XMLHttpRequestEventTarget = globalThis.XMLHttpRequestEventTarget;
export const FormData = globalThis.FormData;
