// `expo-splash-screen` — a GTK application maps its window (ADR 0036 § 5 (a)).
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
// THE DESKTOP EQUIVALENT ALREADY EXISTS and belongs to `Gio.Application`: a GTK
// application maps its window when it is ready. That is the same refusal the router
// table gives expo-router's own `SplashScreen`, and it is a refusal rather than a
// track because nothing is scheduled to change it.

export * from '../generated/unsupported-expo-splash-screen.js';
