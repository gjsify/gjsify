---
title: Publish a package people run with dlx
description: Author an npm package whose GJS bundle runs with one gjsify dlx command, with no install step on the consumer's side.
---

Pick this route for a tool nobody wants permanently installed: a scaffolder, a
one-off migration, a demo. Consumers type `gjsify dlx <your-pkg>` and it runs.
For the routes that do install something, start at
[Ship your app](/gjsify/ship/).

`gjsify dlx` downloads your package tarball into a cache, reads your `gjsify`
field to find the entry bundle, and runs `gjs -m <bundle>`. Three things make a
package work that way:

1. a pre-built GJS bundle inside the published tarball
2. a top-level `gjsify` field pointing at it
3. every dependency inlined, so `gjs -m bundle.js` succeeds with no
   `node_modules/` beside it

## Publish one bundle

```text
my-pkg/
├── src/index.ts     # what you author
├── dist/gjs.js      # the bundle, included in the npm tarball
└── package.json
```

```jsonc
{
  "name": "@me/my-pkg",
  "version": "0.1.0",
  "type": "module",
  "files": ["dist"],
  "scripts": {
    "build": "gjsify build src/index.ts --app gjs --outfile dist/gjs.js"
  },
  "gjsify": {
    "main": "dist/gjs.js"
  },
  "devDependencies": {
    "@gjsify/cli": "^0.40.0"
  }
}
```

Pass `--app gjs` (or set `"gjsify": { "app": "gjs" }`). Without it the target
follows whatever runtime the CLI itself runs on, and building from Node would
give you a Node bundle that `dlx` cannot run.

Keep the entry under the `gjsify` block rather than top-level `main`, so Node
consumers are never handed the GJS bundle by accident.

Smoke-test before you publish anything. A local spec has to be a directory, so
unpack what `yarn pack` produced and point `dlx` at that:

```bash
yarn build && yarn pack
mkdir /tmp/dlx-check
tar xf my-pkg-0.1.0.tgz -C /tmp/dlx-check --strip-components=1
gjsify dlx /tmp/dlx-check
```

Once it is on the registry:

```bash
gjsify dlx @me/my-pkg
gjsify dlx @me/my-pkg --reinstall   # bypass the cache after republishing
```

## Ship several commands

List each one under `gjsify.bin`:

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

```bash
gjsify dlx @me/my-pkg fireworks         # explicit bin
gjsify dlx @me/my-pkg                   # fails: several bins, none named
gjsify dlx @me/my-pkg fireworks -- --x  # forward --x to the bundle
```

The entry is resolved in this order:

1. the named bin, when the consumer passed one and `gjsify.bin[name]` exists
2. the single entry in `gjsify.bin`, when there is exactly one
3. `gjsify.main`
4. top-level `package.json#main`, with an advisory warning
5. otherwise it fails and lists the bins that do exist

So `gjsify.main` is the right choice for a single bundle, and `gjsify.bin` once
you ship more than one command. Relying on the `main` fallback works but nags
the consumer on every run.

## Ship native prebuilds

If your package carries a Vala or GIR-based native extension, declare the
directory and `dlx` sets `GI_TYPELIB_PATH` plus the library search path for
you:

```jsonc
{
  "gjsify": {
    "main":      "dist/gjs.js",
    "prebuilds": "prebuilds"
  },
  "files": ["dist", "prebuilds"]
}
```

Layout, one directory per target, named `<platform>-<arch>` in Node's spelling:

```
prebuilds/
  linux-x64/
    libfoo.so
    Foo-1.0.typelib
  linux-arm64/
  darwin-arm64/
```

The lookup is cross-platform, and the variable it exports follows the host
loader: `LD_LIBRARY_PATH` on Linux, `DYLD_LIBRARY_PATH` on macOS, `PATH` on
Windows. Whether your app actually runs off Linux depends on whether its native
dependencies publish an artifact for that host, which
[Platform Support](/gjsify/platform-support/) tracks per package.

The walk is transitive, so a native typelib living in an indirect dependency is
picked up too.

## Check the bundle stands alone

`dlx` gives your bundle no `node_modules`, so run it on bare `gjs` from the
unpacked tarball, with nothing else beside it:

```bash
gjs -m /tmp/dlx-check/dist/gjs.js
```

A `Cannot find module` here means something escaped the bundle. The usual
causes are an `external` entry covering a package the bundle really needs, or a
runtime read relative to `import.meta.url` pointing at a file the tarball does
not contain.

## Two build mistakes worth knowing

**Do not let the output default onto a TypeScript source.** `gjsify build`
refuses to write to `package.json#main` when that resolves to a `.ts`/`.tsx`
path or anything under `src/`, and tells you so. Set the output explicitly:

```jsonc
{
  "main": "src/index.ts",
  "gjsify": {
    "app": "gjs",
    "bundler": { "output": { "file": "dist/gjs.js" } },
    "bin":     { "my-pkg": "dist/gjs.js" }
  }
}
```

**`package.json#gjsify` and `.gjsifyrc.*` are merged, not either-or.** Keep the
short keys (`app`, `bin`, `main`, `prebuilds`) in `package.json` and put bundler
options in `.gjsifyrc.js`. Both are read, and on a key collision the config file
wins.

```js
// .gjsifyrc.js
export default {
  bundler: {
    output: { file: 'dist/gjs.js' },
    transform: { target: 'firefox140' },
  },
};
```

## Next

- [Self-executing bundle](/gjsify/guides/self-executing-package/) for a single file people
  download and run without `gjsify` at all.
- [CLI Reference → `gjsify dlx`](/gjsify/cli-reference/#gjsify-dlx) for the flags
  consumers have, including `--frozen`, `--cache-max-age` and `--registry`.
