// GJS console shim — injected by esbuild into GJS bundles via the `inject` option.
// Delegates to @gjsify/console which uses print()/printerr() on GJS, bypassing
// GLib.log_structured() — no "Gjs-Console-Message:" prefix, ANSI codes interpreted.
//
// esbuild resolves the @gjsify/console import at user-build time and deduplicates
// it with any explicit `import from 'node:console'` in the same bundle.
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
