# 117. Which GI namespaces enter an Android APK is selected at build time

- Status: **Accepted** (2026-10-27)
- Date: 2026-10-16
- Deciders: Pascal Garber
- Related: [ADR 0104](0104-real-gtk-and-gi-on-android-are-opt-in-tracks-beside-the-nativescript-port.md)
  (track B is the sysroot this selects from),
  [ADR 0105](0105-real-gobject-backs-the-nativescript-subset-on-android.md) (stage 4 built the AAR),
  [ADR 0110](0110-real-gobject-becomes-the-android-default-and-the-subset-stays-tested-there.md)
  (real GObject is the Android default, at the measured cost this ADR must not regress),
  [ADR 0017](0017-native-package-distribution.md) (per-target packages behind an
  `optionalDependencies` bridge),
  [ADR 0037](0037-gtk-runtime-bundles-carry-the-uri-source.md) (the desktop bundles' GIO modules
  and TLS backend — the same problem, one platform earlier),
  the gate report [reports/2026-10-15-adr-0110-gates.md](../reports/2026-10-15-adr-0110-gates.md)

## Context

`@gjsify/gi-runtime-android` is ONE AAR with ONE payload: `libnode_gi.so`, the 14-library
`DT_NEEDED` closure walked from it, and the 7 typelibs whose backing libraries that closure
happens to contain. The payload is not a list anybody chose — it is a measurement, and the typelib
set follows the closure through `planTypelibSet` (`packages/node-gi/scripts/typelib-backers.mjs`,
shared with the `gtk-runtime-darwin-*` / `gtk-runtime-win32-x64` bundles). The sysroot it is cut
from, `gjsify/android-sysroot` 2026.10.12 pinned by sha256 in `build-inputs.json`, carries 21
typelibs — GTK, Adw, Pango, HarfBuzz, Graphene, GdkPixbuf among them — and the bundle ships none
of those, because nothing in `libnode_gi.so`'s link closure reaches them.

So the current shape answers one question ("what does the addon link against?") and the project now
has a different one: **what does THIS APP need?** Three facts make that question concrete.

- **A real GI namespace is now the normal way to reach a web API on Android.** `@gjsify/fetch` is
  built on `gi://Soup?version=3.0` (`@girs/soup-3.0` is a hard dependency of
  `packages/web/fetch`), and ADR 0110 made real GObject the Android default. Its
  `gjsify.runtimes.nativescript` is `"none"` today, and the only reason is that the APK has no
  libsoup. The same holds for `@gjsify/tls`, `@gjsify/http2` and `@gjsify/ws`, which ADR 0037 § 2
  repaired on desktop by shipping the GIO modules.
- **The cost of the payload is measured and it is not small.** Signed release APKs, per ABI:
  **15.77 MB (arm64-v8a)** and **16.93 MB (x86_64)** compressed, of which 205,466 B is typelibs
  and 26,697 B is JavaScript; cold start **+80 ms (+17.8 %)** on the x86_64 emulator and
  **+105.5 ms (+13.0 %)** on a Galaxy S9. Pascal accepted those numbers for GJS-identical
  semantics. A fat AAR that also carried GTK, Adw, libsoup, json-glib and a TLS stack would roughly
  double them for every app, including the apps that need none of it.
- **The desktop bundles already proved the opposite failure.** ADR 0037's first row is a bundle
  that advertised URI playback and could open exactly one scheme, and its second row is a process
  that answered every TLS request with the dummy backend. Shipping a typelib whose backer is absent
  is WORSE than shipping neither: `planTypelibSet`'s own header records the measurement
  (`Adw-1.typelib` with no libadwaita on darwin-x64, `GtkSource-5.typelib` with no gtksourceview
  on win32). Whatever selects namespaces must not be able to produce that state.

The desktop answer to "ship more than the minimum" was `--windowing`: a second, larger tarball of
the same bundle. On Android the envelope is different — the APK IS the install, there is no
per-host policy to pick a bundle at runtime (ADR 0023), and the only thing that puts a `.so` where
`dlopen` finds it is the app's own gradle build. That makes the APP's build the only place the
decision can be made, and it makes it a BUILD-TIME decision rather than a packaging one.

