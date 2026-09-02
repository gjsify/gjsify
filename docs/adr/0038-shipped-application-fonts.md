# ADR 0038 — A shipped application font: one payload directory, and the declarative mechanism each OS actually has

- **Status:** Accepted (2026-09-02)
- **Scope:** `gjsify ship`'s payload (`gjsify.ship.fonts`), the `SHARE` directory set, and the per-OS honesty rows in `utils/ship/layout.ts`. Extends [ADR 0024](0024-ship-installable-artifacts.md) § 2 (*one payload, one layout per OS*) the way § A8 extended it for compiled gettext catalogues. It settles nothing about which GTK closure a `.app` or a Windows program directory carries — that is `@gjsify/gtk-runtime-<target>` and [ADR 0023](0023-gtk-source-precedence.md).
- **Written after the measurements, not before** — and revised by them: the first draft assumed the Linux mechanism generalised to all three OSes, and it does not. What was RUN on this machine is the Linux half, and one of its findings contradicts `fonts-conf(5)`. macOS and Windows were researched against vendor documentation and upstream source and are marked as such throughout, never as measurements. § *What was measured* carries both, apart.

## Context

`@gjsify/react-native`'s support table has told consumers, in the `useFonts`
row and in the generated `SUPPORT.md`, to

> Ship the font with the application (`gjsify ship` installs it where fontconfig looks)

and `surfaces/expo-font.ts` repeats it in prose: fonts are installed
"system-wide, or in `~/.local/share/fonts`, or shipped with the application
where `gjsify ship` puts them".

**There was no such mechanism.** Measured on `origin/main` at 3356ac7c66:

| probe | result |
|---|---|
| `git grep -i font packages/infra/cli/src/utils/ship/ packages/infra/cli/src/commands/ship.ts docs/ship-formats.md` | **0 hits** |
| `SHARE` in `utils/ship/share-dirs.ts` — the CLOSED set of directories a payload installs into | `applications`, `icons`, `schemas`, `mime`, `metainfo`, `locale`. No `fonts` |
| `FcConfigAppFontAddFile` / `AddFontResourceEx` / `CTFontManagerRegisterFontsForURL` anywhere outside `refs/` | 1 hit, and it is a comment saying the first "is not in any typelib here" |
| the only font-registration call in the tree | `PangoCairo.font_map_get_default().add_font_file()` in `packages/dom/dom-elements/src/font-face.ts` — the Canvas `FontFace` path, which is the APP registering a face at runtime and has nothing to do with packaging |

So a project could name `gjsify.ship.extraFiles` and hand-place a `.ttf`, and
nothing else. The documented instruction resolved to nothing.

### Why the gap is the expensive kind

An application that ships brand faces and does not get them installed does not
crash, does not exit non-zero and writes nothing to stderr. Pango **substitutes**:
`pango_font_description_set_family("Brand")` against a font map with no such
family silently resolves to the default sans, the window renders, every test
passes and the application merely looks wrong. On a GNOME host the developer
never sees it, because the family is usually installed there anyway; the
difference shows up on macOS, on Windows, and on any Linux that is not GNOME —
exactly the three places ADR 0024's other milestones exist to reach.

That is the same shape as the two defects `share/` already carries a mechanism
for. An uncompiled GSettings schema *aborts*, which is loud; a misplaced `.mo`
shows the untranslated msgid, which is quiet, and § A8 is the ADR that closed it.
A missing face is quieter than either.

## What was measured

All on Fedora 44, fontconfig **2.17.0**, FreeType 2.14.3 (`freetype2.pc` reports
the libtool number 26.6.20, which is not a FreeType release), plus the seven other
implementations in § 5. The probe is one real TTF copied to
`<probe>/prefix/share/fonts/org.example.App/probe.ttf`, whose family is absent
from every host and runtime tested — so a hit is the probe and never a
substitution.

**1. The stock `fonts.conf` names two things, and only one of them is a fixed path.**

```
/etc/fonts/fonts.conf:  <dir>/usr/share/fonts</dir>
                        <dir>/usr/local/share/fonts</dir>
                        <dir prefix="xdg">fonts</dir>
                        <dir>~/.fonts</dir>
```

**2. `prefix="xdg"` is expanded over `XDG_DATA_DIRS`, and the manual says it is not.**
Both `fonts-conf(5)` and `/usr/share/doc/fontconfig/fontconfig-user.txt` say only
*"the value in the XDG_DATA_HOME environment variable will be added as the path
prefix"*. The behaviour is wider:

