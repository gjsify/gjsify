# ADR 0018 — The OS axis is a declared, checked claim; three platforms are the target

- **Status:** Proposed (2026-08-05)
- **Scope:** `package.json#gjsify.os` (new), `gjsify.platforms` (unchanged), `@gjsify/manifest-conformance` (new `os-axis` rule), AGENTS.md § Runtime & platform model + § Strategy ("Opportunistic, not driven"), CI leg coverage per OS

## Context

Linux, macOS and Windows are now an explicit project goal, not an aspiration. The
runtime & platform model already names four orthogonal axes and insists that
**no declaration exists without a machine check**. The OS axis is the one that
does not hold up to that rule, and the gap is not where it looks.

Measured on `main` at 2026-08-05, over the 190 manifests under `packages/*/*`:

| | count |
|---|---|
| declare `gjsify.runtimes` (runtime axis) | 106 |
| declare `gjsify.platforms` (OS axis) | 74 |
| branch on the OS in their own `src/**` | 16 |
| **of those 16: declare no OS axis at all** | **10** |

The ten: `cli`, `fs`, `os`, `process`, `child_process`, `util`, `utils`,
`node-globals`, `web-globals`, `rolldown-plugin-gjsify`.

So the axis is declared almost exclusively by packages that ship a **binary**
(60 of the 74 are the per-target packages ADR 0017 generates), and it is absent
from nearly every package that makes an OS **decision** — including
`@gjsify/cli`, the one package that writes `PATH` / `DYLD_LIBRARY_PATH` /
`LD_LIBRARY_PATH` per host and generates the launcher every other package is
started through.

`gjsify.platforms` cannot close this. It answers a different question by design
("I promise a prebuilt artifact for these `<os>-<arch>` targets", checked by
opening the binary), and a package with no native build has nothing to declare in
it. Nor can the runtime axis: it is blind to operating systems on purpose, and
that blindness is already documented as measured — the whole native-bridge set
stayed Linux-only while the project described itself as platform-independent.

The cost of the gap is not hypothetical. Four defects found in a single day of
running the published 0.28.0 on the Windows and macOS test VMs, none of which
any existing check could have surfaced, because every one lives in code that
branches on the OS while declaring nothing about it:

| | defect | mechanism |
|---|---|---|
| 1 | the shipped `loaders.cache` lists gdk-pixbuf loaders by **relative** path | a relative entry resolves against the package install dir, not `GDK_PIXBUF_MODULEDIR`; `Pixbuf.get_formats()` still reports `svg` because it reads the cache TEXT, so only a real decode is a signal |
| 2 | the win32 bundle needs the MSVC redistributable | undeclared prerequisite; surfaces as a bare `ERR_DLOPEN_FAILED` on a `.node` that is present, with no diagnostic naming the missing dependency |
| 3 | the darwin addon links **absolute Homebrew install names** | two GObject type registries in one process ⇒ every cross-boundary type check fails (`GDK_IS_PIXBUF` assertion, boxed struct typed as `GIRepository`) |
| 4 | `Adw.init()` dies with `0xC0000005` on win32 | only reproducible outside an interactive console session — which is also what a GitHub Windows runner is |

Defect 3 is the sharpest illustration: the release gate that was supposed to
cover it counted `iconFiles: 860` and `verified icons: 863` — **file counts**,
which a bundle of unloadable binaries passes.

## Decision

1. **The target set is declared, and it names what verifies it.** `linux-x64`,
   `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`. Anything outside it
   (the QEMU-emulated `linux-{ppc64,s390x,riscv64}` legs) is *build-verified
   only* and says so — it is not part of the three-platform claim.

2. **New declaration `gjsify.os`** — per OS, what the package's CODE claims:

   ```jsonc
   "gjsify": {
     "os": { "linux": "supported", "darwin": "partial", "win32": "none" },
     "osNotes": { "darwin": "<why partial>", "win32": "<why none>" }
   }
   ```

   A value below `supported` REQUIRES a reason in `osNotes`. The reason is
   mandatory and printed on every run — the same shape as
   `gjsify.platformsUncommitted` and the `unchecked-fields` ledger, and for the
   same purpose: an honest "not supported here" is available, a silent gap is
   not.

