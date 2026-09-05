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

## What this release is about

**One vocabulary across the renderers, and the values that made it possible.** If you write
Adwaita UI with gjsify — in GJS, in the browser, in NativeScript, in React Native — the
widget you name and the property you set are converging on the names GTK and libadwaita
already use. This release moves the last of the widget names and three of the property
names, and the property moves needed something the surfaces did not have: a portable form
of the GObject value the property holds.

Alongside that, React Native on GTK grew the parts an application actually needs — its own
`Adw.Application`, accessibility, dialogs, deep links.

---

### The widget names are one set now

Five widgets in `@gjsify/adwaita-nativescript` wore an `Adw` prefix over a GTK type. The
last one moves here: `AdwIcon` is `GtkImage`, because libadwaita ships no icon type at all
— a non-interactive image rendering a symbolic is a `Gtk.Image` with an icon name.

The 43 flat widget classes are gone from that package's root and from
`@gjsify/adwaita-react-native`'s. Reach a widget through `Adw.<Widget>` / `Gtk.<Widget>`
from the package root, or through the `./adw` and `./gtk` subpaths; in XML,
`<adw:PreferencesGroup>` replaces the bare class name.

**One name moved where you might not look for it.** `registerAdwaitaElements()` — the call
that hands the widgets to the `registerElement` global in `@nativescript/angular` and
`nativescript-vue` — registers under the class name, because that dialect has one flat
namespace and no prefix. `<AdwIcon>` in an Angular or Vue template is therefore now
`<GtkImage>`. Plain XML apps resolve through their own `xmlns` barrel and are unaffected.

### Three GObject values you can now write as data

A property whose value is a GObject had no portable form, so each surface invented one. Three
of them now have a shared value in `@gjsify/adwaita-core`, and the property that holds it
carries its GIR name on every surface:

| the value | the property | what it replaced |
|---|---|---|
| a menu model, mirroring `GMenuModel` | `menuModel` | a plain string array that could carry no action, section or submenu — and nothing at all in the declarative dialects |
| a list model, plus `GListModel`'s own `items-changed` | `model` | `options` and `items` |
| an adjustment — `Gtk.Adjustment`'s six numbers | `adjustment` | `min` / `max` / `step`, and `lower` / `upper` / `stepIncrement` |

Each is deliberately scoped to the widgets GTK gives that property. A list `model` exists on
five GTK widget interfaces; for the widgets whose collection is built by
`adw_sidebar_append()` there is no such property, and inventing one would put a GTK word on
a value GTK does not have.

In markup these arrive as JSON:

```html
<adw-spin-row title="Font size" value="16" adjustment='{"lower":0,"upper":100}'></adw-spin-row>
```

The string shorthands did not disappear where GTK has one: a menu still accepts the string
array it always did, widened into the model's input rather than surviving beside it.

**Defects that came out with the convergence**, each of which had been green:

- Both browser selectors rebuilt every option node on a model assignment. They splice now —
  and the rebuild had been hiding a click handler that closed over the index it was built at.
- Writing a spin row's three bounds one at a time passed through a momentarily INVERTED
  range, so React Native reported an intermediate value GTK never produced.
- A non-finite write to a spin row's value was coerced to 0 before clamping, which is
  harmless only while 0 is inside the range. On `[-5, -1]` it produced the MAXIMUM.
- Setting `model = ['a', 'b']` on NativeScript stored raw strings, so every label read back
  `undefined`.

### React Native on GTK: the application, and what it can reach

`registerRootComponent` built an `Adw.Application` and kept it, so an application on this
layer could not reach its own — and `@gjsify/devtools` needs one to install onto, which made
the layer's only out-of-process instrument unreachable. It hands the application back now.

Accessibility props were refused wholesale, on a true premise and a wrong conclusion: GTK
carries accessibility through an imperative `update_property()` call, so there is nothing to
set as data — but an imperative call is a route like any other. 40 React Native role names,
33 mapped to GTK nicks, 7 refused BY NAME with advice, none unanswered.

`Modal` works, over a new portal seam in `@gjsify/gtk-host`: a node can now be placed
AGAINST its parent rather than into it. `box.append(dialog)` is a `g_error()` — SIGABRT, a
core dump — but only once the box is rooted in a window, which is why a detached tree took
the same call in silence.

Deep links stay on their own tab; a route's cache is per-route; and one routed window gets
one header bar.

### Instruments that reported nothing

A recurring theme, and this release closes another set of them:

- `gjsify ship` staged a payload the target's interpreter could not load — a `gi://` import
  for Node, a bare GJS built-in — and said nothing until the application failed to start.
- `@gjsify/unit` counted assertions where it said tests, and could report "3 of 2 tests
  failed". Test hooks registered in a nested `describe` leaked outward, and `afterEach` did
  not run for a failing test.
- A GStreamer plugin seed matched nothing on the shipping platform, so an audio format's
  decoder was simply absent from the bundle.
- `gjsify foreach --exec -- <cmd> 9` dropped every numeric argument after the separator.
- On Windows, `C:\images\logo.png` was refused as a URI: a drive letter satisfies RFC 3986's
  scheme grammar exactly, and the only OS with drive letters is the one that failed.

### Also in this release

`@gjsify/vite-plugin-gettext` refuses to gut a catalog rather than writing an empty one;
`@gjsify/gtk-host` quotes a font family GTK would otherwise refuse, and clears a nullable
property for real; and the `.deb` package carries a changelog.
