// GJS console shim — bundled into GJS user builds via the orchestrator's
// virtual-entry side-effect import. Uses print()/printerr() on GJS,
// bypassing GLib.log_structured() — no prefix, ANSI codes work.
//
// `@gjsify/console` is resolved by the user's `gjsify build` Rolldown
// run, NOT by tsc here. The bare specifier survives compilation and only
// gets followed at user-build time, where the CLI's `@gjsify/node-polyfills`
// dep tree has the package. tsc on this package would otherwise need the
// `@gjsify/console` lib to be pre-built (build-order coupling) — the
// `@ts-expect-error` keeps us decoupled.
// @ts-ignore — resolved by Rolldown at user-build time, not by tsc here.
import { log, info, debug, warn, error, dir, dirxml, table, time, timeEnd, timeLog, trace, assert, clear, count, countReset, group, groupCollapsed, groupEnd, profile, profileEnd, timeStamp } from '@gjsify/console';

export let console = {
    log, info, debug, warn, error, dir, dirxml, table,
    time, timeEnd, timeLog, trace, assert, clear,
    count, countReset, group, groupCollapsed, groupEnd,
    profile, profileEnd, timeStamp,
};
