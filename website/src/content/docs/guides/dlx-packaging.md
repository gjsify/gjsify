---
title: Distribute a package via `gjsify dlx`
description: Author an npm package whose GJS bundle runs with one command — no install, no Node.js
---

This guide covers the publisher side: how to author an npm package so consumers can run it on GJS with a single `gjsify dlx <name>` invocation. End-user mechanics live in the [CLI Reference → `gjsify dlx`](../cli-reference/#gjsify-dlx).

## Mental model

`gjsify dlx` is a **GJS-bundle runner**. It downloads the package tarball into a per-spec cache, then invokes `gjs -m <bundle>` after consulting the package's `gjsify` field to find the right entry. The consumer never runs `npm install`; they don't even need Node.js installed at runtime.

Three things make a package `dlx`-friendly:

1. A pre-built GJS bundle in the published tarball
2. A top-level `gjsify` field pointing to it
3. The bundle has every dependency inlined — `gjs -m bundle.js` must succeed without any `node_modules/` next to it

## Minimal package

```text
my-pkg/
├── src/index.ts         # the source you author
├── dist/gjs.js          # the GJS bundle, committed to the npm tarball
└── package.json
```

```jsonc
{
  "name": "@me/my-pkg",
  "version": "0.1.0",
  "type": "module",
  "files": ["dist"],
  "scripts": {
    "build": "gjsify build src/index.ts --outfile dist/gjs.js"
  },
  "gjsify": {
    "main": "dist/gjs.js"
  },
  "devDependencies": {
    "@gjsify/cli": "^0.3.9"
  }
}
```

`gjsify build` produces a single self-contained file: every transitive dep — including the `@gjsify/*` polyfills picked up by `--globals auto` — is inlined. Use `gjsify` block fields rather than top-level `main` so Node consumers (if any) aren't accidentally served the GJS bundle.

```bash
yarn build && yarn pack
gjsify dlx ./my-pkg-0.1.0.tgz   # offline smoke-test against the tarball
```

Once on the registry:

```bash
gjsify dlx @me/my-pkg
```

## Multiple bins (subcommands)

When one package ships several CLIs, list them under `gjsify.bin`:

```jsonc
{
  "gjsify": {
    "bin": {
      "fireworks": "dist/fireworks.js",
      "demo":      "dist/demo.js"
    }
  }
}
```

Resolution order at `gjsify dlx <pkg> [binOrArg]`:

1. user passed a bin name and `gjsify.bin[name]` exists → that path
2. `gjsify.bin` has exactly one entry → that path (auto-pick)
3. `gjsify.main` → that path
4. fallback: top-level `package.json#main` → that path with an advisory warning
5. otherwise: hard-fail telling the consumer which bins exist

```bash
gjsify dlx @me/my-pkg fireworks         # explicit bin
gjsify dlx @me/my-pkg                   # fails — multiple bins, ask which
gjsify dlx @me/my-pkg fireworks -- --x  # forward `--x` to the bundle
```

## Native prebuilds

If your package contains a Vala/GIR-based native extension (`.so` + `.typelib` shipped per-arch), declare the prebuilds directory so the dlx runtime sets `LD_LIBRARY_PATH` and `GI_TYPELIB_PATH` for you:

```jsonc
{
  "gjsify": {
    "main":      "dist/gjs.js",
    "prebuilds": "prebuilds"
  },
  "files": ["dist", "prebuilds"]
}
```

Layout:

```
prebuilds/
  linux-x86_64/
    libfoo.so
    Foo-1.0.typelib
  linux-aarch64/
    libfoo.so
    Foo-1.0.typelib
```

The CLI auto-detects the host architecture and exports the matching directory.

## Build-time gotchas

### `--outfile` must NOT point at a TypeScript source

`gjsify build` refuses to default the output to `package.json#main`/`module` when those resolve to a `.ts`/`.tsx` path or anything under `src/`. Always set `gjsify.bundler.output.file` (or pass `--outfile` explicitly) when `main` is your source file:

```jsonc
{
  "main": "src/index.ts",        // dev path, no build step
  "gjsify": {
    "bundler": { "output": { "file": "dist/gjs.js" } },
    "bin":     { "my-pkg": "dist/gjs.js" }
  }
}
```

Without this, you'd get an error like `gjsify build: refusing to default --outfile to src/index.ts (would overwrite a TypeScript source file)`.

### `package.json#gjsify` and `.gjsifyrc.*` are merged

You can split the config across both — `package.json#gjsify` stays minimal (`bin`, `main`, `prebuilds`) and `.gjsifyrc.js` carries bundler options. Both files are read; on key collisions the explicit file wins. There's no first-match-wins anymore.

```jsonc
// package.json
{
  "gjsify": {
    "bin": { "my-pkg": "dist/gjs.js" }
  }
}
```

```js
// .gjsifyrc.js
export default {
  bundler: {
    output: { file: 'dist/gjs.js' },
    transform: { target: 'firefox140' },
  },
};
```

### Verify the bundle runs offline

Before publishing, simulate the dlx environment — extract the packed tarball into a sibling directory with NO `node_modules`, then run with raw `gjs`:

```bash
yarn pack
mkdir /tmp/dlx-check && tar xf my-pkg-0.1.0.tgz -C /tmp/dlx-check --strip-components=1
gjs -m /tmp/dlx-check/dist/gjs.js
```

If this fails (missing imports, `Cannot find module`), the build is leaking unbundled deps. Common causes: `external` config that excluded a package the bundle actually needs, or a runtime `import.meta.url`-relative read targeting a path not present in the tarball.

## When to use `gjsify.main` vs `gjsify.bin`

- **`gjsify.main`** — single-bundle library or app. Preferred default.
- **`gjsify.bin`** — package ships multiple CLIs. Each entry can have its own outfile and shebang.

Both are optional: a package can also rely on the top-level `package.json#main` fallback, but you'll get a one-time advisory warning per dlx invocation.

## What's next

- Publishing a single self-contained executable that doesn't even need `gjsify dlx` to run — see [Self-executing GJS packages](./self-executing-package).
- The end-to-end CLI mechanics for consumers — see the [CLI Reference](../cli-reference/#gjsify-dlx).
