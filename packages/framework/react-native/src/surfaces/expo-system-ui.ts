// `expo-system-ui` — the window background belongs to the theme (ADR 0036 § 5 (a)).
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
// THE DESKTOP ANSWER IS THE APPLICATION STYLESHEET, and Adwaita already gives it per
// colour scheme — so a per-call override would fight the theme and win only until the
// scheme changes. That is a refusal, not a track.

export * from '../generated/unsupported-expo-system-ui.js';
