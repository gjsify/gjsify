# 59. A foreign platform carries its own CONFIGURATION, not only its own libraries

- **Status:** Proposed (2026-09-15)
- **Deciders:** Pascal Garber
- **Scope:** everything a `win32` or `darwin` artifact carries — the two
  `@gjsify/gtk-runtime-<target>` bundles and the `gjsify ship` layouts that stage them.
  Extends [ADR 0057](0057-bundle-images-do-not-search-outside-the-bundle.md) one level up:
  that ADR settled where a bundled **image** may search, this one asks the same question
  about the **files those images read at init**. It settles nothing about which libraries
  a bundle contains ([ADR 0023](0023-gtk-source-precedence.md),
  [ADR 0056](0056-win32-audio-payload-is-bounded-by-gvsbuild.md)) and nothing about the
  formats a payload is wrapped in ([ADR 0024](0024-ship-installable-artifacts.md) § 2).
- **Related:** [ADR 0018](0018-os-axis-declaration.md),
  [ADR 0023](0023-gtk-source-precedence.md), [ADR 0024](0024-ship-installable-artifacts.md),
  [ADR 0038](0038-shipped-application-fonts.md),
  [ADR 0055](0055-declared-media-capabilities.md),
  [ADR 0057](0057-bundle-images-do-not-search-outside-the-bundle.md),
  `status/open-todos.md` § *The darwin bundle ships the GNOME typeface and cannot put it on
  the font map*, § *The darwin GTK bundles ship no `GIRepository-2.0` typelib*

## What was measured, and what was not

**Nothing in this document was run on macOS or Windows.** It is a read of `main` at
`bc78d1b689` from a Fedora workstation: recipes, layouts, launcher templates, workflows and
the ADRs above. Where a row says *absent*, the evidence is a grep over the file that would
have to contain it, and the grep is named. Where a consequence would need a host to observe,
the row says so and stops.

| probe | result |
|---|---|
| `grep -n "etc\|fonts.conf\|FONTCONFIG" packages/node-gi/scripts/build-gtk-runtime-darwin.mjs` | **0 hits** — the darwin builder never writes an `etc/` at all |
| the same grep against `gtk-runtime-win32-x64/scripts/build-gtk-runtime.mjs` | `etc/fonts` copied + `fc-cache`d at § 4d, `build-gtk-runtime.mjs:790-806` |
| `grep -n "'locale'\|share/locale" ` over **both** builders | **0 hits in both** — neither bundle carries GTK/GLib/libadwaita's own gettext catalogues |
| `grep -n icu` over both builders | **0 hits in both** — no builder names ICU; whether gvsbuild's closure walk pulls one in is decided by `dumpbin` and is not readable from the recipe. **Not measured** |
| `grep -rn 'dconf\|GSETTINGS_BACKEND'` over `packages/node-gi`, `packages/framework/gtk-host`, `docs/adr`, `status/` | **0 hits** — no bundle, ADR or TODO names a GSettings *backend*. Schemas ship; where a written value goes on either foreign OS is undecided. **Not measured** |
| `grep -rn -i font .github/workflows/gtk-os-suites.yml` | **0 hits** — the one workflow that runs both foreign legs against the shipped closure asserts nothing about faces |
| `git log --oneline -1` | `bc78d1b689` |

`gtk/` is gitignored in all three bundle packages (`packages/node-gi/gtk-runtime-*/.gitignore`),
so no published tarball was opened here. The inventory below is what the recipe *writes*, which
is a weaker claim than what a tarball *holds* — and the repository has already been wrong in
exactly that direction twice (0.27.1 published `dataBytes: 0`; 0.50.0 published
`fontconfig: true` with no face).

## Context

Two platforms are foreign: everything that is not Linux. On Linux the artifact may borrow —
the distro supplies GJS or Node, GTK, the icon theme, fontconfig's configuration and the
catalogues, and ADR 0024 § 4 calls bundling them "~100 MiB of cargo cult". On `win32` and
`darwin` there is nothing to borrow from, which ADR 0023 already settled for *libraries*:
the per-OS policy is `bundle` on both, and a host GTK is a hazard rather than a fallback.