3. **The declaration is required exactly where it is NOT derivable.** For a
   package with no OS-conditional code and no native dependency, OS support
   derives to all three and authoring it would restate a derivable fact — which
   the status/conformance rules already forbid. For a package that branches on
   the OS, the claim carries real information no derivation can produce: nothing
   in `if (process.platform === 'win32') …` says whether that branch is correct
   or a stub. So the candidate set is DERIVED and the declaration is demanded
   only for its members.

4. **New conformance rule `os-axis`** (in `@gjsify/manifest-conformance`, hence
   selected by `audit-runtimes --check` on every PR, no install, no build). It
   fails on: a package whose own source makes an OS decision and declares no
   `gjsify.os`; a non-`supported` value with no `osNotes` reason; a key naming an
   OS outside the target set; and — the direction that keeps the ledger honest —
   an `osNotes` entry for an OS declared `supported`.

5. **A declared OS needs a CI leg that exercises CAPABILITY, not just build.**
   State the current asymmetry rather than implying parity: the macOS leg is off
   on PRs (10× billing, `ci:macos` opts in), and Windows appears only in
   `cli-cross-platform.yml`, which diagnoses a *published* CLI and therefore
   structurally cannot gate PR code. Consequence, to be written where it can be
   read: **the OS axis is verified on `main` and the nightly, not on every PR.**

## Consequences

- The ten packages above must each answer for three operating systems, once, in
  review. That is the point: `@gjsify/fs` branching on the OS while claiming
  nothing is how a win32 path bug reaches a user through a green pipeline.
- A new package pays nothing unless it makes an OS decision.
- `gjsify.platforms` keeps its meaning untouched; the two axes stay separate and
  neither may answer the other's question. A package can legitimately declare
  `os.win32: "supported"` with no win32 entry in `platforms` (pure TS), and the
  reverse is a contradiction the rule should eventually catch.
- The three local test machines (win11 VM = win32-x64, macOS Sequoia VM =
  darwin-**x64**, OnePlus 6T/postmarketOS = the only native linux-arm64) are the
  only place a contaminated-host failure mode is observable at all — CI's legs
  are named "no brew GTK" / "no gvsbuild", so a host with a system GTK is
  structurally outside what CI can see. They are part of the verification story,
  not a convenience.

## Implementation

1. Add the rule + the field to the conformance registry (`field-coverage`
   derives the `gjsify.*` key set and fails on any key no rule claims, so the
   field cannot land without the check).
2. Backfill the sixteen OS-deciding packages, reasons included; every
   non-`supported` value gets a `status/open-todos.md` entry naming the port.
3. Record the four defects above as the regression set — each becomes a test at
   the layer that can see it: a real pixbuf **decode** (not `get_formats()`), an
   import-closure check for the win32 dependency, a `dlopen` with the loader
   env unset for the darwin install names, and a non-interactive-session run for
   `Adw.init`.
4. Update AGENTS.md § Strategy: "Opportunistic, not driven" describes the
   RUNTIME axis and must not be read as covering the OS axis, which is now
   driven.

## Do not

- **Do not answer an OS question with the runtime axis.** It is blind to
  operating systems by design, and that blindness is measured, not theoretical.
- **Do not let a file count stand in for a load.** Defect 3 passed a gate that
  counted 863 icons; the artifacts were unloadable. Every OS gate ends in an
  operation the OS actually performs — a decode, a `dlopen`, an `init`.
- **Do not declare an OS whose only evidence is that the build succeeded.**
  Cross-compiling proves a compiler ran. `linux-{ppc64,s390x,riscv64}` are
  build-verified and named as such precisely so the five real targets keep
  meaning something.
