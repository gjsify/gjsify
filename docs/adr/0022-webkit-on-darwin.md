# ADR 0022 — `@gjsify/iframe` on macOS: Apple's WebKit behind a GObject shim; the widget half is a compositor, not an embed

- **Status:** Proposed (2026-08-07)
- **Scope:** `@gjsify/iframe` (Tier 3, Framework pillar) and its `WebKit.WebView` dependency; a prospective `@gjsify/webkit-native` + `*-darwin-{x64,arm64}` per-target set (ADR 0017 distribution, ADR 0018 OS axis). Binds nothing yet — nothing here is implemented.

## Context

**SKELETON — being written. See the draft PR for progress.**

`@gjsify/iframe` is the only `@gjsify/*` package that cannot run on macOS at
all, and the reason is not a missing install.

## Decision

TBD.

## Consequences

TBD.

## Do not

TBD.
