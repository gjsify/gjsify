# ADR 0020 — the GJS engine set becomes an `optionalDependencies` edge of `@gjsify/cli`

- **Status:** Proposed (2026-08-06)
- **Scope:** `packages/infra/cli/package.json` (`peerDependencies` → `optionalDependencies`), `utils/install-global.ts` (`GJS_ENGINE_PACKAGES`, `installGjsEnginePackages`, `hasBundlerEngineInstalled`), `commands/install.ts` (the global gate + the project top-up), `commands/self-update.ts` (the engine branch + its repair gate)

## Context

#1005 was closed by making a project install lay the engine down — an
install-time policy. This ADR records the shape that would make that policy
unnecessary, because `docs/governance.md` § `simplicity` requires asking *"does
the whole arrangement have a simpler shape?"* periodically rather than never, and
the answer here changed without anyone re-asking.

`@gjsify/cli` declares the engine set as **optional peers**:

```json
"peerDependencies":     { "@gjsify/rolldown-native": "workspace:^", "@gjsify/oxfmt-native": "workspace:^" },
"peerDependenciesMeta": { "@gjsify/rolldown-native": { "optional": true }, … }
```

The reason was concrete and correct: `@gjsify/rolldown-native` was **one tarball
carrying every target**, so a `dependencies` edge meant a Windows Node user
downloading Linux binaries.

**ADR 0017 removed that reason.** The bridge is now pure TypeScript
(`files: ["lib", "meson.build", "src/rust", "src/vala"]`) and every binary lives
in a per-target child that declares `os`/`cpu`. Measured on this tree:

| host | bytes fetched if the engines were `optionalDependencies` |
|---|---|
| win32-x64 | **0** — all four rolldown children and all four oxfmt children are linux/darwin |
| darwin-arm64 | 11 MB + 5.4 MB — exactly what that host needs to build under GJS |
| linux-x64, Node only | 13 MB + 6.4 MB — the only genuine waste |

So the cost the optional peer was avoiding is now paid by exactly one
configuration: a Linux host that installs the CLI and never builds under GJS.

## Decision

Move the engine set from optional `peerDependencies` to
`optionalDependencies` on `@gjsify/cli`.

### What it lets us delete

This is the half `simplicity` asks for first, and it is the argument:

- `installGjsEnginePackages()` + `GJS_ENGINE_PACKAGES` (`install-global.ts`)
- `hasBundlerEngineInstalled()` and its two callers
- the `packageNames.includes('@gjsify/cli')` gate in the global install path
- `self-update`'s engine branch **and its repair gate** — a prefix cannot be
  missing an ordinary locked edge
- `ensureProjectGjsEngine()` and its spec, i.e. the policy #1005 just added
- the `--immutable` special case, because the engine becomes an ordinary locked
  edge that `--immutable` installs like any other

### What it fixes that the install-time policy cannot

`gjsify install` is not the only installer consumers use. `npm install`,
`yarn` and `pnpm` reach none of the code above, so under the current shape a
consumer who installs with npm and builds under GJS still has no engine and
still gets no explanation. An `optionalDependencies` edge is honoured by all
four.

## Consequences

- A Linux Node-only consumer fetches ~19 MB it will not load. That is the whole
  cost, and it is the case ADR 0017's platform filter cannot help with because
  the host genuinely matches the target.
- `gjsify.platforms` / the prebuild-artifact invariants are untouched: the
  children already declare everything the audit reads.
- The optional-peer declaration was also *documentation* — it said "you may not
  need this". That intent moves into this ADR and the manifest comment, which is
  where a reader looks anyway.

## Do not

- **Do not make it a plain `dependencies` edge.** A missing prebuild for an
  exotic target must stay non-fatal; `optionalDependencies` is what makes an
  unresolvable child a warning rather than a failed install.
- **Do not implement this and keep the install-time top-up.** Two mechanisms
  doing one job is the redundancy `simplicity` flags, and the one that survives
  should be the one that also works for npm/yarn/pnpm.
- **Do not do it in the #1005 PR.** `governance.md` requires an ADR *before*
  implementation for a change to a published contract, and
  `package.json#peerDependencies` on a published package is exactly that.

## Trigger

Implement on a release cut that is already paying package-manifest churn, so the
contract change lands with a version bump rather than between two.
