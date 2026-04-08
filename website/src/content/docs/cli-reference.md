---
title: CLI Reference
description: All gjsify subcommands, flags and typical usage
---

The `@gjsify/cli` package ships the `gjsify` binary. Run it on demand via `npx @gjsify/cli <command>` or add it as a dev dependency so it is available through your `package.json` scripts.

## `gjsify create`

Scaffold a new GJSify project in a new directory.

```bash
npx @gjsify/cli create my-app
```

| Argument | Description | Default |
|---|---|---|
| `[project-name]` | Directory to create | `my-gjs-app` |

The generated project contains `src/index.ts`, a `package.json` with `build`/`start`/`dev` scripts wired to the GJSify CLI, and a matching `tsconfig.json`. Internally this delegates to [`@gjsify/create-app`](https://www.npmjs.com/package/@gjsify/create-app) — you can also call it directly via `npx @gjsify/create-app my-app`.

## `gjsify build`

Compile and bundle your project with [esbuild](https://esbuild.github.io/). Automatically aliases Node.js and Web API imports to their `@gjsify/*` equivalents when building for GJS.

```bash
npx @gjsify/cli build src/index.ts --outfile dist/index.js
```

| Option | Values | Default | Description |
|---|---|---|---|
| `[entryPoints..]` | paths | `src/index.ts` | Positional entry points |
| `--app` | `gjs` \| `node` \| `browser` | `gjs` | Target runtime |
| `--format` | `iife` \| `esm` \| `cjs` | auto | Override output format |
| `--outfile`, `-o` | path | from `package.json` | App mode output file |
| `--outdir`, `-d` | path | from `package.json` | Library mode output directory |
| `--library` | bool | `false` | Build as a reusable library |
| `--minify` | bool | `false` | Minify the output |
| `--reflection`, `-r` | bool | `false` | Enable TypeScript runtime types via Deepkit |
| `--console-shim` | bool | `true` | Inject the GJS console shim (clean output, ANSI colors). Disable with `--no-console-shim` |
| `--auto-globals` | bool | `true` | Auto-inject `/register` modules for globals referenced in user code. Disable with `--no-auto-globals` |
| `--globals` | string | `""` | Explicit globals list. See [Auto-globals](#auto-globals) below |
| `--exclude` | glob[] | `[]` | Glob patterns to exclude from entry points and aliases |
| `--log-level` | `silent` \| `error` \| `warning` \| `info` \| `debug` \| `verbose` | `warning` | esbuild log level |
| `--verbose` | bool | `false` | Enable verbose mode |

For `--app gjs`, the target is `firefox128` (SpiderMonkey 128) and `gi://*`, `cairo`, `system` and `gettext` are externalised. For `--app node`, the target is `node24`.

### Auto-globals

When building for GJS, GJSify scans your entry points for references to Node.js and Web API globals — `fetch`, `Buffer`, `process`, `ReadableStream`, `AbortController`, `crypto`, `URL`, `TextEncoder`, `document`, and many more — and automatically injects the matching `@gjsify/*/register` modules so the globals are available at runtime. You no longer need to `import '@gjsify/node-globals'` or similar boilerplate in your source code.

The scanner is **scope-aware**: it uses a full JavaScript parser (acorn) so it correctly ignores shadowed identifiers (`const fetch = myCustomFetch`) and property accesses (`api.Buffer`). On unusual TypeScript that acorn cannot parse, it silently falls back to a regex-based scanner so auto-globals never disables itself on a single malformed file.

```bash
# Default — scanner runs, injects only what's needed
npx @gjsify/cli build src/index.ts

# Opt out entirely — you are responsible for importing any required /register subpaths
npx @gjsify/cli build src/index.ts --no-auto-globals

# Absolute whitelist (replaces scan results)
npx @gjsify/cli build src/index.ts --globals fetch,crypto

# Add on top of scan (useful when an npm dependency uses a global internally
# and your own code never references it directly)
npx @gjsify/cli build src/index.ts --globals +crypto

# Remove from scan (useful if you want to suppress a specific injection)
npx @gjsify/cli build src/index.ts --globals -fetch

# Combined modifiers
npx @gjsify/cli build src/index.ts --globals +crypto,-fetch
```

**Scope of the scan:** the scanner only looks at your own entry-point files, not at external npm dependencies. This works for the common case where your source code references the same globals your dependencies use (e.g. Express apps typically read `process.env`). For dependencies that use globals your own code never touches, add them explicitly with `--globals +<name>`.

The list of recognised global identifiers is defined in [`packages/infra/resolve-npm/lib/globals-map.mjs`](https://github.com/gjsify/gjsify/blob/main/packages/infra/resolve-npm/lib/globals-map.mjs) — contributions for missing names are welcome.

## `gjsify run`

Run a built GJS bundle. Automatically sets `LD_LIBRARY_PATH` and `GI_TYPELIB_PATH` for any native prebuilds in `node_modules` (e.g. `@gjsify/webgl`), so you do not have to wire the environment yourself.

```bash
npx @gjsify/cli run dist/index.js
npx @gjsify/cli run dist/index.js -- --my-app-flag value
```

| Argument | Description |
|---|---|
| `<file>` | The GJS bundle to run |
| `[args..]` | Extra arguments passed through to `gjs` |

Before spawning `gjs`, the command prints the exact invocation it is about to run, including any env vars that were set:

```bash
$ gjsify run dist/index.js
$ LD_LIBRARY_PATH=/…/@gjsify/webgl/prebuilds/linux-x64 GI_TYPELIB_PATH=/…/@gjsify/webgl/prebuilds/linux-x64 gjs -m dist/index.js
```

`gjsify run` is **not required** — it is a convenience wrapper. You can always invoke `gjs` directly. If your project does not pull in any native prebuilds, all you need is:

```bash
gjs -m dist/index.js
```

If your project does use native GJSify packages, copy the env vars from the printed line above, or generate them on demand with [`gjsify info --export`](#gjsify-info):

```bash
eval $(npx @gjsify/cli info --export)
gjs -m dist/index.js
```

## `gjsify check`

Verify that all required system dependencies are installed: GJS, GTK 4, Blueprint Compiler, and friends. Returns a non-zero exit code if anything is missing and prints the install command for your detected package manager.

```bash
npx @gjsify/cli check
npx @gjsify/cli check --json
```

| Option | Default | Description |
|---|---|---|
| `--json` | `false` | Output results as JSON |

## `gjsify info`

List any native GJSify packages detected in `node_modules` and show the exact `LD_LIBRARY_PATH` / `GI_TYPELIB_PATH` needed to run your bundle directly with `gjs`. Useful when you cannot use `gjsify run` (for example when launching through a systemd unit).

```bash
npx @gjsify/cli info dist/index.js
eval $(npx @gjsify/cli info --export)
gjs -m dist/index.js
```

| Argument / Option | Description |
|---|---|
| `[file]` | Bundle path used in the generated example command |
| `--export` | Emit only shell `export` statements, suitable for `eval` |

## `gjsify showcase`

List or run the curated showcase applications bundled with the CLI. Each showcase is a fully polished example — Canvas2D fireworks, Three.js post-processing, an Express web server — and can be launched with a single command.

```bash
npx @gjsify/cli showcase                  # list all
npx @gjsify/cli showcase three-geometry-teapot
```

| Option | Default | Description |
|---|---|---|
| `[name]` | — | Showcase name to run. Omit to list available showcases |
| `--list` | `false` | Force list mode even if a name is provided |
| `--json` | `false` | Output as JSON (list mode only) |

Before running, `gjsify showcase` calls `gjsify check` to make sure all required system dependencies are in place.
