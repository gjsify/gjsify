# 57. A runtime bundle's images do not search outside the bundle

- Status: **Accepted**
- Date: 2026-09-10
- Deciders: Pascal Garber
- Related: [ADR 0023 (which GTK a node-gi process uses)](0023-gtk-source-precedence.md) § 4,
  [ADR 0024 (ship installable artifacts)](0024-ship-installable-artifacts.md) § A3 + § A4,
  [ADR 0037 (bundles carry the URI source)](0037-gtk-runtime-bundles-carry-the-uri-source.md),
  `docs/prebuilds.md`, #1536, #1476, #1120, #1144

## Context

[ADR 0023 § 4](0023-gtk-source-precedence.md) states the invariant this repository has now paid
for three times: **a process has exactly ONE GObject type registry.** #1120 broke it through an
unrelocated addon, #1144 through a second GTK on deno. #1536 breaks it a third way, and neither
earlier fix reaches it, because this one is not at the link layer at all.

The symptom is an `https://` GStreamer source that fails SILENTLY on a macOS host with Homebrew
installed, while a bundled file on the same pipeline plays. What arrives on stderr is not a
missing element but `g_type_name()` answering with GObject's own internal qdata quark strings
(`GObject-closure-array`, `GObject-weak-notifies`) where a class name belongs — a GType id
resolved against the wrong type system. `DYLD_PRINT_LIBRARIES` on the reporter's host counted two
distinct copies each of `libglib`, `libgobject` and `libgio`, one `libgstsoup` (the bundle's) and
one `libsoup` (Homebrew's).

### What the artifact records, read from Linux

The whole chain is legible in the shipped Mach-O load commands, with no Mac involved — the
evidence separation [ADR 0024 § A3](0024-ship-installable-artifacts.md) draws, using
`manifest-conformance/lib/binary.mjs`'s `readLibrary()`. Measured 2026-09-10 on the published
`@gjsify/gtk-runtime-darwin-x64@0.48.0` tarball:

| question | answer |
|---|---:|
| Mach-O images in the payload | 119 |
| images with an `@rpath/` DEPENDENCY | **0** |
| images carrying any `LC_RPATH` | 10 |
| images carrying a build-host absolute `LC_RPATH` | **3** |

The three are `lib/libjpeg.8.dylib` (`/usr/local/Cellar/jpeg-turbo/…/lib`), `lib/libsqlite3.dylib`
(`/usr/local/Cellar/sqlite/…/lib`) and — the one #1536 is about —
`lib/gstreamer-1.0/libgstsoup.dylib`, whose **only** search path is
`/usr/local/opt/libsoup/lib`.

Two facts about that plugin decide this ADR:

1. **It does not link libsoup.** Its `LC_LOAD_DYLIB` list is glib, gobject, gio, gstreamer and
   `libSystem`, every one of them already rewritten to `@loader_path/../`. `gst-plugins.mjs`
   already documents why: since 1.18 the plugin reaches libsoup through its own loader shim with
   `g_module_open` **by leaf name**, so a closure walk seeded from the plugin finds no soup at
   all. The bundle ships `libsoup-3.0.0.dylib` only because that seed was added by hand (#1476).
2. **It is the only plugin in the payload carrying an rpath, and that rpath names the libsoup keg
   specifically.** The twenty-odd other bundled plugins carry none. A keg-specific search path on
   exactly the one plugin that resolves a library by leaf name at runtime is not residue that
   happens to be there; it is how that leaf lookup was made to work for the prefix the plugin was
   built for. The bundle copied the plugin and kept it, so the bundle's own plugin points at
   Homebrew's libsoup by construction — and Homebrew's libsoup carries Homebrew's glib family in
   its own link closure, which is the second type registry.

### The loader, asked directly

The inference above was then put to dyld itself, on a macOS 15.7.9 / x86_64 host with Homebrew
`glib 2.88.2`, `libsoup 3.6.6`, `gstreamer 1.28.5` — the reporter's configuration.
`DYLD_PRINT_SEARCHING=1` over `gst-inspect-1.0 souphttpsrc` prints the search for the bare leaf in
dyld's own words:

```
find path "libsoup-3.0.0.dylib"
  possible path(original path on disk): "libsoup-3.0.0.dylib"
  possible path(cryptex prefix): "/System/Volumes/Preboot/Cryptexes/OSlibsoup-3.0.0.dylib"
  LC_RPATH '/usr/local/opt/libsoup/lib' from '…/gstreamer-1.0/libgstsoup.dylib'
  possible path(leaf name using rpath): "/usr/local/opt/libsoup/lib/libsoup-3.0.0.dylib"
  possible path(default fallback): "/usr/lib/libsoup-3.0.0.dylib"
  found: dylib-from-disk: "/usr/local/opt/libsoup/lib/libsoup-3.0.0.dylib"
```

Three things are settled by that block, and two of them contradict what this ADR assumed before it
was measured:

- **dyld expands a BARE LEAF against the calling image's `LC_RPATH`.** Its own phrase for it is
  `leaf name using rpath`. A `g_module_open` with no slash in it is therefore not beyond the reach
  of a load command, which is what "no `install_name` rewrite anywhere can influence it" in #1536
  reasonably but wrongly assumed.
- **The rpath is tried BEFORE the default fallback.**
- **The default fallback for a leaf `dlopen` is `/usr/lib` alone** — not
  `$HOME/lib:/usr/local/lib:/usr/lib`. So `/usr/local/lib`, where Homebrew symlinks every keg, is
  never consulted for this lookup at all.

Together those mean the plugin's own `LC_RPATH` is not *a* route to Homebrew's libsoup. It is the
**only** one.

### The repair, measured the same way

The same host, with the plugin's rpath list replaced (`-delete_rpath` the keg, `-add_rpath`, ad-hoc
re-sign) and a copy of libsoup placed where the new entry points. The probe tree puts the plugin
and the library one directory apart, so its entry reads `@loader_path/../lib`; in the payload the
plugin sits in `lib/gstreamer-1.0/` and the library in `lib/`, which is `@loader_path/..` — the
same expansion at the payload's own depth:

```
LC_RPATH '@loader_path/../lib' from '…/plugins/libgstsoup.dylib'
possible path(leaf name using rpath): "…/plugins/../lib/libsoup-3.0.0.dylib"
found: dylib-from-disk: "…/plugins/../lib/libsoup-3.0.0.dylib"
```

Homebrew's prefix does not appear in the search at all, and `souphttpsrc` still resolves. The
repair is a load-command edit, it is the one the builder can make, and it was verified against the
loader rather than argued from the format.

### Why every existing gate is blind to it

**`relocate()` never touches `LC_RPATH`.** `build-gtk-runtime-darwin.mjs` rewrites the image's own
`LC_ID_DYLIB` and every `LC_LOAD_DYLIB` that names a leaf the bundle carries. Those two are the
whole of it. **`verifyRelocation()` reads only `otool -L`** and skips anything that does not start
with `/`, so it reports *"relocation verified — 0 refs outside the bundle"* over an image whose
sole search path is a Homebrew keg.

That is not a rule nobody wrote down. `docs/prebuilds.md` states it for the *other* stager, in
detail and with the incident behind it: **the whole rpath list is replaced, ORDER INCLUDED**,
because `install_name_tool -add_rpath` APPENDS, so deleting only the unwanted entries leaves
precedence a property of the upstream link line rather than of the policy. `stage-prebuild.mjs`
does that. The bundle builder never got the discipline. **Two stagers, one discipline, applied in
one of them** — the same shape as #1120, where node-gi's stager was the second one and the one
that only ever `copyFileSync`'d.

The conformance layer is blind for a second, independent reason. `checkPrebuildDir()` rules a
build-host absolute rpath a **note**, not a failure — *"FALLBACK ONLY"* — and that ruling is
correct for what it was written about. It is wrong here, and § 1 below is that distinction.

## Decision

### 1. Inside a runtime bundle, an absolute `LC_RPATH` is not a fallback

The prebuild rule stands where it was made. `darwin-prebuild-rpaths.test.mjs` asserts the addon's
list as `@loader_path` → the bundle → the sibling bundle → the Homebrew prefix **last**, and the
reason it keeps that last entry is sound: dyld silently skips a search path that does not exist,
so an ordered fallback strands nobody, and dropping it would break the Homebrew-only host that
works today.

Two properties make it a fallback, and a bundle image's keg entry has neither:

- **It is LAST, behind entries that reach the bundle.** `libgstsoup.dylib` has no bundle entry at
  all. Its Homebrew keg is first and last — not a fallback, a redirect.
- **It can only resolve what the bundle does not carry.** The bundle ships
  `libsoup-3.0.0.dylib`. A search path that resolves a leaf the bundle *already has* is not a
  safety net; it is a **second source for a library that already has one**, and for a
  type-registering library that is ADR 0023 § 4's invariant broken rather than a preference that
  came out wrong.

So: **no image in a runtime bundle payload may carry a build-host absolute `LC_RPATH`.** The
predicate is `isBuildHostAbsolutePath` — derived, never a `/opt/homebrew` grep, for the reason
that function already documents.

**And the two rules are told apart by the SUBJECT, at the call.** `build-gtk-runtime-darwin.mjs`
also relocates a copy of the node-gi ADDON (§ 6), and that addon is a prebuild: `stage-prebuild.mjs`
gives it `<brew prefix>/lib` last, on purpose, and `darwin-prebuild-rpaths.test.mjs` asserts the
ORDER that makes it a fallback. Reading the payload rule over it fails on the one entry this
section's own reasoning requires — measured from Linux, `darwinAddonRpaths('darwin-x64')` ends in
`/usr/local/lib` — so `verifyRelocation()` takes the search-path half as an argument and the addon
call passes `false`. A distinction stated in an ADR and not expressed at the call site is a
distinction the next builder edit loses.

### 2. `relocate()` replaces the whole rpath list, order included

The same sentence `docs/prebuilds.md` writes for `stage-prebuild.mjs`, now true of both stagers.
Every existing entry is deleted and the wanted ones are added in sequence; deleting only the
unwanted ones is a different operation and is what shipped this bug one layer down.

Default: **no rpath**. The payload measurement above is what makes that safe rather than bold —
no image in it has an `@rpath/` dependency, so no image needs a search path to resolve a link.
`docs/prebuilds.md` already states the rule as *"only an image with an `@rpath/` dependency gets
rpaths"*, and it states the cost of ignoring it: `install_name_tool` refuses with *"larger updated
load commands do not fit"* on an image whose linker left no header pad.

### 3. …and a leaf-name opener is the case that rule cannot see

`GST_AUDIO_PLUGINS`' soup entry is the third payload in this tree seeded by hand because **a
closure walk cannot see a `g_module_open`** — librsvg's loader and the GIO TLS backend are the
other two. The rpath rule in § 2 keys on `@rpath/` DEPENDENCIES, which is the same walk one field
over, and it is blind in the same direction: an image that resolves a sibling by **leaf name at
runtime** needs a search path into the bundle and declares nothing that says so.

Therefore the bundled GStreamer plugins are relocated with an rpath into the payload's `lib/`
(`@loader_path/..` from `lib/gstreamer-1.0/`) rather than with none. It is the entry Homebrew's
copy of the plugin had, pointed inside the bundle instead of at a keg.

### 4. The check reads the artifact, from any host

`bundle-search-paths`, a portable `@gjsify/manifest-conformance` rule. It reads the payload's
Mach-O load commands and fails on (a) any build-host absolute `LC_RPATH`, (b) an `@rpath/`
dependency with no in-bundle search path to resolve it — the complementary half, so an image that
*does* need rpath resolution cannot silently lose it to § 2's full-list replace — and (c) an image
it RECOGNISED and could not read.

(c) is not tidiness. `readLibrary` answers `null` for a file whose magic it does not know, which is
most of a payload — icons, schemas, locale data — and it THROWS for a Mach-O it refuses: a
universal (fat) one, a 32-bit one, load commands it cannot walk. Treating both as "not an image"
made a fat wrapper around the very plugin this ADR is about report zero findings while its only
search path was a Homebrew keg. An image the reader could not read is an image this gate did not
clear, and saying so is the difference between a check and a count.

**Whether the rule is SELECTED is part of the decision, not an implementation detail.** A
`@gjsify/manifest-conformance` rule that is registered but not in `audit-runtimes.mjs`'
`CHECK_RULES` is listed by `--rules`, counted by field coverage, and never run — which is the state
this rule shipped in, and the third time that omission has cost this repository a silent gate. It
is selected. In a checkout the payload is gitignored, so what it prints is a NOT INSPECTED note per
bundle; that note IS the answer, and it takes running to give it.

Portable, and deliberately so: **a Linux workstation reads a darwin bundle's load commands without
a Mac**, which is how every number in this ADR was measured. That is the same asymmetry ADR 0024
§ A3 turned into a required field — a reader that runs where the artifact is not built is worth
more than one that does not.

Two gates, each where its subject is: `verifyRelocation()` fails the darwin build on the runner —
which is also the release publish path, since that job runs the same builder — and the rule fails
the audit wherever a payload is on disk, which in CI is node-gi.yml's macOS bundle job and on a
workstation is any built or npm-staged tarball. **A bundle whose plugin resolves a library outside
the bundle has to be caught while it is built, not while it plays.**

## What this does NOT decide

**The end-to-end darwin-x64 bundle run.** § "The repair, measured the same way" drives the
mechanism with `gst-inspect-1.0` over a plugin whose rpath was rewritten by hand, which proves the
loader behaviour and the repair. It is not the same thing as a bundle built by the fixed builder
and exercised through node-gi: that needs a darwin runner to produce the artifact, and the leg
that would see it needs the opposite precondition to the batteries-included ones — **a darwin host
WITH Homebrew glib present**, which #1536 already identifies as one runner setting and the only
configuration in which the assertion means anything. Until such a bundle is published, the rule in
§ 4 is what stands between this defect and a user, and it fails the currently published artifact.

**The Windows half is unmeasured**, as #1536 records: `soup-3.0-0.dll` is reached by the same
leaf-name `g_module_open`, and Windows resolves a DLL from the loading module's directory first, so
it may well be immune. A PE image has no `LC_RPATH`, so § 4's Mach-O half does not apply there —
the win32 payload needs its own question, not this one's answer.

Saying that took a second edit, because the first shape of the rule said it the wrong way round.
`@gjsify/gtk-runtime-win32-x64` declares the same `files: ["gtk"]` and is therefore collected, and
a payload of PE images satisfied *"exists and holds no Mach-O image at all"* — so the rule would
have reported a DEFECT on a correct bundle the moment its payload was on disk, which is worse than
the false clean it was written against: a false clean lets a good artifact through, a false defect
refuses one. A payload with images and no Mach-O among them is a printed **non-answer**.

**`DYLD_FALLBACK_LIBRARY_PATH` turned out not to be part of this.** It was the obvious second
suspect, and the measurement removed it: the default fallback for a leaf `dlopen` is `/usr/lib`
alone. node-gi's `maybeReexecForGtkRuntime()` still sets it, and that remains correct for the
lookups it does cover; it is simply not what decided #1536, and a fix aimed there would have
changed nothing while looking like a repair.

## Consequences

- The three build-host rpaths in the current darwin payload go away, and the two that are not
  `libgstsoup` (`libjpeg`, `libsqlite3` — both version-PINNED Cellar paths, i.e. bytes that differ
  between two CI runs of one commit) go with them. `docs/prebuilds.md` records dropping exactly
  that shape of entry one layer down, for the same determinism reason.
- **The published `0.48.0` bundle fails the new rule.** That is the intended reading: the rule was
  written against a real artifact that really carries the defect, and the first thing it did was
  go red on it. It stays red until a bundle built by the fixed builder is published.
- `verifyRelocation()`'s summary line stops being able to say "0 refs outside the bundle" while an
  image points out of it, which is what it was always read as meaning. It now names WHICH of the
  two questions it asked, because that sentence was read as covering both for eight releases while
  one half was never evaluated.
- Nothing changes for prebuilds. `checkPrebuildDir()`'s note keeps its wording and its reason; § 1
  states why the two artifacts are held to different rules rather than quietly changing one — and
  why `verifyRelocation()` takes the distinction as an argument instead of leaving it to prose.
- The bundled GStreamer plugins can take the new load command: measured on the published 0.48.0
  payload from Linux, all 24 carry between 6 and 17 KiB of Mach-O header pad against the 32 bytes
  an `@loader_path/..` `LC_RPATH` costs, so § 3 does not run into the *"larger updated load
  commands do not fit"* wall § 2 names.
