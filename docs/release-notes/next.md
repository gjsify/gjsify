<!--
THE PROSE PREAMBLE FOR THE NEXT RELEASE.

`scripts/check-changelog-references.mjs --release-notes <version>` publishes this
file ABOVE the generated changelog section in the GitHub release body. Write here
in the PR that lands the change, while you still remember why it mattered — the
generated section already says what changed.

  · Prose is OPTIONAL. No prose costs a warning in the cut's job summary and
    nothing else; the body is then the changelog section alone.
  · It counts only if git says this file changed since the last tag, so the
    previous release's text can never reappear under a new version. There is no
    version to write down and nothing to reset by hand: after a release this file
    is stale by definition, and the next prose is simply the next edit.
    So REPLACE what you find here, do not append to it — right after a release
    this file still holds the text that shipped with it, and the tag is where
    that copy lives (`git show v0.28.0:docs/release-notes/next.md`).
  · It goes through the same broken-reference detector as CHANGELOG.md, so a
    fabricated issue or repository link fails the cut. Write `#123` for a real
    issue in this repo; put anything `#`-shaped that is NOT a reference in
    backticks (`PKCS#7`), and the same for npm scopes and at-rules (`@girs`,
    `@font-face`) so they are not read as GitHub accounts.
  · No `## [x.y.z]` heading — the preamble sits above the section, not beside it.

Everything below the last comment is published verbatim. Delete this comment or
leave it; comments are stripped either way, and a file holding only comments
counts as no prose.

A worked example is the v0.28.0 release body:
https://github.com/gjsify/gjsify/releases/tag/v0.28.0
-->

## Highlights

