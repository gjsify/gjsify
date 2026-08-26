// What an unimplemented React Native export IS, at runtime.
//
// The bundler gate (ADR 0032 § 8) refuses these at build time and gives the best
// message, because it knows the importing file and the line. This is the backstop
// for everything the gate cannot see: a computed property read, a `import * as RN`
// namespace walked at runtime, a dependency that reaches for `RN.Animated` inside a
// `typeof` guard.
//
// WHY A THROWING VALUE RATHER THAN NO EXPORT AT ALL. Omitting the name is already
// loud — a bundler reports `MISSING_EXPORT` — but what it reports is "this package
// does not export FlatList", which sends the reader to ask whether they typed it
// wrong. The table knows something better: that `FlatList` is tier P2, that it maps
// onto `Gtk.ListView` with a real `Gio.ListStore` behind it, and that it is not
// built yet. A shrug and a sentence cost the same to ship.
//
// WHY IT THROWS ON *ACCESS* AND NOT ONLY ON CALL. `Animated.timing` and
// `NativeModules.Foo` are property reads on an object, and a module that reads one
// during its own evaluation would otherwise get `undefined` and fail somewhere else
// entirely — the failure-attribution problem this repository keeps paying for. The
// proxy answers `typeof` honestly (a function) so a `typeof X === 'function'` guard
// still works, and refuses everything else with the name and the reason.

import { explainUnsupported } from './support-table.js';

/**
 * The error an unimplemented export raises.
 *
 * A named class so a consumer can distinguish "this layer does not do that yet"
 * from a genuine bug in their own code, which a bare `Error` makes impossible.
 */
export class UnsupportedError extends Error {
    override readonly name = 'UnsupportedError';
    /** The React Native export that was reached for. */
    readonly export: string;

    constructor(exportName: string) {
        super(explainUnsupported(exportName));
        this.export = exportName;
    }
}

/**
 * A stand-in for `name` that refuses every use with the table's own sentence.
 *
 * Callable, constructible, and property-readable — all three throw. It is typed
 * `never`-ish on purpose at the call sites that re-export it: the declared type
 * comes from React Native's own, so a consumer's code still type-checks and the
 * refusal is a runtime fact rather than a type error they cannot act on.
 */
export function unsupported(name: string): never {
    // The function itself is the component/API stand-in. Rendering it calls it.
    const refuse = (): never => {
        throw new UnsupportedError(name);
    };

    // A function DECLARATION as the proxy target, not the arrow above. An arrow is
    // not constructible, and the engine rejects `new proxy()` on the TARGET's shape
    // before the `construct` trap ever runs — measured on gjs 1.88.1, the thrown
    // error is `t is not a constructor`, which names a minified local and explains
    // nothing. A `class X extends SomeRNThing` in a consumer's code is exactly this
    // path, so it has to reach the trap.
    function constructible(): never {
        return refuse();
    }

    const proxy = new Proxy(constructible, {
        apply: refuse,
        construct: refuse,
        get(target, property) {
            // `typeof x` never traps, but these three are read by feature
            // detection and by the bundler's own interop, and answering them
            // honestly is cheaper than a throw nobody asked for.
            if (property === 'name') return name;
            if (property === 'displayName') return name;
            if (property === Symbol.toStringTag) return name;
            // React checks this on anything it is asked to render, before render.
            if (property === '$$typeof') return undefined;
            // A thenable check: returning a throwing `then` would break `await`
            // on an unrelated value that merely passed through here.
            if (property === 'then') return undefined;
            if (property === 'prototype') return Reflect.get(target, property);
            throw new UnsupportedError(name);
        },
        set(): never {
            throw new UnsupportedError(name);
        },
    });

    return proxy as never;
}
