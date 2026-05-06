---
title: Build a self-executing GJS package
description: Ship a single executable file users can run on bare GJS — no Node, no npm, no `gjsify dlx`
---

A self-executing package is a single GJS bundle file with a shebang that runs directly on `gjs`. End users never invoke `gjsify`, `gjsify dlx`, `npm`, or `node` — they just download or `chmod +x` your file and run it. This guide is the recipe — the canonical implementation is [ts-for-gir](https://github.com/gjsify/ts-for-gir/blob/main/packages/cli/).

If you only need an `npm`-distributable runner that consumers reach via `gjsify dlx <pkg>`, see [Distribute a package via `gjsify dlx`](./dlx-packaging) — that's a simpler pattern.

## What you ship

```
my-tool/
├── bin/
│   └── my-tool        # 23 MB single file, executable, with `#!/usr/bin/env -S gjs -m`
└── (everything below is the build pipeline that produced bin/my-tool)
```

When users run `./bin/my-tool --help`, GJS interprets the shebang and executes the bundle. Nothing else on disk is read.

## 1. Write the entry point

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

  // CRITICAL: GJS keeps the GLib main loop alive after main() resolves.
  // Without an explicit exit the process hangs silently after the last
  // log line — visible to the user as "command did nothing".
  process.exit(0);
}

main();
```

The explicit `process.exit(0)` is the most-common gotcha. Any module you import that touches `setTimeout`, `WebSocket`, `Soup.Server`, or initialises a Gtk app spins up a `GLib.MainLoop` that won't terminate on its own. The CLI's job is to call `process.exit` after its work resolves.

## 2. Configure the build

```jsonc
// package.json
{
  "name": "@me/my-tool",
  "version": "0.1.0",
  "type": "module",
  "main": "src/start.ts",
  "bin": {
    "my-tool": "bin/my-tool"
  },
  "files": ["bin", "src"],
  "scripts": {
    "build": "gjsify build src/start.ts"
  },
  "gjsify": {
    "shebang": true,
    "esbuild": {
      "outfile": "bin/my-tool"
    },
    "bin": {
      "my-tool": "bin/my-tool"
    }
  },
  "devDependencies": {
    "@gjsify/cli": "^0.3.9"
  }
}
```

Two `bin` blocks — one at the package root (npm semantics: `npm install -g` symlinks here) and one inside `gjsify` (so `gjsify dlx @me/my-tool` resolves to the same file).

`gjsify.shebang: true` makes the build prepend `#!/usr/bin/env -S gjs -m` and `chmod 0755` the output. Equivalent to `gjsify build src/start.ts --shebang`.

```bash
yarn build
./bin/my-tool hello Pascal       # → Hello, Pascal!
```

## 3. Bake in the version (optional)

If you need a `--version` command that reflects the bundled package's version, pass it through esbuild's `--define`. ts-for-gir does this with a 5-line wrapper:

```js
// scripts/build-gjs.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf-8"));
const result = spawnSync(
  "gjsify",
  ["build", "src/start.ts", "--define", `__MY_TOOL_VERSION__=${JSON.stringify(pkg.version)}`],
  { stdio: "inherit", cwd: join(here, "..") },
);
process.exit(result.status ?? 1);
```

Reference the constant in source:

```ts
// src/types/version.d.ts
declare const __MY_TOOL_VERSION__: string;
```

```ts
// in your CLI
.option("version", { alias: "v", desc: () => __MY_TOOL_VERSION__ });
```

Then wire `package.json#scripts.build` to invoke the wrapper:

```jsonc
"scripts": {
  "build": "node scripts/build-gjs.mjs"
}
```

## 4. Distribute via GitHub Releases

A GitHub-Actions workflow that builds the bundle on `release: published` and uploads it as a release asset:

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

Now every release tag has the binary attached. Consumers download it directly:

```bash
curl -L https://github.com/me/my-tool/releases/latest/download/my-tool -o my-tool
chmod +x my-tool
./my-tool --version
```

## 5. Bootstrap installer (`install.js`)

Provide a one-liner curl-friendly installer that's itself a GJS script — so users don't even need `curl`'s `-o`:

```js
#!/usr/bin/env -S gjs -m
// install.js — installs my-tool into ~/.local/bin
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Soup from "gi://Soup?version=3.0";
import { exit } from "system";

const REPO = "me/my-tool";
const ASSET = "my-tool";
const TARGET = GLib.build_filenamev([
  GLib.get_home_dir(), ".local", "bin", "my-tool",
]);

const session = new Soup.Session();
const apiMsg = Soup.Message.new(
  "GET",
  `https://api.github.com/repos/${REPO}/releases/latest`,
);
apiMsg.request_headers.append("Accept", "application/vnd.github.v3+json");
apiMsg.request_headers.append("User-Agent", "my-tool-installer");

const apiBytes = session.send_and_read(apiMsg, null);
const release = JSON.parse(new TextDecoder().decode(apiBytes.toArray()));
const url = release.assets.find((a) => a.name === ASSET)?.browser_download_url;
if (!url) { printerr("asset not found"); exit(1); }

