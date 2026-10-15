// The one build-time define this suite adds (see vite.config.ts): whether the app opts the
// real-Gio GObject engine in. Declared rather than read off `process.env` so the control run
// differs from the subject in a value the BUNDLE carries, not in the device's environment.
declare const __GJSIFY_GI_OPT_IN__: boolean;

// Whether this build runs the per-instance benchmark (`app/specs/bench.ts`). Off by default and a
// define for the same reason: it has to be absent from the BUNDLE of the runs that measure cold
// start, because the suite runs before `Application.run()` and seconds of benchmark would land in
// the startup number ADR 0110 gate 2 compares.
declare const __GJSIFY_GI_BENCH__: boolean;

// webpack's escape hatch for "do not touch this require", declared so `app/specs/loader.probe.ts`
// can `typeof` it exactly as `@gjsify/node-gi`'s NativeScript host does. It is NOT a global and
// nothing defines it here: under Vite the identifier survives undeclared, `typeof` on an
// undeclared name is 'undefined' rather than a ReferenceError, and that answer is the measurement.
declare const __non_webpack_require__: unknown;
