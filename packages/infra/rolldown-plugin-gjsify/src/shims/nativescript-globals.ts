// Node globals a NativeScript runtime lacks, installed before any app or dependency
// module evaluates. Entered by both `--app nativescript` paths (Rolldown entry wrapper,
// Vite bundler-context prepend). Each import is a no-op where the host has the global.
//
// The specifier is followed at USER-build time, like `console-gjs`'s, so this package
// only needs `@gjsify/timers` installed next to it, not built before it.
// @ts-ignore: resolved by the bundler at user-build time, not by tsc here.
import '@gjsify/timers/register';
