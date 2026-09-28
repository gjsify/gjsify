# ADR 0083 — OS axis second derivation signal

## Status

Proposed

## Context

The OS axis (ADR 0018) declares what the CODE claims (`gjsify.os`) and what a
package PROMISES (`gjsify.platforms`). Both are declarations in `package.json`,
checked by conformance rules.

But some packages generate data at BUILD TIME that encodes platform-specific
facts. A package that ships a generated `.gir` for a Linux build, or a
generated bundle that embeds `process.platform`, has OS-derived data that is
NOT declared in `package.json` — it is a build output.

The question: how does the OS axis account for OS-derived data that is not a
declaration but a build artefact?

## Decision

Introduce a second derivation signal: `gjsify.osDerived: true` on packages
whose generated artefacts encode platform-specific data.

This is NOT a replacement for `gjsify.os` or `gjsify.platforms`. It is a
complementary signal that says: "this package's build output is OS-specific,
and the OS axis must account for that."

The signal is:
- `gjsify.osDerived: true` — the package's build output encodes OS-specific data
- `gjsify.os` + `gjsify.osNotes` — the package's source code branches on the OS

The two signals are independent: a package can have OS-derived data without
branching on the OS in source (e.g. a generated `.gir` that is always the same
but is only used on one OS), and a package can branch on the OS in source
without generating OS-specific data (e.g. a runtime check that does not affect
the build output).

## Consequences

- `gjsify.osDerived` is a new `gjsify.*` key, and `field-coverage` fails on any
  key no rule claims. Either a rule claims it, or it gets an `uncheckedFields`
  entry with its reason.
- The OS axis now has two signals: `gjsify.os` (source branches) and
  `gjsify.osDerived` (build output is OS-specific).
- Packages that generate OS-specific data must declare `gjsify.osDerived: true`
  in addition to `gjsify.os` and `gjsify.platforms`.
