// GJS console shim — bundled into GJS user builds via Rolldown's `inject`.
// Uses print()/printerr() on GJS, bypassing GLib.log_structured() — no
// `Gjs-Console-Message:` prefix, ANSI escapes work, output goes to
// stdout/stderr instead of GLib's logging stream.
//
// `@gjsify/console` is resolved by the user's `gjsify build` Rolldown
// run, NOT by tsc here. The bare specifier survives compilation and only
// gets followed at user-build time, where the CLI's `@gjsify/node-polyfills`
// dep tree has the package. tsc on this package would otherwise need the
// `@gjsify/console` lib to be pre-built (build-order coupling).
//
// We can't reassign `globalThis.console` on SpiderMonkey 128 — the
// property is non-configurable. Rolldown's `inject` option rewrites bare
// `console` references to a named import from this shim instead, leaving
// `globalThis.console` untouched and routing user `console.log(…)` calls
// through our object.
// @ts-ignore — resolved by Rolldown at user-build time, not by tsc here.
import { log, info, debug, warn, error, dir, dirxml, table, time, timeEnd, timeLog, trace, assert, clear, count, countReset, group, groupCollapsed, groupEnd, profile, profileEnd, timeStamp } from '@gjsify/console';

export const console = {
    log, info, debug, warn, error, dir, dirxml, table,
    time, timeEnd, timeLog, trace, assert, clear,
    count, countReset, group, groupCollapsed, groupEnd,
    profile, profileEnd, timeStamp,
};
