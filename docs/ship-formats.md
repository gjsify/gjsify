# `gjsify ship` formats — how one is declared, and what Flatpak measured

Reference for [`packages/infra/cli/AGENTS.md`](../packages/infra/cli/AGENTS.md) § `gjsify ship`.
The decisions are [ADR 0024](adr/0024-ship-installable-artifacts.md); this file is the detail
behind them, kept out of an agent context file that is loaded on every turn.

## A format is a descriptor row

`utils/ship/formats.ts` holds `FORMATS: Record<FormatId, FormatDescriptor>`, and everything that
differs between formats outside the archive container is a field on it: the install `prefix`, where
the licence goes and in what shape, the architecture spelling, the artifact filename, the
dependency key, and the host requirement. ADR 0024 § 2 predicted "the whole difference between a
Flatpak and an `.rpm` is a four-line prefix map". Measured: `prefix: '/app'`, an arch table with no
`noarch` in it, and one filename.

Three consumers are bound to the vocabulary by the compiler — `FORMATS` is a total record, the
packer dispatch in `ship.ts` is a `switch` with a `never` guard, and `FORMAT_IDS` is read back off
the table. One cannot be: `manifest-conformance`'s `TARGETS`, which lives in a different package
that must not import the CLI (the rule is `portable` on purpose). `scripts/check-ship-format-vocabulary.mjs`
compares the two textually, and its header records why a stale `TARGETS` matters in the direction
that is easy to miss: `auditShip` REFUSES an unknown target, so the failure is `gjsify audit`
rejecting the first CORRECT declaration of a newly supported format, in someone else's tree.

## Host-boundness is data (ADR 0024 § A3)

`FormatDescriptor.host` is a `HostRequirement` with three fields, and they are three because the
measurements split three ways:

| field | what it answers | why not derived |
|---|---|---|
| `finishOn` | which OSes can pack this | not the LAYOUT — a `<App>.app` tree assembles anywhere while the `.dmg` around it needs macOS |
| `requiredTools` | what the packer EXECS | not implied by `finishOn` — an `.msi` we wrote ourselves would be `'any'` with no tools |
| `installHint` | how to install those tools | the refusal is one generic function; hardcoded there the hint said `dnf install flatpak flatpak-builder` for every format that will ever need a tool |
| `oracle` | who reads the artifact back, and where | derivable from neither; a format built by the platform's own tool forfeits independence unless a reader from another implementation family exists |

`oracle.selfReading: true` is the honest confession that a format has no independent discriminator
yet. ADR 0024 § A3 calls it legal to declare and illegal to release; `utils/ship/flatpak.spec.ts`
is what turns that sentence into a red test, so flipping the field is a decision somebody makes
rather than a value nobody reads.

`deb` and `rpm` are `finishOn: 'any'` with `requiredTools: []` — this tree writes both formats, and
that is exactly what made `rpm` available as an independent oracle and caught the dpkg-`$1`
convention in the very first artifact (§ Implementation status). `flatpak` is
`finishOn: ['linux']`, `requiredTools: ['flatpak-builder', 'flatpak']`.

Both gates (`assertHostCanFinish`, `assertToolsInstalled`) run BEFORE the project's `build` script,
because discovering an absent `flatpak-builder` afterwards costs the whole build. They are two
messages on purpose: the wrong OS needs another machine, a missing tool needs a package. Both are
skipped under `--stage`, which is precisely the phase that needs neither — the asymmetry is the
point of the two-phase split.

Two consequences of a host-bound format existing at all:

- **`DEFAULT_FORMAT_IDS` is a second derivation from the same table.** `FORMAT_IDS` used to be both
  "every format that exists" and "every format built by default", which was one list only while
  every format was `'any'`. Putting `flatpak` in `FORMAT_IDS` alone would have made a bare
  `gjsify ship` demand `flatpak-builder` of every project that ever packaged a `.deb` — including
  `release-cut.yml`, which packs `@gjsify/cli` itself on a bare `ubuntu-latest` runner.
- **`packOne`'s dispatch branches WRITE the artifact** instead of returning bytes. Returning bytes
  is the right shape only while every packer is a byte writer: a Flatpak's bytes exist as a file
  before this process could hold them, and reading a bundle back into memory to hand it to one
  `writeFileSync` would be a copy for the sake of a signature.

## `DistroFormatId` is not `FormatId`

A `.deb` says `Depends: gir1.2-gtk-4.0`, an `.rpm` says `Requires: gtk4`, and both are package
names in a distribution's namespace. A Flatpak has no such field: it declares ONE dependency, its
runtime, in the manifest — and inside that runtime a typelib is either present or nothing on the
system provides it, so there is no package to name and no gap a name could close.

