# @gjsify/node-runtime-darwin-x64

The **Node.js interpreter for macOS on Intel**, packaged so an application built with
gjsify can carry its own. Three files, nothing else:

```
bin/node            the interpreter (124,285,824 B), verbatim from the pinned Node 24 LTS release
bin/LICENSE         Node's own LICENSE, verbatim from that same release
bin/manifest.json   which release, which URL, which digests
```

Platform-gated (`os: ["darwin"]`, `cpu: ["x64"]`), tier 3. On any other
platform npm skips it. The `bin/` payload is **not committed** — it is fetched and
digest-checked on a CI runner by
[`../scripts/fetch-node-runtime.mjs`](../scripts/fetch-node-runtime.mjs) and reaches
consumers through the published tarball.

## Who installs it

**Nobody adds it to `dependencies`.** It follows the same rule as
`@gjsify/gtk-runtime-*` (see [docs/publishing.md](../../../docs/publishing.md)):
resolved **by name** by whoever *ships* the application, with no
`optionalDependencies` edge anywhere. Making a runtime bundle a dependency of the
library that uses it was [#910](https://github.com/gjsify/gjsify/issues/910) — a
from-source addon met a foreign GTK, produced wrong method entries and a 29-minute
timeout, and it was reverted in #920.

So for an app author the answer is: **nothing to add**. `gjsify ship` resolves
`@gjsify/node-runtime-<target>` for the target it is packaging and stages
`bin/node` into the artifact. Overriding it is
`GJSIFY_NODE_RUNTIME=/path/to/bin`.

## Why only three targets, and not Linux

**Linux gets no package.** A `.deb` or `.rpm` declares a dependency on the
distribution's Node instead — `Depends: nodejs (>= 24)` and
`Requires: nodejs(engine) >= 24` — exactly as a `--app gjs` package declares
`gjs`. Every Linux distribution ships a Node; macOS and Windows do not, which is
the whole reason these three exist.

⚠️ The rpm spelling is **not** `nodejs >= 24`. Measured with `dnf repoquery` on
Fedora 44: `nodejs` as a name is provided only by `nodejs22-1:22.23.1`, whose
**Epoch 1** beats the `0:24` that a bare `>= 24` desugars to — so
`--whatprovides 'nodejs >= 24'` answers **nodejs22**. `nodejs(engine)` carries no
epoch and resolves correctly.

## Why `bin/node` and not the whole distribution

The full release drags in npm's bundled `node_modules`, which in the win-x64 zip
alone adds **154 further LICENSE files** — 154 attribution obligations for code
that is not being shipped. An interpreter inside a `.app` or a Windows program
directory needs the binary and the terms it travels under.

Node's own `LICENSE`, verbatim from the release, discharges the whole set in one
file: MIT, Apache-2.0 §4(a)/(b), BSD-3 clause 2, Unicode-3.0, zlib, Artistic-2.0
(npm), BlueOak-1.0.0 (minimatch) and ISC. **Zero copyleft** in the shipped binary.
OpenSSL is upstream 3.5.7 under **Apache-2.0 alone** — not quictls, not the dual
licence — so there is no advertising clause and no "Eric Young" attribution to
reproduce, and no bundled Apache component ships a `NOTICE`.

## Two traps the fetcher exists to close

1. **`https://nodejs.org/dist/<v>/darwin-x64/` carries no LICENSE.** That directory
   holds `node` and debug symbols and nothing else — measured on v24.20.0. It is
   the convenient route and it drops the redistribution obligation with no error.
   The fetcher only ever reads the `.tar.xz` / `.zip`, which carry it.
2. **One release ships the licence twice, byte-different.** 157,609 B with LF (in
   the tarballs) and 160,555 B with CRLF (in the zip) — 2,946 CR, one per line.
   Any size or digest check must expect **both**, or it passes two targets and
   fails the third for a reason that reads like a corrupt download.

## Use it directly

```js
import { nodePath, isPresent, licensePath } from '@gjsify/node-runtime-darwin-x64';

if (isPresent) {
    // copy `nodePath` into your artifact — and `licensePath` beside it.
}
```

`binaryName` is a package constant, never derived from `process.platform`:
assembling a Windows artifact on Linux is a supported path, and a derived name
would look for the wrong file there.

---

Node.js is a registered trademark of the OpenJS Foundation. This package is not
affiliated with, endorsed, or sponsored by the OpenJS Foundation.
