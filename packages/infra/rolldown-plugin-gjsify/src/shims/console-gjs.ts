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
import * as gjsConsole from '@gjsify/console';

// NOTE: a namespace import is used deliberately. It is a single statement that
// no formatter (oxfmt) can wrap across lines, so the `@ts-ignore` above always
// sits on the line immediately preceding the import and reliably suppresses the
// TS2307 (`@gjsify/console` is resolved by Rolldown at user-build time, not by
// tsc here). A multi-line named import would let the reformatter detach the
// suppression from the offending `from '@gjsify/console'` line.
export const console = {
    log: gjsConsole.log,
    info: gjsConsole.info,
    debug: gjsConsole.debug,
    warn: gjsConsole.warn,
    error: gjsConsole.error,
    dir: gjsConsole.dir,
    dirxml: gjsConsole.dirxml,
    table: gjsConsole.table,
    time: gjsConsole.time,
    timeEnd: gjsConsole.timeEnd,
    timeLog: gjsConsole.timeLog,
    trace: gjsConsole.trace,
    assert: gjsConsole.assert,
    clear: gjsConsole.clear,
    count: gjsConsole.count,
    countReset: gjsConsole.countReset,
    group: gjsConsole.group,
    groupCollapsed: gjsConsole.groupCollapsed,
    groupEnd: gjsConsole.groupEnd,
    profile: gjsConsole.profile,
    profileEnd: gjsConsole.profileEnd,
    timeStamp: gjsConsole.timeStamp,
};
