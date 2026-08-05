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
