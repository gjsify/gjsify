// Legacy `.call(this)` compatibility shim for ES6 classes.
//
// Reference: refs/node/lib/internal/streams/legacy.js (Node core Stream() as a
//            regular function, deliberately callable via .call()).
// Reference: refs/readable-stream/lib/internal/streams/legacy.js (same pattern).
// Implements the legacy callable pattern for our class-based hierarchy so
// pre-ES2015 CJS consumers can do `Cls.call(this)` + `util.inherits(Sub, Cls)`.
// Without this shim, packages that do `EventEmitter.call(this)` or
// `Stream.call(this)` crash with:
//   TypeError: Class constructor Foo cannot be invoked without 'new'
//
// Copyright (c) Node.js contributors. MIT license.
// Modifications: implemented as a Proxy wrapper for GJSify's ES6 classes.

/**
 * Wrap an ES6 class so it supports both the modern `new Cls(...)` pattern and
 * the legacy `Cls.call(thisArg, ...)` / `Cls(...)` (no-`new`) patterns.
 *
 * The `apply` trap has two modes:
 *
 *  1. **`Cls.call(thisArg, ...)`** — a real consumer instance is provided.
 *     We materialise a temporary instance via `Reflect.construct` (so field
 *     initializers and constructor bodies run normally) and transplant its
 *     own property descriptors onto `thisArg`. This is how Node-era CJS
 *     consumers + `util.inherits(Sub, Cls)` chains expect to subclass our
 *     ES6 classes.
 *
 *  2. **`Cls(...)`** (called as a plain function — `thisArg` is `undefined`
 *     in strict mode or `globalThis` in sloppy mode) — we treat the call as
 *     a constructor call and return a fresh `new Cls(...)`. Node's stream
 *     constructors implement this guard explicitly:
 *       `if (!(this instanceof PassThrough)) return new PassThrough(...)`
 *     so consumers like `merge2` invoke `Stream.PassThrough(opts)` without
 *     `new` and rely on the result being a real instance. Without this
 *     branch the apply trap would crash with "undefined is not a non-null
 *     object" when it tried to `Object.defineProperty(thisArg, …)`.
 *
 * The default Proxy traps pass `construct`, `get` and `getPrototypeOf`
 * straight through, so `new Wrapped()`, `Wrapped.prototype` (consulted by
 * `util.inherits`) and `instance instanceof Wrapped` all behave identically
 * to the underlying class.
 */
export function makeCallable<T extends new (...args: any[]) => any>(Cls: T): T {
    return new Proxy(Cls, {
        apply(target, thisArg: object | undefined | null, args: any[]) {
            // No-`new` invocation (`Cls(...)`): no usable receiver to mutate
            // — return a freshly constructed instance instead. globalThis is
            // also treated as "no receiver" because that is what a sloppy-
            // mode plain function call surfaces.
            if (thisArg == null || thisArg === globalThis) {
                return Reflect.construct(target, args, target);
            }
            // `Cls.call(thisArg, ...)`: transplant a fresh instance's own
            // properties onto the caller-supplied receiver.
            const tmp = Reflect.construct(target, args, target);
            for (const key of Reflect.ownKeys(tmp)) {
                const desc = Object.getOwnPropertyDescriptor(tmp, key);
                if (desc) Object.defineProperty(thisArg, key, desc);
            }
            return thisArg;
        },
    });
}
