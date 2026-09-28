# ADR 0083: OS axis — packages whose data is generated on one OS

## Status

Proposed

## Title

OS axis — packages whose data is generated on one OS

## Context

ADR 0018's `os-axis` rule derives its candidate set from **shipping source that branches on the operating system**. The derivation is deliberate: reading the runtime clause as covering operating systems is how the native-bridge set stayed Linux-only while describing itself as platform-independent, and a support claim derived from source beats a hand-maintained list that drifts.

**It has a blind spot.** `@gjsify/gtk-host` reads the operating system nowhere — zero hits across `src/**`. By the rule it correctly owes no `gjsify.os` declaration. And it ships a **Linux-shaped widget table**: generated from the GIR on a Linux host, offering GTK's Unix print stack (`GtkPageSetupUnixDialog`, `GtkPrintUnixDialog`, `GtkPrinter`, `GtkPrintJob`, and eight more identifiers) as though those classes existed everywhere. On Windows they do not, and the suite fails 6 of 2264 there against 2274 of 2274 on both darwin arms.

The generalisation:

> **A package whose DATA is derived on one operating system owes an OS statement, even when its SOURCE never reads the operating system.**

The rule looks for a branch. There is no branch. The platform assumption entered through the *input* to a generator, not through a conditional — a shape the current derivation cannot see by construction.

A second, independently measured failure of the same derivation: `audit-runtimes --check` went red on a branch whose only change was to `gtk-host`'s style layer. The rule reported the package as "reads the host operating system" on the strength of **two JSDoc lines** — one of them the sentence explaining that the module **never** reads `process.platform`. The patterns are textual, and text does not distinguish a comment from a statement.

Stripping comments before matching dropped 14 matches across 9 packages, and three packages fell to zero sites. One was the false positive. The other two were being held by accident, through a comment:

| package | how it actually reads the OS | matched by any pattern |
|---|---|---|
| `@gjsify/os` | `mapSysname(cli('uname -s'))` — there is no `process` to ask | **no** |
| `@gjsify/child_process` | probes `/proc/self/status`, the macOS version plist, `/system/bin/sh` | **no** |

Both already declare `gjsify.os` correctly, so nothing in the tree was wrong. But the coverage holding those two declarations in place was **incidental** — a comment happened to contain a matching word.

## Decision

Add a **second derivation signal**, beside "source branches on the OS": *this package ships data generated from a platform-specific input.*

The signal is carried by a manifest field `gjsify.osDerived: true` on packages whose generated artefacts encode platform-specific data. The field is a declaration, but it is a declaration with a **provenance obligation**: the package must name the generator and the input it reads, so the claim is auditable.

`audit-runtimes --check` treats `gjsify.osDerived: true` as equivalent to a source-level OS branch for the purpose of requiring `gjsify.os` + `gjsify.osNotes`.

The comment stripper in the OS-axis detector is replaced by the canonical stateful scanner (`packages/infra/manifest-conformance/lib/strip-comments.mjs`), which is one-directional and already imported by 12 other scripts.

## Consequences

- `@gjsify/gtk-host` declares `gjsify.osDerived: true` and `gjsify.os` + `gjsify.osNotes` naming the GIR as the platform-specific input.
- Packages whose OS coverage was incidental (`@gjsify/os`, `@gjsify/child_process`) keep their declarations; the detector no longer depends on a comment containing a matching word.
- The detector's pattern list is not widened — a widened pattern is a guess about which packages have OS-derived data, made by a regex over source that does not contain the fact.
- ADR 0018's `docs/runtime-platform-axes.md` is updated to document the second signal.

## Not to be lost

The reason the blind spot survived: **the only place that can answer "does the running GTK have this class" is where a typelib is loaded.** The conformance test that asks it (`generated.spec.ts`, "is every emitted name real") existed the whole time and had only ever run on Linux, where the answer is trivially yes. A test can be a correct question aimed at a host that cannot give a wrong answer — which is why a second OS leg is a *measurement*, not a duplicate.