The libraries are therefore in good shape. What has never been stated as one rule is
everything a library **reads** once it is loaded: a configuration file, a module cache, a
compiled schema, a face, a catalogue. Those arrived one incident at a time, and each was
solved where it hurt:

- `loaders.cache` was written bare-leaf on win32 because someone reasoned about
  `GDK_PIXBUF_MODULEDIR` instead of measuring it, and no SVG icon decoded from a win32
  bundle for its whole life (#996).
- The darwin bundle shipped 860 icon files of which zero decoded, with a manifest that read
  `verified icons: 863`, because a file count is not a capability (ADR 0018).
- `gschemas.compiled` is compiled at ship time off Linux because a `.app` has no postinst
  and nothing else was going to run it (`utils/ship/schemas.ts:6-8`).
- The faces were documented for a year before any mechanism existed (ADR 0038).

Each fix was right. Together they are not a rule, and the absence of the rule is visible in
the one place the two foreign platforms now disagree hardest — fontconfig. The win32 bundle
ships `etc/fonts` "when present"; the darwin bundle ships none, on the stated premise that
macOS Pango is CoreText-backed and a `fonts.conf` inside a `.app` "would be inert twice over"
(`utils/ship/layout.ts:404-410`). That premise is a statement about **how Homebrew built
pango**, not about macOS — `pangocairo-fontmap.c` picks its backend from what was compiled
in, `PANGOCAIRO_BACKEND=fc` selects the other one by hand, and this repository documents that
escape hatch in four places (`status/open-todos.md:33`, ADR 0038 § 523,
`packages/framework/gtk-host/src/fonts.ts:244`,
`website/src/content/docs/guides/bundled-fonts.md:355`). The moment anything selects it, a
darwin bundle that carries `libfontconfig` and no `fonts.conf` is asking fontconfig to find
its configuration where the **build machine's Homebrew prefix** used to be. That is the shape
ADR 0057 outlawed for dylibs, in a file format ADR 0057 does not cover.

## The inventory — what each foreign artifact carries today

Sources: `packages/node-gi/gtk-runtime-win32-x64/scripts/build-gtk-runtime.mjs` (W),
`packages/node-gi/scripts/build-gtk-runtime-darwin.mjs` (D),
`packages/node-gi/scripts/bundle-fonts.mjs` + `bundle-data.mjs` (shared),
`packages/infra/cli/src/utils/ship/{app-runtime,launcher,layout,share-dirs,schemas}.ts` (S).
The `--windowing` superset is what release.yml publishes, so it is what the rows describe.

| what | win32-x64 | darwin-arm64 / -x64 | assembled by |
|---|---|---|---|
| GTK/GLib/cairo/pango native closure | `gtk/bin/*.dll`, no relocation — Windows resolves by search path | `gtk/lib/*.dylib`, relocated to `@loader_path`, ad-hoc re-signed | W § 2 / D § 2 |
| typelibs | `gtk/girepository-1.0/`, only those the bundle can back | same rule, same module (`typelib-backers.mjs`) | W § 3 / D § 4 |
| gdk-pixbuf loaders | `lib/gdk-pixbuf-2.0/2.10.0/loaders/*.dll` | same path, `.so`, relocated | W § 4a / D § 2b |
| `loaders.cache` | rewritten **toplevel-relative** (`pixbuf-loader-cache.mjs`) | written `@loader_path/…` by Homebrew's own tool | W § 4a / D § 2b |
| GIO modules (TLS backend) | every `.dll` in the prefix's module dir | every `.so`/`.dylib` in the keg's module dir | W:336 / D:452 |
| GStreamer plugins + scanner | audio set + `gst-plugin-scanner.exe` in `libexec/` | audio set + scanner | W § 4g / D § 2c |
| GSettings schemas | `share/glib-2.0/schemas/gschemas.compiled`, recompiled in the bundle | same | W:743 / D:1067 |
| GSettings **backend** (where a written value lands) | **undecided** — no code, ADR or TODO names one | **undecided** — same | — |
| icon themes + `icon-theme.cache` | `share/icons/{Adwaita,hicolor}` | same | W § 4c / D § 4b-b |
| GtkSourceView data tree | whole `share/gtksourceview-5` | whole `share/gtksourceview-5` | W:832 / D:1123 |
| fontconfig configuration | `etc/fonts/fonts.conf` + `conf.d` + a cache, **when the gvsbuild prefix has one** | **none, ever** | W:790-806 / D: absent |
| the GNOME UI faces | `share/fonts/adwaita/*.ttf`, from pinned `refs/adwaita-fonts` | identical payload, identical source | `bundle-fonts.mjs`, both |
| …and a process that can SEE those faces | yes — loader exports `GJSIFY_GTK_RUNTIME_FONT_DIR`, `initFonts()` calls `add_font_file` | **no** — `status/open-todos.md:7` : "~7.3 MB of faces that no process can reach" | `gtk-runtime.js:460` + `gtk-host/src/fonts.ts` |
| GTK/GLib/libadwaita gettext catalogues | **absent** | **absent** | — |
| ICU / locale data | not named by the recipe; closure-walk dependent. **Not measured** | not named by the recipe. **Not measured** | — |
| the app's own faces | `share/fonts/<appId>` + `GJSIFY_FONT_DIR`, registered by the app | `share/fonts/<appId>` + `ATSApplicationFontsPath`, activated by macOS (**unverified**, `layout.ts:416-424`) | S, ADR 0038 |
| the app's own catalogues | `share/locale` + `GJSIFY_LOCALE_DIR` | same | S, ADR 0024 § A8 |
| Node interpreter + its LICENSE | staged beside the launcher | staged in `Contents/MacOS` | S `app-runtime.ts:440-452` |
| the whole `gtk/` tree into the artifact | copied file-by-file, wholesale | copied file-by-file, wholesale | S `app-runtime.ts:466-472` |

The last row is why the fontconfig row matters beyond the bundle: `stageAppRuntime` walks
`listFilesRecursive(gtk.dir)` and stages everything under it, so the win32 program directory
*does* end up with `gtk/etc/fonts` and a shipped `.app` has nothing equivalent to end up with.

## The gaps, with file:line

**G1 — the darwin bundle ships fontconfig with no configuration.**
`packages/node-gi/scripts/build-gtk-runtime-darwin.mjs:186` names fontconfig among the
libraries the closure walk pulls in; the file contains no `etc`, no `fonts.conf` and no
`FONTCONFIG`. `packages/node-gi/node-gi/gtk-runtime.js:434-439` sets `FONTCONFIG_PATH` and
`FONTCONFIG_FILE` **only if** `<bundle>/etc/fonts/fonts.conf` exists, which on darwin it never
does. What a configuration-less `FcInit` then reads is the path compiled into that dylib,
i.e. the build machine's Homebrew prefix. **Not measured** — it needs a Mac without Homebrew.
Today this is latent because the CoreText map is the one in use; PR #1677 is about selecting
the other one.

**G2 — a Linux default in a macOS-only launcher.**
`packages/infra/cli/src/utils/ship/launcher.ts:265` writes
`XDG_DATA_DIRS="$contents/…:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"` into every `.app`.
The win32 sibling at `launcher.ts:393` appends nothing. On macOS those two directories are
either absent or hold Homebrew's tree — the one thing every foreign-platform gate in this
repository exists to keep out of the measurement (`gtk-os-suites.yml:316`).

**G3 — a Linux path as the last-resort locale directory on every OS.**
`packages/framework/adwaita-app/src/locale-dir.ts:8` defines
`SYSTEM_LOCALE_DIR = '/usr/share/locale'` and `:34` returns it when neither the option, nor
`GJSIFY_LOCALE_DIR`, nor the caller's fallback names one. Harmless today (the launcher sets
the variable whenever it staged catalogues) and wrong as a default off Linux: it should be
"no directory", so the failure is *untranslated*, which is visible, rather than *bound to a
path that cannot exist*, which is the same thing with a misleading trace.

