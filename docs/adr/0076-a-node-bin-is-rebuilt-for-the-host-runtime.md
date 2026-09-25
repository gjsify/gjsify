# 76. A Node bin is REBUILT for the runtime gjsify runs on, and never silently run on another

- Status: **Accepted**
- Date: 2026-09-25
- Deciders: Pascal Garber
- Related: [ADR 0002](0002-bootstrap-bundle-minimization.md) (the Node-less bootstrap),
  [ADR 0011](0011-napi-host-in-gjs.md) (N-API over GJS),
  [docs/bundled-toolchains.md](../bundled-toolchains.md) (axis 6),
  `packages/infra/cli/src/commands/exec.ts`, `packages/infra/cli/src/utils/exec-bin.ts`

## Context

Every npm bin is written for Node: `#!/usr/bin/env node`, `node:` imports, CommonJS, a
`require('../package.json')` for `--version`. On a host with `gjs` and no Node — the
postmarketOS device ADR 0002 was measured on, a Flatpak sandbox — none of them runs, and a
project that installed `prettier` or `wxt` has no way to call it.

The parts to run them already exist, each built for a narrower caller:

- `gjsify build --app gjs` maps `node:*` to `@gjsify/*`, injects the globals a bundle reads,
  and resolves CommonJS and `exports` maps at bundle time — GJS's loader does neither.
- `@gjsify/napi` loads a `.node` addon under GJS, and the build routes the usual acquisition
  helpers (`bindings`, `node-gyp-build`, napi-rs loaders) to it.
- `gjsify run --node-script` already rebuilds ONE unbundled script for the host runtime, with
  the `toolchainAnchor` fallback that lets the build take `@gjsify/*` from beside the CLI when
  the project installs none.
- `runGjsBundle` / `runRuntimeBundle` launch a bundle with `GI_TYPELIB_PATH` and the library
  search path set.

What was missing is the command that takes a bin NAME, picks the runtime, and caches the
rebuild. `gjsify dlx` is not it: it runs a package's PUBLISHED GJS bundle and refuses a package
that ships none.

## Decision

`gjsify exec [--runtime gjs|node|bun|deno] [--rebuild] [--verbose] <bin> [args…]`.

1. **Resolution is npx's, for an INSTALLED bin.** The project's own `package.json#bin` first,
   then every `node_modules` from the working directory up. `.bin/<name>` is a hint: a symlink
   names its target, and any other shape (a gjsify `sh` launcher, a Windows `.cmd`) falls back
   to the manifests of that `node_modules`, where a package NAMED like the bin wins. Fetching an
   uninstalled package stays `dlx`'s job.

2. **The runtime is the one gjsify runs on.** On Node, Bun or Deno the npm entry runs
   unchanged — nothing is built. On GJS a package's own `gjsify.bin` bundle runs as is; any
   other bin is rebuilt `--app gjs` and run with `gjs -m`. `--runtime` overrides the host, and
   is the ONE documented escape hatch.

3. **No silent fallback.** A failed rebuild exits non-zero with the bundler's diagnostics and
   runs nothing. Falling back to `node` would be wrong twice: a GJS host may have no Node, and a
   tool that "worked" on a runtime nobody asked for hides the exact gap the command exists to
   expose. `--runtime node` states the choice.

4. **The rebuild is keyed by CONTENT**: package name + version, the entry, the running CLI's
   version (bundler and polyfills), and a hash of the project's lockfile (dependencies can move
   without the version doing so). A hit costs one `existsSync`. `--rebuild` forces one; a
   package that is not inside `node_modules` (the project's own bin, a workspace link) is never
   reused, because its source changes without a version bump. Builds go to a private temp
   directory and are renamed into place, so concurrent runs cannot read half an artifact.

5. **The cache lives in the project's `node_modules/.cache/gjsify/exec/`, not in
   `$XDG_CACHE_HOME`.** Measured, not preferred: a bundled dependency that reads its own files
   (`package.json`, a template, a locale) has its `import.meta.url` rewritten to resolve the
   package AT RUNTIME from the bundle's location (`shims/module-resolve.ts`). From a directory
   outside the project's `node_modules` that walk finds nothing. The artifact file keeps the
   entry's basename (the is-main guard compares `process.argv[1]` against it), except that
   `.cjs` becomes `.mjs`: the bundler reads the OUTPUT format off a `.cjs` name, and prettier's
   rebuild came out as CommonJS that died with `require is not defined`.

6. **argv, stdio, cwd, env and the exit code pass through.** gjsify adds no `… exited with code
   N` line, because a non-zero exit is often an answer (`semver -r` exits 1 for "no match"). A
   bin that is not found exits 127, the shell's "command not found". Rebuild warnings are
   silenced unless `--verbose`: every polyfill of a consumer's bin comes from the toolchain, so
   the per-import rescue notice is the rule here, and it printed dozens of lines ahead of
   `--version`.

## Consequences

The first real bins found build defects that failed whole builds of ordinary packages, fixed
at the bundler in the same change, each with a regression row
(`packages/infra/cli/src/bin-rebuild-regressions.spec.ts`,
`packages/infra/cli/src/unresolved-workspace-import.spec.ts`):

- `console = …` in a sloppy dependency (node-forge, reached through web-ext and wxt) failed
  with `ASSIGN_TO_IMPORT`, because the console `inject` turns every free `console` into an
  import binding. Such a module now gets `var console = globalThis.console`
  (`plugins/console-assign.ts`), decided on the AST so a parameter or a `const console` is not
  mistaken for the global.
- `"import.meta.url"` as a STRING — vite's and wxt's `define` keys — was rewritten inside the
  quotes into `"__gjsifyModuleUrl("vite/…")"`: the two `PARSE_ERROR: Expected ':' but found
  Identifier` the first wxt attempt reported. The rewrite now replaces the expression on the AST,
  and answers `import.meta.dirname`/`.filename` too, which GJS does not define.
- A `.cjs` entry's virtual wrapper kept the extension and was parsed as CommonJS.
- The `--globals auto` gate checked only the project for each register, so a consumer with no
  `@gjsify/*` lost every global the toolchain resolver would have supplied.
- The workspace-import guard answered a CONCURRENT resolution of the same package with `null`
  (its re-entrancy belt shared the cache's key), so the import was externalised whenever the
  scheduler interleaved two askers — web-ext lost the module-resolve shim in five of six
  command modules, vite kept a bare `node:path`. Concurrent askers now share one resolution;
  the belt recognises the guard's own probes by a `custom` marker.

A rebuilt bin also needs the native prebuilds of polyfills that came from the toolchain, so
`gjsify exec` adds the CLI's own tree to the typelib/library search (`nativeRoots`).

Missing Node surface the rebuilds hit, added where it belongs: `util.parseEnv` (ported from
`node_dotenv.cc`), `fs/promises.constants`, `stream.promises`, `dns.promises`, `module.Module`,
and a mutable `require('fs')` (graceful-fs patches it in place; the ESM namespace threw).

What `exec` does NOT promise: that every Node bin runs. The rebuild inherits every gap in the
polyfills, and a failure is now a named one. The smoke matrix at acceptance and the gaps still
open are in [docs/bundled-toolchains.md](../bundled-toolchains.md) § `gjsify exec`.
