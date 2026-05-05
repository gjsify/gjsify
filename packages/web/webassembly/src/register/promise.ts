// Side-effect module: replace GJS's stub WebAssembly Promise APIs with
// polyfills wrapping the synchronous constructors.
//
// SpiderMonkey 128 (GJS 1.86) exposes WebAssembly.{compile,compileStreaming,
// instantiate,instantiateStreaming,validate} as `function` typeof values
// that throw `Error: WebAssembly Promise APIs not supported in this runtime.`
// at first call. The synchronous constructors `new WebAssembly.Module(buffer)`
// and `new WebAssembly.Instance(module, imports)` work, so we wrap them.
//
// Idempotent — installing twice replaces with the same wrappers.
//
// On Node.js these Promise APIs are native — the aliases in
// @gjsify/resolve-npm route this subpath to @gjsify/empty during Node builds
// so it becomes a no-op.

import {
    compile,
    compileStreaming,
    instantiate,
    instantiateStreaming,
    validate,
} from '../index.js';

const wa = (globalThis as any).WebAssembly;
if (typeof wa !== 'undefined') {
    // Replace unconditionally — the runtime stubs throw on first call, so
    // our wrappers are strictly more capable. Use defineProperty so
    // re-imports do not error in strict mode.
    const replace = (name: string, value: unknown) => {
        try {
            Object.defineProperty(wa, name, {
                value,
                writable: true,
                configurable: true,
                enumerable: true,
            });
        } catch {
            // Some runtimes mark these properties non-configurable. Fall
            // through silently — the consumer can still import named
            // helpers from `@gjsify/webassembly` directly.
        }
    };
    replace('compile', compile);
    replace('compileStreaming', compileStreaming);
    replace('instantiate', instantiate);
    replace('instantiateStreaming', instantiateStreaming);
    replace('validate', validate);
}
