---
title: Versioning
description: The @gjsify/* release train — what is compatible with what, and how to upgrade
---

All `@gjsify/*` packages are released as one coherent **release train**: every
release publishes the whole package set at a single version, and the packages
are tested against each other at exactly that version. Compatibility between
`@gjsify/*` packages is therefore guaranteed **only within the same release
version** — combinations like `@gjsify/fetch@0.18.x` + `@gjsify/http@0.17.x`
are never tested and not supported.

The practical rule: **upgrade all `@gjsify/*` dependencies together.**

## Upgrading

[`gjsify upgrade`](/gjsify/cli-reference/#gjsify-upgrade) is the supported tool
for exactly this:

```bash
# Bump every @gjsify/* dependency to the latest release train
gjsify upgrade --latest --filter @gjsify

# Monorepos: repair drift — re-align deps declared at mixed
# ranges across workspaces (offline, no registry calls)
gjsify upgrade --align

# CI gate: fail when dependency ranges have drifted apart
gjsify upgrade --check
```

After the write-back, run `gjsify install` to actually fetch the new versions.

## What is on the train — and what is not

- **On the train:** every published `@gjsify/*` package — Node.js modules,
  Web APIs, DOM bridges, native prebuilds, the CLI and build tooling.
- **Not on the train:** external peer dependencies (`vite`,
  `@nativescript/core`, …) keep their own honest semver ranges, and `@girs/*`
  type packages are versioned by
  [ts-for-gir](/gjsify/projects/ts-for-gir/) — keep the versions your
  scaffolded project pins, or bump them in lockstep with a `@girs` release.

The full rationale is recorded in
[ADR 0008 — Release-train versioning policy](https://github.com/gjsify/gjsify/blob/main/docs/adr/0008-release-versioning-policy.md).

## Package tiers

Every published package declares a stability tier in `package.json#gjsify.tier`,
verified in CI:

- **Tier 1 — core.** Stability promise: full dual-runtime CI, root-cause
  governance, no known-broken releases. The Node.js, Web and DOM pillars, the
  GTK bridge packages and the build tooling.
- **Tier 2 — product.** Best effort: tested and released on the train, but a
  breaking change may ship with a minor version and a changelog note. The
  Adwaita design-identity packages, storybook, devtools, the native app shell,
  the published showcases and [node-gi](/gjsify/projects/node-gi/).
- **Tier 3 — experimental.** No promise; new axes start here.

Dependencies may only point at the same or a lower tier, so an experimental
package can never destabilize a core one. The tier model is defined in
[ADR 0003 — Package tiering](https://github.com/gjsify/gjsify/blob/main/docs/adr/0003-package-tiering.md);
the current membership list lives in
[`STATUS.md`](https://github.com/gjsify/gjsify/blob/main/STATUS.md).
