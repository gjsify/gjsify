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

## Upgrading

`node:sqlite` now RAISES where it used to answer "no rows".

`StatementSync.get()` wrapped its whole body in `catch { return undefined }` and `all()` in
`catch { return [] }`, so on GJS every error libgda reported at execution became a wrong answer
no consumer could tell from an empty table — `SELECT * FROM does_not_exist` came back as
`undefined`, and kept doing so for the rest of the process's life. Node raises there. Now so do we,
as a `SqliteError` carrying SQLite's own text and `code === 'ERR_SQLITE_ERROR'`.

This is a behaviour change, and it can surface as a NEW exception in code that has been quietly
reading nothing back. That is the point: the exception was always the truth, and the previous
answer was a wrong one wearing the shape of an empty result. If a query in your code starts
throwing after this upgrade, it has been returning nothing for a reason since the day it was
written.

`run()` changed shape too, in the same direction. It used to leak libgda's raw `GLib.Error`, whose
`code` is a numeric GError enum — nothing a `node:sqlite` consumer can branch on. It now raises the
same `SqliteError` the other two do. And `exec()`/`prepare()` stopped reporting
`"GLib.Error gda_server_provider_error: no such table: t"` where Node reports `"no such table: t"`.
