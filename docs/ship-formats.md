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

`macos-app` and `macos-app-zip` (#1354 M2a) are the pair that shows the three fields really are
three. Both are `finishOn: 'any'` — a `<App>.app` tree and a zip around it are file copying, and a
Linux workstation does all of it — and both nonetheless declare
`requiredTools: ['glib-compile-schemas']`, because a layout with no install step has to compile
`gschemas.compiled` while the tree is being assembled or the bundle aborts at its first
`Gio.Settings.new()`. That is a tool requirement without host-boundness, which is the case
`assertToolsInstalled` is separate from `assertHostCanFinish` for. `glib-compile-schemas` is GLib's
own and runs on all three OSes, so declaring it does not make the format host-bound.

`windows-dir` and `windows-dir-zip` (#1354 M3) are the same pair one OS over and carry the same
`requiredTools` for the same reason. The one row-level difference is the ARTIFACT: a `<App>.app`
carries its own directory in the stage (`Layout.root`), because it is dragged to `/Applications` as
one object, while a Windows program directory does not — an installer chooses
`C:\Program Files\<Publisher>\<App>` and lays the stage's CONTENTS into it. So `windows-dir` writes
the payload with no rebase, and `windows-dir-zip` SYNTHESISES the top level the `.app` zip inherits.
Without that synthesis the archive expands into whatever directory the user was in, scattering
`app\`, `share\` and a loose `.cmd` across it — and every entry would be individually correct, so
no listing of names reads as wrong.

`windows-dir` is also the row where `archName` is one value: `wingtk/gvsbuild` hardcodes
`self.platform = "x64"` and publishes no arm64 GTK, so there is nothing to build
`@gjsify/gtk-runtime-win32-arm64` out of and no GTK for a Windows/ARM artifact to load
([#1117](https://github.com/gjsify/gjsify/issues/1117)). `Layout.arches` carries the same refusal
one phase earlier, with the blocker named; `--stage` warns instead of refusing, because assembling a
foreign-arch layout is what `tests/e2e/ship-layout` does on purpose — it proves the layout MAP over
one payload, and that payload's native file has an architecture.

Their oracles are `python3` and `zipinfo`, and each was chosen against a plausible alternative that
measures nothing — the reason this field is a required one rather than prose:

| format | the reader that looks right | what it actually does | the reader used |
|---|---|---|---|
| `macos-app` | `plutil -lint` | macOS-only, absent here and in the CI image | CPython `plistlib` |
| `macos-app` | `plistutil -i` | accepts a `<dict>` whose `<key>` has no value and prints `<dict/>` at **exit 0** | " |
| `macos-app` | `xmllint --noout --valid --nonet` | **exit 4 on a CORRECT plist** — the DTD is a remote URL, so it is a constant, not a reader | " |
| `macos-app-zip` | `unzip -Z1` | prints names only; blind to a launcher extracted 0644, which is the only failure this format has | `zipinfo -l` |
| `windows-dir` | `file(1)` | not baked into the CI image, and a job using a tool the image never carries trips `scripts/check-ci-image-packages.mjs` | CPython `struct` + `cmd.exe` |
| `windows-dir` | our own `binary.mjs` | it is the reader under test — a PE read by the same family that staged it is not an oracle | " |
| `windows-dir-zip` | `unzip -Z1` | as above; and here it is also blind to the archive's own failure, entries written at the ROOT | `zipinfo -l` |

`bsdtar` was the other zip candidate and is absent here and in the CI image; adding it would trip
`scripts/check-ci-image-packages.mjs`. `zipinfo` ships in the `unzip` package that is already
baked.

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

**Unlike everything else on this page, this section is a DECISION and not a description.** Nothing
in the CLI signs anything yet: `grep -rniE 'codesign|notariz' packages/infra/cli/src` returns 2
hits, both comments in `utils/ship/layout.ts` and its spec, and neither `--sign` nor
`gjsify.ship.sign` exists. It is written down here because the shape of the descriptor is decided
by it — a field not added is as much a design as a field added, and the reason has to survive until
#1354 M6 implements it.

ADR 0024 § A1 phrased the rule as *"a container is produced where its format's tool lives, and a
signature where its credentials live — a format declares which of the three it needs"*. Measured,
a format declares TWO of the three, and the third should not join them:

| question | who answers it | scope | today |
|---|---|---|---|
| can this host run the packer's tools? | `finishOn` + `requiredTools` | per FORMAT | implemented |
| does this run hold an identity to sign with? | `--sign <identity>`, defaulting to `gjsify.ship.sign.<os>.identity` | per RUN | decided, not built |

Same shape as the two existing gates being two messages: the wrong OS needs another machine, a
missing tool needs a package — and a missing identity will need neither, because **no identity is
not an error**: it will skip, say so on stderr, and exit 0 (ADR 0024 § A13). `gjsify ship` will
never receive a certificate at all — it will exec `codesign` with a NAME, and the private key stays
on the signing host (ADR 0024 § A12 records what is measured about that and what is Apple's
documented behaviour). That is what lets an external developer ship under their own Developer ID
with no fork and no fixture.

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

### The launcher has three forms, and two questions about the interpreter

Two of the differences are measured rather than stylistic: `readlink -f` is GNU coreutils' and the
BSD `readlink` macOS ships has no `-f` (so under `set -e` the first line would end the launcher),
and the macOS launcher exports no `DYLD_*` — a rule whose stated reason was corrected in #1354 M2a
rather than the rule. It used to read "SIP strips an inherited `DYLD_*` at the `/bin/sh` exec, so a
wrapper structurally cannot hand the loader a library path", which is stronger than what was
measured, and this repository depends on the difference in two places green on the darwin legs
today (`utils/bin-shim.ts`'s `dyldFallbackPreamble`, `node-gi`'s `maybeReexecForGtkRuntime`): an
INHERITED `DYLD_*` is stripped when a PROTECTED binary is exec'd, while what a shim exports itself
survives into an unprotected child. The reason that holds points the same way and is one milestone
out — a hardened-runtime, Developer-ID-signed main executable IS restricted, so a launcher depending
on `DYLD_*` works unsigned and breaks the day the bundle is signed. ADR 0024 § 3 puts that half
in-process instead.

All three exec whatever `gjsify.app` names — `gjs -m`, or `node` for a `--app node` project.
ADR 0024 § 4 derives Node for macOS and Windows, and that answer lives on
`Layout.shippedRuntime` as DATA: it describes the runtime a SHIPPED ARTIFACT carries, which
#1354 M0 implements by bundling one and **#1354 M2b stages** — the macOS launcher execs
`"$here/node"` when the stage carries one, and the bare name when it does not. The only interpreter
that can read the payload is still the one it was BUILT for, and `assertShippableTarget`
(layout-independent) guarantees that is `gjs` or `node`.

`utils/ship/payload.ts`'s `readLauncherInterpreters` strips a surrounding shell quote before taking
the basename, and that is not tidiness: without it `"$here/node"` read back as `node"`, which is
neither known interpreter, so `assertLauncherMatchesInterpreter` took its "a program that is
neither" branch and passed. A vacuous green, on exactly the layout that made the check matter.

**`cmd.exe` is a third dialect, and it was vacuous three ways at once** (#1354 M3). Reading the
`.cmd` with the POSIX rules found nothing, and each of the three reasons is on its own enough to
make the check pass over a launcher that runs the wrong interpreter:

1. batch has no `exec` to anchor on — the LAST command a batch file runs is what it runs, and its
   exit status is the script's — so the `\nexec ` scan matched nothing and the reader returned `[]`,
   which `assertLauncherMatchesInterpreter` treats as "nothing to check";
2. `%~dp0` already ends in a separator, so the renderer concatenates with none and `%HERE%node.exe`
   has no `/` or `\` to take a basename at;
3. the file is `node.exe` and the declared vocabulary is `node`.

So the reader has a `cmd` branch: rule the batch built-ins OUT (there is no keyword to rule in),
strip one leading `%NAME%`, strip a trailing `.exe` — and only `.exe`, since a `.cmd` or `.bat` is a
batch file whose contents this reader has not read. Measured before the branch existed: a `.cmd`
running `gjs -m` under `gjsify.app: "node"` passed.

**And ruling lines out is not the same as ruling KEYWORDS out**, which is how the same hole reopened
one round later. The first cut put `if`, `else` and `for` in the built-in list on the grounds that
they "take no program"; they take a whole command, and batch is routinely written on one line:

```
IF defined X (node x)        → []      ← the whole reader
for %f in (*) do node %f     → []
```

`[]` is the value `assertLauncherMatchesInterpreter` treats as "nothing to check", so
`if exist "%HERE%gjs.exe" ("%HERE%gjs.exe" -m …)` under `gjsify.app: "node"` passed — the POSIX
form's un-indented-`exec` incident, in the dialect batch actually uses. Those three REDUCE now, to
the command they carry, both arms of an `if`/`else` included; the `if` conditions are enumerated
(three unary forms, `a==b`, six comparison operators) rather than guessed, because the failure mode
of guessing is not silence but naming whichever token landed in the program position. `call` and
`start` stay unhandled and stay silent for exactly that reason.

**And that is where the FORMAT's answer differs from the LAYOUT's** (#1354 M2a). `macos-app` and
`macos-app-zip` are `interpreters: ['node']`, because a bundle a stranger downloads must carry its
interpreter and there is no relocatable GJS to put in one. The two windows rows say the same thing
for a harder reason (#1354 M3): there is no GJS host on Windows AT ALL — not a system one to depend
on and not a relocatable one to carry — so a `--app gjs` payload has nothing anywhere that could run
it. So the two questions are asked in two
places and give two different answers for one project: the launcher execs what the payload was built
for, and the FORMAT says what its runtime can provide. A `--app gjs` project therefore stages the
darwin layout and cannot pack it — and the distinction between those is load-bearing rather than
pedantic. A DERIVED default set is filtered by the interpreter, with the dropped formats and the
reason printed; a typed `--target macos-app` is refused by name. The first cut refused both, which
made `gjsify ship darwin --stage` exit 1 for every project this command has.

That is the SECOND time this pair of questions has been collapsed into one, and the first is worth
keeping beside it because the two failures are mirror images. The first cut of the LAYOUT axis read
§ 4 as a per-layout requirement and got both halves wrong at once: `gjsify.app: "gjs"` was refused
for the macOS layout, while a project declaring nothing staged `exec node …/gjs.js` in front of a
bundle whose first line is `import Gtk from 'gi://Gtk?version=4.0'`. `Layout.runtimeGap` is the
honest remainder: one sentence per OS saying why the launcher cannot name `shippedRuntime` yet,
printed on every non-Linux stage.

### What a self-contained artifact carries, and who declares it (#1354 M2b, M3)

`utils/ship/app-runtime.ts` stages four things into a non-Linux layout, each resolved BY NAME from
the project being shipped and each `null`-not-throw. The paths come from `Layout.dirs`, so the two
rows below are one table read through two maps rather than two stagers:

| Piece | Package | `.app` (M2b) | program directory (M3) |
|---|---|---|---|
| the interpreter | `@gjsify/node-runtime-<target>` | `Contents/MacOS/node` | `node.exe` at the root |
| its licence | " | `Contents/Resources/share/licenses/node/LICENSE` | `share\licenses\node\LICENSE` |
| the relocated GTK closure | `@gjsify/gtk-runtime-<target>` | `Contents/Frameworks/node-gi/prebuilds/<target>/gtk/**` | `lib\node-gi\prebuilds\<target>\gtk\**` |
| the node-gi addon | `@gjsify/node-gi` (`prebuilds/<target>/node_gi.node`) | beside that closure, as its SIBLING | same |
| node-gi's JavaScript | `@gjsify/node-gi` | `Contents/Resources/lib/node_modules/@gjsify/node-gi/` | `app\node_modules\@gjsify\node-gi\` |

The interpreter's FILENAME comes from `nodeRuntimeBinaryName(target)` — the same function that
decided the source file's name — so `node.exe` stays `node.exe` across the copy. A stage that
renamed it would be a launcher execing a file nothing wrote, and nothing else in the pipeline
compares the two.

⚠️ **`@gjsify/node-runtime-*` is not published yet** — all three targets 404 on npm as of 0.44.0,
and the payload is gitignored, so an in-repo checkout resolves the package and finds no binary
(`resolveNodeRuntime` answers `null` for exactly that, by design). `packages/node-runtime/scripts/fetch-node-runtime.mjs`
populates one from a pinned Node release, verifying its SHA-256, and that is what
`node-gi.yml`'s two assemble legs run. `@gjsify/gtk-runtime-win32-x64` IS published (0.44.0,
81 250 039 B unpacked over 1 027 files), as are both darwin siblings.

What a publish would upload, per target — `npm pack --dry-run --json` in each package
directory after the fetcher has run, 8 files each:

| Package | packed | unpacked | interpreter | Node's `LICENSE` |
|---|---|---|---|---|
| `@gjsify/node-runtime-darwin-arm64` | 40 292 475 B | 122 082 467 B | `bin/node` 121 911 744 B | `bin/LICENSE` 157 609 B |
| `@gjsify/node-runtime-darwin-x64` | 41 287 805 B | 124 456 499 B | `bin/node` 124 285 824 B | `bin/LICENSE` 157 609 B |
| `@gjsify/node-runtime-win32-x64` | 35 796 451 B | 93 554 864 B | `bin/node.exe` 93 381 448 B | `bin/LICENSE` 160 555 B |

The licence TRAVELS, and that is a `files:` property rather than a good intention:
`files: ["index.js", "index.d.ts", "bin"]` ships the whole `bin/`, so Node's own
`LICENSE` is in the tarball beside the binary it covers — measured in the pack listing
above, and digest-recorded in `bin/manifest.json`. The package's own 1 556 B `LICENSE`
is MIT and says in its own text that it covers the SOURCE only, so the two cannot be
read as one claim. Node is redistributable and its terms are the only obligation the
fetcher takes on: it copies `LICENSE` and nothing else from the distribution,
deliberately leaving the 149 further licence files that belong to npm's bundled
`node_modules`, which this package does not ship.

`scripts/check-shipped-runtime-packages.mjs` keeps this warning honest — while a name
is in its `PENDING_BOOTSTRAP` ledger, every file declaring a dependency on it must say
it is not published, and the entry itself fails once the package goes live.

**Not one of them is an `optionalDependencies` edge**, which is `docs/publishing.md`'s rule (#910,
reverted in #920): whoever SHIPS an app declares the runtime, never the library that uses it. So the
list above is what a third-party author adds to their own `package.json` — the first two as
`devDependencies` (the packaging host needs them, the app does not), `@gjsify/node-gi` as a
`dependency`. `website/src/content/docs/ship/index.mdx` carries the copy-pasteable block, and
`tests/e2e/ship-macos` proves it: every fixture installs those packages into a throwaway project's
own `node_modules` and nothing of gjsify's, so a resolution that only worked from inside this
monorepo would fail there.

**The closure is staged TREE-PRESERVING, and it cannot go through `gjsify.ship.bundledTypelibs`.**
`plan.ts` stages a bundled typelib as `posix.join(libDir, 'gi', basename(file))` — the basename —
while `discoverTypelibs` walks its directory recursively, so three inputs at three depths collapse
into one directory. Measured through the built planner:

```
gtk/lib/gdk-pixbuf-2.0/2.10.0/loaders/libpixbufloader-svg.so → lib/<name>/gi/libpixbufloader-svg.so
gtk/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache                  → lib/<name>/gi/loaders.cache
gtk/girepository-1.0/Gtk-4.0.typelib                         → lib/<name>/gi/Gtk-4.0.typelib
```

Every relation inside a relocated closure is relative — `@loader_path/<leaf>` install names,
`@loader_path/../../..` in `loaders.cache`, `@loader_path/gtk/lib` on the addon — so flattening
breaks all three at once, and the result has neither a `lib/` nor a `girepository-1.0/` for
`resolveGtkRuntimeBundle()`'s existence probe. `placeStage` therefore takes the staged runtime as
already-stage-relative files, through the same uniqueness check `Layout.metadata` goes through.

**The launcher exports two locators and still no `DYLD_*`.** `GJSIFY_GTK_RUNTIME` is candidate 1 of
`resolveGtkRuntimeBundle()`'s four (candidates 2–4 walk node-gi's package directory or
`node_modules`, and in a shipped `.app` node-gi's package root is
`Contents/Resources/lib/node_modules/@gjsify/node-gi`, so every probed path lands under `Resources`
rather than in `Frameworks`); `NODE_GI_NATIVE` is the absolute-path form `nativeCandidates()`
accepts, and it returns a pinned path ALONE, so the bundle's addon is not merely preferred.
`GJSIFY_GI_LIBRARY_PATH` joins them when the app carries GI libraries of its own — #1410 shipped
that reader with no writer anywhere in this pipeline, and this launcher is it. All three are read by
node-gi in JS and handed to GI through the binding; dyld never sees one, which is why the rule above
survives signing.

**The `.cmd` exports the same two locators and deliberately no `PATH`** (#1354 M3), which is the
Windows counterpart of that rule with the opposite reason — so it is written down rather than
inferred. Windows has no rpath: a DLL is found on `PATH`, in the directory of the image that loaded
it, or not at all. But node-gi puts the closure there ITSELF, in-process, before it `require`s the
addon — `maybePrependGtkRuntimeDllPath()` runs at `packages/node-gi/node-gi/index.js` top level,
above `loadNative()`, "because Windows re-reads the DLL search path at every LoadLibrary (unlike
dyld's launch-time capture)". What that function needs from the launcher is the LOCATOR, and a
launcher-set `PATH` would be a second copy of a directory node-gi already derives from it: two
truths, and the stale one wins the day the layout moves. `GJSIFY_GI_LIBRARY_PATH` has no Windows
half either — `PATH` is what reaches a typelib's bare-leaf backer there, and the launcher already
prepends `lib\` when `gjsify.ship.bundledTypelibs` put a typelib in it.

### What the file-set equality cannot see

The equality is a real check and it is blind to one whole class, because **sameness is the defect**:
the Linux tree carries `share/glib-2.0/schemas/*.gschema.xml`, `share/mime/packages/*.xml` and
`share/icons/hicolor/**`, and all three are only correct there because a `.deb`/`.rpm` scriptlet
compiles or reindexes them at install time (`utils/ship/scripts.ts`). An uncompiled schema makes
GSettings abort at runtime. Two more — the `.desktop` entry and the AppStream component — are
freedesktop metadata neither other OS reads at all.

**One of those five is now answered** (#1354 M2a): the schema directory. `utils/ship/schemas.ts`
runs `glib-compile-schemas --strict` at ASSEMBLY time for every non-Linux layout and adds
`share/glib-2.0/schemas/gschemas.compiled` to the prefix-relative plan, so it goes through the same
layout map as everything else. Linux still gets none — there the postinst compiles the SYSTEM
directory, where this app's schemas merge with every other package's, and a prebuilt cache would be
a file the install step overwrites. The rule did not become a comment: `SHARE_VERDICTS`'s schema row
is a FUNCTION of the payload, so a stage whose cache was removed classifies as `aborts` again, and
`tests/e2e/ship-layout` asserts both directions.

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

## Signing is a payload MUTATION, and its proof needs no certificate (#1354 M6)

`--sign <identity>` is a flag on the FINISH phase, never a verb of its own
([ADR 0024 § A2](adr/0024-ship-installable-artifacts.md), § A12). What it takes is an IDENTITY —
the string `codesign` and `signtool` look a private key up by — and never a certificate: there is no
`--certificate`, no `--p12` and no `--password`, so nothing on this surface can leak. Getting a key
into a keychain is the signing HOST's job. `-` is the reserved ad-hoc value.

| | darwin | win32 | linux |
|---|---|---|---|
| tool | `codesign` | `signtool` | — |
| invocation | `--force --sign <identity> <file>` | `sign /n <identity> /fd sha256 <file>` | — |
| runs on | darwin | win32 | — |
| signs | every Mach-O image in the payload | every PE image in the payload | nothing |
| project default | `gjsify.ship.sign.darwin.identity` | `gjsify.ship.sign.win32.identity` | refused by name |
| proven | ad-hoc, end to end, in CI | flag + skip + refusals only — **UNVERIFIED** | n/a |

Linux has no row and `--sign` there is refused with the mechanism rather than a shrug: a `.deb` and
an `.rpm` ARE signed, by the repository that serves them (`debsigs`, `rpmsign`), with that
repository's key and not with a build-time identity.

**Absent identity ⇒ skip, loudly, exit 0.** Unsigned is the default path and a legitimate
deliverable; what ADR 0024 § 5 refuses is the other direction, claiming a signature that was not
made. The skip goes to stderr and names the step it skipped — the reference's own two scripts both
say "Skipping codesign" and one of them is skipping `productsign`.

**A payload with nothing signable is also a success, and it says so.** A `--app gjs` bundle is
JavaScript and a launcher, so there is nothing for the loader to validate; the run prints *"nothing
in this payload is a Mach-O image, so codesign signed 0 file(s). The artifact carries no
signature."* The consequence is worth knowing rather than discovering: an IDENTITY is only ever
validated by the tool that consumes it, so a run with nothing to sign cannot tell a real Developer
ID from a name nobody holds. `tests/e2e/ship-signing` therefore plants a signable image in both
identity refusals — measured, because without one they passed at exit 0 on macOS.

**Why the signer returns bytes rather than wrapping them.** Under hardened runtime a
Developer-ID-signed main executable will not load ad-hoc-signed dylibs, and § A4 measured **106 of
106** Mach-O images in the shipped darwin GTK closure already carrying an ad-hoc
`LC_CODE_SIGNATURE` — they must, because `install_name_tool` invalidates the original during
relocation. So the darwin leg re-signs the closure and the packers get new bytes.

**The order is structural (§ A17).** `readStage` compares each staged file's SIZE against
`.gjsify-ship-stage.json`, and a size is no more re-sign-proof than a digest would be. Both halves
are measured and they agree: append one byte to a staged file and `readStage` refuses with *"… is 6
bytes in the stage and 5 in its manifest"*, and an ad-hoc re-sign of one staged image took it from
34 816 to 34 848 bytes (+32, macos-latest/arm64, 2026-08-30). So `packOne` validates the PRE-sign
tree, `signPayload` takes that result and returns
the signed one, and the container is built from the return value. The signed bytes are computed
from the validated ones and therefore cannot exist before them; the arriving stage is never written
to, which is also what makes a `--from-stage --sign` run repeatable.

**The oracle.** `.github/ship-oracle/verify-signed-arrival.mjs` compares the staged tree with the
artifact: every non-Mach-O file byte-identical, every Mach-O identical outside `LC_CODE_SIGNATURE`,
`LC_UUID` and `__LINKEDIT`'s size fields (that last one is a consequence rather than a concession —
the signature blob lives inside that segment by construction). The Mach-O half is
`compareMachOAfterResign` in `packages/infra/manifest-conformance/lib/binary.mjs`, extended there
rather than reimplemented beside it because that file's header says so: *extend this file; never add
a second parser*. It is an independent reader despite being ours — the mutation is made by Apple's
`codesign`, which knows nothing about it.

**Ad-hoc signing needs no Apple Developer Program membership**, which is why the whole pipeline plus
its oracle is a green CI leg with no secret in it (`macos-suites.yml`, and
`GJSIFY_SHIP_SIGNING_REQUIRE_CODESIGN=1` is what stops that leg passing on a host with no
`codesign`). A real Developer ID later is a different VALUE for the same flag, not a different code
path.

**Notarisation is a SECOND, unrelated credential** (§ A15). `--notarize <keychain-profile>` runs
`xcrun notarytool submit --keychain-profile <p> --wait <artifact>`, and the guard tests exactly the
value the next line reads — which is the trap `refs/node/tools/osx-notarize.sh` falls into, guarding
on three environment variables it never uses. It is **UNVERIFIED end to end**: notarisation needs an
Apple account, which is precisely the credential M6 does without. The App Store Connect API-key form
is not implemented, and stapling is not implemented — `status/open-todos.md` carries both, with what
was measured for each.

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
