// `nativewind` — the class vocabulary is consumed, the toolchain is not (ADR 0036 § 5 (b)).
//
// A ROW AND NO POINTER, which is the difference from `expo-audio` and `expo-video`:
// every name in this surface's table is `refused`, so there is no other track waiting
// to answer it. What the row buys is still the thing ADR 0036 § 5 exists for — before
// it, an import of this package failed at MODULE RESOLUTION and the bundler said npm
// could not find it, which tells a porter nothing about whether a desktop answer
// exists. Now the build gate prints the reason, and the reason names the desktop's own
// answer rather than a schedule.
//
// Nothing here is hand-written: the exports below are generated from the table, so a
// status that changes changes the module.
//
// ADR 0032 § 12 ALREADY DECIDED THIS SURFACE: the class VOCABULARY is consumed and
// none of its toolchain is, so `className` works on every primitive here with no
// runtime at all. Resolving these names would pull NativeWind's bindings to React
// Native's StyleSheet, Appearance, Dimensions and PixelRatio into the critical path —
// the two-lossy-mappings-stacked shape that rules out react-native-web.

export * from '../generated/unsupported-nativewind.js';
