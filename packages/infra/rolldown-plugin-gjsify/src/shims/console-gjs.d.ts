// Ambient declaration so tsc can compile `shims/console-gjs.ts` without
// `@gjsify/console`'s `lib/` having been built yet during `yarn run build`
// in CI. The shim is a side-effect-only module that's resolved by Rolldown
// at user-build time — its imports never run through tsc's resolver in
// any consumer; only this package's tsc needs ambient types.

declare module '@gjsify/console' {
    type ConsoleFn = (...args: unknown[]) => void;
    export const log: ConsoleFn;
    export const info: ConsoleFn;
    export const debug: ConsoleFn;
    export const warn: ConsoleFn;
    export const error: ConsoleFn;
    export const dir: ConsoleFn;
    export const dirxml: ConsoleFn;
    export const table: ConsoleFn;
    export const time: ConsoleFn;
    export const timeEnd: ConsoleFn;
    export const timeLog: ConsoleFn;
    export const trace: ConsoleFn;
    export const assert: ConsoleFn;
    export const clear: ConsoleFn;
    export const count: ConsoleFn;
    export const countReset: ConsoleFn;
    export const group: ConsoleFn;
    export const groupCollapsed: ConsoleFn;
    export const groupEnd: ConsoleFn;
    export const profile: ConsoleFn;
    export const profileEnd: ConsoleFn;
    export const timeStamp: ConsoleFn;
}
