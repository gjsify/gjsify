// Android test entry — the GObject conformance vectors on a device, against BOTH subjects ADR
// 0105 stage 0 asks about: the pure-JS subset (`gobject.spec.ts`'s test door) and real GObject
// through `@gjsify/node-gi` on NativeScript. One bundle, one APK, one logcat.
//
// WHY THIS ENTRY EXPORTS INSTEAD OF RUNNING. The other entries call `run()` at import. Here the
// host must inject `requireGi`: on Android `@gjsify/node-gi` resolves only through
// `@nativescript/webpack`, which adds the `nativescript` export condition that points `#host` at
// `host.nativescript.js` — and only that host knows `system_lib://libnode_gi.so`. A gjsify bundle
// resolves the specifier with Node conditions, so the import has to happen in the APK's own code,
// above this bundle. The suite already takes `requireGi` as a parameter (that is why), so this
// entry only has to hand it through.
//
// WHY `@gjsify/unit` NEEDS NO LOGCAT REPORTER. Its `print` is `globalThis.print || console.log`,
// and on NativeScript that is `console.log`, which the runtime writes to logcat under the `JS`
// tag. The runner's output therefore arrives line by line with no change to `@gjsify/unit` — see
// the arm64 report.
//
// THE SUBSET RUNS FIRST, deliberately: it needs nothing native, so a `dlopen` or GI failure in the
// node-gi leg cannot take the subset's rows with it.

import { run } from '@gjsify/unit';

import gobjectTestSuite from './gobject.spec.js';
import { gobjectNodeGiSuite, type RequireGi } from './gobject.node-gi.spec.js';

/**
 * Drive both subjects. `requireGi` omitted ⇒ only the pure-JS subset runs, which is what a host
 * without the addon (or one measuring the subset alone) wants.
 */
export const runAndroidGObjectSuites = (requireGi?: RequireGi) =>
    run({
        gobjectSubsetTestSuite: gobjectTestSuite,
        ...(requireGi === undefined ? {} : { gobjectNodeGiTestSuite: gobjectNodeGiSuite(requireGi) }),
    });

export default runAndroidGObjectSuites;