So `deriveDepends` and `warnAboutGjsFloor` take a `DistroFormatId`, the descriptor answers
`depends: DistroFormatId | null`, and the three `Record<DistroFormatId, …>` tables
(`SCHEMA_COMPILER_PACKAGE`, `GJS_FLOOR_IS_DEBIAN_NEWS`, `TYPELIB_PACKAGES`'s rows) stay total.
`DistroFormatId` is `Extract<FormatId, 'deb' | 'rpm'>` rather than a fresh union so it cannot
outlive `FormatId`; the other direction is covered by `depends` being a REQUIRED descriptor field.

This is the hazard `check-ship-format-vocabulary.mjs` records from the other side, and it was
already paid for once: two ternaries in `depends.ts` meant a third format silently took rpm's
package name into a Debian `Depends:`, at exit 0.

## What flatpak-builder actually does — measured, 1.4.10, 2026-08-26

Each of these had a plausible wrong answer and flatpak-builder reports none of them. Run against
`org.gnome.Platform//50` on Fedora 44.

1. **An absolute `path` on a `dir` source works.** The alternative — paths relative to the manifest
   — would have forced the manifest to live inside the output root and broken
   `--from-stage --out <elsewhere>`, where the stage and the artifacts have no common ancestor.
2. **`skip` on a `dir` source works**, and it is what keeps `.gjsify-ship-stage.json` out of
   `/app`. Without it the stage's own closure ships as payload: `cp -a stage/.` copies dotfiles,
   and nothing downstream would ever complain about one extra file.
3. **`cp -a` preserves the mode.** `ostree ls` reported `-00755` for `bin/<name>` and `-00644` for
   the rest, so the launcher stays executable — the same property `readStage` protects for the deb
   and rpm paths, arrived at by a completely different route.
4. **`flatpak-builder --show-manifest` is NOT a validator** and must not be used as one. It
   accepted an unknown source property (`skipp`) and `buildsystem: "nonsense"` at exit 0. It reads
   and normalises JSON; that is all it proves.
5. **flatpak-builder installs the dereferenced manifest at `/app/manifest.json` itself.** That file
   is its addition, not a leak from the payload, and `tests/e2e/ship-flatpak` asserts it so nobody
   removes it as one.

The real oracle is `flatpak build-import-bundle` into a FRESH ostree repo plus `ostree ls -R`,
which prints a path, a mode and a size per file — ostree parses a static delta this tree never
wrote. `tests/e2e/ship-flatpak` runs that tier where `flatpak-builder`, `flatpak`, `ostree` and the
GNOME runtime all exist (a workstation, not this project's Fedora CI image) and PRINTS the skip
where they do not. Two tiers always run: the structural one, and one that executes the module's own
`build-commands` under `sh` against a temp prefix, with two negative controls — dropping `skip`
must put the sidecar in `/app`, and `cp -a stage /app/` (no `/.`) must lose the launcher. A
comparison that cannot fail proves nothing.

## The `gjsify.flatpak` deprecation window

ADR 0024 § 8 makes it a condition of the migration: "`gjsify.flatpak` is a published config
contract, so the keys move with a deprecation window in which both spellings resolve and the old
one warns." `utils/ship/flatpak-config.ts` is that window, and only part of the block is in it.

| keys | status |
|---|---|
| `runtime`, `runtimeVersion`, `sdkExtensions`, `appendPath`, `finishArgs`, `cleanup` | MOVED to `gjsify.ship.flatpak.*`; the old spelling resolves and warns, removed in `LEGACY_FLATPAK_KEYS_REMOVED_IN` |
| `AppMetadata` (`name`, `summary`, `developer`, `categories`, `license`, …) | NOT deprecated. Both blocks extend `AppMetadata` by design — § 8's own words are "those files are not Flatpak's, they are the app's" — so this is an alias, not a legacy spelling. Warning on it would print for every project that has a `gjsify.flatpak` block at all |
| `lockfile`, `ciContainer`, `ciBranches`, `flathubRepo`, `modules`, `extraModules`, `command` | untouched: they belong to `gjsify flatpak <sub>`, whose own move to `gjsify ship flatpak <sub>` is a separate item in `status/open-todos.md`. Deprecating them now would warn on commands that have not moved |

**The window has TWO sides, and only building one is a trap.** The six build keys are read by
`gjsify flatpak init` and `flatpak ci` as well, and those commands have NOT moved. So a project that
did what the warning told it and moved the keys would have lost them there: `flatpak init` falls back
to its own defaults and writes a manifest against a different `org.gnome.Platform` version, with
different finish-args, into a file the project commits — at exit 0. Both command groups therefore
resolve through the same `pickFlatpakBuildKeys`, so "both spellings resolve" is true of every reader
of these keys and the advice is safe to follow.

Fallback is per-KEY, not per-block, so a project migrating one key at a time does not lose the five
it has not moved yet. It is also a LOOP over `MIGRATED_FLATPAK_KEYS` rather than six hand-written
picks: written out, the constant was the one unbound copy of this vocabulary — a key added to it with
nothing reading it compiled fine and was simply not in the window, and the only test that mentioned
the constant compared it to a literal copy of itself — and that is also what makes the warning actionable: it names the keys still
coming from the old block rather than telling the reader a block is deprecated and leaving them to
diff it by hand.

The precedent is `utils/normalize-bundler-options.ts`, the `esbuild` → `bundler` shim, and it is
followed including its DEFECT: that warning names a removal version (0.5.0) the tree is many minors
past, so its header now has to say "removing the shim means fixing that string too". Here the
version is one exported constant the message reads and a spec asserts, so the plan and the warning
cannot drift apart silently.

`gjsify.ship.flatpak` deliberately has NO `modules` / `extraModules`. Under `ship` the module list
IS the staged payload, and an escape hatch injecting arbitrary build modules would put a second
staging model back in the tree — which is the one thing ADR 0024 § 8 gates the whole migration on.
A project that has to BUILD something inside the sandbox still has `gjsify flatpak init` +
`gjsify flatpak build`, unchanged.
