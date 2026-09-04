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

**A real application was ported onto the React Native layer, on macOS and Windows, and it
found in a fortnight what the suites had not found in months.** Five of the twelve changes
here come straight out of that port; three more finish a unification the widget vocabulary
started; and the rest are the same shape the last release was about — something that
reported success while doing nothing.

---

### The React Native layer now carries a real screen

Four defects, each of which made a screen unusable rather than imperfect, and none of which
any suite reported.

A parent decides whether it becomes a `Gtk.Overlay` from its children's descriptors, and two
independent things hid an absolutely positioned child from it: a Fragment, which
`Children.toArray` does not descend into, and an `Animated.View`, whose animated style made
the read THROW into a `catch` that answered "not positioned". Both then blamed the parent for
something the parent could not see.

A routed window drew one set of window controls per navigator level — three stacked title
bars with three close buttons on a tab route. The invariant is one control SET per side, not
one header bar, because a split view legitimately shows two.

`registerRootComponent` built an `Adw.Application` and kept it, so an application could not
reach its own — which is also what made `@gjsify/devtools` unreachable, and with it the only
way to drive a running window from outside the process.

And every accessibility prop was refused, on the grounds that GTK carries accessibility
through an imperative call. The fact is right; the conclusion was not. It is a route family
now: 40 React Native role names, 33 mapped, 7 refused BY NAME with advice.

### Three of those were introduced by the fix, and found by reviewing it

Worth saying plainly, because it is the useful part. The header-bar change left a window with
**no way to close, move or maximise it** when a headerless screen sat on top — named by its own
new guard, reached by no vector. The Fragment fix composed child keys without a separator, so
two ordinary authored trees could collide on one key and React would then swap their widgets
on a reorder, with the duplicate-key warning going to a console a GJS process does not have.
The font-family serialiser opened a string at every quote, so `Marion's Hand, sans-serif`
went out as one quoted family and the fallback vanished — GTK accepts that.

Each was found by running the composition, not by reading the diff.

### A font family GTK refuses, and it is not the one you would guess

`font-family: Source Sans 3` makes GTK reject the whole rule. A bare sequence of identifiers
is legal CSS and GTK implements it, so `Noto Sans` and `Fira Code` were never the problem —
what fails is a component that is not a valid identifier, overwhelmingly one starting with a
digit. `Source Sans 3` fails on the `3`.

The serialiser follows CSSOM instead of guessing: quote every family NAME, leave every KEYWORD
bare, and it never consults the identifier grammar at all. A function call passes through
verbatim, because quoting `var(--font-sans)` would emit a family literally called that — a
silent wrong font rather than a loud one.

### One portable menu model, and two surfaces lose their flat classes

The widget vocabulary was unified a release ago; the DATA was not. A menu was a `Gio.Menu` on
GJS, a string array on NativeScript that could carry no action, section or submenu, and
nothing at all in the declarative dialects. ADR 0042 mirrors `GMenuModel` across all of them.

ADR 0034 clause 2 reaches its last two surfaces: 28 flat widget classes gone from
`@gjsify/adwaita-react-native`'s three barrels and 43 from `@gjsify/adwaita-nativescript`,
reachable through the `Adw` and `Gtk` namespaces only. Both removals were verified in both
directions against the published 0.47.0 tarball — the removed names and the namespace members
are the same set, member for member.

**These three are breaking.** Import through the namespace, and build menus from the portable
model.

### And three more that were green while doing nothing

`set_property(name, null)` guesses `gpointer`: GObject logs a CRITICAL, keeps the OLD value,
and exits 0 — so removing a nullable property from a mounted widget did nothing at all.

`xgettextPlugin` could destroy every catalog in a project and exit 0, because a sources
pattern that matched nothing left its whole string group out of the POT and the update then
pruned every language against it. Two guards now: every pattern must match, and a merge that
would lose more than a configured share of the largest catalog is refused.

`<adw-combo-row>` parsed its items once and published no accessor, so setting `.items` after
connect did nothing — while the three other widgets over the same state could all be updated.
It comes with a check for the class rather than for the case.
