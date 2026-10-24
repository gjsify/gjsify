# @gjsify/node-runtime-win32-arm64

The **Node.js interpreter for Windows arm64**, packaged so an application built with
gjsify can carry its own. Three files, nothing else:

```
bin/node.exe        the interpreter, verbatim from the pinned Node 24 LTS release (win-arm64)
bin/LICENSE         Node's own LICENSE, verbatim from that same release
bin/manifest.json   which release, which URL, which digests
```

Platform-gated (`os: ["win32"]`, `cpu: ["arm64"]`), tier 3. The `bin/` payload
is **not committed** — it is fetched and digest-checked on a CI runner by
[`../scripts/fetch-node-runtime.mjs`](../scripts/fetch-node-runtime.mjs)
(`--target win32-arm64`, Node's own `win-arm64` dist tag) and reaches
consumers through the published tarball.

Same rules as the [win32-x64 sibling](../node-runtime-win32-x64) — nobody adds
this to `dependencies`; `gjsify ship` resolves it by name for a Windows/ARM
target and stages `bin/node.exe` into the artifact. Overriding it is
`GJSIFY_NODE_RUNTIME=/path/to/bin`.

---

Node.js is a registered trademark of the OpenJS Foundation. This package is not
affiliated with, endorsed, or sponsored by the OpenJS Foundation.