This ADR designs that mechanism. **It implements nothing**: no sysroot is built, no package is
split, no selection code is written here.

## Decision drivers

- **Today's APK must not grow by a byte** for an app that asks for nothing new. ADR 0110's numbers
  are the baseline, and a default that quietly includes more is a regression nobody asked for.
- **An unbacked typelib must stay impossible.** The gate that already prevents it
  (`planTypelibSet`) must be the gate the selection runs through, not a second mechanism beside it.
- **The app author declares intent, not file names.** `gi://Soup?version=3.0` is what the code
  says; a list of sonames is a transcription of an answer the build can compute.
- **One linked unit.** `libnode_gi.so` names its GI libraries in `DT_NEEDED`; an addon built
  against one GLib and running beside another is a startup crash. Any split must keep the ABI
  contract that the AAR README states as "the addon travels WITH the GI stack".
- **A human uploads the sysroot.** g-ir-scanner has to run target binaries (ADR 0104 track B,
  #2179); at the time of writing that meant a hand build with no CI path. Since 2026-10-16 CI
  builds it under qemu-user (§ Amendment), and releases stay manual by choice.

## Decision

### 1. Package shape: a CORE AAR plus per-group ADD-ON AARs, as optional dependencies

`@gjsify/gi-runtime-android` stays what it is and keeps its name: the core — `libnode_gi.so`, the
GLib/GObject/Gio closure, `GIRepository`, and nothing else. Today's 14 libraries and 7 typelibs are
exactly that core, so **an app that installs only this package gets byte-identical bytes to today**.

What is new is a second kind of package, one per NAMESPACE GROUP, each a NativeScript plugin of the
same shape (`platforms/android/<name>.aar` + a committed `include.gradle`):

- `@gjsify/gi-runtime-android-soup` — libsoup 3, its closure (libpsl, nghttp2, sqlite where
  libsoup needs it), `Soup-3.0.typelib`
- `@gjsify/gi-runtime-android-json` — json-glib, `Json-1.0.typelib`
- `@gjsify/gi-runtime-android-tls` — glib-networking as a GIO module plus its TLS library (§ 3)
- `@gjsify/gi-runtime-android-gtk` — GTK 4, Adw, Pango, PangoCairo, HarfBuzz, Graphene, GdkPixbuf,
  Gdk, Gsk, cairo: ADR 0104 track C's payload, from the sysroot that already has it

A group is a GROUP and not a namespace, because the unit that can be shipped independently is a
closed link closure. Pango without HarfBuzz is not installable (`Pango-1.0` DEPENDS on
`HarfBuzz-0.0`, which is the dependency-aware case `planTypelibSet` exists for), and GTK without
Gdk is not a thing. So the grouping rule is: **a group is the smallest set whose typelib
dependencies and library closure are satisfied by itself plus the core.** The build computes that;
the package list above is the expected result, not an axiom.

Each add-on is an `optionalDependencies` edge of `@gjsify/gi-runtime-android`, which is ADR 0017's
bridge pattern and the same shape `@gjsify/node-gi` uses for `gtk-runtime-darwin-*` /
`gtk-runtime-win32-x64`. An add-on nobody selected is not downloaded, and an install on a non-npm
mirror that cannot fetch one still succeeds — the build then fails with a named missing group, not
the APK with a `dlopen` crash.

**Versions and the sysroot pin stay in lockstep by construction, not by convention.** All of these
packages are built in ONE `release.yml` job from ONE `build-inputs.json`, carry the release train's
version (ADR 0008), and each one's `gi-runtime.json` records the sysroot tag and the per-ABI
sha256 it was cut from. A startup check in `host.nativescript.js` compares the core's recorded
sysroot identity against each add-on's and refuses to proceed when they differ, naming both — the
mixed-GLib startup crash made into a sentence. The semver range an add-on is depended on by is
exact (`=<version>`, not `^`), because "compatible with" is not a question that has a true answer
for two halves of one link closure.

**Rejected: one fat AAR with everything, and gradle strips what is unused.** AGP does not do
reachability analysis on native libraries; a `.so` in `jni/<abi>/` is in the APK. `packagingOptions
{ exclude }` could drop them by path, which means the app author maintains a list of file names
per ABI and a wrong entry is a runtime crash — the exact transcription this ADR's § 2 exists to
avoid.

**Rejected: one AAR per NAMESPACE.** It splits what cannot be split (Pango/HarfBuzz) and multiplies
the lockstep surface by ten for no gain, since nothing selects HarfBuzz without Pango.

**Rejected: keep the single package and publish a second `-windowing` variant, like desktop.** Two
variants answer two guesses about what apps need; the trigger for this ADR is that the third guess
(Soup) was already wrong. A variant axis grows combinatorially the moment a second independent
group exists.

### 2. Selection: the SCAN proposes, the CONFIG decides, and the build fails on a gap

Both inputs, with one of them authoritative.

**The scan.** `gjsify build --app nativescript` already knows every `gi://` specifier in the
bundle: `scanGiNamespaces` (`packages/infra/cli/src/utils/ship/gi-namespaces.ts`) parses the
EMITTED bundle with the same acorn pass the CLI uses for its runtime closure, reports `Ns-Version`
where a specifier pins one, and separates HARD from `&optional` (ADR 0086) by the marker the
bundler's own shim emits. That reader exists because a regex got it wrong in both directions —
it missed `import "gi://Soup?version=3.0"`, the bare side-effect form `@gjsify/fetch` emits, and
it matched a `gi://` inside a diagnostic string. It is the one definition of "what does this
bundle import" and this ADR adds no second one. On `--app nativescript` the NativeScript
GI shim is the path `gi://` takes, so the same scanner answers for an Android bundle.

**The config.** `gjsify.config.*`'s nativescript section gains an explicit list:

```jsonc
{
  "nativescript": {
    "giNamespaces": ["Soup", "Json"]   // groups are DERIVED from namespaces
  }
}
```

**The rule between them:** the scan's HARD namespaces are a LOWER BOUND the config must cover. A
namespace the bundle imports and the config does not list fails the build, naming the importing
module and the one-line config edit. A namespace the config lists and the scan does not find is a
WARNING, not a failure — `GLib.Module`, a plugin loaded by string, and `Gio.DBusProxy` reaching a
namespace through a name are all legitimate, and the config is how an app says so. A `&optional`
namespace the config omits is neither: it is the declared absent case, and the shim already
degrades.

Why not the scan alone, which is the tempting shape since the bundler already sees the imports: a
build whose payload is a pure function of the import graph changes its APK size when a dependency
adds an import, with nothing in the app's own repository recording that it happened. For a 16 MB
per-ABI payload that is the wrong direction of surprise. The config makes the APK's native content
a reviewable line in a diff.

Why not the config alone: it drifts, silently, in the direction that crashes. `@gjsify/fetch`
arriving as a transitive dependency is exactly the case nobody edits a config for.

**From namespaces to a payload.** The selection is resolved against the SYSROOT, by the gate that
already exists:

1. Map each requested namespace to the sysroot's typelib (`readTypelibDir`), read its
   `shared_library` field and its `dependencies` — from the typelib, never a table, which is
   `typelib-backers.mjs`'s own rule and the reason it survives three platforms' different leaf
   names.
2. Walk the `DT_NEEDED` closure of those backing libraries, with the core's closure already
   present, and the same `SYSTEM_PROVIDED` allowlist (Bionic, `libz.so`, `libNativeScript.so`).
3. Run `planTypelibSet` over the result. `blocked` — an unbacked typelib something shipped depends
   on — is a HARD FAILURE naming the missing library, as it is today on all three platforms.
   `dropped` is reported, so "you asked for Gtk and got no GtkSource" is visible.
4. Assign each resulting library and typelib to exactly ONE package. A library in two add-ons'
   closures (both Soup and GTK want libsqlite, say) moves to the CORE, and the build fails if it
   cannot, because two `.so` copies of one soname in one APK is one `.so` chosen by AGP's merge
   order.
5. `include.gradle` of each selected add-on then does what today's does: turn an absent AAR into a
   gradle failure that names the build command.

**The default is today's set.** An app with no `giNamespaces` and no `gi://` import gets the core
alone — the 14 libraries and 7 typelibs ADR 0110 measured. This is the property the acceptance
test in § 5 stage 1 checks by comparing bytes, not by reading the code.

**Desktop later, and only mentioned here.** The same `giNamespaces` declaration is the obvious
replacement for the desktop bundles' `--windowing` boolean, and ADR 0037's cost table is the
argument for wanting it (+13 % darwin, +62 % win32 for one plugin). But a desktop bundle is
resolved per HOST at install time under ADR 0023's policy, not baked into one artifact, so the
mechanism's other half — WHO applies the selection — is a different question there. Out of scope:
this ADR decides the declaration's shape so that a later desktop ADR can reuse it, and decides
nothing about desktop.

### 3. GIO modules: shipped as a module directory, found by `GIO_MODULE_DIR`, backend TLS-OPEN

`GTlsConnection` has no implementation inside GIO. glib-networking supplies one as a module that
GIO `g_module_open`s out of a single directory whose compiled-in default is the BUILD machine's
prefix — so nothing links it, a closure walk cannot find it, and a process with its own `libgio`
and no module answers every TLS request with the dummy backend. ADR 0037 measured exactly that on
both desktop bundles, and `@gjsify/{tls,http2,ws}` fail the same way one layer up.

The Android decision follows ADR 0037 § 2 and § 3 rather than inventing a second shape:

- The TLS add-on ships the sysroot's `lib/gio/modules/*.so` into the AAR's `jni/<abi>/`, because
  `jni/<abi>/` is the only directory AGP will put a `.so` in and `dlopen` will find without an
  absolute path. They are NOT linked by anything, so they are **explicitly seeded** into the
  closure walk — the fourth instance of the shape librsvg established on desktop.
- `host.nativescript.js` sets `GIO_MODULE_DIR` to the extracted native library directory via
  `android.system.Os.setenv` before the addon loads, next to the dirs it already points at
  `__NODE_GI_APP_DIR` (GLib caches these on first use; a later `GLib.setenv` is too late). The
  path comes from `ApplicationInfo.nativeLibraryDir` through the existing JNI bootstrap, not from
  a guessed `/data/app/...`.
- Presence is a DECLARED data set like desktop's `tls-backend`: the add-on's `gi-runtime.json`
  names the module it shipped, and the build fails on an empty module directory rather than
  publishing a package that cannot do TLS.

**Static registration is rejected as the default.** GIO can take a statically linked module through
`g_io_module_load` called by hand, which Android's lack of a module search path makes superficially
attractive. But it would mean a custom `libnode_gi.so` per selected add-on — the opposite of § 1's
one-core-one-ABI-contract — and `GIO_MODULE_DIR` is a documented GIO override that works on
Android unchanged. It stays the fallback if a future API level breaks `dlopen` from
`nativeLibraryDir`, and that would be an amendment with the measurement attached.

**OPEN, for the owner: OpenSSL or GnuTLS.** Both are real options and the choice binds the sysroot,
the licence payload and the APK size. From ADR 0037's measured desktop cost table: `libgiognutls`
plus gnutls, nettle, hogweed, gmp, p11-kit, libtasn1, libidn2 and libunistring is 6.83 MiB on
darwin; gvsbuild's `gioopenssl` route costs 8.21 MiB of `libcrypto`/`libssl`. Licence-wise gnutls
is LGPL-2.1+/LGPL-3+ with a notice chain through eight projects, OpenSSL 3 is Apache-2.0 whose § 4
requires the licence to travel with the binary. The Android-specific argument that has no desktop
counterpart is § 3's trust question below: p11-kit, which is how gnutls reaches trust anchors on
desktop, resolves its trust module out of a COMPILED-IN directory with no env override —
ADR 0037's consequence section measured a full green test suite over an empty trust store — and
there is no system p11-kit on Android at all. That points at OpenSSL, which takes a CA directory
by configuration. It is not decided here.

**OPEN, for the owner: the Android CA store.** A TLS backend without anchors rejects every
certificate, and the lower bound ADR 0037 settled on —
`g_tls_backend_get_default_database()` non-NULL — is a check the Android leg has to answer for
itself. The options, with what each costs:

- **Point the backend at `/system/etc/security/cacerts`**, Android's OpenSSL-style hashed
  directory. Free, current, maintained by the OS. Does NOT include the user/admin store, and
  since API 24 an app's default network security config does not trust user CAs either — so this
  matches platform behaviour for the common case and breaks corporate MITM and
  `mitmproxy`-style debugging.
- **Also read the user store** (`/data/misc/user/0/cacerts-added`). Matches what an app with a
  `network_security_config` opting into user CAs does, and is what makes on-device debugging of
  our own HTTP stack possible. Needs a decision about whether a gjsify app trusts user CAs by
  default, which is a security posture and therefore the owner's.
- **Ship our own CA bundle** in the AAR. Reproducible and testable offline; goes stale, duplicates
  ~200 KB the device already has, and makes us the trust root operator. Rejected unless the first
  two are measured not to work.
- **Ask Android through JNI** (`X509TrustManagerExtensions`) and feed the result into a
  `GTlsDatabase`. Most correct — it is what every Java HTTP client gets — and the most work: a
  custom `GTlsDatabase` implementation in `libnode_gi.so` or a JNI-backed certificate feed.

The staged plan's stage 2 acceptance test is written so that it FAILS when anchors are missing,
which is what keeps this open question from shipping as a silent "TLS works".

### 4. The sysroot grows, and only the owner uploads a release

The pinned 2026.10.12 prefix has 21 typelibs and carries **no libsoup, no json-glib, no
glib-networking**. GTK, Adw, Pango, PangoCairo, HarfBuzz, Graphene, GdkPixbuf, Gdk, Gsk and cairo
ARE there — which is why stage 1 can land the whole selection mechanism against the existing,
already-pinned, already-digested prefix and prove it on namespaces nobody has to build first.

What a later `gjsify/android-sysroot` release must add, for § 1's Soup and TLS groups:

- **libsoup 3** (the trigger: `gi://Soup?version=3.0`, the spelling `@gjsify/fetch` and every GJS
  example already use)
- **libpsl** — libsoup's cookie policy needs the public-suffix list
- **nghttp2** — libsoup 3's HTTP/2
- **sqlite** — OPTIONAL: only libsoup's `SoupCookieJarDB` needs it, and `--without` is a supported
  libsoup build. Shipping it is the § 2 step-4 case where a library two groups want moves to the
  core, so whether it goes in at all is decided with the GTK group, not here
- **json-glib** — `Json-1.0`, the usual companion of a REST call
- **glib-networking** plus the TLS library § 3's open question picks

The rule, unchanged and restated because this ADR is the first thing that will want to break it:
**a new sysroot release needs Pascal's explicit OK before upload.** g-ir-scanner has to RUN a
dumper compiled for the target (ADR 0104 track B, #2179 option 1b), and the artifact is a binary
that every consumer pins by sha256. CI can now rebuild it (§ Amendment), but a release is still
the owner's decision, not a constraint of the build. An agent may prepare the
recipe, the project list and the digest bump in a branch; the upload and the tag are the owner's
action. The pin bump in `build-inputs.json` and the licence corpus under
`<sysroot>/share/licenses` move in the same commit as the digests, because
`THIRD-PARTY-NOTICES.md` is generated from them and a library in the closure with no
`licenses/bundled-projects.json` entry already fails the build.

### 5. Three stages, each with the test that says it works

**Stage 1 — the selection mechanism, against today's sysroot.** The core/add-on split, the
`giNamespaces` config, the scan-is-a-lower-bound rule, the resolution through `planTypelibSet`,
and `@gjsify/gi-runtime-android-gtk` built from the libraries the 2026.10.12 prefix already has.
No sysroot change, no new third-party code.

*Acceptance:* (a) An app with no `giNamespaces` produces an AAR whose payload entries are
byte-identical to the current package's, and its per-ABI release APK payload matches ADR 0110's
15,746,594 B / 16,907,482 B — the no-regression property stated as a number. (b) An app declaring
`["Gtk"]` gets Gtk, Gdk, Gsk, Pango, PangoCairo, HarfBuzz, Graphene, GdkPixbuf and cairo, and
`requireGi('Gtk', '4.0')` resolves on the emulator. (c) An app whose bundle imports
`gi://Soup?version=3.0` with no config entry FAILS the build naming the module — on the host, in a
unit test, no device. (d) A fixture declaring a namespace whose backer the sysroot lacks fails
with `planTypelibSet`'s `blocked` message.

**Stage 2 — the sysroot with soup + TLS, and the two add-on packages.** A new android-sysroot
release (§ 4, owner-uploaded), the digest bump, `@gjsify/gi-runtime-android-soup`,
`-json` and `-tls`, `GIO_MODULE_DIR` in the host, and the § 3 backend and CA decisions taken.

*Acceptance:* on the x86_64 emulator, with the Soup and TLS groups selected —
`Gio.tls_backend_get_default().supports_tls()` is true AND
`g_tls_backend_get_default_database()` is non-NULL. Both, because ADR 0037 measured that the first
is true on a bundle that rejects every certificate in existence, and the second is what separates
"a TLS backend loaded" from "TLS can succeed". Plus the per-ABI APK delta of each group,
published in a report, so the cost of selecting Soup is a number before any app pays it.

**Stage 3 — GJS-identical Soup on real hardware.** One body of code, the one a GJS app writes,
run on the Galaxy S9 (arm64) and on `NsGi_API_36`: a `Soup.Session` GET over https against a
known host, and `fetch()` from `@gjsify/fetch` with its `gjsify.runtimes.nativescript` flipped
from `"none"` to `"polyfill"`.

*Acceptance:* the same spec passes under GJS on the desktop and under NativeScript on both Android
targets — ADR 0030's one-corpus-GJS-as-oracle rule, with Android as a third subject. A redirect
and a 404 are in the corpus, because a TLS failure and an HTTP error are two outcomes a thin test
conflates. Cold start is re-measured for the selected set and reported against ADR 0110's
baseline.

## Consequences

- An Android app's native payload becomes a reviewable declaration instead of a side effect of
  `libnode_gi.so`'s link graph, and `@gjsify/fetch` becomes reachable on Android at all.
- Today's apps pay nothing: the default payload is the measured one, held by a byte comparison.
- Every selected group costs APK size and cold start, per ABI, and stage 2 publishes each number
  before stage 3 can use it. Nobody gets to say "roughly".
- The lockstep surface grows: five packages instead of one, all published from one job, all
  pinning one sysroot, with a startup check that refuses a mixed set by name. That check is the
  price of the split and it is cheaper than the crash it replaces.
- `@gjsify/gi-runtime-android` was published BY HAND every release before the `release.yml` job landed
  (#2179, #2187), and this ADR multiplies that manual step by the number of groups. Stage 1 therefore
  lands the `release.yml` job for all of them together or not at all.
- A GIO module directory on Android is a new mechanism in this repository, and `GIO_MODULE_DIR`
  from `nativeLibraryDir` is the part most likely to break on a future API level. § 3 names static
  registration as the fallback so the next person does not re-derive it.

## What this does not decide

- The TLS backend (OpenSSL or GnuTLS) and the Android CA store route. Both are § 3's open
  questions and both need the owner.
- Whether sqlite enters the sysroot, which is decided with the GTK group's closure in stage 1.
- iOS. ADR 0105 § 6 holds; the subset is that path and no GI payload is proposed for it.
- Desktop's selection mechanism. § 2 shapes the declaration so a later ADR can reuse it and
  decides nothing beyond that.
- ADR 0104 track C (real GTK rendering on Android). The GTK group makes the LIBRARIES available;
  whether a `GdkSurface` may live in a `NativeScriptActivity` is ADR 0104's question and untouched.

## Implementation

Tracked in [status/open-todos/node-gi.md](../../status/open-todos/node-gi.md). The three stages of
§ 5 are the work, in that order, each gated by its own acceptance test.

**Stage 1 is split into 1a and 1b.** § 5 bundles two independent things under one stage: the
SELECTION MECHANISM, which changes code in this repository, and the PACKAGE SPLIT of § 1, which
publishes four new npm packages and rewires `release.yml`. 1a is landed; 1b is not.

Splitting it this way because the mechanism is what every later stage builds on and it is testable
on a host today, while the split is a publishing decision whose first irreversible act — four new
names on npm, in lockstep with a sysroot pin — should not ride along with the change that makes
selection work at all. The § 1 shape is unchanged and 1b implements it as written; the Consequences
note that stage 1 lands the `release.yml` job "for all of them together or not at all" belongs to
1b, and nothing in 1a publishes anything.

**Stage 1a — the selection mechanism** (#2280). `nativescript.giNamespaces` in the app config, validated
in `packages/infra/cli/src/config.ts`; `planGiSelection` reconciles it against `scanGiNamespaces`
of the emitted bundle, as a post-bundle gate in `build.ts` beside the GJS and node ones. (1a put
both in `packages/infra/cli/src/utils/ship/`; 1b moved them to
`packages/infra/rolldown-plugin-gjsify/src/utils/` so the Vite path shares them — see below.) On the AAR
side, `planGiRoots` turns the requested namespaces into SEEDS — walked and bundled — which
`planClosure` now accepts next to `roots`, and `planTypelibSet` stays the single judge of what
ships. `--gi-namespaces` / `NODE_GI_ANDROID_NAMESPACES` drive the same path from the command line.

What 1a found that § 4 and § 5 get wrong:

- **The pinned sysroot has no `cairo-1.0`, `freetype2-2.0` or `fontconfig-2.0` typelib.** It has
  all three LIBRARIES, which is what § 4's "cairo is already in the prefix" reads off, but
  introspection data is a separate artifact and the prefix carries none for them. So acceptance
  (b) cannot be met against today's sysroot: `["Gtk"]` fails in `planTypelibSet` with *Gtk-4.0
  depends on cairo-1.0, which the source prefix does not provide at all* — and so do `Gdk`, `Gsk`,
  `Adw`, `GdkAndroid` and `Pango`. That is the gate working, not the selection failing. The three
  namespaces the prefix can resolve today — `Graphene`, `GdkPixbuf`, `GdkPixdata` — are the
  positive proof, and generating those three typelibs is 1b's first sysroot task, not stage 2's.
- **Acceptance (a)'s byte comparison is held one layer below the bytes.** ADR 0110's 15,746,594 B
  and 16,907,482 B are COMPRESSED zip-entry sizes of a gradle release build; no host test can
  reproduce them, and a test that needs an APK is a test nobody runs. Instead
  `gi-runtime-android/payload-baseline.json` freezes the pinned prefix's link graph and the plan
  the default build makes from it, and `node-gi/test/gi-runtime-android.test.mjs` replays the real
  planners over it: selecting nothing yields exactly 15 libraries and 7 typelibs per ABI, the same
  entries ADR 0110 counted at those totals, and selecting `Graphene` only adds. Regenerate the
  baseline with `scripts/snapshot-payload-baseline.mjs` when the sysroot pin moves.
- **Selection was unusable without attribution.** `renderNotice` refuses any newly bundled soname
  with no entry in `licenses/bundled-projects.json`, which the default closure never trips because
  every library it reaches was already listed. The table now covers every library the pinned
  prefix can contribute.

- **The scan is a weaker lower bound on this target than § 2 assumed.** `scanGiNamespaces` reads
  `requireGi` calls by their BINDING to `@gjsify/node-gi/gi`, so it answers only while that import
  survives into the emitted file. It does on `--app node`, where the specifier is external; it does
  not when node-gi is bundled in, which is what the Vite path does — the calls are then to an
  inlined local function and the scan rightly refuses to guess. So on the real Android path the
  config is not merely the decider, it is for now the only input, and the gate catches the case
  where the import is external. Lower-bound-ness is what makes that sound rather than broken: an
  empty scan can only fail to warn, never wrongly fail a build.

Not in 1a, and deliberately: `@gjsify/nativescript-vite` (`defineNativescriptConfig`), which is
how a real app builds, did not run the gate — only `gjsify build --app nativescript` did. Wiring it
there was 1b's first change, and it is where the scan's blind spot was to get a second input
(node-gi's own `requireGi` wrapper emitting the `gi://`-style marker ADR 0087 uses for optional
namespaces). The gate landed; the second input did not, and cannot — see below.

**Stage 1b — the package split.** `@gjsify/gi-runtime-android-gtk` and the `release.yml` job that
publishes core and add-ons together, the startup check that refuses a mixed set, the three missing
typelibs in the sysroot, and the `nativescript-vite` path.

What 1b found wiring the Vite path:

- **The scanner and the planner had to MOVE, because the CLI cannot be imported from.**
  `@gjsify/cli` declares `exports: {}`, so `@gjsify/vite-plugin-gjsify` could not reach
  `scanGiNamespaces` or `planGiSelection` where 1a put them. A second parse on the Vite side is
  exactly the "one definition of what this bundle imports" rule this ADR set in § 2, so instead
  both modules moved down into `@gjsify/rolldown-plugin-gjsify`, the dependency the CLI and the
  Vite plugin already share. The move also removed a cross-package `GI_OPTIONAL_MARKER` import
  that pointed the wrong way, and `config.ts`'s entry-shape validation became
  `assertGiNamespaceEntries`, one definition for both paths. `planGiSelection`'s semantics are
  unchanged and the emitted bundle is still the oracle: the plugin reads it in `writeBundle`, the
  way `build.ts` reads it after emit.

- **The suggested second input is not statically implementable.** The marker idea assumes
  `requireGi` calls that a bundle pass can see. On this path they are inside the bundled gjsify
  packages, reached through an inlined local binding, and their arguments are frequently computed
  — a renderer picks a namespace by name at runtime. There is no honest static marker to emit, so
  on the Vite path the config is not merely authoritative, it is the only input. That is sound for
  the same reason § 2's lower-bound rule is: a missing scan can only fail to warn, never wrongly
  fail a build.

- **A `gi://` specifier in the module graph is not a payload requirement under `giRenderer`.** The
  tempting Vite-path input is a `resolveId` observer counting `gi://` specifiers. It is wrong: with
  `giRenderer: true` every `gi://Ns` resolves to the JS renderer, not to a typelib, so a
  `gi://Gtk` import demands nothing of the AAR. Feeding those to `planGiSelection` would require
  `giNamespaces: ["Gtk", "Adw"]` of a Learn6502-shaped app and then fail in `planTypelibSet`,
  which cannot satisfy either on the pinned sysroot — a gate that breaks the one app it guards.

## Amendment 2026-10-16: the sysroot has a CI path

Stage 0 of this ADR assumed the sysroot cannot be built in CI because g-ir-scanner must run a
dumper compiled for the target and a runner has no Android device. That premise is gone.
[gjsify/android-sysroot](https://github.com/gjsify/android-sysroot/blob/main/.github/workflows/build.yml) PRs #1–#3 build the prefix on a stock x86_64 runner in a
`fedora:44` container: `tools/qemu-run` runs the dumper under qemu-user against a bionic runtime
unpacked from the official system image. Both x86_64 and arm64-v8a are covered, about 8 minutes
warm per ABI.

The result is byte-identical to release 2026.10.12: all 21 typelibs and all 34 shared objects
match. The only differences are a licence symlink fixed in c109b50, stale licence files from the
hand-build tree, and the manifest's `tag`/`buildRoot`/`ndkRoot`.

The workflow uploads a workflow artifact and never creates or edits a release. Releases stay
manual by choice: the owner's OK per release still applies. Open items live in
android-sysroot: the pango/freetype2 wraps still float, and a GIR race is worked around. The
decision above is unchanged; the status was still Proposed at that point.
