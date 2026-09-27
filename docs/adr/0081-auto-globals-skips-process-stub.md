# 0081: `--globals auto` skips process stub in analysis builds

**Status**: Accepted  
**Date**: 2026-09-27

## Context

The `--globals auto` analysis bundles were detecting `process` from the
byte-1 process stub banner (written in `renderChunk`), causing
`@gjsify/process` to be injected into **every** GJS bundle regardless of
whether the source code used it.

The process stub is necessary for final GJS bundles (packages like `glob`,
`path-scurry`, `readable-stream` read `process.platform` at top level during
`__esm` lazy init, before any import side effects fire). But it must not run
during the analysis bundles used for global detection.

Measured impact: an empty entry with `--globals auto` produced a 140 KB bundle
(injecting `@gjsify/process` + closure) instead of ~3 KB.

## Decision

Add `skipProcessStub` option to `PluginOptions` in
`packages/infra/rolldown-plugin-gjsify/src/types/plugin-options.ts`.

The `detectAutoGlobals` function in `packages/infra/rolldown-plugin-gjsify/src/utils/auto-globals.ts`
passes `skipProcessStub: true` for analysis builds.

The final build (which calls `setupForGjs` without this flag) still includes
the process stub for GJS apps that need it.

## Consequences

- `--globals auto` analysis bundles no longer self-detect `process`
- Empty/minimal entries with `--globals auto` now produce ~3 KB bundles (was 140 KB)
- Final GJS bundles still get the process stub for apps that need it
- No behavioral change for end users — only build-time optimization

## References

- Fixes #1676
- Implementation: `packages/infra/rolldown-plugin-gjsify/src/types/plugin-options.ts`
- Implementation: `packages/infra/rolldown-plugin-gjsify/src/app/gjs.ts`
- Implementation: `packages/infra/rolldown-plugin-gjsify/src/utils/auto-globals.ts`