**G4 — neither foreign bundle carries GTK's own translations.**
0 hits for `locale` in both builders. Every stock string a GTK/libadwaita dialog draws —
button labels, the file chooser, the about dialog — is the English msgid on Windows and
macOS, for every user, in every locale. On Linux the distro's `gtk4` package supplies them, so
this is exactly the class of "Linux quietly provides it" this ADR is about. Cost of the gap is
not a crash and not a log line.

**G5 — a bundle that writes a GSetting has nowhere decided to put it.**
Schemas ship and `Gio.Settings` constructs. Nothing in the tree names dconf, a keyfile
backend or `GSETTINGS_BACKEND`. If GLib falls back to the memory backend, every write is lost
at exit with no error. **Not measured**; the recipe cannot answer it, a host can.

**G6 — the darwin bundle's own faces are unreachable, and that is recorded as an open item
rather than as a failing gate.** `status/open-todos.md:7-42` states it precisely and
`packages/node-gi/node-gi/test/windowing.test.mjs:324` *asserts the decline*, so the day it
changes the test says so. What no gate says is that the artifact is shipping payload nothing
can read — the `fonts` windowing-data set (`bundle-data.mjs:189-198`) requires the files to be
PRESENT, which they are.

**G7 — the one workflow that runs both foreign legs asserts nothing about faces.**
`gtk-os-suites.yml` has 0 occurrences of `font`. Both legs do assert the harder half — no
Homebrew GTK (`:316`), no gvsbuild prefix (`:566`) — so the self-containment habit exists; it
simply stops at the library boundary.

