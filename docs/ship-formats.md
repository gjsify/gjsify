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

- **`defaultFormatIds(os)` is a second derivation from the same table.** `FORMAT_IDS` used to be
  both "every format that exists" and "every format built by default", which was one list only
  while every format was `'any'`. Putting `flatpak` in `FORMAT_IDS` alone would have made a bare
  `gjsify ship` demand `flatpak-builder` of every project that ever packaged a `.deb` — including
  `release-cut.yml`, which packs `@gjsify/cli` itself on a bare `ubuntu-latest` runner. It gained a
  SECOND criterion — `layoutOs` — when the layout axis landed; see below.
- **`packOne`'s dispatch branches WRITE the artifact** instead of returning bytes. Returning bytes
  is the right shape only while every packer is a byte writer: a Flatpak's bytes exist as a file
  before this process could hold them, and reading a bundle back into memory to hand it to one
  `writeFileSync` would be a copy for the sake of a signature.

### Signing is NOT a `HostRequirement` field (ADR 0024 § A14)

ADR 0024 § A1 phrased the rule as *"a container is produced where its format's tool lives, and a
signature where its credentials live — a format declares which of the three it needs"*. Measured,
a format declares TWO of the three, and the third should not join them:

| question | who answers it | scope |
|---|---|---|
| can this host run the packer's tools? | `finishOn` + `requiredTools` | per FORMAT |
| does this run hold an identity to sign with? | `--sign <identity>`, defaulting to `gjsify.ship.sign.<os>.identity` | per RUN |

