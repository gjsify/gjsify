# 0080: `@gjsify/tsc` declares builtin substitution dependencies

**Status**: Accepted  
**Date**: 2026-09-27

## Context

`@gjsify/tsc` bundles upstream TypeScript's `_tsc.js` under `--app gjs`,
which reaches six Node builtins (`fs`, `crypto`, `inspector`, `os`, `path`,
`perf_hooks`) through the alias substitution layer, without declaring their
`@gjsify/*` targets as dependencies.

On a narrow-core runner (macOS arm64 CI, 3 cores), `@gjsify/tsc` could start
building before `@gjsify/fs` finished:
`UnresolvedWorkspaceImportError: cannot resolve @gjsify/fs`.

## Decision

1. Add all six as `workspace:^` dependencies of `@gjsify/tsc` in its `package.json`
2. Add validation script `scripts/check-builtin-substitution-deps.mjs` that
   mirrors the build-order check from #1830 one layer down — it fails when a
   package's `--app gjs` build reaches a Node builtin whose `@gjsify/*`
   substitution is not one of its own declared dependencies
3. Scope the check to packages `gjsify foreach build -tp` actually sweeps
   (packages sequenced elsewhere, like `@gjsify/cli`, are correctly out of scope)
4. Wire into `audit-runtimes.yml` jobs right after the existing build-order check

## Consequences

- `@gjsify/tsc` now correctly declares its transitive dependency closure
- The validation script prevents regressions across all packages
- CI no longer has race conditions on narrow-core runners

## References

- Fixes the macOS arm64 CI failure where `@gjsify/tsc` could start building before `@gjsify/fs`
- Implementation: `packages/infra/tsc/package.json` (6 new deps)
- Implementation: `scripts/check-builtin-substitution-deps.mjs` (validation)
- Implementation: `.github/workflows/audit-runtimes.yml` (CI integration)

