# @gjsify/tsc

[TypeScript][typescript] for [GJS][gjs] — the upstream `typescript` compiler
bundled to a single GJS module and shipped with a `gjsify-tsc` bin that runs
**directly under [SpiderMonkey][spidermonkey] via GJS**, without Node.js in
the loop.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/tsc

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/tsc
yarn add @gjsify/tsc
```

## Usage

```bash
# Node-free TypeScript checking on any GJS-equipped system:
gjsify-tsc --version              # → Version 6.0.3
gjsify-tsc -p tsconfig.json       # type-check (--noEmit-style usage)
gjsify-tsc --diagnostics foo.ts   # tsc perf info works the same as on Node
```

## Why

`typescript` is itself written in TypeScript and ships as plain JS. There is
no Node-only API in the compiler proper — it talks to disk through `sys` and
that's it. With `@gjsify/cli`'s `--app gjs` target, the same compiler runs
unchanged under GJS, polyfilled by the rest of the gjsify family
(`@gjsify/fs`, `@gjsify/path`, `@gjsify/process`, `@gjsify/perf_hooks`, …).

gjsify **self-hosts** its type-checking on this package: every workspace
`check` and `.d.ts` emit runs `gjsify-tsc`, not Node's `tsc`. Together with
the `gjsify` CLI (also a GJS bundle) and the native Rolldown bundler engine,
the gjsify build chain now runs Node-free under GJS — the long-standing goal
tracked in `status/open-todos.md`.

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
# update TYPESCRIPT_VERSION in src/index.ts to match the new bundled version
# commit the new dist/tsc.gjs.mjs and src/index.ts
```

The bundled version is pinned in `src/index.ts` as `TYPESCRIPT_VERSION`.

CI (`.github/workflows/main.yml`) runs a staleness check after every install
that fails the build if `dist/tsc.gjs.mjs --version` does not match
`TYPESCRIPT_VERSION` — same shape as the existing check for
`packages/infra/cli/dist/cli.gjs.mjs`.

## Tests

```bash
gjsify workspace @gjsify/tsc test
```

The GJS-only smoke spec (`src/index.gjs.spec.ts`) runs the committed bundle
under `gjs -m dist/tsc.gjs.mjs …` and validates `--version` plus `-p
<tsconfig>` exit codes on a clean and a buggy fixture (the latter must
produce a `TS2322` diagnostic). The aggregator is `src/test.mts`; the test
bundle is built to `dist/test.gjs.mjs` and is gitignored.

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

## License

MIT

[typescript]: https://github.com/microsoft/TypeScript
[gjs]: https://gitlab.gnome.org/GNOME/gjs
[spidermonkey]: https://spidermonkey.dev/