- **Blueprint is parsed in this repository.** `blueprint-compiler` stops being a build
  dependency and becomes the oracle a parser is measured against — 25 of 36 corpus files
  byte-equal, the other 11 diverging under exactly one named cause (#1632, #1635).
- **Effect 4 runs on GJS, unmodified**, and `@gjsify/effect-platform` gives it GNOME:
  `effect/FileSystem` on `Gio.File`, `effect/Path` on GLib, GObject lifetimes bound to
  Effect `Scope`s (#1590).
- **The first musl prebuilds ship.** `linux-x64-musl` and `linux-arm64-musl` are declared
  and published, ending a silent fallback that left the CSS bridge missing on musl hosts
  (#1602, #1607, #1613).
- **A runtime bundle declares what it can decode** — every format, the element behind it,
  and the reason for each gap — and win32 gained Ogg/Vorbis. `initFonts()` now reports
  family NAMES, the one thing a caller can act on (#1629, #1633).
- **One authored widget tree, built by two renderers.** GTK and the browser are held to the
  same conformance rows, so a red test names the renderer rather than the assertion (#1627).
- **A `Gtk.Root` appended to a box no longer aborts the process.** It is presented as its own
  window, and a class that cannot be a child is refused at the insert with a catchable error
  naming the tag (#1628).
- **A macOS bundle reached past itself for libsoup** and ended up with two GObject type
  systems in one process. The shipped library is now the one it finds (#1634).
- **The NativeScript vocabulary finishes converging on GJS spellings** — `Gtk.Box`,
  `Gtk.Label`, methods and signals as GJS writes them, and a look is a class list
  (#1615, #1623, #1575).

---

## What this release is about

**Two languages the repository stopped outsourcing, and one it finished converging.**
Blueprint is now read here rather than shelled out to, Effect runs on GJS without a patch,
and the Adwaita vocabulary's last NativeScript names move to the ones GTK and libadwaita
already use. Around those: the first musl prebuilds, runtime bundles that state their own
audio and font contracts, and a set of instruments that used to report nothing.

---

### Blueprint is parsed in this repository

`blueprint-compiler` was a build dependency — a Python program, on `PATH`, standing between
a `.blp` file and the UI it describes. ADR 0053 demotes it to an **oracle**: it stays
authoritative for the build while an in-repo parser runs beside it and reports every byte it
gets wrong, and it becomes authoritative only when that report is empty.

The corpus came first (#1632), before a line of parser existed, because a harness with
nothing to compare against reports green while proving nothing. It holds 25 one-rule `.blp`
files with the XML the reference compiler produces from each, the 11 `.blp` this repo already
builds — listed by path and read from where they live, so no copy can drift and keep passing
— and a hand-written `SharedNode` tree for all 36, with its 119 losses declared at the seam.

Then the parser, the emitter and the projection (#1635): `.blp` → AST → GtkBuilder XML, and a
second, lossy exit to `SharedNode` that never sees the first. **25 of the 36 files come out
byte-equal today, and the other 11 diverge under exactly one cause across 23 named lines** —
an enum member reaching the XML by name where GTK writes its number. One problem eleven times
is a parser waiting on a fact it may not invent; eleven unrelated problems would be a parser
that is unfinished.

What tolerates those 11 is data, never an `if` in the emitter — an exemption in a code path is
invisible to every reader of the output and outlives its cause. And it names the LINES it
excuses, because an entry that named only a file excused everything that file emitted: measured
on this corpus, an emitter taught to write `<property name="THIS-IS-NOT-A-PROPERTY">` for every
`hscrollbar-policy` passed the gate with the headline unchanged. The ledger fails both ways, so
it cannot only grow: a divergence that is not listed fails, and a listed divergence that no
longer happens fails too.

### Effect 4 runs on GJS, unmodified

[Effect](https://effect.website) is a TypeScript library for programs that have to survive
failure, concurrency and resource cleanup — typed error channels, fibers you can actually
cancel, scopes that release what they acquired. It now runs on GJS with **no change to any
`@gjsify/*` package**, which was the open question: 64 cases green on Node, 85 on GJS (#1590).
Bare GJS gives Effect `WeakRef` and `FinalizationRegistry` and nothing else it asks for;
`structuredClone`, `MessageChannel`, `AbortController`, `queueMicrotask`, `performance`,
`Symbol.dispose` and `process` all come from gjsify, and they all hold.

`@gjsify/effect-platform` is the GNOME half — `effect/FileSystem` on `Gio.File`, `effect/Path`
on GLib, `GError` mapped onto Effect's normalized platform errors, and a `/gtk` subpath that
binds GObject lifetimes to Effect `Scope`s. It follows the shape of Effect's own ecosystem,
one platform package per host beside `@effect/platform-node` and friends, and is deliberately
**not** a fourth renderer: Effect has no components, no templates and no reconciliation, and
this repo already answers the rendering question three times over. Effect is pinned at
`4.0.0-rc.112` exactly, because `^` does not do what you expect across prerelease tags. The
documentation files this under Experiments — it runs, it is not yet a recommendation.

### The first musl prebuilds

`@gjsify/lightningcss-native` and `@gjsify/sab-native` now declare and ship `linux-x64-musl`
and `linux-arm64-musl` (#1607). The musl leg had been building and uploading these for a
while and `commit-prebuilds` dropped them on purpose, because committing an undeclared target
is exactly what the `prebuild-artifacts` rule fails on. So the build was proven and nothing
ever shipped, and a musl host silently resolved the glibc sibling instead.

What that cost, measured on a OnePlus 6 running postmarketOS with musl 1.2.6: nine of ten
prebuilds load anyway, because musl's loader aliases `libc.so.6` to itself. The tenth does
not —

```
Error relocating …/libgjsify_lightningcss.so: gnu_get_libc_version: symbol not found
```

— and the CSS bridge is then simply absent from the next build, which rolldown reports as
`Could not load src/application.css`. Nothing in that chain names libc. A host that still
falls back to a glibc prebuild is now warned about by name (#1602), and the libc is measured
rather than assumed, so musl and glibc are two different answers instead of one (#1613).

### The NativeScript port converges the rest of the way

ADR 0034 converged widget names and has been counting down property names. This release takes
the axes no ledger had touched.

**Methods and signals, as GJS spells them** (#1615). Across the 40 gallery blocks that carry
both a `gjs` and a `nativescript` pane, the two surfaces shared exactly three method names:
`add`, `present`, `push`. And the spelling is not a matter of taste — on the real GJS,
`Gtk.Button.prototype.add_css_class` is a function and `addCssClass` is `undefined`. GJS
installs snake_case and nothing else, so a method converges to the typelib's spelling or it
does not converge at all.

**A look is a class list** (#1575). `.suggested-action`, `.destructive-action`, `.pill`, and
`.flat` on a header bar are not properties in GTK; they are style classes, and a widget carries
a list of them in `GtkWidget:css-classes`. The port had spelled them as properties, so the one
construction that GTK makes composable was the one the port could not compose.

**A page is chosen, not counted** (#1573). No portable selection value had to be invented here
— the value already exists on every surface. What diverged was which of GTK's three selection
shapes each port had picked, per widget, against what GTK itself chooses.

**`Gtk.Box`, `Gtk.Label`, and a button with an icon** (#1623) close the last gallery blocks
where a `@nativescript/core` layout stood in for a widget the port did not ship. A widget can
now be built through a construct-props object like every other surface spells it (#1579), a
bottom sheet is simply `open` (#1574), and an avatar falls back (#1578).

**And the icons travel with the app** (#1620, #1624). Repo-wide before this change,
`add_resource_path` and `add_search_path` had zero hits outside `node_modules`: every gjsify
GTK app drew whatever icon theme the host happened to have, and nothing in the tree noticed.
`@gjsify/adwaita-app` now bundles the Adwaita subset into the app's own GResource and
registers it, because you cannot assume the environment your app lands in ships that set.
### One authored widget tree, built by two renderers

The gallery has widget trees that are written once and drawn by more than one renderer. Until
now two generators compared them as DATA — the same tags, the same properties — which says
nothing about the two renderers BEHAVING the same on them. They are now BUILT: the GTK host
turns each tree into real libadwaita widgets under a diagnostics gate, `@gjsify/adwaita-web`
turns the same tree into custom elements in Firefox, and both are held to the
`@gjsify/adwaita-core` conformance rows the tree's own authored values instantiate. Neither
driver writes an expected value of its own, so a red test names the renderer rather than the
assertion.

It found what a per-widget suite structurally cannot. Breaking the DECLARATIVE path of
`<adw-switch-row>` — the attribute read that runs when an element is built from markup, as
opposed to the property set the existing suite drives — failed exactly the two tree tests
and left every other browser test in the package green.

Two facts came out of the GTK side and are worth knowing if you write Adwaita for more than
one surface. A `GParamSpec` default is not a constructed default: `AdwBanner:use-markup`
declares `TRUE` and a freshly constructed banner answers `FALSE`, so the same authored banner
is markup-on in the browser and markup-off in GTK. And `Adw.ShortcutLabel` draws TRANSLATED
keycaps, so a shortcut rendering can only be asserted where nothing translates.

### A runtime bundle now says what it can play, and which font name to ask for

Two things an application could only find out by shipping and waiting.

**`@gjsify/gtk-runtime-<os>-<arch>` declares its own audio contract.** These bundles carry
GStreamer, so they decide what your application can decode — and that answer differs per
platform. Measured on the published 0.48.0 tarballs: the two darwin bundles carry 24 plugins,
the win32 one carries 21, and the three that are missing are the MP3, Ogg/Vorbis and FLAC
decoders. Nothing said so: the bundle's own manifest recorded a plugin COUNT, and a count
cannot be wrong about which. Each package now carries
`package.json#gjsify.mediaCapabilities` — every format it decodes, with the plugin file behind
it and the element that decodes it, and every format it does not, with the reason. So
`npm view @gjsify/gtk-runtime-win32-x64` answers the question that previously needed a Windows
machine. A conformance rule holds the declaration against the shipped plugin files, and — with
no payload in reach at all — against the other bundles' claims, so a format one target plays
and another silently does not is a red build rather than a difference nobody wrote down.

**And asking the question of three artifacts at once answered part of it.** The win32 payload
was #1626, and the three missing decoders turned out not to be one fact. `libvorbis` is a
project the Windows GTK build system already has and nobody had ever named, so the Windows
GStreamer build now names it and `@gjsify/gtk-runtime-win32-x64` claims Ogg/Vorbis instead of
excusing it — a container it already demuxed, finally leading somewhere. MP3 and FLAC stay
declared gaps, and their reason is now specific rather than general: gvsbuild defines no
project for libmpg123 or libFLAC, so the elements that link them cannot be built in that prefix
at all. Neither is a licensing question — libmpg123 is LGPL-2.1 and libFLAC is BSD-3-Clause —
and closing either means a project file upstream. The measurement is in #1626 so nobody has to
take it again.

**`initFonts()` reports family NAMES.** It reported the files it registered, and a caller can
act on none of them: `font-family` takes a family name, the name comes out of the font's naming
table, and which name you get depends on which font stack read it. The same byte-identical
Merriweather face registers as `Merriweather` under fontconfig and `Merriweather 18pt` under
the Windows bundle — and `initFonts()` answered `registered: 5, failed: 0` on both while
Windows rendered Tahoma. The result now carries `families` (what the call added to the map) and,
when you pass `expectedFamilies`, a `matches` entry per name saying whether it resolves, resolves
under an optical-size alias, or is simply not there — warned about on the spot, because Pango
substitutes silently and nothing else ever will.

### A window in a child list is not a smaller version of a dialog in one

`@gjsify/gtk-host` learned last release that an `Adw.Dialog` cannot be a child: appending
one to a box that sits in a window is `g_error()`, which means SIGABRT and a core dump
rather than an exception. The same probe measured the case next door and the result looked
harmless — `box.append(new Gtk.Window())` is exit 0 with nothing logged.

It is the same defect. Afterwards the window's parent is the box and its root is *itself*:
a toplevel with a parent, drawn as a window and simultaneously measured and laid out by a
container. One kind shouts, its neighbour says nothing, and only the shouting one had an
answer.

Both have one now. A `Gtk.Root` is presented as its own window and destroyed on unmount,
declared by the eighteen classes in the table that can present themselves — and the two
arms are told apart by something the libraries state rather than by a list of names:
`adw_dialog_present()` takes a parent, `gtk_window_present()` takes none. That same
question is what the host asks of any widget whose descriptor says nothing at all, so a
class that cannot be a child is now refused at the insert with a catchable error naming
the tag, instead of aborting the process or being taken in silence.

One thing the two kinds do not share is how they come back down. A dialog's forced close is
reversible — present it again and it re-hosts — while destroying a window is final, so
`remove`, which the host documents as a detach a later insert undoes, now takes a window off
screen instead of destroying it. Destroying is what `destroy` is for — and so is every place
the host throws a widget away, including the rollback after a rejected build, which used to
leave a window GTK still held and nothing could reach.

Verifying it needed a shape worth naming: an abort is invisible to the process it kills, so
"this no longer aborts" cannot be asserted where it used to happen. The negative control is
a child process, and what the suite reads is its exit signal.

A macOS bundle could play an audio file it shipped and go silent on a stream. Not a missing
element — the plugin that reads a URL was there and resolved. What was missing was any reason
for it to use the libsoup sitting next to it in the bundle rather than the one Homebrew had
installed, and it used Homebrew's. That library brings its own GLib, so a process that had
already loaded the bundle's ended up with two GObject type systems: from then on a type
registered in one and looked up through the other, which surfaces as an object plainly lacking
a property it obviously has, and as a stream that reports no error and never starts.

The route was one line in the artifact. A GStreamer plugin does not link libsoup; it opens it
at runtime by bare name, and the bundle's copy of the plugin had kept the search path its
Homebrew build was given — pointing straight back into Homebrew. Asking dyld directly settled
what had until then been argued from the file format: it expands a bare name against exactly
that search path, and reaches it before anything else it would try. There was no second route.
Pointing the entry inside the bundle makes the same lookup land on the shipped library.

Why it survived: the builder rewrote every reference an image makes to another library and
never touched its search paths, and the check that verified the result read only the references.
Both now cover both, and a new conformance rule reads the finished payload from any machine —
a Linux workstation can inspect a macOS bundle's load commands without a Mac — refusing an image
that can reach outside the bundle, and equally one left with a dependency it can no longer
resolve.

### Also in this release

The website's Adwaita gallery grew three windows, one language per window (#1622), glosses
its fence attributes from the GIR rather than from prose (#1621), and its two panes are now
measured against each other rather than asserted to match (#1614). Effect moved under a new
Experiments rubric (#1608), and the documentation as a whole reads for a reader rather than
for a reviewer (#1619, #1625).

On the GTK side: `Gtk.AspectFrame` is curated, because a ratio needs a widget that holds one
(#1598); a flow box keeps its per-line cap at its child count (#1596); an enum value is read
rather than counted (#1585); and a horizontal `ScrollView` answers its height with a layout
manager (#1599). A React Native tab layout can contribute a persistent bottom bar (#1617),
and the switcher moves there when the window is narrow (#1597). A finger is a pointer too
(#1591).

In the toolchain: `@gjsify/rolldown-plugin-gjsify` never inlines a read of the host (#1604)
and grew its `gi://` arms for the browser and NativeScript (#1580); the npm client retries
past a registry blip, body included (#1603); the ship oracle stops blaming the artifact for
a fault in its own reader (#1605); and `@gjsify/devtools` says which absence a declined
screenshot was (#1611), over a tree that reports what it was given (#1589).
