/**
 * Re-exports native Web API globals for use in Node.js builds.
 *
 * When tests import from the bare 'fetch' specifier, the build system
 * aliases it to this module on Node.js (where fetch/Headers/Request/
 * Response/FormData are native globals).
 */
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
export const FormData = globalThis.FormData;
export default globalThis.fetch;
