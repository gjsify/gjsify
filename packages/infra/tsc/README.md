# @gjsify/tsc

[TypeScript][typescript] for [GJS][gjs] — the upstream `typescript` compiler
bundled to a single GJS module and shipped with a `tsc` bin that runs
**directly under [SpiderMonkey][spidermonkey] via GJS**, without Node.js in
the loop.

```bash
# Node-free TypeScript checking on any GJS-equipped system:
gjsify-tsc --version              # → Version 5.9.3
gjsify-tsc -p tsconfig.json       # type-check (--noEmit-style usage)
gjsify-tsc --diagnostics foo.ts   # tsc perf info works the same as on Node
```

## Why

`typescript` is itself written in TypeScript and ships as plain JS. There is
no Node-only API in the compiler proper — it talks to disk through `sys` and
that's it. With `@gjsify/cli`'s `--app gjs` target, the same compiler runs
unchanged under GJS, polyfilled by the rest of the gjsify family
(`@gjsify/fs`, `@gjsify/path`, `@gjsify/process`, `@gjsify/perf_hooks`, …).

This package is the first proof-of-concept that **the gjsify build chain can
be Node-free** — the long-standing goal tracked in the project's
`STATUS.md`. The `gjsify` CLI itself already ships as a GJS bundle; pairing
that with `gjsify-tsc` removes Node from the type-check step of any
gjsify-built app.

## Layout

```
packages/infra/tsc/
├── package.json
├── src/index.ts        ← metadata stub (TSC_BUNDLE_PATH, TYPESCRIPT_VERSION)
├── scripts/
│   └── build-bundle.mjs  ← runs `gjsify build` against typescript/lib/_tsc.js
└── dist/
    └── tsc.gjs.mjs     ← committed, ~3.5 MiB, the actual bin
```

The bundle is **committed** because it's a heavy artifact the rest of the
repo (and downstream consumers) don't want to rebuild on every install. It
ships in the npm tarball via `files: ["dist/tsc.gjs.mjs"]`.

## Updating the bundled TypeScript version

```bash
gjsify workspace @gjsify/tsc clear
# bump devDependency typescript: in package.json (or workspace-wide)
gjsify install --immutable
gjsify workspace @gjsify/tsc build
# commit the new dist/tsc.gjs.mjs
```

The bundled version is pinned in `src/index.ts` as `TYPESCRIPT_VERSION`.

## Runtime triplet

```json
{ "gjs": "polyfill", "node": "none", "browser": "none" }
```

This is a GJS-only artifact. On Node, consumers use the upstream
`typescript` package directly. On the browser, type-checking isn't a use
case.

## Reference

- [`refs/typescript`][typescript] — Microsoft's reference implementation.
- Originally implemented for Node.js / SpiderMonkey; this package bundles
  upstream's pre-built `_tsc.js` CLI entry, not a reimplementation.

[typescript]: https://github.com/microsoft/TypeScript
[gjs]: https://gitlab.gnome.org/GNOME/gjs
[spidermonkey]: https://spidermonkey.dev/
