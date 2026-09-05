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

**One vocabulary across the renderers.** If you write Adwaita UI with gjsify — in GJS, in
the browser, in NativeScript — the widget you name and the property you set are converging
on the names GTK and libadwaita already use, and this release moves several of them. The
renames are deliberate and there is no alias behind them, so the migration below is the
whole of it.

---

### The names your markup uses, and what they are now

`@gjsify/adwaita-nativescript` no longer exports the 43 flat widget classes or the
`./widgets` subpath. Reach a widget through `Adw.<Widget>` / `Gtk.<Widget>` from the package
root, or through the `./adw` and `./gtk` subpaths; in XML, `<adw:PreferencesGroup>` replaces
the bare class name.

Five widgets there wore an `Adw` prefix over a GTK type. Four moved last release; the fifth
moves now — `AdwIcon` is `GtkImage`, because libadwaita ships no icon type at all and a
non-interactive image rendering a symbolic is a `Gtk.Image` with an icon name. The namespace
member did not change (`Gtk.Image`, as before), and neither did the CSS class it emits
(`adw-icon`): a widget is named after the library owning its GType, a style class after the
design system whose stylesheet carries it.

**One name did move where you might not look for it.** `registerAdwaitaElements()` — the
call that hands the widgets to the `registerElement` global in `@nativescript/angular` and
`nativescript-vue` — registers under the class name, because that dialect has one flat
namespace and no prefix. `<AdwIcon>` in an Angular or Vue template is therefore now
`<GtkImage>`. Plain XML apps resolve through their own `xmlns` barrel and are unaffected.

### Lists and menus carry a model, not an array

`options` on `Adw.ComboRow` and `Gtk.DropDown` is `model`, on both the browser elements
(property and attribute) and the NativeScript widgets; `ComboState.setOptions`/`options` are
`setModel`/`model`. A menu is a portable menu model mirroring `GMenuModel` rather than a
string array that could carry no action, section or submenu — the string array still works
and widened into the model's input, so the shorthand became portable instead of surviving as
a second spelling.

Both browser selectors now splice rather than rebuild, which brought out a latent defect
worth knowing about if you had worked around it: each drop-down row's click handler closed
over the index it was built at, and only a full rebuild refreshed it.