| `XDG_DATA_HOME` | `XDG_DATA_DIRS` | probe face found |
|---|---|---|
| `/nonexistent-home` | `<probe>/prefix/share:/usr/share` | **yes** |
| `/nonexistent-home` | `/usr/share:<probe>/prefix/share` | **yes** (any position) |
| `/nonexistent-home` | `/usr/share` | no |
| `<probe>/prefix/share` | *(unset)* | yes (the documented half) |

**3. It really is that element, not something Fedora added.** With
`FONTCONFIG_FILE` pointed at a hand-written config holding `<dir>/usr/share/fonts</dir>`
alone, the probe face is invisible; adding the single line
`<dir prefix="xdg">fonts</dir>` to the same file makes it visible. Nothing in
`/etc/fonts/conf.d/` mentions XDG at all.

**4. No cache step is required.** With a fresh, empty `XDG_CACHE_HOME`, the face
resolves on the FIRST call and three cache files are written as a side effect.
`fc-cache` is an optimisation here, not a precondition — which is the opposite of
`glib-compile-schemas`, where the missing artifact aborts the process.

**5. Eight independent fontconfig builds agree, across five releases.** The claim
is a BEHAVIOUR of a third-party library that its own manual contradicts, so one
host is not enough to build a mechanism on. Re-run in every runtime available
here — probe prefix on `XDG_DATA_DIRS`, `XDG_DATA_HOME=/nonexistent-home`, a fresh
`XDG_CACHE_HOME`, and a negative control (`XDG_DATA_DIRS=/usr/share`) in each:

| runtime | fontconfig | control | probe prefix on `XDG_DATA_DIRS` |
|---|---|---|---|
| Fedora 44 (host) | 2.17.0 | fallback | **found** |
| `org.gnome.Platform//43` | 2.14.1 | fallback | **found** |
| `org.gnome.Platform//45`, `//46`, `//47`, `//48` | 2.15.0 | fallback | **found** |
| `org.gnome.Platform//49` | 2.17.1 | fallback | **found** |
| `org.gnome.Platform//master` | 2.18.3 | fallback | **found** |
| `org.freedesktop.Platform//24.08` | 2.15.0 | fallback | **found** |
| `org.freedesktop.Platform//25.08` | 2.17.1 | fallback | **found** |
| `org.fedoraproject.Platform//f44` | 2.17.0 | fallback | **found** |

So the expansion is not a Fedora patch, not a recent addition and not a
regression waiting to be reverted — it is what every fontconfig in reach does.
Each of those runtimes carries the same two `fonts.conf` elements and no `/app`
entry, and Flatpak sets `XDG_DATA_DIRS=/app/share:/usr/share:…` — so
`/app/share/fonts` is reached by this rule and not by a Flatpak-specific one.

**6. It recurses.** The probe face is one level below `fonts/`, under a directory
named for an app id, and is found there.

**7. `.woff2` is readable here and that is not portable.** `fc-query` reads a
`.woff2`'s family fine on this host. FreeType's WOFF2 support is
`FT_CONFIG_OPTION_USE_BROTLI` — a build option of whichever FreeType the artifact
loads, which for a `.app` or a Windows program directory is the one inside
`@gjsify/gtk-runtime-<target>`, not this machine's.

### And one thing that was NOT measured here, because it inverted the design

The seven above are Linux and they are this machine's. macOS was researched
against primary sources rather than run, and the first draft of this ADR was
wrong about it in the direction that matters — it assumed the mechanism
generalised, because `build-gtk-runtime-darwin.mjs` seeds `libpangoft2-1.0.dylib`
and the otool walk pulls fontconfig in transitively. **The library being in the
closure is not the backend being in use.**

- GTK's own `meson.build` carries `fontconfig_dep = []  # only used in x11 backend`,
  and Homebrew's `gtk4` formula builds `-Dx11-backend=false -Dmacos-backend=true`.
  GTK4 on macOS is **not linked against fontconfig at all**.
- cairo's `quartz` option defaults to `auto` and auto-enables on darwin, so
  `HAVE_CAIRO_QUARTZ` is set unless someone explicitly disables it. Pango's
  **CoreText** font map winning on macOS is close to unconditional rather than a
  habit of three packagers.
- `pango_font_map_add_font_file()` — the call `@gjsify/dom-elements` uses for
  Canvas `FontFace` — answers `G_IO_ERROR_NOT_SUPPORTED` on the CoreText map.
