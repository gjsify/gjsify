// The non-vacuity sentinel: a deliberate, UNSUPPRESSED type error.
//
// Everything else in this directory asserts "exit code 0", and exit 0 is exactly
// what a compiler that never read a fixture also reports. `tsconfig.sentinel.json`
// compiles this one file and `scripts/check-type-surfaces.mjs` requires it to FAIL
// with the code named below — so a run that reports the React half green has
// proved, in the same invocation, that the harness can still see an error at all.
//
// It is a separate program on purpose: kept in the main one it would need a
// `@ts-expect-error`, and then it would be indistinguishable from the negatives it
// exists to underwrite.

// expect-error: TS2339 — the harness reports this file's error, or the gate is a no-op.
export const sentinel = <gtk-this-tag-must-never-exist />;