print(`[my-tool] downloading ${release.tag_name}...`);
const dlMsg = Soup.Message.new("GET", url);
const bytes = session.send_and_read(dlMsg, null);
GLib.mkdir_with_parents(GLib.path_get_dirname(TARGET), 0o755);
GLib.file_set_contents_full(
  TARGET,
  bytes.toArray(),
  GLib.FileSetContentsFlags.NONE,
  0o755,
);
print(`[my-tool] installed to ${TARGET}`);
```

Users run:

```bash
curl -fsSL https://raw.githubusercontent.com/me/my-tool/main/install.js | gjs -m /dev/stdin
```

(Or download `install.js` and run it locally.) `install.js` itself is a self-executing GJS script — no Node, no `npm`. ts-for-gir's [install.js](https://github.com/gjsify/ts-for-gir/blob/main/install.js) is a battle-tested reference.

## 6. Self-update from inside the binary

Add a `self-update` subcommand to the bundle so users update without re-running the installer:

```ts
// src/commands/self-update.ts
import { writeFileSync, chmodSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO = "me/my-tool";
const ASSET = "my-tool";

export async function selfUpdate(): Promise<void> {
  // Refuse to self-update if running from source / node_modules
  const target = process.argv[1] ?? "";
  if (!target || target.endsWith(".ts") || target.includes("node_modules")) {
    console.log("self-update only works on the installed binary");
    return;
  }

  const release = await (await fetch(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    { headers: { "User-Agent": `my-tool` } },
  )).json();

  const url = release.assets.find((a: any) => a.name === ASSET)
    ?.browser_download_url;
  if (!url) throw new Error("asset not found");

  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());

  // Atomic install: write to tmp file, chmod, rename over the running binary.
  // Linux allows replacing an executing binary because the kernel keeps the
  // old inode open until the process exits.
  const tmp = join(tmpdir(), `${ASSET}.${process.pid}`);
  writeFileSync(tmp, bytes);
  chmodSync(tmp, 0o755);
  renameSync(tmp, target);

  console.log(`updated to ${release.tag_name}`);
}
```

Wire as a yargs command:

```ts
.command("self-update", "update to the latest release", {}, selfUpdate)
```

This works because gjsify bundles the modern `fetch` + `node:fs` polyfills automatically.

## 7. Optional — also publish on npm

You can ship the same package on npm so consumers who *do* have Node can use `gjsify dlx`:

```bash
yarn npm publish
```

Then both flows work:

```bash
# Self-executing — no Node, no gjsify
curl -L .../my-tool -o my-tool && chmod +x my-tool && ./my-tool

# Via gjsify dlx — uses the same bundle from the npm tarball
gjsify dlx @me/my-tool
```

Make sure the `bin/my-tool` file is in the published tarball (`"files": ["bin"]`) and `gjsify.bin` points to it.

## Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Process hangs after last log line | Active `GLib.MainLoop` (any `setTimeout`, Soup, Gtk, ...) | Call `process.exit(0)` after `parseAsync()` resolves |
| `Cannot find module '...'` at runtime | Some dep escaped bundling | Don't use `external` for code paths that actually run; verify with `gjs -m bin/my-tool` in a directory with no `node_modules` |
| Bundle is 80 MB | Large dep included unnecessarily (e.g. typedoc, full TS compiler) | `--external typedoc` or `--alias typedoc=@gjsify/empty` for code paths the runtime never reaches |
| `--version` prints `0.0.0` or undefined | Forgot the `--define` step | Add the `build-gjs.mjs` wrapper from step 3 |
| `EACCES` running the bundle | Build forgot to chmod | Use `gjsify.shebang: true` (or `--shebang`) |
| `gjsify build: refusing to default --outfile to src/start.ts` | `package.json#main` is `src/start.ts` and you didn't set an explicit outfile | Set `gjsify.esbuild.outfile` (this is the safety check that prevents source overwrites) |

## Reference implementation

[ts-for-gir](https://github.com/gjsify/ts-for-gir) implements every step above:

- Entry: [`packages/cli/src/start.ts`](https://github.com/gjsify/ts-for-gir/blob/main/packages/cli/src/start.ts)
- Build: [`packages/cli/scripts/build-gjs.mjs`](https://github.com/gjsify/ts-for-gir/blob/main/packages/cli/scripts/build-gjs.mjs)
- Release workflow: [`.github/workflows/release-app.yml`](https://github.com/gjsify/ts-for-gir/blob/main/.github/workflows/release-app.yml)
- Installer: [`install.js`](https://github.com/gjsify/ts-for-gir/blob/main/install.js)
- Self-update: [`packages/cli/src/commands/self-update.ts`](https://github.com/gjsify/ts-for-gir/blob/main/packages/cli/src/commands/self-update.ts)
- E2E tests against the bundle: [`packages/cli/tests/e2e/cli-gjs/`](https://github.com/gjsify/ts-for-gir/blob/main/packages/cli/tests/e2e/cli-gjs/)
