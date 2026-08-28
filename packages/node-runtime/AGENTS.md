# AGENTS.md — `packages/node-runtime` (bundled Node interpreters)

> Scope: this directory tree. Repo-wide rules live in the [root AGENTS.md](../../AGENTS.md) — read that first.
> NOT workspace members — published by `release.yml`'s `publish-node-runtime` job, not by the ubuntu `npm:publish` sweep.

### What these three are

`@gjsify/node-runtime-{darwin-arm64,darwin-x64,win32-x64}` each ship **one Node binary and Node's `LICENSE`**, nothing else, so a `gjsify ship` artifact for macOS or Windows can carry its own interpreter. **Linux gets no package on purpose**: a `.deb`/`.rpm` declares a dependency on the distribution's Node (`utils/ship/depends.ts` → `NODE_PACKAGE`), the way a `--app gjs` package declares `gjs`.

Shape is `@gjsify/gtk-runtime-*`'s (hand-written manifest, gitignored payload, `files:` overriding `.gitignore` at pack time), NOT `packages/node/tls-native-*`'s: that one commits its artifacts and machine-generates its manifest from `scripts/generate-platform-packages.mjs`, and a 120 MB binary must not be committed. The one place we diverge from gtk-runtime is the publish topology — its payload is BUILT on the OS it targets and needs a runner per OS; ours is a verified DOWNLOAD, so all three ride one ubuntu job and nothing here reads `process.platform`.

|**payload = `bin/node` (`bin/node.exe` on win32) + `bin/LICENSE` + `bin/manifest.json`, and never more.** The full distribution carries npm's bundled `node_modules` — 154 further LICENSE files in the win-x64 zip alone, i.e. 154 attribution obligations for code that is not being shipped. Node's own `LICENSE`, verbatim from the release, discharges MIT + Apache-2.0 §4(a)/(b) + BSD-3 cl. 2 + Unicode-3.0 + zlib + Artistic-2.0 + BlueOak-1.0.0 + ISC in one file. Zero copyleft in the binary; OpenSSL is upstream 3.5.7 under Apache-2.0 ALONE (not quictls — no advertising clause, no "Eric Young" attribution) and no bundled Apache component ships a `NOTICE`.
|**Ship from a release TAG, never from `main`.** `deps/sqlite` is compiled in and unlisted in `LICENSE` (harmless, public domain) — which proves the file is a curated notice and not a generated inventory. On `main`, `deps/libffi` and `deps/perfetto` are also unlisted and DO require attribution.
|**Nobody declares these as a dependency.** Same rule as `@gjsify/gtk-runtime-*` ([docs/publishing.md](../../docs/publishing.md)): resolved BY NAME by whoever ships the app, no `optionalDependencies` edge, so `verify-published-closure.mjs` has no edge to check and the publish job is the guard. Making a runtime bundle a library's dependency was #910 (reverted in #920). The resolver is `utils/ship/node-runtime.ts` in the CLI, mirroring `resolveGtkRuntimeBundle()`; the override is `GJSIFY_NODE_RUNTIME`.

### Four traps, every one of them silent

1. ⚠️ **`https://nodejs.org/dist/<v>/win-x64/` carries NO LICENSE** — only `node.exe`, `node.lib`, `node_pdb.*` (measured on v24.20.0). It is the convenient route (93 MB, no unzip) and it drops the redistribution obligation with nothing to notice. `TARGETS` in `scripts/node-release.mjs` names the `.zip`/`.tar.xz` for this reason and no other; `verify-node-runtime.mjs` says so in the failure text.
2. ⚠️ **One release ships `LICENSE` twice, byte-different** — 157,609 B LF (tarballs) / 160,555 B CRLF (zip), 2,946 CR, one per line. `EXPECTED_LICENSE_BYTES` is a **Set** for that reason: a single value passes two targets and fails the third, and the failure reads as a corrupt download. A Node bump changes both numbers and must fail here — that is the moment to re-read what is being redistributed.
3. ⚠️ **`bundled-license`'s `PAYLOAD_DIRS` is a literal set.** It was `new Set(['gtk'])`; `'bin'` is in it now. Unextended, a package with `files: ["bin"]` carrying a Node binary could declare `"license": "MIT"` and CI would say nothing — verbatim the defect the rule exists to close.
4. ⚠️ **`NON_WORKSPACE_PUBLISHABLE_DIRS` is hardcoded** in `packages/infra/cli/src/utils/publishable-packages.ts`. `['packages','node-runtime']` is in it now. Without it `gjsify onboard`/`trust` under-report silently and the first release 404s on the OIDC exchange — how `@gjsify/napi` was missed while onboard called 127 packages "already done".

### Bumping the Node version

`NODE_VERSION` in [`scripts/node-release.mjs`](scripts/node-release.mjs) is the only place it is written. A bump means: re-measure both `LICENSE` byte lengths from the `.tar.xz` AND the `.zip`, update `EXPECTED_LICENSE_BYTES`, and re-check `DEFAULT_NODE_FLOOR` in `utils/ship/depends.ts` — the floor is what excludes Debian stable, so raising it is a decision, not a bump.

### First publish

These three names do not exist on npm yet. The bootstrap (`gjsify onboard`, then `gjsify trust` targeting **`release.yml`**) is a manual maintainer action and must happen **before** the release that ships them. ADR 0024 § Consequences claims `ship` costs "no new published npm name, so no first-publish bootstrap" — these are the first time that stops being true.
