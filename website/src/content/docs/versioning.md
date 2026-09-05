---
title: Versioning
description: How to upgrade @gjsify/* safely, which versions work together, and how much stability each package promises.
---

**Upgrade all your `@gjsify/*` dependencies together, to the same version.** That is the whole rule.

Every release publishes the entire package set at one version, and the packages are tested against each other at exactly that version. Mixing them (`@gjsify/fetch@0.46.x` with `@gjsify/http@0.45.x`, say) is untested and unsupported.

## Upgrade

```bash
# Bump every @gjsify/* dependency to the latest release
gjsify upgrade --latest --filter @gjsify

# Then fetch the new versions
gjsify install
```

`gjsify upgrade` only rewrites `package.json`. Nothing lands in `node_modules` until you run `gjsify install` after it.

Preview first with `--dry-run`, and restrict the sweep with `--workspace <pattern>` if you only want part of a monorepo. Every flag is listed in the [CLI Reference](/gjsify/cli-reference/#gjsify-upgrade).

## Repair a monorepo that has drifted apart

In a workspace, different packages can end up declaring the same dependency at different ranges. `--align` fixes that offline, with no registry calls: it finds every dependency declared at more than one range and pulls them all up to the highest.

```bash
gjsify upgrade --align
```

## Catch drift in CI

`--check` is the gate that pairs with `--align`. It makes no registry calls and exits non-zero as soon as any dependency is declared inconsistently across workspaces.

```bash
gjsify upgrade --check
```

## Pin without a range operator

Consistency is not exactness. A tree where every manifest agrees on `^4.1.0` passes `--check` and still lets a minor release move under a consumer's lockfile-less install, so a package whose subpaths you depend on wants the whole version declared. `--exact` is that question, on both sides of the pair: `--check --exact` is the gate, and `--align --exact` is the repair — offline, keeping each declared version and dropping only the operator.

```bash
gjsify upgrade --check --exact --filter @girs   # gate
gjsify upgrade --align --exact --filter @girs   # repair, offline
gjsify upgrade --latest --exact --filter @girs  # repair at the newest release instead
```

Pair `--exact` with `--filter`. Without one it reaches every dependency you declare, and an ordinary caret on a third-party package is not a defect.

## What moves together, and what does not

**Moves together:** every published `@gjsify/*` package. The Node.js modules, the Web APIs, the DOM bridges, the native prebuilds, the CLI and the build tooling all carry the same version number.

**Keeps its own schedule:**

- External peer dependencies such as `vite` and `@nativescript/core` keep honest semver ranges of their own.
- `@girs/*` type packages are versioned by [ts-for-gir](/gjsify/projects/ts-for-gir/). Keep the versions your scaffold pinned, or bump them together with a `@girs` release.

## How much stability to expect

Every package declares a tier in its own manifest, and the declaration is checked rather than taken on trust.

**Tier 1, core.** Its whole test suite runs on both GJS and Node before every release, and no release ships with a known break in it. This is the Node.js, Web and DOM pillars, the GTK bridge widgets and the build tooling, which is nearly every package you will ever import.

**Tier 2, product.** Tested and released on the same train, but a breaking change can arrive in a minor version with a changelog note. This covers the Adwaita packages, storybook, devtools, the native app shell, the published showcase apps and [node-gi](/gjsify/projects/node-gi/).

**Tier 3, experimental.** No promise at all. New directions start here: today that is [`@gjsify/napi`](/gjsify/projects/napi/) with its shim prebuilds, the browser and CDP devtools adapters, the prebuilt GTK and Node runtime bundles that let a macOS or Windows artifact carry its own, the [GTK host](/gjsify/frameworks/) and the [React Native layer](/gjsify/frameworks/react-native/) over it. Each package's own `gjsify.tier` field is the authority — this list is what those fields say.

A package's runtime dependencies may only point at its own tier or a lower one, so nothing experimental can end up underneath something core.

## Related

- [CLI Reference](/gjsify/cli-reference/#gjsify-upgrade), all `gjsify upgrade` flags
- [Runtimes](/gjsify/runtimes/), what is validated on GJS, Node.js, Bun, Deno and the browser
- [Platform Support](/gjsify/platform-support/), which operating systems each native bridge reaches
