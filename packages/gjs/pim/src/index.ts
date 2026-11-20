/**
 * `@gjsify/pim` — calendars and tasks behind one port, whatever stores them.
 *
 * The root entry is pure: the port, its types, the errors and the translator hook. Drivers are
 * subpath exports, so a consumer pulls in only the ones it uses: `@gjsify/pim/caldav` (plain
 * fetch, every runtime) and `@gjsify/pim/eds` (Evolution Data Server, typelibs loaded on first
 * use).
 */

export * from './types.js';
export * from './backend.js';
export * from './errors.js';
export { optionalNamespace, type OptionalNamespace } from './optional.js';
export { setPimTranslator, type PimTranslator } from './i18n.js';
