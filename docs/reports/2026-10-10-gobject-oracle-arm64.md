# The GObject vectors on a real arm64 device (2026-10-10)

[ADR 0105](../adr/0105-real-gobject-backs-the-nativescript-subset-on-android.md) stage 0 asks for
the shared GObject conformance vectors on Android against **both** subjects: real GObject through
node-gi, and the hand-written pure-JS subset that ADR 0105 proposes to put it behind. The
[Linux leg](2026-10-10-gobject-oracle-node-gi.md) measured node-gi on `x86_64` Fedora and left
both Android legs as "not done", calling them stage-1 infrastructure. They are done now, and not
on the emulator the ADR names but on real hardware.

**Both subjects hold on `arm64-v8a`.** One APK, one logcat, 44 rows driven: the pure-JS subset
passes all 30 of its rows, node-gi passes 13 of the 14 it can run there with the 14th the already
known `$gtype.name` divergence ([#2151](https://github.com/gjsify/gjsify/issues/2151)), marked
`it.failing`. No row had to be weakened and no new divergence appeared between `x86_64` Linux and
`arm64` Android — but getting there cost three node-gi/bundler fixes that only an arm64 Android
host could surface.

And the #2149 stdout/stderr→logcat redirect is **verified on the device**, with a probe that
touches a real descriptor rather than GLib's log bridge — the distinction turned out to matter.

Measured on a Samsung Galaxy S9 (`SM-G960F`), Android 15 / API 35, `arm64-v8a`, over adb.
NativeScript 9.1.2 runtime, node-gi built with NDK 27.1.12297006 against the pixiewood GI stack
(GLib 2.91.0, girepository-2.0), `libnode_gi.so` 1,181,968 B, APK 56,271,791 B, app id
`dev.gjsify.oracle`. No GTK in the APK, so no display: the three template rows skip exactly as
they do headless on Linux.

## The result

Per subject, on the device:

- **pure-JS subset (`gobject.spec.ts`): 24 of 24 vector rows pass**, plus the suite's own 6 "door"
  rows — 30 green, 37 assertions. All 24 run because the subset brings its own `Widget`, so the
  three template rows need no GTK; and it is the only subject that witnesses the seven `subset`
  refusal rows.
- **node-gi (`gobject.node-gi.spec.ts`): 14 rows run, 13 pass, 1 expected failure.** Skipped: the
  seven `holds: 'subset'` refusal rows (`isOracle: true` drops them — real GObject *accepts* what
  the subset refuses) and the three template rows (no Gtk typelib in the APK).
- Run total from `@gjsify/unit`'s own summary, verbatim from logcat:
  `✔ 44 tests passed · 51 assertions (56.1ms)` and `✗ 1 expected failure (it.failing — upstream
  defects)`.
- **No arm64-only divergence.** Every row that passes on `x86_64` Linux passes on `arm64`
  Android, and the one that fails fails identically, with the same reason string.

## Per row × subject

`node-gi Linux` = the [Linux leg](2026-10-10-gobject-oracle-node-gi.md), `x86_64`, with a display.
`node-gi arm64` and `subset arm64` = this run. `skip (no Gtk)` and `skip (oracle)` are the
driver's own decisions, not omissions.

Rows 1-17, `holds: 'oracle'`:

1. ParamSpec, a generated accessor notifies once per change and not on an equal value — node-gi
   Linux pass; node-gi arm64 pass; subset arm64 pass.
2. ParamSpec, a property reads as its ParamSpec default until it is set, all five kinds — pass;
   pass; pass.
3. ParamSpec, a class-defined accessor is kept and decides when to notify — pass; pass; pass.
4. ParamSpec, a dashed name is reachable as `dash-name`, `dash_name` and `dashName`, one
   `notify::dash-name` serving all three — pass; pass; pass.
5. ParamSpec, a CONSTRUCT_ONLY property gets no accessor and keeps its built value — pass; pass;
   pass.
6. Signals, emit reaches a handler as `(emitter, …params)`, disconnect stops it, an undeclared
   name or wrong arity throws — pass; pass; pass.
7. instance API, `signal_stop_emission_by_name` stops the emission in progress — pass; pass; pass.
8. instance API, it stops only the innermost emission of ITS signal, and with none in progress
   does nothing — pass; pass; pass.
9. field-form, meta as static symbol fields registers like the meta object — `it.failing` (#2151);
   `it.failing` (#2151), same reason printed on-device; subset arm64 pass.
10. type_ensure, `$gtype` is a token and `type_ensure` accepts it — pass; pass; pass.
11. binding engine, SYNC_CREATE transfers once at bind time — pass; pass; pass.
12. binding engine, the target follows every change of the source — pass; pass; pass.
13. binding engine, BIDIRECTIONAL makes the source follow back without echoing — pass; pass; pass.
14. binding engine, INVERT_BOOLEAN negates what crosses — pass; pass; pass.
15. template, construction order: the template is built, construct properties are set (`this._x`
    undefined inside a setter), then `this._x` is installed — pass (under xvfb); **skip (no Gtk)**;
    subset arm64 pass.
16. template, `bind template.x bidirectional` follows both ways — pass (under xvfb); **skip (no
    Gtk)**; subset arm64 pass.
17. template, a handler on the template instance runs bound to it and receives the emitter — pass
    (under xvfb); **skip (no Gtk)**; subset arm64 pass.

Rows 18-24, `holds: 'subset'` (refusals): **skip (oracle)** on both node-gi columns, by the
driver's `holds === 'subset' && subject.isOracle` rule; all seven **pass** on `subset arm64`.
18 a missing template handler throws; 19-22 `registerClass` refusing `Children`, `Implements`,
`Requires`, `GTypeFlags`; 23 `vfunc_*`; 24 an out-of-subset signal param type.

The subset leg additionally drives its own six door rows (children attached after
InternalChildren, the construct bag, a non-`?template` Template, `type_ensure` refusing a
non-GType token, ADR 0096 § 2 coverage, `signal_stop_emission_by_name` on a STOP_EMISSION
object) — all pass.

## The divergences, classified

The only vector-level divergence on the device is the one the Linux leg already filed:

1. **node-gi bug, filed not fixed — `$gtype.name` is `undefined`.** Row 9's remainder. The GType
   handle is a napi `External`, which is not extensible, so there is no name slot;
   `G.type_name($gtype)` answers correctly and registration itself is right. A representation
   change across 18 `IsExternal()` sites — [#2151](https://github.com/gjsify/gjsify/issues/2151).
   Unchanged on arm64: the row printed the same `it.failing` reason, which is itself the finding —
   the divergence is in the binding's design, not in anything architecture-specific.
2. **No registerClass meta-key mismatch left.** The symbol field form, divergence 4 of the Linux
   leg, is accepted on-device too.
3. **No subset divergence.** The pure-JS subject answers all 24 rows plus its door rows on
   NativeScript's JS engine exactly as it does on gjs, Node and the browser. Nothing in the subset
   was touched by this work.

Three defects *outside* the vectors blocked the run and were fixed at the core, each with a test:

1. **`fix(node-gi): link liblog in the android build`** (`0b90ad2236`). `android-log.cc` calls
   `__android_log_print`/`__android_log_write`; `libNativeScript.so` carries both only as UND
   imports, so the link failed under `--no-undefined` on `arm64-v8a` and `x86_64` alike. The
   library list moved into an exported `androidLinkArgs()` that `test/android-link-libs.test.mjs`
   asserts without an NDK. Without this, #2149's own code could not be linked at all — on either
   Android architecture.
2. **`fix(bundler): externalize NS core via a hook`** (`b6b6fbe3a8`). `--app nativescript` put a
   RegExp into rolldown's `external`, which the *native* engine — what the GJS-hosted `gjsify` CLI
   runs, so every build outside a Node host — rejects: "`external` entries must be exact string
   names". The subpath set cannot be enumerated and dropping the arm would bundle a second
   `@nativescript/core`, so the arm became a `resolveId` hook composed ahead of the alias and
   platform-suffix resolvers. `src/app/nativescript-external.spec.ts`; the suite's 81 rows pass and
   the GJS host now emits the byte-identical 152,185 B bundle the Node host did.
3. **`fix(node-gi): accept null for a gpointer IN argument`** (`15d711f0bd`).
   `GI_TYPE_TAG_VOID` had no arm in the IN marshaller, so any call carrying its own `user_data`
   failed with "Unsupported IN argument type tag 0". gjs writes NULL for the tag (`Arg::NullIn`);
   node-gi now does the same for `null`/`undefined` and refuses anything else, naming the
   argument. `test/void-pointer-in-arg.test.mjs`. Found while building the #2149 probe — see below.

## The #2149 redirect, verified — and the probe that does not prove it

[#2149](https://github.com/gjsify/gjsify/pull/2149) sends fd 1 to logcat as tag `stdout`/INFO and
fd 2 as tag `stderr`/WARN, so a C library's `fprintf(stderr)` stops vanishing into `/dev/null`.
**Verified on the device**, logcat verbatim:

```
10-10 22:01:31.148 30569 30595 I stdout  : ORACLE_STDIO_PROBE expect-tag-stdout
10-10 22:01:31.148 30569 30596 W stderr  : ORACLE_STDIO_PROBE expect-tag-stderr
```

Both from `GioUnix.OutputStream.new(1 | 2, false).write_bytes(…, null)` — libgio doing a real
`write(2)` on the descriptor, which is the thing the redirect intercepts. Note the pid is the
app's and the tids are not: the reader threads #2149 installs.

**What does NOT prove it, and cost a measurement cycle.** Anything routed through GLib. node-gi
installs a print handler, a default log handler *and* a log writer at `Init`, so `g_print`,
`g_warning` and even `g_log_default_handler` — which reaches the writer via
`g_log_structured_array` — arrive in logcat without touching a descriptor at all. The first
device run's two probe lines came in under tag `oracle`, the log domain, which looks like success
and is not: it proves the **log bridge**, not the redirect. The probe kept one such line,
explicitly labelled:

```
10-10 22:01:31.149 30569 30569 I oracle  : ORACLE_LOG_BRIDGE via writer
```

That line is also where fix 3 above shows on arm64: `GLib.log_default_handler(domain, level, msg,
null)` is the `user_data`-carrying call that the missing VOID arm refused.

`@gjsify/unit` needed **no** logcat reporter, which retires the Linux report's claim that it has
"no `run()` path that reports to logcat": its `print` is `globalThis.print || console.log`, and on
NativeScript `console.log` goes to logcat under tag `JS` as `CONSOLE LOG:` lines. Its `run()` also
calls `process.exit` only when `globalThis.process` exists — absent here, so the app stays up and
the summary still prints.

## Where the harness lives

Split, deliberately, at the line between what the repo can run and what needs a 55 MB device
image:

- **In the repo:** `packages/web/adwaita-core/src/test.android.mts`, next to `src/test.mts`,
  `src/test.browser.mts` and `src/test.node-gi.mts`, in `tsconfig.json`'s `exclude` like all three,
  with a `build:test:android` script beside the other three `build:test:*`. That is the whole
  repo-side harness: a later CI or automation calls `gjsify run build:test:android` in that
  package and gets the bundle both subjects run from.
- **The entry EXPORTS `runAndroidGObjectSuites(requireGi?)` instead of calling `run()`** — the one
  structural difference from its three siblings. On Android `@gjsify/node-gi` resolves only under
  `@nativescript/webpack`'s `nativescript` export condition, which points `#host` at the host that
  knows `system_lib://libnode_gi.so`; a gjsify bundle resolves with Node conditions. So the bridge
  import has to happen in the APK's own code, above the bundle, and be injected. The suite already
  took `requireGi` as a parameter, for the type-resolution reason the Linux report documents, so
  the entry only hands it through. Omitting the argument runs the subset alone — which is what a
  host without the addon wants, and what makes the subset leg immune to a `dlopen` failure. The
  subset suite is driven first for the same reason.
- **Not in the repo:** the NativeScript app, the APK build and the adb/logcat driver, in
  `~/.cache/gjsify-android/ns/oracle/` and `~/.cache/gjsify-android/ns/build-node-gi-wt.sh` (`SRC`
  overridable via `NODE_GI_SRC`). They depend on a built pixiewood GI sysroot for `arm64-v8a`
  (15 `.so` plus seven typelibs, a 56 MB APK) and on an installed Android SDK/NDK plus a connected
  device. A repo home for *that* is ADR 0104's track work — a reproducible Android GI stack and an
  `ns` app target in `@gjsify/cli` — and is larger than this measurement. Recording the route
  rather than half-building it: the device scripts stay out, the bundle entry goes in, and stage 1
  owns the rest.

## Not measured

- **GTK with a display, on the device.** The three template rows need a real widget; the APK
  carries no `libgtk-4.so` and no Gtk/Gdk/Adw typelib. The subject now tolerates that
  (`requireGi('Gtk')` in a `try`, `hasDisplay = Gtk !== undefined && Gtk.init_check()`), so the
  rows skip instead of taking the suite down — the same outcome as a headless Linux run. GTK on
  Android is ADR 0104's track-C′ worker setup; a device run of rows 15-17 waits for it. Note that
  rows 15 and 4 are the ones that found two of the Linux leg's divergences, so this is a real gap,
  not a formality: node-gi's composite-template path is **unmeasured on arm64**.
- **The `x86_64` emulator**, which is what ADR 0105 stage 0 literally asks for. Real arm64 hardware
  is the stronger measurement for a shipped app and the weaker one for the ADR's text; the
  emulator leg would mostly re-measure the host architecture the Linux leg already covers.
- **Timing, memory, startup cost.** The run is a conformance measurement; the 56.1 ms the summary
  prints is wall time inside one process on one device and is not a benchmark.
- The full node-gi suite on-device: only these vectors ran there. On Linux, in this worktree, that
  suite is **807 tests, 772 pass, 1 fail, 34 skipped**; the single failure, `idle_add_once fires
  exactly once (auto-removed)` (`test/glib-overrides.test.mjs:104`), is **pre-existing** — it
  reproduces identically in an untouched `main` checkout and is unrelated to the three fixes here.

## Limits

- "Both subjects hold on arm64" is a statement about `registerClass`, properties, signals and
  bindings — 14 rows for node-gi, 24 plus six for the subset. It is not a statement that node-gi's
  GObject is interchangeable with GJS's across GI as a whole, and with the template rows skipped it
  is not even the full vector set.
- One device, one Android version, one ABI. Nothing here says anything about armv7, about a
  different vendor's GL stack, or about an Android version whose logcat or `dlopen` behaves
  differently.
- The redirect verification shows that a `write(2)` to fd 1/2 from *inside the app process*
  reaches logcat. A library that writes before `Init` installs the redirect, or from a process the
  app forks, is not covered.
