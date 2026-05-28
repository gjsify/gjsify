// Re-exports native Fetch API globals for use in Node.js / browser builds.
// On Node 18+ fetch, Request, Response, Headers and FormData are native
// globals (the undici-backed implementation is enabled by default). On
// browsers all five have been native for a decade.
//
// The dynamic resolver in `@gjsify/resolve-npm/runtime-aliases.mjs` routes
// `@gjsify/fetch` here when the package's `gjsify.runtimes` triplet
// declares the non-GJS slot as `"native"`. The hardcoded bare `fetch`
// specifier in `ALIASES_WEB_FOR_NODE` previously skipped aliasing on
// Node entirely (consumers read `globalThis.fetch` directly); now both
// paths converge on this file.

export const fetch = globalThis.fetch;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
export const Headers = globalThis.Headers;
export const FormData = globalThis.FormData;
