// GJS console shim — bundled into GJS user builds via Rolldown's `inject`.
// Routes through print()/printerr() rather than GLib.log_structured(): no
// `Gjs-Console-Message:` prefix, ANSI escapes survive, output on stdout/stderr.
//
// `globalThis.console` is non-writable AND non-configurable in GJS — re-measured
// on 1.88/SM 140, so it is a property of the runtime and not of one version — which
// is why nothing here assigns to it. Rolldown's `inject` rewrites bare `console`
// references to a named import from this shim instead.
//
// The `@gjsify/console` specifier is followed at USER-build time by Rolldown, not by
// tsc here; resolving it here would make this package depend on that one being built
// first. Hence the namespace import: a single statement no formatter can wrap, so the
// `@ts-ignore` stays on the line directly above it. A multi-line named import would
// let oxfmt detach the suppression from the `from '@gjsify/console'` line.
// @ts-ignore — resolved by Rolldown at user-build time, not by tsc here.
import * as gjsConsole from '@gjsify/console';

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