- `ATSApplicationFontsPath` is current and undeprecated. Apple's archived
  *Information Property List Key Reference* states the scope this command needs:
  *"If present, macOS activates the fonts at the specified path for use by the
  bundled app. The fonts are activated only for the bundled app and not for the
  system as a whole."*
- The ORDERING is the reason to prefer it over any runtime call, not tidiness:
  `pango_core_text_font_map_changed()` only bumps a serial. There is no
  `kCTFontManagerRegisteredFontsChangedNotification` observer and no re-scan path
  in `pangocoretext-fontmap.c`, so a face registered after the font map
  initialises **cannot be recovered by poking the map**. The system activates this
  key's directory at launch, before any of the app's code runs.
- Runtime probe for a machine that has one: `PANGOCAIRO_BACKEND=bogus ./yourapp`
  makes the `g_critical` print the compiled-in backend list.

So a `fonts.conf` inside a `.app` would be inert twice over — wrong Pango backend
and no GTK-side fontconfig — and the darwin row is a different mechanism, not a
weaker version of the Linux one.

### Windows, likewise researched rather than run — and it has no declarative answer

The repository's own win32 builder hedges: it copies `etc/fonts` *"when present"*
and otherwise logs *"pango uses the win32/DirectWrite backend — skipping"*. The
hedge resolves, and not in the direction the arrangement assumes.

- `pango_win32_font_map_init()` has exactly **one** population call,
  `pango_win32_dwrite_font_map_populate()`. Grepping the win32 backend for
  `EnumFontFamilies|AddFontResource` gives zero hits: there is no GDI enumeration
  and no filesystem search path anywhere in it. The win32 backend **is** the
  DirectWrite backend; there is no third one to select.
- `pangocairo-fontmap.c` picks the first backend **compiled in**, in the order
  coretext → win32 → fc — not per platform. cairo's meson adds `cairo-win32`
  unconditionally on a Windows host, and gvsbuild builds pango with
  `-Dfontconfig=enabled`. So **both** are compiled in, win32 wins, and the fc font
  map is built and never selected. The `etc/fonts` copy and the `FONTCONFIG_PATH`
  / `FONTCONFIG_FILE` plumbing have never affected text rendering.
- GTK's `meson.build` (4.23.x): `pangoft_dep` is required only for Wayland/X11,
  `if win32_enabled` hard-requires `pangowin32`, and `pango_pkgname` is
  `pangowin32` on Windows. `fontconfig_dep = []` is set outside `if x11_enabled`.
- **The `XDG_DATA_DIRS` finding does not port.** `FcConfigXdgDataDirs()` splits on
  a hardcoded colon — its own source comment says the spec asks for one — while
  `FC_SEARCH_PATH_SEPARATOR` is `;` on Windows. `XDG_DATA_DIRS=C:\App\share`
  splits into `C` and `\App\share`. Unusable with any drive-letter path, and dead
  code anyway per the point above.
- `AddFontResourceEx(..., FR_PRIVATE)` is a **Gdi32** call. Microsoft's own list
  of DirectWrite font sources (system font set, local file references, remote
  loaders, in-memory loaders) does not include GDI's private font table — and the
  Pango-side argument is decisive on its own and independent of that gap: the
  populate call goes through DirectWrite, so a GDI-private font could not reach
  the font map even if DirectWrite could see it.
- **There is no Windows `ATSApplicationFontsPath`.** Side-by-side application
  manifests carry no font element. The one declarative mechanism Windows has is
  MSIX's `windows.sharedFonts` extension, which is wrong three ways over: it needs
  MSIX packaging rather than a relocatable directory, it installs the font
  *shared* rather than per-process, and Store submission gates it.
- What is left is `pango_font_map_add_font_file()` (Pango 1.56+), and it **is**
  reachable: `Pango-1.0.gir` carries
  `<method name="add_font_file" c:identifier="pango_font_map_add_font_file" version="1.56" throws="1">`,
  verified against the installed typelib. On win32 it goes through
  `IDWriteFactory5::CreateFontSetBuilder` (falling back to `IDWriteFactory3`), then
  clears the map's cache and emits `changed` — so unlike CoreText it works **after**
  the font map exists.

Nothing in this section was executed on Windows. It is source and vendor
documentation, and it is marked as such.

## Decision

