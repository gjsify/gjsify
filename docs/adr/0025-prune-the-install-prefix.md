# 25. Prune the install prefix — remove what this host cannot use, and only that

- Status: **Accepted** — the platform rule and both surfaces have landed; the reachability rule is deferred, see § Deferred
- Date: 2026-08-17
- Deciders: Pascal Garber
- Related: [ADR 0001 (install/clean separation)](0001-install-clean-separation.md), [ADR 0017 (native distribution)](0017-native-package-distribution.md), [ADR 0018 (OS-axis declaration)](0018-os-axis-declaration.md), `status/open-todos.md` § *A pruned prefix still cannot prove what it was assembled from*

## Context

An install prefix is a write-only union. `applyPlatformFilter` keeps a foreign-platform package
from being installed, and **nothing has ever removed one that an earlier install placed**. There
is no prune, no gc and no `--clean` anywhere in the CLI.

Measured on a workstation whose user-global prefix was created 2026-05-17, with the CLI current:

```console
$ du -sh ~/.local/share/gjsify/global
638M
$ du -sh ~/.local/share/gjsify/global/node_modules/@rolldown
258M
```

`@rolldown` alone is sixteen platform bindings on a host that can load exactly one. `lightningcss`
repeats the shape.

### It is accretion, and the versions prove it

This matters, because "the filter is broken" and "the filter arrived late" call for opposite fixes.
The on-disk **versions** separate them, more sharply than mtimes do:

- the foreign `@rolldown/binding-*` directories are one patch version behind the `rolldown` that
  pins all of them, and the only binding at the current version is the one this host runs;
- every foreign `@gjsify/*-<os>-<arch>` on disk is at the release that **first shipped the filter**,
  beside a CLI many releases newer.

They were written by the previous CLI, during the self-update that installed the fix. A filter
cannot remove what predates it. So this is not a regression to repair in the filter; it is a pass
that never existed.

## Decision

**1. One rule, and it is a pure manifest read.** npm's own `os`/`cpu`/`libc`, through the same
`checkPlatform` the installer filters with — so a pruned prefix converges on what a fresh install
would have placed, rather than on this module's opinion. Measured on the prefix above: 75 packages,
420.5 MB, nothing usable in the set.

**2. A package that declares nothing is never touched.** `@rolldown/binding-wasm32-wasi` is
unusable here and says so nowhere; inferring that from its NAME is how a prune starts deleting
things it cannot justify. Uncertain means keep.

**3. Two surfaces, because they answer different questions.** `gjsify prune` repairs a prefix that
already accreted — the only way to reach the measured 420 MB, since the release shipping this is
installed BY the previous CLI. An automatic pass after `install`/`self-update` keeps it from
happening again, for the majority who never read a release note. `--no-prune` opts out of the
latter.

**4. The automatic pass never acts on a target the user typed.** `--os/--cpu/--libc` are legal on
`gjsify install -g`. Inherited by a prune they would make `gjsify install -g foo --os=darwin`
delete every Linux package in the user's real shared prefix — the engine set, the bundler bindings,
the CLI's own. So the automatic pass reads the measured host and **refuses entirely** when any
override is present, while `gjsify prune --os=darwin` stays legal: that one is a request, not a
side effect. It also declines under `--immutable`, matching `ensureProjectGjsEngine`.

**5. Housekeeping never fails its caller.** A removal that fails is collected and reported; the
install that already succeeded is not turned into a failure by a directory that would not unlink.

### Relation to ADR 0001

ADR 0001's *"cleaning is never an install side effect"* is about **build artifacts** — `lib/`,
`dist/`, committed bundles, files git tracks. It stands. This deletes only inside the prefix's own
`node_modules/`, which ADR 0001 Decision 1 already lists as installer-owned mutable state, and only
packages the install itself would not have placed there.

## Deferred

**Reachability** — "no installed package points at this any more" — would catch the wasm32-wasi
shape and more. It needs a record of what the prefix was ASSEMBLED FROM, and no prefix carries one:
the global prefix has no lockfile, no `package.json` and no root list. Adding that record is a
separate change, and until it exists an orphan sweep would be guessing. Tracked in
`status/open-todos.md`.

**`gjsify uninstall`** does not prune. An uninstall is precisely when a dependency closure becomes
unreachable — which is the reachability rule, deferred above. Its handler is also synchronous and
takes no install lock today, so wiring a prune into it is a change to that command, not to this one.
