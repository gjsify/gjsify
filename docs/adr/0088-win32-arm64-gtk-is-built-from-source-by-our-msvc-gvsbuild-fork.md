# 88. win32-arm64 GTK is built from source by our MSVC gvsbuild fork

- Status: **Accepted**
- Date: 2026-10-02
- Deciders: Pascal Garber
- Related: [ADR 0018](0018-os-axis-declaration.md) (the OS axis is a declared, checked claim),
  [ADR 0037](0037-gtk-runtime-bundles-carry-the-uri-source.md) (bundles carry an http(s) source and
  a TLS backend),
  [ADR 0056](0056-win32-audio-payload-is-bounded-by-gvsbuild.md) (the Windows bundle is bounded by
  gvsbuild's project list),
  [ADR 0059](0059-foreign-platforms-carry-their-own-configuration.md) (a foreign platform carries
  its own configuration), `status/open-todos/windows.md` § win32-arm64, #1117,
  gjsify/gvsbuild#1

## Context

`wingtk/gvsbuild` has no arm64 target: `base_project.py` hardcodes `self.platform = "x64"` and
every release publishes only `GTK{3,4}_Gvsbuild_<v>_x64.zip`. Everything Windows in this
repository stands on that ZIP, so `@gjsify/gtk-runtime-win32-arm64` had nothing to be built out
of, and `win32-arm64` was recorded as blocked upstream (#1117).

That blocker is a missing artifact, not a missing capability. gvsbuild builds GTK from source
with MSVC, and MSVC targets arm64. The only other Windows/ARM GTK anyone builds is MSYS2's
`CLANGARM64` (MinGW). Taking it would put GTK, the GL shim and the node-gyp addon on MinGW,
while the x64 addon and runtime are MSVC-ABI — a second toolchain for one architecture.

## Decision

**The arm64 stack comes from our fork `gjsify/gvsbuild`, MSVC end to end.**

1. **MSVC, not MinGW.** One toolchain keeps `node_gi.node`, the GTK DLLs and the
   `@gjsify/gtk-runtime-*` closure on one ABI and CRT family, and the x64 recipe (`binding.gyp`,
   `win-gi-gyp-flags.mjs`) transfers unchanged. `CLANGARM64`/MSYS2 is not used.
2. **The fork carries the arm64 platform** (gjsify/gvsbuild#1, branch `feat/arm64-platform`).
   It is a source-level addition to gvsbuild, not a patch set on top of a prebuilt ZIP.
3. **There is no prebuilt arm64 ZIP, so the prefix is built in the job.** arm64 legs run on
   GitHub `windows-11-arm`, install the fork with
   `pipx install git+https://github.com/gjsify/gvsbuild@<sha>`, build `C:\gtk-build\gtk\arm64\release`
   and cache it with `actions/cache` under an arm64 key. x64 is unchanged: the wingtk ZIP and
   the `GVSBUILD_VERSION` pin. This mirrors the x64 job (`node-gi.yml`
   `windows-gtk-windowing-runtime`, `release.yml` `publish-gtk-runtime-win32-x64`) with the
   download step replaced by a build step.
4. **The fork is pinned by commit SHA on its default branch**, after #1 merges — never a
   feature-branch head, which can move or vanish under a green cache key.
5. **Exit.** When upstream gvsbuild ships arm64 (the maintainer may propose the port upstream
   by hand; agents never file there), arm64 switches to the upstream version pin and the fork
   is retired.
6. **The token rule stands (ADR 0018).** `win32-arm64` enters `gjsify.platforms` only in the
   same PR that adds the CI leg producing it; `audit-runtimes --check` holds that line.

## Measured (2026-10-02)

- Fork CI run 36985111029 (head 66304a2): `Build GTK4 Binaries (ARM64)` is green on
  `windows-11-arm` with MSVC 14.51 (VS 2026), after backporting gobject-introspection's
  `g-ir-scanner` fix for MSVC 2026 macro quoting (C7772). Cold-cache duration: 1 h 32 min
  (09:15 → 10:48 UTC), against 1 h 4 min for the x64 GTK4 job in the same run.
- On a Windows 11 ARM64 VM, `@gjsify/node-gi` built natively (`vcvarsarm64`,
  `node-gyp --arch=arm64`) against a fork-built prefix: addon and GTK DLLs are AA64, no MinGW
  DLL is present, GTK 4.22.4 and Adw 1.9 are present and windows work. node-gi's Windows CI set (cross-runtime
  node list 39 files, smoke 5, windowing 4) is green after #1995 (two hostname-case test fixes).
- CRT: the addon links the static CRT and GLib the dynamic one — exactly as the published
  win32-x64 0.53.0. An audit found no allocation, `FILE*` or environment crossing the
  boundary, so it stays as is.

## Consequences

- The blocker moves from "upstream" to "our CI minutes": the work is ours and ordered in
  `status/open-todos/windows.md`.
- A cold arm64 prefix build is long (above) and the cache key decides whether a PR pays it.
  The key must cover the fork SHA, so a pin bump rebuilds once.
- arm64 needs the same two-pass gst-plugins-good build as x64 for `gstsoup.dll` /
  `souphttpsrc` (ADR 0037); until it lands, an arm64 bundle has no `http(s)` media source.
- `Graphene.Box` is opaque on every Windows target (`Vec3`/`Vec4` carry `opaque="1"` in the
  gvsbuild GIR; the typelib is byte-identical on x64 and arm64). That gap is shared, not
  arm64's, and is not fixed here.
- The fork is a maintenance liability by construction; clause 5 is its end date, and a fork
  that outlives an upstream arm64 port is a defect of this ADR.

## Alternatives considered

- **MSYS2 `CLANGARM64`.** Rejected: a MinGW GTK against an MSVC-ABI runtime mixes CRTs where
  GLib allocates what the consumer frees, or forces the addon and the GL shim onto MinGW too.
- **Wait for upstream.** Rejected: nobody is asking for arm64 there (the `arm64` issues are
  dependabot noise), so the wait has no end date.
- **Pin the fork's feature branch.** Rejected by clause 4.

## Implementation

The ordered remaining work is the ledger, not this record: `status/open-todos/windows.md`
§ win32-arm64. No code changes in the PR that records this decision.
