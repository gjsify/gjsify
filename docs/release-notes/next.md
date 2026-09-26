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

## `gjsify install` installs required peer dependencies

npm 7 and later install every `peerDependencies` entry that `peerDependenciesMeta` does not
mark `optional`. The native install backend ignored `peerDependencies` completely, so an install
could exit 0 and still leave a package unable to run. The case that exposed it: a project with
`wxt` as a devDependency got no `vite`, and `wxt prepare` then failed with "Builder not found".

Required peers are now installed beside the package that declares them. If the tree already
holds a version in range, that copy is reused. If the slot holds a version outside the range,
the install prints a warning and keeps going, which is what npm does outside strict mode.
Optional peers are still skipped, the same as npm, so `@gjsify/cli` does not pull in its GJS
engine packages.

`gjsify-lock.json` now records each package's peer maps and a `peersResolved` flag. A lockfile
written by an older CLI has no flag, so the first plain `gjsify install` resolves it again.
Pinned versions are kept, and any missing peers are added. `--immutable` still installs such a
file exactly as it is, so run one plain install and commit the updated lockfile.

## `node:sqlite` connections no longer wear out

On GJS, every statement a `DatabaseSync` connection executed left libgda objects registered on
it: a cached prepared statement for each execution, a hidden `SELECT` that libgda ran after
every `INSERT`, and the data model of every read until the garbage collector reached it. Each of
those holds a weak reference to the SQLite provider, and GLib allows 65,535 of them per object.
A connection that crossed the limit logged "Too many GWeakRef registered" and then answered
reads wrongly without throwing. A mail sync of about 5,000 messages was enough, because each
`run()` cost four references.

Each execution now releases what it created before it returns, so a connection stays usable no
matter how long it lives. A read that libgda can no longer type throws instead of returning rows.

## `node:sqlite` reads 64-bit integers

libgda types an `INTEGER` column, and an expression whose first value is an integer, as a
32-bit `gint`. Any value past 2,147,483,647 then failed the whole read, and on 0.49.0 the
failure was reported as an empty result. A millisecond timestamp was enough. Such columns
are now read as their exact decimal digits and converted as `node:sqlite` does. A value that
fits `Number.MAX_SAFE_INTEGER` becomes a Number, `readBigInts` returns a BigInt, and anything
larger throws `ERR_OUT_OF_RANGE`. `lastInsertRowid` also handles rowids past 2^31.

## `https.request` honours `ca` and the other TLS options

On GJS, `https.request` never passed its TLS options to libsoup. A server whose certificate
chains to a private root failed even with that root passed as `ca`, and `rejectUnauthorized`,
`servername`, `checkServerIdentity`, `cert`/`key` and an `https.Agent`'s options were ignored
as well. Now `ca` (a string, a Buffer or an array of them) replaces the system trust store, as
it does in Node. A rejected certificate reports Node's error code, for example
`DEPTH_ZERO_SELF_SIGNED_CERT`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE` or
`ERR_TLS_CERT_ALTNAME_INVALID`. The TLS options of an `https.Agent` override the request's,
the same as in Node.
