# Package convention

Layout and release-train rules for every `@gjsify/*` package.

## Package layout

`packages/<pillar>/<name>/` → `@gjsify/<name>`. One workspace version (release train, ADR 0008 — compatibility guaranteed only within a release). Every package is `"type":"module"`.

Exports:

- `./lib/esm/index.js` (always)
- `./lib/esm/register.js` only if the package provides globals
- `sideEffects` pinned to register-only — a package with no `/register` pins the one module that mutates the realm

Scripts:

- `build:gjsify`
- `build:types`
- `build:test:{gjs,node}`
- `test`
- `test:{gjs,node}`

Dependencies:

- `@girs/*` as runtime deps
- `@gjsify/unit` as devDep
- workspace deps use `workspace:^`

Source layout:

- `src/index.ts` — pure named exports
- `src/register.ts`
- `src/*.spec.ts`
- `src/test.mts`

Full register rules are in the runtime-and-platform model doc: [`runtime-platform-axes.md`](runtime-platform-axes.md).

## Shared utils

`@gjsify/utils` — check before duplicating; extract only when a second package needs it. The `/core` vs barrel split is covered in [`runtime-platform-axes.md`](runtime-platform-axes.md).

`@gjsify/stream` direct imports are allowed in internal modules/tests that need non-standard exports; all public code uses `node:stream`.

## New package names

A new `@gjsify/*` name needs a manual npm first-publish plus Trusted Publisher bootstrap **before** the release that ships it. Skipping it does not stall the train — the sweep skips it and ships its dependents instead (#1713). See [`publishing.md`](publishing.md).

## Channels

Two dist-tags: `latest` (the train) and `next`. A nightly at 03:00 Europe/Berlin republishes the whole sweep as `<next patch>-next.<run number>`, rewritten in the CI checkout and **never** committed (ADR 0111). A new publishing job belongs in `release.yml` because Trusted Publishing is registered against that filename. See [`publishing.md`](publishing.md) § A second channel.