**G8 — `system-gi.js` keeps host prefixes for both foreign OSes.**
`packages/node-gi/node-gi/system-gi.js:88` lists `/opt/homebrew/lib`, `/usr/local/lib`,
`/opt/local/lib` for darwin and `:310` a Unix default set. Correct for the `system` policy
ADR 0023 § 4 permits an author to select; listed here because it is the only remaining path by
which a foreign process reaches a host prefix by design, and any future rule must say so
rather than trip over it.

## Where the two foreign platforms diverge without a stated reason

**D1 — `GIRepository-2.0` ships on win32 and not on darwin.** `status/open-todos.md:498-519`
has the diff and the honest verdict: neither builder names it, so it arrives through each
platform's closure walk "rather than by decision", and `gi://GIRepository` therefore works on
Windows and fails on macOS with nothing to say so.

**D2 — `dataBytes` counts different trees.** `build-gtk-runtime.mjs:1113` sums
`lib + share + etc`; `build-gtk-runtime-darwin.mjs:1434` sums `share` alone. The manifests are
compared across platforms in release gates; the day darwin grows an `etc/`, it will under-report
it silently.

**D3 — two builders, two homes.** win32's recipe lives inside its package
(`gtk-runtime-win32-x64/scripts/build-gtk-runtime.mjs`); darwin's lives one level up
(`packages/node-gi/scripts/build-gtk-runtime-darwin.mjs`) and is shared by the two arch
packages. Not a defect — but it is why the shared rule modules (`bundle-data.mjs`,
`bundle-fonts.mjs`, `typelib-backers.mjs`) are load-bearing, and why anything *not* in them
drifts by default.

**D4 — pinned catalogue on one side, a package manager on the other.** win32 builds from a
gvsbuild prefix whose project list is committed (`scripts/gvsbuild-catalogue.json`) and whose
gaps must be declared with an upstream cause (ADR 0056). darwin builds from
`brew --prefix` (`build-gtk-runtime-darwin.mjs:175`) with no equivalent. A capability that
disappears from a Homebrew formula disappears from the bundle, and the only thing that would
notice is a symmetry or floor check that happens to cover it.

