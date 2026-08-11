// Legacy `.call(this)` compatibility shim for ES6 classes: pre-ES2015 CJS
// consumers do `Cls.call(this)` + `util.inherits(Sub, Cls)`, which without this
// shim dies with "TypeError: Class constructor Foo cannot be invoked without
// 'new'".
//
// Reference: refs/node/lib/internal/streams/legacy.js and
// refs/readable-stream/lib/internal/streams/legacy.js — Node's Stream() is a
// regular function, deliberately callable via .call().
//
// Copyright (c) Node.js contributors. MIT license.
// Modifications: implemented as a Proxy wrapper for GJSify's ES6 classes.

/**
 * Wrap an ES6 class so it supports `new Cls(...)`, `Cls.call(thisArg, ...)` and
 * `Cls(...)` (no-`new`) alike.
 *
 * The `apply` trap has two modes:
 *
 *  1. **`Cls.call(thisArg, ...)`** — materialise a temporary instance via
 *     `Reflect.construct` (so field initializers and constructor bodies run) and
 *     transplant its own property descriptors onto `thisArg`.
 *
 *  2. **`Cls(...)`** — `thisArg` is `undefined` (strict) or `globalThis`
 *     (sloppy); construct instead. Node's stream constructors guard this
 *     explicitly (`if (!(this instanceof PassThrough)) return new PassThrough(…)`)
 *     and consumers like `merge2` rely on it. Without this branch the trap
 *     crashes on `Object.defineProperty(thisArg, …)`.
 *
 * `construct`, `get` and `getPrototypeOf` pass straight through, so
 * `Wrapped.prototype` (consulted by `util.inherits`) and `instanceof` behave
 * exactly as on the underlying class.
 */
export function makeCallable<T extends new (...args: unknown[]) => unknown>(Cls: T): T {
    return new Proxy(Cls, {
        apply(target, thisArg: object | undefined | null, args: unknown[]) {
            // No usable receiver: `globalThis` counts as none, because that is what
            // a sloppy-mode plain function call surfaces.
            if (thisArg == null || thisArg === globalThis) {
                return Reflect.construct(target, args, target);
            }
            const tmp = Reflect.construct(target, args, target) as object;
            for (const key of Reflect.ownKeys(tmp)) {
                const desc = Object.getOwnPropertyDescriptor(tmp, key);
                if (desc) Object.defineProperty(thisArg, key, desc);
            }
            return thisArg;
        },
    });
}
