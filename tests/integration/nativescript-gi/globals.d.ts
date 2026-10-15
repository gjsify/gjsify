// The one build-time define this suite adds (see vite.config.ts): whether the app opts the
// real-Gio GObject engine in. Declared rather than read off `process.env` so the control run
// differs from the subject in a value the BUNDLE carries, not in the device's environment.
declare const __GJSIFY_GI_OPT_IN__: boolean;

// Whether this build runs the per-instance benchmark (`app/specs/bench.ts`). Off by default and a
// define for the same reason: it has to be absent from the BUNDLE of the runs that measure cold
// start, because the suite runs before `Application.run()` and seconds of benchmark would land in
// the startup number ADR 0110 gate 2 compares.
declare const __GJSIFY_GI_BENCH__: boolean;

// Whether this build carries the two UI specs of ADR 0110 § 3 (`app/specs/views.ts`,
// `app/specs/storybook.ts`) — the ones that run in BOTH legs. ON by default, because they are the
// dual run's subject; a define, and off in the gate-2 release rungs, because they pull
// `@gjsify/storybook-nativescript` and a pile of real widgets into the bundle, and the APK-size
// and cold-start ladder recorded in docs/reports/2026-10-15-adr-0110-gates.md was measured
// without them. Comparable numbers mean the same bundle.
declare const __GJSIFY_GI_UI__: boolean;

// webpack's escape hatch for "do not touch this require", declared so `app/specs/loader.probe.ts`
// can `typeof` it exactly as `@gjsify/node-gi`'s NativeScript host does. It is NOT a global and
// nothing defines it here: under Vite the identifier survives undeclared, `typeof` on an
// undeclared name is 'undefined' rather than a ReferenceError, and that answer is the measurement.
declare const __non_webpack_require__: unknown;
