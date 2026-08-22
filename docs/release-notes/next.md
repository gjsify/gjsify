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

**Two things an app could not do, both of which fail silently when you get them wrong.**

---

### An app can find its own translations

`gjsify ship` learned to package compiled catalogues in 0.42.0, and its launcher exports
`GJSIFY_LOCALE_DIR` because only the launcher knows whether the payload became `/usr` in a `.deb`, a
`--prefix` tree, or `/app` in a Flatpak. Nothing read that variable. Every app was expected to write
the same four calls, and the two that tried had no translation at all.

`initLocale(domain)` in `@gjsify/adwaita-app` is the reading half:

```ts
import { initLocale } from '@gjsify/adwaita-app';

const _ = initLocale('bauplaner');
label.set_label(_('Assembly'));
status.set_label(_.plural('%d layer', '%d layers', n));
```

Two details are the reason this is shared code and not a snippet:

- **`textdomain()` is set, not only `dgettext()` used.** GtkBuilder resolves every
  `translatable="yes"` string — so everything from a `.blp` file — in the DEFAULT domain, inside GTK,
  where the app never gets to pass one. Binding only through `dgettext` translates the TypeScript
  strings and leaves the Blueprint ones in the source language, which reads as a half-finished
  translation rather than as a missing call.
- **An empty `GJSIFY_LOCALE_DIR` counts as unset.** The launcher exports it only when it staged
  catalogues, but a wrapper that sets it unconditionally hands over `''` — and
  `bindtextdomain(domain, '')` binds to the *current directory*, where the lookup finds nothing and
  reports it exactly as "this app has no German".

Measured against a real compiled catalogue, because "the calls did not throw" is not evidence that a
lookup resolves: `de_DE.utf8` returns the translation and picks the right plural form, `en_US.utf8`
returns the msgids (English needs no catalogue of its own), and an unset variable falls back to
`/usr/share/locale`.

### A package can define a file type, not just claim to open one

`MimeType=` in a desktop entry says "I open this type". It does not say the type EXISTS. For
`text/plain` that never matters — the distribution defines it. For a type of your own it decides
whether the feature works, and nothing tells you when it does not: no component knows what a
`.bauplan` file is, so the file manager never assigns the type, `MimeType=` matches nothing, and a
double-click does nothing at all. No error, no log line. It is indistinguishable from the app not
being installed.

`gjsify.ship.mimeTypes` defines types as a shared-mime-info document staged into
`share/mime/packages/<app-id>.xml`, and the package refreshes the MIME cache on install — detection
reads the compiled cache under `share/mime`, not the packages directory, so without that refresh the
document installs and the type still does not exist.

```json
"gjsify": {
  "ship": {
    "mimeTypes": [
      { "type": "application/x-bauplan", "comment": "Bauplaner project", "globs": ["*.bauplan"] }
    ]
  }
}
```

Declared types are folded into `provides.mimetypes` automatically, so the desktop entry and the
metainfo need no knowledge of the new field — they already render `MimeType=` (with the `%f` field
code) and `<mediatype>` from that one list. Keeping the two independent would make "defined but not
handled" reachable by omission, and that state installs cleanly and does nothing.

Four declarations are refused outright, each of which would otherwise install and never resolve: a
malformed type name (`update-mime-database` ignores it), a glob with no wildcard (`bauplan` matches
only a file called exactly that), a type with neither a glob nor a parent type (nothing can ever
match it), and a duplicate definition (which comment wins would depend on document order). See
ADR 0024 § A11.
