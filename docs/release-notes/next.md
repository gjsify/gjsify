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

## Ed25519 and X25519 in `node:crypto` and WebCrypto

GJS now has the two Curve25519 algorithms that the Signal, WhatsApp and OMEMO protocols build
on. `crypto.subtle` handles `Ed25519` (generate, import, export as raw, spki, pkcs8 or jwk, sign,
verify) and `X25519` (generate, import, export, deriveBits, deriveKey), as browsers ship them.
`node:crypto` adds `generateKeyPair`/`generateKeyPairSync` for `'ed25519'` and `'x25519'`, the
one-shot `crypto.sign`/`crypto.verify` (including Ed25519ctx through `{ key, context }`),
`crypto.diffieHellman({ privateKey, publicKey })`, and KeyObject import and export for both key
types in PEM, DER and JWK.

The curve arithmetic comes from `@noble/curves`, an audited pure-JS library. Ed25519
verification follows OpenSSL rather than the library's default: small-order keys and `R` values
are rejected and the equation is cofactorless. That way GJS gives the same answer as Node on the
WPT small-order vectors. The tests check the RFC 8032 and RFC 7748 vectors and all 518 Wycheproof
X25519 cases. They run on both GJS and Node.

A library that picks its code path by checking `typeof crypto.diffieHellman === 'function'` now
takes the `node:crypto` path on GJS. npm `libsignal`, used by Baileys, is one of them.
