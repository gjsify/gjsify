# 110. Real GObject becomes the Android default, and the subset stays tested there

- Status: **Accepted** (2026-10-13)
- Date: 2026-10-13
- Deciders: Pascal Garber
- Related: [ADR 0104](0104-real-gtk-and-gi-on-android-are-opt-in-tracks-beside-the-nativescript-port.md)
  (§ 1 is untouched),
  [ADR 0105](0105-real-gobject-backs-the-nativescript-subset-on-android.md) (amended by this ADR),
  [ADR 0096](0096-a-gobject-subset-runs-on-the-browser-and-nativescript.md) (the subset)

## Context

ADR 0105 made real GObject an opt-in backend on NativeScript Android and kept the pure-JS subset as
the default. Since then stage 4 shipped the engine as `@gjsify/adwaita-gobject-native` plus
`@gjsify/gi-runtime-android`, and it passes the subset's 41 of 41 rows on an arm64 phone and an
`x86_64` emulator. Two measurements exist: the plugin share of a universal debug APK is about
15.5 MB per ABI, and cold start grows by about 83 ms (6.5 %) on arm64. No release APK was measured
per ABI, and the widget twins for registered classes (stage 2) are not finished.

The project goal is GJS-identical behaviour wherever that is possible. Only real GObject is fully
GJS-like: node-gi's `GLib.Error` was just made identical to GJS for the same reason. Daily Android
use of real GObject also surfaces node-gi defects, and fixing them at the core helps Node, Bun and
Deno too.

## Decision

### 1. Real GObject becomes the Android default, behind two gates

On NativeScript Android the real engine becomes the default once both gates hold:

- ADR 0105 stage 2 is complete: the engine backs real widgets through the twins for registered
  classes, and per-instance construction cost is timed against the pure-JS engine.
- The compressed APK size delta per ABI of a release build is measured, with the cold-start delta.

The flip is a small follow-up PR that cites both measurements. If the size delta is judged too
large, real GObject stays opt-in and this ADR is amended. Until the flip, ADR 0105 § 1 and § 2
hold unchanged. The pure-JS subset stays available on Android as an explicit opt-out.

**Both gates held and the flip is done** (2026-10-15, Pascal Garber, on
[the gate report](../reports/2026-10-15-adr-0110-gates.md) and
[the set/emit report](../reports/2026-10-15-node-gi-set-emit-perf.md)): ~16 MB per ABI and +80 ms
cold start are acceptable for GJS-identical semantics. What that means in code, since the engine
is still the APP's to build and not the port's (see `engine.ts` § "What an EMPTY slot means"):

- A NativeScript **Android** build with an empty engine slot is a MISSING DECISION, not a
  default. `engineForTarget` throws at the port's module load, naming both calls.
- `useRealGObjectEngine(requireGi)` is the real engine, as before, and now the expected call.
- `usePureJsGObjectEngine()` from `@gjsify/adwaita-core` is the OPT-OUT, and the subset on
  Android is exactly that one line.
- iOS, the browser and a bundle for neither are untouched: an empty slot is still the subset.

ADR 0105 § 4's no-silent-fallback rule is what makes the refusal a refusal: it was written about
an opt-in that FAILED, and this is the same rule about an opt-in that was never made.

### 2. The pure-JS subset stays

The browser has no GObject, and the subset is the iOS path (ADR 0105 § 6). It keeps growing only
for needs of the browser and iOS. No Android-only feature is re-created in it.

### 3. The subset stays tested on Android

The conformance vectors already run on the same device or emulator against both subjects (ADR 0105
§ 3); that continues in every run. New: the app-level and storybook tests on the emulator also run
twice, once per engine. The vectors test GObject logic, not the interplay of NativeScript Views
(the door) with the engine. Without the second run that interplay could break unnoticed on the
subset once Android users no longer exercise it. iOS runs the subset under NativeScript and
covers most of the day-to-day usage the subset loses on Android.

### 4. Not affected: ADR 0104 § 1

The NativeScript port with native widgets stays the Android default renderer. This ADR is about
the GObject engine under it, not about GTK rendering.

## Consequences

