/**
 * `@gjsify/pim/eds` — the Evolution Data Server backend. One implementation for every runtime:
 * GJS resolves `gi://` natively, Node through `@gjsify/node-gi`. The typelibs load on first use,
 * so importing this entry on a host without EDS is safe; the first call answers with
 * `BackendUnavailableError`.
 */

export { createEdsBackend } from './driver.gjs.js';
export { edsError, unwrapList, unwrapResult } from './errors.js';
export { goaAccountId, type GoaSourceLike } from './goa.js';