**1. Fonts are payload, and the payload does not grow a second shape.**
A new `gjsify.ship.fonts` key (a file, or a directory, defaulting to `data/fonts`
when it exists) puts every face into the ONE prefix-relative plan at
`share/fonts/<appId>/<basename>`, and `place()` maps it per layout like every
other `share/` entry. No layout gets a rule of its own, and
`tests/e2e/ship-layout`'s hand-written map needs no new entry for it — which is
the property ADR 0024 § 2 is checkable by.

**2. `share/fonts` is under the app id, and the reason is `/usr`.**
That prefix is shared with every other package on the system, so a face named
`Regular.ttf` at the top of it is one of two files claiming a path with install
order deciding the winner — the same argument that already puts the app id on the
GSettings schema and the shared-mime-info document. Unlike those two the
collision is not refused by NAME: a face's filename belongs to the foundry and
there is no convention to hold it to, so the directory carries the id and the
basenames are left alone. Nesting costs nothing (§ *What was measured*, 6).

**3. ONE payload directory, and the DECLARATIVE mechanism each OS actually has.**
The path is the same everywhere; what reaches it is not, and pretending otherwise
is the error the first draft made.

| | how the payload's `share/fonts/<appId>` is reached | status |
|---|---|---|
| Linux, `.deb` / `.rpm` (`/usr`) | the stock `fonts.conf`'s unconditional `<dir>/usr/share/fonts</dir>` | measured here |
| Linux, Flatpak (`/app`) | `<dir prefix="xdg">fonts</dir>` over the `XDG_DATA_DIRS` Flatpak sets | measured here, in eight fontconfig builds (2.14.1 → 2.18.3) |
| macOS `.app` | `ATSApplicationFontsPath` in `Info.plist`, resolved against `Contents/Resources` — the OS activates the directory for THIS app at launch | primary sources; activation unverified on hardware |
| Windows program directory | **nothing declarative exists.** The launcher exports `GJSIFY_FONT_DIR` and the app calls `PangoCairo.FontMap.get_default().add_font_file()` | primary sources; the three candidates that look like they work are each dead — see above |

On LINUX the launcher is **not changed**: `renderLauncher` has exported
`XDG_DATA_DIRS` at the staged `share/` on every layout since ADR 0024 § 3, for the
icons, the desktop entry and the compiled schemas, and the finding is only that
fontconfig reads it too. What changes is that the line is now load-bearing for a
reader `fonts-conf(5)` does not list, so the comment above it says so.

On MACOS the same variable carries the icons and the schemas as before and
carries **no face at all**; the `Info.plist` key does the work instead — emitted
by `Layout.metadata`, which is why that function now takes the payload: a manifest
key naming a directory must not be written over a bundle that has none.

**4. Windows gets the handover, not a guess.** `gjsify ship` places files; it does
not put code inside somebody else's bundle, and the only Windows mechanism is a
call the application makes. So the launcher exports **`GJSIFY_FONT_DIR`** at the
staged face directory — on all three layouts, exactly as `GJSIFY_LOCALE_DIR`
already hands over the catalogue directory for `bindtextdomain`, which has no
environment variable of its own either (ADR 0024 § A9).

Redundant on Linux, informational on macOS, load-bearing on Windows — and
exported everywhere anyway, because the one thing a consumer must not have to
write is an OS branch around a path this command chose. `Layout.fontGap` names the
call.

**5. No install step, and that is a deletion rather than an omission.**
`cacheRefreshCommands` gains no `fc-cache` row and `PayloadFacts` gains no
`hasFonts`. § *What was measured* 4 is why: the cache is built lazily, per user,
on first use, and both distributions run `fc-cache` from their own fontconfig
triggers on `/usr/share/fonts` anyway. `share/fonts` therefore joins
`share/locale` in `SHARE_PORTABLE` — the list of `share/` entries whose
correctness does NOT come from a package install step — so the non-Linux warning
does not name it as a cost it is not.

The one thing the packers DO gain is a directory the package must not claim:
`/usr/share/fonts` joins `rpm.ts`'s `SYSTEM_OWNED_DIRECTORIES` (measured,
`rpm -qf /usr/share/fonts` → `fonts-filesystem-5.0.0-2.fc44`). It is a PARENT
rather than a directory the planner stages into — the package legitimately owns
`share/fonts/<appId>` — but the parent here IS `SHARE.fonts` exactly, so it is
derived rather than spelled out, unlike the two literal parents beside it.

