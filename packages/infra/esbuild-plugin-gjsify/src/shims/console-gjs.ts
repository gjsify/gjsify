// GJS console shim — bundled and injected into GJS builds via esbuild's `inject` option.
// Contains the full @gjsify/console implementation inlined (~4KB) so no external
// @gjsify/* package resolution is needed at user-build time. Uses print()/printerr()
// on GJS, bypassing GLib.log_structured() — no prefix, ANSI codes work.
import {
    log, info, debug, warn, error, dir, dirxml, table,
    time, timeEnd, timeLog, trace, assert, clear,
    count, countReset, group, groupCollapsed, groupEnd,
    profile, profileEnd, timeStamp,
} from '@gjsify/console';

export let console = {
    log, info, debug, warn, error, dir, dirxml, table,
    time, timeEnd, timeLog, trace, assert, clear,
    count, countReset, group, groupCollapsed, groupEnd,
    profile, profileEnd, timeStamp,
};
