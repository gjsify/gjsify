<!-- Authored Open-TODO sections — area: Fonts.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### No leg runs a SHIPPED artifact and registers its fonts

`initFonts()` in `@gjsify/gtk-host/fonts` closes the call ADR 0038 § 4 handed over: it reads
`GJSIFY_FONT_DIR`, walks the staged directory and registers every face with
`PangoCairo.FontMap.get_default().add_font_file()`, treating the `G_IO_ERROR_NOT_SUPPORTED` a
CoreText map answers as "the OS already activated these" rather than as a failure. Both open
API questions are decided: the app calls it (this package owns no lifecycle to hook, and a
module-load side effect would pick an application's initialisation order for it), and a face
that will not open warns and is reported rather than aborting.

What is NOT closed is the end-to-end path, and it is the half ADR 0038's *Do not let a file
count stand in for a load* names. The CALL is measured on both operating systems it is for —
Fedora 44 / Pango 1.57.1 here (`list_families()` 100 → 101 with the staged family, and a layout
that measures 66x50 px against the 87x63 an invented family gets), Windows 11 / GTK 4.22.4 in
ADR 0038 § W4-W5 (82 → 83). What no leg does is BUILD a program directory or a `.app`, start it
through the launcher `gjsify ship` wrote, and assert the family resolves in that process.
`tests/e2e/ship-layout` asserts the staged tree and the launcher's exports; `gtk-os-suites.yml`
runs `@gjsify/gtk-host` on the shipped GTK closure but from a checkout, not from a shipped
payload. Nothing joins the two, so `GJSIFY_FONT_DIR` is asserted as a STRING in a launcher and
consumed as a DIRECTORY in a different run.

macOS keeps its own half of that gap unchanged: `ATSApplicationFontsPath` is emitted and its
ACTIVATION is unverified on hardware, which is why `Layout.fontGap` still prints it.


### The win32 GTK bundle's fontconfig config — proposed for deletion, then reversed

`gtk-runtime-win32-x64/scripts/build-gtk-runtime.mjs` copies `<prefix>/etc/fonts` into the
bundle and runs `fc-cache` over it; `node-gi/gtk-runtime.js` then sets `FONTCONFIG_PATH`
and `FONTCONFIG_FILE` at it. The sources cited in the entry above say the fc font map is
compiled and not selected by default on Windows; that is now MEASURED (ADR 0038 § W1-W2,
Windows 11 / GTK 4.22.4). A hand-written `FONTCONFIG_FILE` naming a face directory leaves
`PangoCairo.FontMap.get_default().list_families()` at 82 without the face — and still at 82
when that directory is the ONLY configured one, which is the row that distinguishes "read
and ignored" from "not read". A `PangoFT2.FontMap` built from the same config in the same
process does see the face. So none of this affects text rendering. The bundle also ships no
`fc-cache.exe`: the cache is baked at build time and there is no supported way to rebuild
it on the target, which is a second reason the arrangement cannot be made to work rather
than merely being unused.

Two things made it look worth removing rather than leaving as harmless: the code comment
beside it says gvsbuild's pango "can be fontconfig-backed … so either path works", read at
the time as the claim that made ADR 0038's first draft wrong in the same direction — and that
half of it turns out to be CORRECT, which is the first thing this entry got backwards; and the
builder's
`else` branch ("no etc/fonts … skipping") is probably unreachable, because fontconfig's own
meson installs `fonts.conf` to `<prefix>/etc/fonts` and gvsbuild builds fontconfig with the
default `sysconfdir` — so the "when present" test always passes and the log line implying a
choice was never true. NOT VERIFIED against a gvsbuild release artifact; if that branch has
ever been taken, fontconfig is being excluded from the closure somewhere and that is a
different finding.

`packages/node-gi` is outside the npm workspace with its own CI, and this is a REMOVAL of
shipped bundle content. The Windows run it wanted behind it now exists; what it still wants
is a PR in that tree, and one re-run there after the deletion — a Linux-green deletion is
still not evidence for it.

**REVERSED 2026-09-14 — this payload is load-bearing after all, and the reason it looked dead
is worth more than the entry was.** ADR 0038 § Amendment 3 has the loader select the backend
that reads this configuration (`PANGOCAIRO_BACKEND=fc`), so `etc/fonts` becomes the configuration
a win32 process actually loads. It does NOT contradict § W1-W2 above: those measured a
*pangowin32* map, which is filled exclusively from the DirectWrite system collection and would
ignore a fully-read `fonts.conf`; what changes is which map exists.

The intermediate reading — that gvsbuild's pango has no fontconfig backend to select, so the
variable is inert on win32 — was WRONG and is kept here because it was well-evidenced.
`pangocairo-1.0-0.dll` in `GTK4_Gvsbuild_2026.6.0_x64.zip` registers `PangoCairoFcFontMap`,
imports `fontconfig-1.dll`, and lists ` win32 fontconfig`. What CI run 34873488108 actually
measured is that a `process.env` write does not reach `getenv()` on Windows: Node writes the
Win32 environment block, pango reads the C runtime's copy. `mirrorWindowingEnvIntoCrt()` in
`gi.js` closes that with `g_setenv()`. The same defect applies to `FONTCONFIG_FILE` itself, which
fontconfig also reads with `getenv()` — so this payload had two reasons to look unread and now
has none.

What remains of this entry: the bundle still ships no `fc-cache.exe`, so the cache stays baked at
build time with no supported way to rebuild it on the target; and the builder's `else` branch
("no etc/fonts … skipping") is still probably unreachable. Neither is a reason to delete the
payload any more.


### `@gjsify/adwaita-fonts` ships desktop TTFs, which is why the web font is opt-in

The package vendors `adwaita-sans-400.ttf` (880 KB) and its italic (910 KB) — the
upstream DESKTOP faces, unsubsetted, not web fonts. That decides the shape of
everything downstream. Inlined as base64 (the only form that survives a
`--app browser` build, which emits one file and no assets):

| | bytes | gzip -9 |
|---|---:|---:|
| `@gjsify/adwaita-web` stylesheet | 190 731 | 25 891 |
| `+` sans 400 | 1 363 795 | 594 177 |
| `+` sans 400 + italic | 2 577 599 | 1 205 683 |

So the faces travel behind an explicit `applyAdwaitaFonts()`
(`@gjsify/adwaita-web/fonts`) rather than in the root entry, and
`status/stylesheet-font-families.json` carries that as the reason the stylesheet
names a family it does not carry. A fontsource-style **woff2, subsetted per
unicode-range**, is 15-40 KB a slice — at which point inlining by default stops
being a question and the ledger entry retires itself.

What blocks it is not code: producing woff2 means committing NEW font binaries
(or adding a font toolchain to the build), and that is a licensing and repository
decision, not a fix. Same call for **Adwaita Mono**, which this package does not
ship at all: `refs/adwaita-fonts/mono/` carries four faces of 1.4-1.5 MB each,
`--monospace-font-family` heads with `'Adwaita Mono'` for the GNOME hosts that
have it installed, and everything reading that token — `.monospace` labels, the
data-grid mono cell, `<adw-source-view>` — falls through to `ui-monospace`
everywhere else.


### `@gjsify/adwaita-storybook` still ships no typeface

The seven DOM showcases now call `applyAdwaitaFonts()`. That was this entry's own
recommendation — they are browser artifacts served to whatever opens them, so they
are exactly the place the size decision belongs, and an app may make it where a
library barrel may not.

Measured on `showcases/dom/canvas2d-fireworks/dist/browser.js`, rebuilt either way:

    before   18 033 980 B   0 @font-face   names "Adwaita Sans" twice
    after    20 421 448 B   2 @font-face   2 data: URIs      (+2 387 468 B, +13.2%)

and in real Firefox against the served artifact, `document.fonts` holds two faces
(`weight: 100 900`, normal + italic) with the normal one `status: "loaded"`. That
reading is host-independent by construction: a system-installed family never
appears in `document.fonts`, which is why the assertion is made there and not
against a computed font — on this Fedora box every one of these pages looked
correct before the change and will look identical after it. The difference is on
macOS, on Windows, and on any Linux that is not GNOME.

What still does not opt in is `@gjsify/adwaita-storybook`, whose whole purpose is
to look like Adwaita. Its entry is a barrel, and 1.18 MB gzip inside a library is
the size decision a consumer should be making, so it wants either a host that
calls the opt-in or a subsetted woff2 (the entry above) before it changes.

NO GATE holds "a showcase that renders Adwaita chrome must call the opt-in", and
that is deliberate: `applyAdwaitaFonts` is a VALUE export precisely so the silent
form cannot be written — an import that is never called does not compile away into
a green build, it simply is not an opt-in. What remains is an omission, which is
the ordinary shape of a missing feature rather than a check that passed while
nothing was verified. A gate for it would cost an incident header in a `scripts`
tree with ten lines of budget left, to catch someone not adding something.

