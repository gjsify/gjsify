/**
 * `@gjsify/pim/caldav` — the CalDAV backend. Plain `fetch` through `@gjsify/dav`, so one
 * implementation serves GJS and Node. Basic auth only; other schemes are the consumer's to refuse.
 */

export { createCaldavBackend, type CaldavOptions } from './backend.js';
export { createCaldavDeltaReader, type CaldavDeltaOptions, type CaldavDeltaReader } from './delta.js';
