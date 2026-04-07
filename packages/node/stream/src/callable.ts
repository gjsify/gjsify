// Legacy `.call(this)` compatibility shim for ES6 stream classes.
//
// Reference: refs/node/lib/internal/streams/legacy.js (Node core Stream() as a
//            regular function, deliberately callable via .call()).
// Reference: refs/readable-stream/lib/internal/streams/legacy.js (same pattern).
// Implements the legacy callable pattern for our class-based stream hierarchy
// so pre-ES2015 CJS consumers can do `Stream.call(this)` + `util.inherits(Sub,
// Stream)`. Without this shim, packages like npm `send` (which backs
// `express.static`) and our own `@gjsify/crypto` `Hash.copy()` crash with
// `TypeError: Class constructor Stream cannot be invoked without 'new'`.
//
// Copyright (c) Node.js contributors. MIT license.
// Modifications: implemented as a Proxy wrapper for GJSify's ES6 class streams.

/**
 * Wrap an ES6 class so it supports both the modern `new Cls(...)` pattern and
 * the legacy `Cls.call(thisArg, ...)` pattern.
 *
 * The `apply` trap materialises a temporary instance via `Reflect.construct`
 * (so field initializers and constructor bodies run normally), then transplants
 * its own property descriptors onto `thisArg`. The default Proxy traps pass
 * `construct`, `get` and `getPrototypeOf` straight through, so `new Wrapped()`,
 * `Wrapped.prototype` (consulted by `util.inherits`) and `instance instanceof
 * Wrapped` all behave identically to the underlying class.
 */
export function makeCallable<T extends new (...args: any[]) => any>(Cls: T): T {
    return new Proxy(Cls, {
        apply(target, thisArg: object, args: any[]) {
            const tmp = Reflect.construct(target, args, target);
            for (const key of Reflect.ownKeys(tmp)) {
                const desc = Object.getOwnPropertyDescriptor(tmp, key);
                if (desc) Object.defineProperty(thisArg, key, desc);
            }
            return thisArg;
        },
    });
}
