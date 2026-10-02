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

Highlights of 0.54.0:

- **Typed Blueprint imports.** A `.blp` import now exports its ids as typed names,
  derived by our own Blueprint parser: `const { download_button } = build()` needs no
  `Gtk.Builder` and no `as` casts, and a template gets `GTypeName`, `InternalChildren` and
  `type Children`. `gjsify blueprint types` writes the sidecars and gates their drift
  (ADR 0088, #1984). The showcases and the website snippets use it (#1988, #1987).
- **Two new packages.** `@gjsify/mcp` is a reusable MCP server lifecycle with a
  default-deny read-only gate (#1946), and `@gjsify/oxlint-plugin-gjsify` is now on npm,
  switched on in the Blueprint templates (#1953).
- **Optional GI namespaces.** `import Ns from 'gi://Ns?version=X&optional'` resolves to
  `undefined` with one warning instead of failing at load, so an app can degrade when a
  typelib is missing (ADR 0087, #1947).
- **`gjsify devtools`.** A scriptable client for the app control plane, e.g. a screenshot
  straight to a file, also usable as a library (#1949).
- **Node-compatible timers.** `setTimeout` / `setInterval` return handles with `ref()`,
  `unref()` and `hasRef()` on GJS, so shared code needs no casts (#1950).
- **SQLite on a Mac without Homebrew.** The darwin GTK runtime ships libgda, so
  `node:sqlite` works out of the box (#1942).

Fixes worth knowing: `@gjsify/napi` installs on a cold tree again (#1983),
`tty.ReadStream#setRawMode` restores the terminal on exit (#1940), `child_process` emits
`close` only after piped stdio has ended (#1990), `Readable#addListener` behaves like `on`
(#1958), `gjsify webext` gains an Opera target (#1936), and a macOS `.app` is signed for
real (#1929).

## Upgrading

Every `@gjsify/*` package moves together (ADR 0008): compatibility is guaranteed
only within one release, so upgrade the whole set with `gjsify upgrade --latest
--filter @gjsify`, or repair drift with `gjsify upgrade --align`.