**D5 — the darwin README describes a bundle that no longer exists.**
`packages/node-gi/gtk-runtime-darwin-arm64/README.md:189-196` says the gdk-pixbuf loaders are
"still not collected" — § 2b of the current builder collects them — and in the same paragraph
gives fontconfig's omission its reason. One half of that paragraph is measurably stale, which
is a poor place for the other half to be the only statement of a decision.

## What is already decided (this ADR must not contradict it)

- **ADR 0018** — the OS axis is a declared, *checked* claim, and a file count is not a
  capability.
- **ADR 0023** — `win32` and `darwin` are `bundle`-first; a host GTK is a hazard, not a
  fallback; exactly one GObject type registry per process.
- **ADR 0024 § 2** — one payload, one layout per OS; per-OS code only where the LAYOUT
  differs, never a branch in the staging code. **§ 4** — on both foreign OSes the artifact
  carries Node + `@gjsify/node-gi` + `@gjsify/gtk-runtime-<target>`.
- **ADR 0038** — one payload directory for faces; the *mechanism* is per-OS and each row must
  say whether it was measured or researched.
- **ADR 0055 / 0056** — a bundle declares its media capabilities and names the upstream cause
  of each gap; a gap with no named cause fails the build.
- **ADR 0057** — inside a runtime bundle, an absolute search path is a redirect, not a
  fallback.

The proposal below adds no new payload *kind* and no new layout. It generalises 0057's
sentence from images to the files images read, and gives 0055's "declare the gap with its
cause" shape to configuration.

## Decision (proposed)

**A foreign-platform artifact carries every input its own libraries read. Where it
deliberately carries none, the absence is declared as data, with its cause, on both foreign
platforms or on neither.**

Four clauses.

### 1. Configuration is payload

`etc/` joins `share/` as a directory a bundle may own, on both foreign platforms. The rule for
what goes in it is not "what the build prefix happened to have" but "what a library in this
bundle reads at init and would otherwise look for outside the artifact". `fonts.conf` is the
case that forces it; a bundle-owned `fonts.conf` names `<bundle>/share/fonts` and the artifact's
own `share/fonts/<appId>`, and nothing else.

### 2. A configuration input is a declared data set, or a declared absence

`WINDOWING_DATA_SETS` (`packages/node-gi/scripts/bundle-data.mjs:134`) is already the shared,
platform-free list, and its doc comment already says why `etc/fonts` is not in it: a gvsbuild
prefix without one means pango uses DirectWrite, "which is the normal configuration rather than
a defect". That reasoning is sound and incomplete — it makes the *absence* conditional on a
build-prefix property that nothing records. The change is to let a set declare
`absent: { why, upstream }` the way ADR 0056 lets a media gap declare its cause, and to require
that both foreign platforms resolve every set to either *present with files* or *absent with a
cause*. A set that is silently missing on one platform and present on the other stops being
expressible.

### 3. A capability claim is proved inside the artifact, not counted

The decode probe (`build-gtk-runtime.mjs:950`, `build-gtk-runtime-darwin.mjs:1362`) is the
pattern and it is already symmetric: both builders spawn a child with the host prefix scrubbed
and assert real pixel dimensions. Two more probes belong beside it, on the same terms:

- **a font probe** — `list_families()` in a bundle-activated child, asserting the bundled family
  is present and an invented family is not (the discriminator ADR 0038 § W1-W5 already uses);
- **a settings probe** — write a key through `Gio.Settings`, re-open, read it back, so G5 is
  answered by the artifact rather than by reasoning about backends.

### 4. No Linux-shaped default in a foreign-platform artifact

A launcher, a locale resolver or a search-path default may name `/usr`, `/usr/local` or
`/opt/homebrew` only on Linux. Off Linux the correct value is "nothing", so the failure is a
visible absence rather than a path that silently cannot exist. This is checkable by grep over
the rendered launcher strings, which `launcher.spec.ts` already renders.