**6. What the payload cannot settle is PRINTED, per OS, and only when a face is
carried.** `Layout.fontGap` is `runtimeGap`'s sibling: absent on Linux, and on
each other row a sentence saying what is still unverified there.

- **darwin** — the mechanism is declared and its EFFECT is unverified. The plist
  key is in the bundle and points at the staged directory; that macOS activates it
  and that Pango's CoreText map then holds the family cannot be checked from any
  leg this repository has. `PangoCairo.FontMap.get_default().list_families()` in
  the shipped bundle is the check, and `PANGOCAIRO_BACKEND=bogus` prints which
  backend it was actually built with.
- **windows** — there is no mechanism to declare, so the note says what the app
  must do and names the call. It is the row a reader is most likely to get wrong,
  because three different things look like they would work and none does.

Conditional on the payload actually carrying a face, for the reason `runtimeGap`
is conditional on the missing interpreter: a warning printed over every stage is
one nobody reads by the time it matters.

**7. A web-font wrapper is REFUSED by name.** `.woff`, `.woff2` and `.eot` fail
the build with the reason, rather than being filtered out with the strays. § 7
above is why it is a refusal and not a warning: it resolves on the packaging host
and may not in the shipped bundle, which is the exact silent substitution this
key exists against. An `OFL.txt` beside the faces is still ignored — the refusal
targets the file somebody put there meaning it to ship.

## Consequences

- The support-table claim becomes true, with the key named. That sentence is what
  this ADR is paying off; leaving it as prose over an absent mechanism was the
  defect.
- `@gjsify/adwaita-fonts`' desktop TTFs now have a packaging destination. The
  entry in `status/open-todos.md` about that package is unchanged — it is about
  the size of a *web* font in a browser bundle, which this does not touch.
- One more `share/` directory means one more row a fourth OS's layout has to have
  an answer for. That cost is the same one `SHARE` was extracted to bound, and it
  is paid by the compiler rather than by prose.
- Nothing about the artifact's SIZE is decided here. A `.ttf` is 0.9 MB and a
  family is several; that is the consumer's call, made in their own
  `gjsify.ship` block, and `gjsify ship` neither subsets nor warns about it.

## What this does NOT decide

- **`gjsify ship` does not put code inside somebody's bundle.** Windows needs one
  runtime call and this command does not make it — it stages the faces, names the
  directory in `GJSIFY_FONT_DIR`, and says which call is missing. A packaging
  command that injected a startup step would be deciding an application's
  initialisation order for it, and it would do so invisibly.
- **The Windows call has no home in `@gjsify/*` yet.** One line in a GTK
  application's startup registers every face
  (`PangoCairo.FontMap.get_default().add_font_file()` over `GJSIFY_FONT_DIR`), and
  it belongs in the GTK host layer (ADR 0027) rather than copy-pasted per app —
  but that is a second package's API, with its own tests, and putting it in this
  PR would decide it without measuring it. `status/open-todos.md`.
- **Whether a shipped `.app` resolves the family.** The plist key is declared and
  its EFFECT is unverified: no leg here runs a `.app`. Decision 6 prints it rather
  than letting the green stage imply otherwise.
- **The inert fontconfig plumbing in the win32 runtime bundle.**
  `gtk-runtime-win32-x64`'s builder copies `etc/fonts` and `node-gi/gtk-runtime.js`
  sets `FONTCONFIG_PATH`/`FONTCONFIG_FILE` at it. Per the sources cited above the
  fc font map is compiled and never selected, so none of it affects text — and the
  comment beside it implies fontconfig is sometimes in play, which is worse than
  the dead code. That is `@gjsify/node-gi`'s tree, outside this workspace and with
  its own CI, and it is a REMOVAL that wants a Windows run behind it.
  `status/open-todos.md`.
- **`AddFontResourceEx` with `FR_PRIVATE`, permanently.** Not deferred — ruled
  out. It registers with GDI, and `pango_win32_font_map_init()` populates from
  DirectWrite alone. A GDI-private font cannot reach GTK4 text even if DirectWrite
  could see it, which is itself undocumented either way.
- **MSIX `windows.sharedFonts`.** The one declarative font mechanism Windows has,
  and wrong three ways: it requires MSIX packaging rather than a relocatable
  directory, it installs the face SHARED rather than per-process, and Store
  submission gates it.
