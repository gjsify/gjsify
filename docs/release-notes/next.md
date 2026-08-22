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

**`gjsify ship` did not work on a real app.** It shipped in 0.39.0, it was exercised by the repo's own tests, and the first two projects that pointed it at their own `package.json` both hit a wall inside the first minute. This release is what those two walls turned out to be, plus the gap that made one of them unfixable from the consumer side.

If you have tried `ship` and given up, try it again.

---

### `ship` could not find its own desktop template

`gjsify ship` died with `ENOENT … templates/app/desktop.tmpl` on **every** project, when run through the GJS entry point.

The template was read with `readFileSync(new URL('../templates/app/desktop.tmpl', import.meta.url))`, and a comment above it stated that the `static-read-inliner` folds it into the bundle. It does not: the inliner's `shouldRewrite` requires the file to sit under `node_modules`, and the CLI bundles its own source. So the read survived into `dist/cli.gjs.mjs`, resolved `../templates/…` against `dist/`, and found nothing — while the Node `lib/` entry, where the relative path happens to be correct, worked fine. That split is why it went unnoticed for three releases: CI and `npm install -g` both take the Node path.

A ten-line skeleton is not worth a file the bundle has to locate. It is a template literal now: nothing to resolve, nothing to package, and the two entry points cannot disagree.

### `ship` can carry typelibs no distribution ships

A GI library that arrives as a gjsify npm prebuild — `Gwebgl` is the one that surfaced this — has no `gir1.2-…` package anywhere, so `deriveDepends` refused the build and there was no honest way past it. Naming a package that does not exist would turn a clear refusal into an install that succeeds and an app that dies at its first import.

`gjsify.ship.bundledTypelibs` takes directories whose `*.typelib` and `*.so` are staged into `lib/<app>/gi/` and put on `GI_TYPELIB_PATH` / `LD_LIBRARY_PATH` by the launcher:

```json
"gjsify": { "ship": { "bundledTypelibs": ["../node_modules/@gjsify/webgl-linux-x64/prebuilds/linux-x64"] } }
```

Both halves are staged from the same directory on purpose: a typelib without its shared library installs and then dies at the first import, which is the failure this feature exists to prevent.

### `ship` can package translations

`gjsify.ship.localeDir` names a directory of compiled catalogues and stages them into
`share/locale/`, keeping the `<lang>/LC_MESSAGES/<domain>.mo` layout that `bindtextdomain` reads.
The launcher then exports `GJSIFY_LOCALE_DIR`, so the app finds them without knowing which prefix
it was installed under — the same division of labour § 3 of ADR 0024 already uses for icons and
schemas.

Translations were simply not part of the payload before: an app with a working gettext setup
packaged fine and showed English on a German desktop.

Discovery refuses a `.po` left in place of a `.mo`, a catalogue outside `<lang>/LC_MESSAGES/`, and
a declared directory holding no catalogue at all. All three are the same failure — a package that
installs its translations and shows none of them — and it is the quietest kind, because an
untranslated UI is indistinguishable from "this app has no German".

One thing found by reading the built `.rpm` rather than the config: `dist/locale/` sits beside the
bundle, so the wholesale bundle staging shipped every catalogue a second time under
`lib/<binary>/locale/`. The declared locale tree now drops out of that staging.

### Two smaller things `ship` got wrong

- **`Gda-6.0` had no entry in the typelib table**, so any app touching libgda was refused with an accurate but unhelpful message. It maps to `gir1.2-gda-6.0` / `libgda` now.
- **`ship.description` as a plain string threw.** The field was documented as accepting either a string or an array of paragraphs, and only the array worked.

### New package: `@gjsify/gtk-host`

A framework-agnostic GTK4/Adwaita **element model** — the layer a UI-framework renderer binds to instead of talking to GTK directly. Tier 3 (experimental), GJS-only, with a conformance suite a renderer can run against itself. See ADR 0027.

### Elsewhere

`@gjsify/devtools` grew `FindWidget` and `SendKey`, so a headless rig can locate a widget by type and CSS class and deliver a real key press to it — a screenshot proves a widget was drawn, never that pressing it does anything.
