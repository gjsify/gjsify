// The one build-time define this suite adds (see vite.config.ts): whether the app opts the
// real-Gio GObject engine in. Declared rather than read off `process.env` so the control run
// differs from the subject in a value the BUNDLE carries, not in the device's environment.
declare const __GJSIFY_GI_OPT_IN__: boolean;

// webpack's escape hatch for "do not touch this require", declared so `app/specs/loader.probe.ts`
// can `typeof` it exactly as `@gjsify/node-gi`'s NativeScript host does. It is NOT a global and
// nothing defines it here: under Vite the identifier survives undeclared, `typeof` on an
// undeclared name is 'undefined' rather than a ReferenceError, and that answer is the measurement.
declare const __non_webpack_require__: unknown;
