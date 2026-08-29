---
title: Build a self-executing GJS bundle
description: Ship one executable file that runs on bare gjs, with no Node, no npm and no gjsify on the user's machine.
---

Pick this route when you want people to download one file, `chmod +x` it, and
run it. There is no package manager, no install step and no gjsify on their
machine; all they need is `gjs`. For the routes that install something, start
at [Ship your app](/gjsify/ship/).

What you end up shipping is a single file:

```
my-tool/
└── bin/
    └── my-tool     # executable, starting with #!/usr/bin/env -S gjs -m
```

When someone runs `./bin/my-tool --help`, GJS reads the shebang and executes
the bundle. Nothing else on disk is touched.

## Write the entry point

```ts
// src/start.ts
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

async function main(): Promise<void> {
  await yargs(hideBin(process.argv))
    .scriptName("my-tool")
    .command("hello [name]", "say hello", {}, (argv) => {
      console.log(`Hello, ${argv.name ?? "world"}!`);
    })
    .parseAsync();

  process.exit(0);
}

main();
```

That last `process.exit(0)` matters. Anything you import that touches
`setTimeout`, a `Soup` session, a WebSocket or a GTK application starts a GLib
main loop, and the loop keeps running after `main()` resolves. Without the
explicit exit your tool prints its output and then sits there, which users read
as "the command hung".

## Configure the build

```jsonc
// package.json
{
  "name": "@me/my-tool",
  "version": "0.1.0",
  "type": "module",
  "main": "src/start.ts",
  "bin": { "my-tool": "bin/my-tool" },
  "files": ["bin", "src"],
  "scripts": {
    "build": "gjsify build src/start.ts"
  },
  "gjsify": {
    "app": "gjs",
    "shebang": true,
    "bundler": { "output": { "file": "bin/my-tool" } },
    "bin": { "my-tool": "bin/my-tool" },
    "defineFromPackageJson": {
      "__MY_TOOL_VERSION__": { "field": "version" }
    }
  },
  "devDependencies": {
    "@gjsify/cli": "^0.40.0"
  }
}
```

Four keys carry the weight:

- **`gjsify.app: "gjs"`** pins the target. Left out, the target follows whatever
  runtime the CLI runs on, and building from Node would give you a Node bundle.
- **`gjsify.shebang: true`** prepends `#!/usr/bin/env -S gjs -m` and marks the
  output executable. Same as passing `--shebang`.
- **`gjsify.bundler.output.file`** sets the output path. You need it here
  because `main` points at a TypeScript source, and `gjsify build` refuses to
  default the output onto a source file.
- **`gjsify.defineFromPackageJson`** substitutes your version into the bundle at
  build time, so `--version` reports something true.

There are two `bin` blocks on purpose: the top-level one is npm's (`npm i -g`
symlinks it), and the `gjsify` one lets `gjsify dlx @me/my-tool` find the same
file.

```bash
yarn build
./bin/my-tool hello world        # Hello, world!
```

## Report the right version

`defineFromPackageJson` turns `__MY_TOOL_VERSION__` into a compile-time
constant. Declare it once for TypeScript:

```ts
// src/types/version.d.ts
declare const __MY_TOOL_VERSION__: string;
```

and hand it to yargs:

```ts
.version(__MY_TOOL_VERSION__)
```

## Publish it on GitHub Releases

A workflow that builds on `release: published` and attaches the file:

```yaml
# .github/workflows/release-app.yml
name: Release App
on:
  release:
    types: [published]
  workflow_dispatch:

jobs:
  publish-app:
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24.x' }
      - run: yarn install --immutable
      - run: yarn build              # produces bin/my-tool

      - name: Upload to GitHub Release
        if: github.event_name == 'release'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh release upload "${{ github.event.release.tag_name }}" \
            bin/my-tool --clobber
```

Every release tag now carries the binary, and the download is three lines:

```bash
curl -L https://github.com/me/my-tool/releases/latest/download/my-tool -o my-tool
chmod +x my-tool
./my-tool --version
```

If you would rather hand people a script than a URL, generate one with
[`gjsify generate-installer`](/gjsify/guides/distributing-gjs-apps/). It installs from npm
into `~/.local`, which also gives users a clean upgrade path.

## Add a self-update command

Saves your users from re-running the download by hand:

```ts
// src/commands/self-update.ts
import { writeFileSync, chmodSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO = "me/my-tool";
const ASSET = "my-tool";

export async function selfUpdate(): Promise<void> {
  // Running from source or from node_modules: there is nothing to replace.
  const target = process.argv[1] ?? "";
  if (!target || target.endsWith(".ts") || target.includes("node_modules")) {
    console.log("self-update only works on the installed binary");
    return;
  }

  const release = await (await fetch(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    { headers: { "User-Agent": "my-tool" } },
  )).json();

  const url = release.assets.find((a: any) => a.name === ASSET)
    ?.browser_download_url;
  if (!url) throw new Error("asset not found");

  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());

  // Write, chmod, then rename over the running file. Linux keeps the old inode
  // open until this process exits, so replacing a running binary is safe.
  const tmp = join(tmpdir(), `${ASSET}.${process.pid}`);
  writeFileSync(tmp, bytes);
  chmodSync(tmp, 0o755);
  renameSync(tmp, target);

  console.log(`updated to ${release.tag_name}`);
}
```

```ts
.command("self-update", "update to the latest release", {}, selfUpdate)
```

`fetch` and `node:fs` both work here because the build bundles the gjsify
polyfills for them. `process.argv[1]` is the path GJS was handed, which is your
binary.

## Publish on npm too

The same package can also go to the registry, so people who do have Node reach
it through `gjsify dlx`:

```bash
yarn npm publish
```

```bash
# no Node, no gjsify
curl -L .../my-tool -o my-tool && chmod +x my-tool && ./my-tool

# same bundle, from the npm tarball
gjsify dlx @me/my-tool
```

Keep `bin/my-tool` inside the published tarball (`"files": ["bin"]`) and make
sure `gjsify.bin` points at it. See
[Publish a package people run with dlx](/gjsify/guides/dlx-packaging/) for the rest.

## When it misbehaves

| Symptom | Cause | Fix |
|---|---|---|
| Hangs after the last line of output | A GLib main loop is still running (`setTimeout`, Soup, GTK) | `process.exit(0)` once your work resolves |
| `Cannot find module '...'` at runtime | A dependency escaped the bundle | Drop it from `external`, then verify with `gjs -m bin/my-tool` in a directory with no `node_modules` |
| The bundle is enormous | A large dependency got pulled in that never runs | `--external typedoc`, or `--alias typedoc=@gjsify/empty` |
| `--version` prints nothing useful | No `defineFromPackageJson` entry | Add it and declare the constant |
| `EACCES` when running the file | Not marked executable | `gjsify.shebang: true`, or `--shebang` |
| `refusing to default --outfile to src/start.ts` | `main` is a TypeScript source and no output was set | Set `gjsify.bundler.output.file` |

## A working example

[ts-for-gir](https://github.com/gjsify/ts-for-gir) ships exactly this way:

- entry: [`packages/cli/src/start.ts`](https://github.com/gjsify/ts-for-gir/blob/main/packages/cli/src/start.ts)
- release workflow: [`.github/workflows/release-app.yml`](https://github.com/gjsify/ts-for-gir/blob/main/.github/workflows/release-app.yml)
- installer script: [`install.js`](https://github.com/gjsify/ts-for-gir/blob/main/install.js)
- self-update: [`packages/cli/src/commands/self-update.ts`](https://github.com/gjsify/ts-for-gir/blob/main/packages/cli/src/commands/self-update.ts)
