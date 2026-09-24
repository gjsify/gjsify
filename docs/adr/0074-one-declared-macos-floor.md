# 74. Every shipped darwin binary targets one declared macOS floor: 15.0

- Status: **Accepted**
- Date: 2026-09-24
- Deciders: Pascal Garber
- Related: `packages/infra/manifest-conformance/lib/platforms.mjs` (`DARWIN_DEPLOYMENT_TARGET`),
  `packages/infra/manifest-conformance/lib/rules/prebuild-darwin-target.mjs`,
  `.github/actions/darwin-deployment-target/action.yml`,
  `packages/node-gi/scripts/build-gtk-runtime-darwin.mjs`, ADR 0017, ADR 0022, ADR 0013

## Context

Nothing in the repository set `MACOSX_DEPLOYMENT_TARGET` or `-mmacosx-version-min`,
except `@gjsify/webkit-native`'s `meson.build` (11.0, ADR 0022). Without either, clang and
rustc pick a default, and that default is a fact about the BUILD MACHINE. Every Mach-O
records the result as `minos` in `LC_BUILD_VERSION`, and dyld refuses to load an image
whose `minos` is newer than the running OS. So the oldest macOS a gjsify binary loads on
was decided by whichever runner image GitHub currently calls `macos-latest`.

Measured on 2026-09-24 (`otool -l … | grep -A4 LC_BUILD_VERSION`, origin/main `bf1acaac5`
and the 0.52.0 tarballs on npm):

| Artifact | darwin-arm64 | darwin-x64 | Why |
|---|---|---|---|
| Vala/C bridges built by meson (tls, http2, http-soup-bridge, terminal, webgl, the three Rust bridges' Vala half) | **26.0** | 15.0 | clang's default = the runner's SDK major (`macos-latest`, `macos-15-intel`) |
| Rust cdylibs (`libgjsify_{lightningcss,oxfmt,rolldown}`) | 11.0 | 10.12 | rustc's own per-arch default |
| `libgjsifywebkit` | 11.0 | 11.0 | pinned in `meson.build` (ADR 0022) |
| `@gjsify/napi-darwin-arm64` | **26.0** | — | same as meson, built on `macos-latest` |
| `@gjsify/node-gi` `.node` | 13.5 | 13.5 | node-gyp inherits Node 24's `common.gypi` |
| `@gjsify/node-runtime-darwin-arm64` | 13.5 | — | Node.js's own release floor |
| `@gjsify/gtk-runtime-darwin-*` (117 / 119 images) | **26.0** | 14.0 – **15.0** | Homebrew bottles carry the OS they were poured for |

Nothing documented a platform-wide floor. The only stated numbers were per-feature:
macOS 11 for web views (ADR 0022, the website) and 14.4 for `os_sync_wait_on_address`,
the API ADR 0013 plans `@gjsify/sab-native`'s macOS port on. A user on macOS 15 installing
any 0.52.0 darwin-arm64 prebuild would have failed at `dlopen` — the least debuggable
failure shape there is — while every doc said nothing that ruled their machine out.

## Decision

**One number, macOS 15.0, is the floor for every darwin binary this repository ships, and
it is declared once: `DARWIN_DEPLOYMENT_TARGET` in
`packages/infra/manifest-conformance/lib/platforms.mjs`.**

Why 15.0 and not lower:

1. **The GTK runtime bounds it, and 15 is the lowest the runtime can reach.** The bundled
   GTK closure is Homebrew bottles, and a bottle's `minos` is the OS its bottle tag names —
   no flag we pass changes it. The x64 bundle is built on `macos-15-intel`, the LAST
   x86_64 image Actions offers, and already measures 15.0 (`libpcre2-8`, `liblzma`,
   `libzstd`, `libsqlite3`, `libgmp`). Going below 15 would mean building the runtime on a
   `macos-14` image, which buys one OS version on an image with a shorter horizon than the
   one it replaces.
2. **Every API we call is older.** `WKContentWorld` is macOS 11 (ADR 0022);
   `os_sync_wait_on_address` is 14.4 (ADR 0013). A floor of 15 needs no
   `__builtin_available` guard anywhere today, and the day sab-native's macOS port lands it
   calls those functions unguarded against a declared target that permits it.
3. **It matches Apple's support window.** Apple ships security fixes for the current
   release and the two before it — 27, 26 and 15 on the date of this ADR.

How it is applied — one definition, three consumers:

- **Compiled code (meson + clang, valac's generated C, cargo/rustc)** reads the
  environment variable `MACOSX_DEPLOYMENT_TARGET`, which all three honour. Every CI job that
  builds a darwin binary somebody ships runs `.github/actions/darwin-deployment-target`,
  which exports the variable from the constant. No `meson.build` carries a copy.
  `@gjsify/webkit-native` keeps its explicit `11.0`: it is that library's API floor (clang
  flags any unguarded call newer than it), it is below 15.0, and so it narrows nothing.
- **The GTK runtime bundles** are built on the runner whose bottles meet the floor:
  `macos-15` for arm64, `macos-15-intel` (already) for x64. `build-gtk-runtime-darwin.mjs`
  measures every image it bundles and FAILS when one exceeds the floor, so a runner-image
  change that raises it goes red on the builder instead of reaching a user.
- **node-gyp** (`@gjsify/node-gi`) is left alone: Node 24's `common.gypi` passes
  `-mmacosx-version-min=13.5` explicitly, which is below the floor. Writing 15.0 into
  `binding.gyp` would be a second copy of the number with no effect on who can load it.

How it is checked: the portable `prebuild-darwin-target` rule reads `minos` out of every
Mach-O under a committed `prebuilds/darwin-*/` directory with the one binary parser
(`lib/binary.mjs`, `LC_BUILD_VERSION` and the older `LC_VERSION_MIN_MACOSX`) and fails when
it is newer than `DARWIN_DEPLOYMENT_TARGET`. An image with no version record at all is a
failure too — "not measured" must not read as "fits".

## Consequences

- **The committed darwin-arm64 prebuilds violate the floor until CI rebuilds them.** They
  are only ever produced by `prebuilds.yml`'s `commit-prebuilds` on `main`, and this change
  touches `packages/infra/manifest-conformance/**` and `prebuilds.yml`, both shared inputs
  that rebuild every package. So the rule arrives in REPORT mode in this repository
  (`audit-runtimes.mjs` passes `darwinDeploymentTarget: 'report'`): every violation is
  printed as a note on every run, and nothing fails. Flipping it to `'enforce'` is a
  one-line follow-up once `commit-prebuilds` has landed the rebuilt artifacts, tracked in
  `status/open-todos.md`. Report mode is chosen over a per-package exemption because the
  exemption would have had to live in 14 GENERATED manifests and be cleared by the same
  commit that lands the artifacts — machinery this one-off transition does not justify.
  Outside this repository the rule enforces by default.
- **Raising the floor is a one-line change** to the constant, and because
  `packages/infra/manifest-conformance/**` is a shared input to `prebuilds.yml`, that one
  line rebuilds every darwin prebuild. Lowering it below 15 is not a one-line change: the
  runtime bundles would have to move to an older runner first, and the builder's own check
  says so.
- The linker warns "linking with dylib … which was built for newer version" on runners
  newer than the floor. That is expected: a prebuild links against install NAMES, and at
  run time dyld resolves them to the user's own Homebrew or to the bundled runtime, both of
  which meet the floor on a supported OS.
- `darwin-x64` has its own horizon (`macos-15-intel` until August 2027, prebuilds.yml).
  When that image goes, x64 goes with it; the floor does not have to change for that.