- **`FONTCONFIG_FILE` / `FONTCONFIG_PATH` from the launcher.** Both REPLACE the
  configuration rather than adding to it, so a staged config would have to
  `<include>` whatever it displaced — and `node-gi`'s `maybeWireGtkWindowingEnv`
  sets them itself, with `setIfUnset`, so a launcher value would silently win over
  the runtime bundle's own config. It would also be pointing at a font map neither
  non-Linux OS selects.
- **The fontconfig floor.** The `XDG_DATA_DIRS` expansion holds in every
  fontconfig reachable from here — 2.14.1, 2.15.0, 2.17.0, 2.17.1, 2.18.3, in
  eight independently built runtimes (§ *What was measured*, 5). Which release
  introduced it, and whether one before 2.14.1 lacks it, is not established; the
  `/usr` case does not depend on the answer, because it uses the unconditional
  `<dir>` instead.

## Implementation

Landed with this ADR, in `packages/infra/cli`:

1. `SHARE.fonts` in `share-dirs.ts`, carrying the measurement so it is not
   re-derived from the man page and removed.
2. `gjsify.ship.fonts` in `types/config-data.ts`; `discoverFonts` in
   `utils/ship/discover.ts` with the `data/fonts` default and the refusals;
   `fontFiles` through `DiscoveredPayload` → `ShipSettings` (and deliberately not
   `PackSettings` — the faces cross in the payload, like the catalogues).
3. `planFonts` in `utils/ship/plan.ts`, staging under the app id.
4. `SHARE.fonts` into `SHARE_PORTABLE` in `utils/ship/payload.ts` — no install
   step on any layout, which is the only thing that list claims — and
   `/usr/${SHARE.fonts}` into `rpm.ts`'s `SYSTEM_OWNED_DIRECTORIES`, so the
   package does not claim a directory `fonts-filesystem` owns.
5. `ATSApplicationFontsPath` in `utils/ship/plist.ts`, emitted only when the
   bundle carries a face. `Layout.metadata` now takes the PAYLOAD so it can ask —
   the seam `CFBundleDocumentTypes` will need for the same reason.
6. `GJSIFY_FONT_DIR` from all three launcher forms, on the `GJSIFY_LOCALE_DIR`
   precedent (ADR 0024 § A9).
7. `Layout.fontGap` in `utils/ship/layout.ts`, printed by `commands/ship.ts`
   beside `runtimeGap` and only when a face is staged.
8. `utils/ship/discover-fonts.spec.ts` for the refusals, a `plist.spec.ts` case
   for the key's presence AND absence, and `tests/e2e/ship-layout` extended rather
   than duplicated: the fixture carries a real 11 KB face, the Linux payload list
   names `share/fonts/<appId>/…`, the map places it on the other two, the plist's
   declared path is resolved against the staged tree, and all three launcher forms
   assert their exports. Without the implementation that suite fails **7** tests,
   across the payload, all three launchers, the plist and both gap notices.

## Do not

- **Do not assume a mechanism generalises across the three OSes because the
  library is in the closure.** That is the mistake this ADR's own first draft
  made, on a plausible-looking argument from `build-gtk-runtime-darwin.mjs`'s seed
  list. fontconfig is linked into the darwin AND the win32 closures and is the
  selected backend in NEITHER. Read the backend selection, not the dependency
  graph.
- **Do not narrow the launcher's `XDG_DATA_DIRS` line to its GLib readers.** On
  Linux it carries the faces, and `fonts-conf(5)` lists none of that behaviour —
  so the obvious tidy-up ("this is for icons and schemas") silently un-ships every
  bundled typeface while every file stays exactly where the e2e asserts it is.
  That is why the assertion is on all three launcher forms, not only on Linux's.
- **Do not add `fc-cache` to the postinst because the other four directories have
  a refresh line.** Measured unnecessary (§ 4), and both distributions already run
  it from their own fontconfig triggers. A step that does nothing is a step whose
  failure nobody notices.
- **Do not "fix" darwin by staging a `fonts.conf` into the `.app`.** It would be
  inert twice over — wrong Pango backend, and GTK there is not built against
  fontconfig — while looking exactly like a fix.
- **Do not relax the `.woff2` refusal because it works locally.** It does work
  locally; that is measurement 7, and it is the reason for the refusal rather than
  an argument against it.
- **Do not let a file count stand in for a load.** Nothing here proves a family
  RESOLVES on macOS or Windows. The staged tree is asserted, the resolution is
  not, and `Layout.fontGap` is what says so out loud instead of letting a green
  stage imply otherwise.