Same shape as the two existing gates being two messages: the wrong OS needs another machine, a
missing tool needs a package — and a missing identity needs neither, because **no identity is not
an error**. It skips, says so on stderr, and exits 0 (ADR 0024 § A13). `gjsify ship` never receives
a certificate at all: it execs `codesign` with a NAME, and the private key stays on the signing
host (ADR 0024 § A12 records what is measured about that and what is Apple's documented behaviour).
That is what lets an external developer ship under their own Developer ID with no fork and no
fixture.

## The layout axis: a format wraps ONE OS's tree

`gjsify ship <os>` (ADR 0024 § A2) chooses which operating system's LAYOUT to assemble;
`utils/ship/layout.ts` holds the three rows, and `place()` is the map from the prefix-relative plan
to a stage-relative path. `planStage` still produces exactly one plan, in the Linux/XDG shape, and
that split is what makes ADR 0024 § 2's claim checkable rather than rhetorical:
`tests/e2e/ship-layout` assembles one project three ways and asserts the file SET and every file's
BYTES agree modulo a map written out in the suite itself. Exactly one planned entry is
layout-derived — the launcher, rendered before the plan is built — and the suite asserts that one
DIFFERS between layouts, which is what keeps "one payload" from being a claim about nothing.

`Contents/MacOS` is the first layout that is not a `prefix` substitution. The carried GI files
(`gjsify.ship.bundledTypelibs`) sit inside `lib/<name>/` on Linux and leave the bundle directory
entirely on macOS for `Contents/Frameworks`, and the launcher's own NAME changes on Windows
(`<binaryName>.cmd`). What is the OS's and what is the app's:

| | fixed by the OS | from the consumer's `gjsify.ship` |
|---|---|---|
| macOS | `Contents/{MacOS,Resources,Frameworks}`, the `.app` suffix | the bundle directory's name (`name`), the executable inside it (`binaryName`), everything the data tree is keyed on (`appId`) |
| Windows | `%~dp0`, CRLF, `.cmd`, `PATH` as the loader's path | `binaryName`, and the same data tree |

### The refusals, and the two lists that are NOT the same question

- **`FormatDescriptor.layoutOs` is not `host.finishOn`.** One says which staged tree a format wraps,
  the other where the container can be produced. They look like one field while only Linux formats
  exist; the `.app` zip (`finishOn: 'any'`) beside the `.dmg` (`['darwin']`) is the pair that
  separates them. `defaultFormatIds(os)` filters on BOTH, which is why adding layouts did not make
  a bare `gjsify ship` on Linux emit anything new.
- **`--target deb` under `gjsify ship darwin` is an error**, not a silent empty build. Filtering it
  away would stage the tree, pack nothing and exit 0 — the shape the empty-`--target` refusal
  already exists to prevent, arriving through a different door.
- **`gjsify.ship.targets` is FILTERED, not refused**, and the two are different questions. A flag is
  a claim about this run; a configured list is a project-level default written once, and refusing it
  the same way makes the positional unusable in any project that has the key. The filtering is not
  silent: `configuredFormats` returns what it dropped and `gjsify ship` prints it, because the
  `--target` path names a foreign format and this one used to just produce a shorter list. Measured: with
  `targets: ["deb", "rpm"]` — which `packages/infra/cli/package.json` declares — the strict path
  made `gjsify ship darwin --stage` exit 1 telling the author to run `gjsify ship darwin --stage`,
  and no `--target` value got a darwin stage out of such a project at all. `configuredFormats` is
  the filtered half; the empty result it can produce is safe because `assertPackable` refuses a PACK
  with nothing to pack.
- **`layoutForOs` is strict where `resolveLayout` is not.** The positional accepts `windows` beside
  `win32`, because the ADR writes one and `--expect-target` prints the other. The stage manifest's
  `target.os` accepts only the `process.platform` spelling: it is a cross-host wire format, and
  routing it through the lenient resolver would mean two files with different bytes in the one field
  `--expect-target` exists to compare both matched it.
- **A bare `gjsify ship` on a macOS or Windows host now assembles THAT host's layout**, where the
  old host-independent default emitted `.deb` + `.rpm` everywhere. Deliberate — the positional means
  what it says — and `assertPackable` names the one-word replacement (`gjsify ship linux`) rather
  than leaving it as a regression.

### The launcher has three forms, and execs one interpreter

Two of the differences are measured rather than stylistic: `readlink -f` is GNU coreutils' and the
BSD `readlink` macOS ships has no `-f` (so under `set -e` the first line would end the launcher),
and SIP strips an inherited `DYLD_*` at the `/bin/sh` exec, so a macOS launcher structurally cannot
hand the loader a library path — ADR 0024 § 3 puts that half in-process instead.

All three exec **`gjs -m`**. ADR 0024 § 4 derives Node for macOS and Windows, and that answer lives
on `Layout.shippedRuntime` as DATA — it describes the runtime a SHIPPED ARTIFACT carries, which
issue #1354 M0 implements by bundling one. Until then the only interpreter that can read the payload
is the one it was built for, and `assertShippableTarget` (layout-independent, `gjs` only) guarantees
that is GJS. The first cut of this axis read § 4 as a per-layout requirement and got both halves
wrong at once: `gjsify.app: "gjs"` — the only declaration `ship` supports — was refused for the
macOS layout, while a project declaring nothing staged `exec node …/gjs.js` in front of a bundle
whose first line is `import Gtk from 'gi://Gtk?version=4.0'`. `Layout.runtimeGap` is the honest
remainder: one sentence per OS saying why the launcher cannot name `shippedRuntime` yet, printed on
every non-Linux stage.

### What the file-set equality cannot see

The equality is a real check and it is blind to one whole class, because **sameness is the defect**:
the Linux tree carries `share/glib-2.0/schemas/*.gschema.xml`, `share/mime/packages/*.xml` and
`share/icons/hicolor/**`, and all three are only correct there because a `.deb`/`.rpm` scriptlet
compiles or reindexes them at install time (`utils/ship/scripts.ts`). An uncompiled schema makes
GSettings abort at runtime. Two more — the `.desktop` entry and the AppStream component — are
freedesktop metadata neither other OS reads at all.

`linuxInstallDependent()` in `utils/ship/payload.ts` is that list. An earlier version of this
paragraph said the rules were "keyed on the same prefixes `cacheRefreshCommands` guards so the two
cannot drift" — which was PROSE, not a mechanism, and it was measured false: `share/glib-2.0/schemas`
existed as five independent string literals, and pointing one rule at a directory matching nothing
dropped a file from the printed warning with the whole suite green at exit 0. Three things replace
the sentence:

- **`utils/ship/share-dirs.ts` holds `SHARE`,** and `plan.ts`, `readPayloadFacts`,
  `cacheRefreshCommands` and `linuxInstallDependent` all import it, so the compiler is what keeps
  them together. `rpm.ts` derives the three entries that name a directory the planner stages into
  and keeps the rest literal, because "which directories does the distro own" is a different
  question — parents included, deliberately non-exhaustive.
- **The rule is EXHAUSTIVE, not an allow-list**, and that direction is the repair. A closed list of
  five reported "carries 5 file(s)" for a payload carrying six: a
  `share/dbus-1/services/*.service` added through `gjsify.ship.extraFiles` is meaningful on Linux
  only because the package installs it into a system prefix, and it went unnamed. Anything under
  `share/` that is neither classified nor known-portable (only `share/locale` is) comes back
  `unknown`.
- **`ShareVerdict` separates `aborts` from `inert`**, because they are not one severity. Every
  launcher exports `XDG_DATA_DIRS` at the staged `share/`, so a `.app` built from this stage points
  GSettings at a schema directory holding an `.xml` and no `gschemas.compiled` — `g_settings_new()`
  ABORTS. The other four merely do nothing. The aborting entry is printed first and marked.

`tests/e2e/ship-layout` now calls the function rather than re-deriving its own regex, and asserts
against the tree in both directions. What each entry BECOMES — a compiled `gschemas.compiled` in the
bundle, an `Info.plist` `CFBundleDocumentTypes`, a Windows registry association, or nothing — is ADR
0024 stages 4 and 5, because it needs the container that does not exist yet.

Flagged there and not measured here: a loose `.typelib` in `Contents/Frameworks` is the classic
codesign/notarization complaint (a bundle's `Frameworks` is expected to hold code, and a plain data
file there is what `codesign --deep` and notarization object to), so stage 4 may have to move it.
`LayoutDirs.other` already cites codesign as the reason nothing lands beside `Contents/`.

### The label is checked against the payload at STAGE time

`assertPayloadMatchesArch` has always guarded the artifact, inside `packOne`. Darwin and windows
stages never reach a packer, and this is the first milestone in which the STAGE is the deliverable —
so the check now also runs in `assemble`, on the tree that was just written. Measured before it did:
`gjsify ship darwin --stage --arch x64` over an arm64 Mach-O exited 0, recorded `darwin-x64`, and
`--expect-target darwin-x64` accepted it. The cost is a second read of the payload on the one-shot
Linux path, which is the price of checking the tree that ships rather than the bytes in memory.

**What it does NOT cover, and the Windows row is the one to read carefully.** `readBinaryArch`
answers from ELF and Mach-O and returns `null` for PE by design — the COFF machine field is one this
tree has never parsed. So a Windows payload whose only native file is a `.dll` cannot trip this check
at all: the guard is silent there rather than wrong. The e2e's windows leg reuses the fixture's
Mach-O, so it proves the LAYOUT and the same Mach-O branch, not the PE case. Closing it means
teaching `readBinaryArch` the COFF field (`manifest-conformance`'s `binary.mjs` already reads it);
`status/open-todos.md` item 5 carries the gap.

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