## Steps, and what each one costs

| # | step | cost, honestly |
|---|---|---|
| 1 | Delete the `/usr/local/share:/usr/share` fallback from the `.app` launcher (G2); make `resolveLocaleDir` return undefined rather than `/usr/share/locale` off Linux (G3) | Small: two strings, two spec updates. **Risk:** a `.app` on a developer's Mac that today reaches a Homebrew icon theme through that fallback will stop — which is the point, and will look like a regression the first time |
| 2 | Add the `absent + cause` field to `WINDOWING_DATA_SETS` and make every set resolve on both platforms (clause 2) | Medium: one shared module, two builders, one verifier (`verify-bundle-manifest.mjs`). No payload changes. Forces a written cause for the two absences that have none today — D1 and G4 |
| 3 | Decide D1 (`GIRepository-2.0`: both or neither) and record it in `REQUIRED_NAMESPACES` rather than leaving it to the closure walk | Small in code, a real decision in substance; `status/open-todos.md:517` already asks the owner of the bundle contract to make it |
| 4 | Ship a bundle-owned `fonts.conf` on **both** foreign platforms; point `FONTCONFIG_PATH`/`FONTCONFIG_FILE` at it unconditionally where a bundle carries one (G1) | Medium, and it is the step that must not be taken blind: the darwin half is unverifiable from here, and it interacts directly with PR #1677 — whichever lands second must re-measure, not assume. On win32 it also removes the "when the prefix has one" conditional, which changes what a bundle built against a fontconfig-less gvsbuild contains |
| 5 | Add the font probe and the settings probe (clause 3) | Medium-high: the font probe is a near-copy of the decode probe and is affordable; the settings probe needs a writable child environment on two OSes and may find that G5's answer is "the memory backend", which is a second, larger piece of work |
| 6 | Ship GTK's own gettext catalogues in both bundles (G4) | **The expensive one.** ~50 languages × GTK + GLib + libadwaita is tens of MiB on a bundle that is already 81.6 MiB on win32, and it needs a language-selection policy (all / a set / author-chosen) that nothing in the tree has. Naming it here so the gap stops being invisible; deciding it is not this ADR's business |
| 7 | Fix the darwin README's stale paragraph (D5) and align `dataBytes` (D2) | Small, and worth doing with step 2 so the two statements of the fontconfig decision cannot disagree again |

Steps 1-3 and 7 are independent of any host and can land from Linux. Steps 4-6 need the two
foreign hosts to say anything true, and this ADR does not claim their outcome.

## Consequences

**Good.** One sentence covers a class that has been paid for one incident at a time: images
(0057), faces (0038), media (0055) and now configuration all answer the same question, and
"which OS" stops being the axis — "is this artifact self-contained" is. A new foreign
platform, or a second source for an existing one, inherits the checks instead of rediscovering
them.

**Bad.** Clause 2 makes every absence cost a written cause, and some causes are genuinely "we
have not measured this on that host". The honest form of that is a declaration that says so,
which is more text than silence and looks like bureaucracy until the day it is the only reason
someone notices (`dataBytes: 0` reached npm; `fontconfig: true` with no face reached npm).

**Bad, specifically.** Step 4 adds a fontconfig configuration to a platform where the current
font map may not read it. That is dead payload until something selects the fontconfig backend
— measurable in kilobytes, not megabytes — and the alternative is a bundle whose behaviour
under `PANGOCAIRO_BACKEND=fc` depends on a directory that belonged to the build machine.

**Unresolved.** G5 and G4 are named, not solved. So is the question behind D4: darwin has no
pinned catalogue, and until it does, "what this bundle can do" is a property of a Homebrew
formula on the day the runner ran.

## What this does NOT decide

Which libraries a bundle contains; which GTK a process picks (ADR 0023); whether darwin should
move off Homebrew as a build source; the language-selection policy step 6 would need; and
anything about Linux artifacts, which borrow by design and should keep doing so.