- Android apps get real GObject semantics by default, at the native size ADR 0105 measured per ABI.
- Real GObject becomes the daily-use oracle on the device and keeps exposing node-gi defects.
- The subset is no longer exercised by Android users, so the dual emulator run carries that duty.
- CI and the emulator run take longer: app and storybook tests run once per engine.

## Alternatives rejected

- **Keep the subset as Android default so Android exercises it daily.** The dual runs give the
  testing benefit without shipping Android users the smaller implementation.
- **Drop the subset.** The browser has no GObject, and iOS needs it.
- **Flip the default now.** Stage 2 and the release APK size are not measured.

## What this does not decide

- The exact size threshold that counts as "too large"; the flip PR argues it from the numbers.
- iOS (ADR 0105 § 6).
- Which route replaces the twin by a real subclass (ADR 0105 § 2).

## Implementation

1. Finish ADR 0105 stage 2. Measurement: vectors pass on device; per-instance construction cost,
   real engine against pure JS.
   **Measured:** [report](../reports/2026-10-15-adr-0110-gates.md). Construction costs no
   measurably more (plain `READWRITE` properties touch no engine, and the twin is lazy); use does
   — first property read ~5x on the host and ~8x on the emulator, a `set`/`notify` round trip ~45x
   and ~99x, an emission ~24x and ~20–45x. `packages/nativescript-bridge/gobject/src/bench.ts` is
   one body run from both hosts, on demand, not in CI.
   **Then optimized:** [report](../reports/2026-10-15-node-gi-set-emit-perf.md). The gap was
   node-gi re-resolving per call what is a pure function of (GType, name), not the N-API crossing;
   caching it took the host `set`/`notify` from ~45x to **14.4x** and the emission from ~24x to
   **19.3x**. The emulator leg is not re-measured — it rides along with step 3.
2. Build a release APK and measure the compressed size delta per ABI and the cold-start delta
   against an app without the plugin, on an arm64 device.
   **Measured:** [report](../reports/2026-10-15-adr-0110-gates.md). Signed release APKs, per-ABI
   splits, minified JS: **15,773,293 B (15.77 MB) arm64-v8a** and **16,934,181 B (16.93 MB)
   x86_64** compressed, of which 26,697 B is JavaScript. Cold start on the x86_64 emulator,
   median of twenty launches per rung: **+80 ms (+17.8 %)** from plugin-not-imported to opt-in
   (450 → 457 → 530 ms), matching stage 4's ~83 ms on arm64 against a much slower baseline.
   Deviations: cold start is the `x86_64` emulator, **not** an arm64 device; R8 is not enabled
   (NativeScript leaves its hooks commented out, and R8 cannot change a `.so`/typelib delta).
3. Wire the dual emulator run: the app and storybook tests execute once per engine, next to the
   vectors that already run on both subjects.
   **Done** (#2234): two specs, `app/specs/views.ts` and `app/specs/storybook.ts`, in the existing
   dual-leg harness `tests/integration/nativescript-gi`, both legs green on the `x86_64` emulator
   (real-gio 80/80, pure-js 46/46). The legs are `scripts/run-dual.mjs --engine real-gio|pure-js`,
   run by hand: **CI covers none of it**, as that README says. The emulator leg of step 1 was
   re-measured there with a locally built `libnode_gi.so` carrying the cache — `set`/`notify`
   **24.9x**, an emission **21.7x**, construct+first-read **5.4x**, bare construction **0.57x**
   (the real engine is FASTER), medians of 4000 iterations × 7 repeats
   ([report](../reports/2026-10-15-node-gi-set-emit-perf.md) § "Confirmed on the emulator").
4. Flip the default in a small PR that cites steps 1 and 2. Keep the pure-JS opt-out and update
   ADR 0105 § 2 if the wording needs it.
   **Done.** The per-target default is one build-time file in the port
   (`src/engine-target.ts` and its `.android.ts` variant, picked by NativeScript's platform file
   resolution), read by `engineForTarget` in `@gjsify/adwaita-core`'s slot. The opt-out is
   `usePureJsGObjectEngine()`. ADR 0105 § 1 and § 4 keep their wording and gain a pointer here;
   § 2's twin route is unchanged and still open.
