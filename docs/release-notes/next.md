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
## New

### `gjsify exec` runs an installed npm bin on the runtime gjsify runs on

`gjsify exec <bin> [args…]` is `npx <bin>` for a bin your project installed (ADR 0076). Under
Node, Bun or Deno the bin runs unchanged. Under GJS, which cannot load an npm bin, gjsify
rebuilds it `--app gjs` once, caches the result in `node_modules/.cache/gjsify/exec/`, and runs
it with `gjs`. The cache is reused until the package version, the lockfile or the gjsify
version changes. Arguments, the working directory, the environment, stdio and the exit code
pass through.

A rebuild that fails prints the bundler's diagnostics and runs nothing: `gjsify exec` never
falls back to Node on its own. `--runtime node` runs the bin on Node when that is what you want.

Not every Node bin runs under GJS yet. Measured when the command landed: `semver`, `json5` and
`wxt --version` run; `prettier` and `web-ext` do not, and the reason each one stops is written
down in `docs/bundled-toolchains.md`.

### Builds of ordinary npm packages that failed under `--app gjs`

Rebuilding real bins found build defects that affect every `gjsify build --app gjs`:

- A dependency that assigns `console = …` (node-forge does) no longer fails the build with
  `ASSIGN_TO_IMPORT: Cannot assign to import 'console'`.
- A dependency that has `"import.meta.url"` as a string, as vite's and wxt's `define` keys do,
  no longer fails with `PARSE_ERROR: Expected ':' but found Identifier`.
- `import.meta.dirname` and `import.meta.filename` in a dependency now work. GJS defines neither,
  so they were `undefined`.
- `require('fs')` from CommonJS is a mutable object, as in Node. graceful-fs (under fs-extra and
  many CLIs) patches it in place, and that failed at load with `setting getter-only property`.
- A `.cjs` entry point builds.
- Two modules in one directory that import the same `@gjsify/*` package at the same moment no
  longer lose that import to a race. The lost import came out as a bare specifier, and the
  bundle failed its load check or died at load.

### New Node APIs

`util.parseEnv`, `fs/promises.constants`, `stream.promises`, `dns.promises` and
`module.Module`.
