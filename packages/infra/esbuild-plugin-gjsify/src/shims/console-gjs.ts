// GJS console shim — injected by esbuild into GJS bundles via the `inject` option.
// Replaces all bare `console` global references in the bundle with this implementation.
// print() / printerr() are GJS globals that call g_print() / g_printerr() directly,
// bypassing GLib.log_structured() — so no "Gjs-Console-Message:" prefix and ANSI
// escape codes are interpreted by the terminal correctly.

declare function print(...args: unknown[]): void;
declare function printerr(...args: unknown[]): void;

function _fmt(...args: unknown[]): string {
    return args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
}

const _grp: string[] = [];

export let console = {
    log:   (...a: unknown[]) => print(_grp.join('') + _fmt(...a)),
    info:  (...a: unknown[]) => print(_grp.join('') + _fmt(...a)),
    debug: (...a: unknown[]) => print(_grp.join('') + _fmt(...a)),
    warn:  (...a: unknown[]) => printerr(_grp.join('') + _fmt(...a)),
    error: (...a: unknown[]) => printerr(_grp.join('') + _fmt(...a)),
    dir:   (o: unknown, _opts?: object) => print(JSON.stringify(o, null, 2)),
    dirxml: (...a: unknown[]) => print(_grp.join('') + _fmt(...a)),
    group:    (...a: unknown[]) => { if (a.length) print(_grp.join('') + _fmt(...a)); _grp.push('  '); },
    groupEnd: () => { _grp.pop(); },
    groupCollapsed: (...a: unknown[]) => console.group(...a),
    table: (d: unknown, _props?: string[]) => print(JSON.stringify(d, null, 2)),
    clear: () => print('\x1Bc'),
    assert: (v: unknown, ...a: unknown[]) => { if (!v) printerr('Assertion failed:', _fmt(...a)); },
    count:      (_l?: string) => {},
    countReset: (_l?: string) => {},
    time:    (_l?: string) => {},
    timeEnd: (_l?: string) => {},
    timeLog: (_l?: string, ..._a: unknown[]) => {},
    trace:  (...a: unknown[]) => printerr('Trace:', _fmt(...a)),
    profile:    (_l?: string) => {},
    profileEnd: (_l?: string) => {},
    timeStamp:  (_l?: string) => {},
};
