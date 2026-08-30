# 24. `gjsify ship` — one payload, a runtime policy per OS, several install formats

- Status: **Accepted** — stages 1, 2, 3, 4 (darwin) and 6 have landed; see § Implementation status
- Date: 2026-08-14 (accepted 2026-08-15)
- Deciders: Pascal Garber
- Related: [ADR 0017 (native distribution)](0017-native-package-distribution.md), [ADR 0018 (OS-axis declaration)](0018-os-axis-declaration.md), [ADR 0021 (in-process prebuild resolution)](0021-launcher-free-prebuild-resolution.md), [ADR 0023 (which GTK a process uses)](0023-gtk-source-precedence.md), [docs/publishing.md](../publishing.md), `status/open-todos.md` § *gjsify on Flatpak — remaining roadmap*

## Context

gjsify can build an application for four targets on three operating systems. It cannot hand a
stranger anything to install, on any of them, unless that something is a Flatpak.

Measured on this tree:

```
$ grep -rniE 'appimage|nfpm|dpkg-deb|rpmbuild|\.rpm\b' packages/infra/cli/src | wc -l
0
$ grep -rniE 'Info\.plist|\.dmg|codesign|notariz|\.app/Contents' packages/infra/cli/src | wc -l
0
```

Not partial implementations, not TODOs — the question has never been asked, for Linux packages
or for a macOS `.app`. (Both greps are scoped to the CLI sources on purpose: this file is the
first place in the tree where several of those words appear at all, so a grep including `docs/`
would from now on be measuring itself.)

The half that IS answered is answered well, and only for Linux: `packages/infra/cli/src/commands/flatpak/`
is 2 633 lines over nine subcommands with six e2e suites behind it, one driving a real
`flatpak-builder`. It emits `.desktop.in` / `.metainfo.xml.in` gettext templates, so app metadata
is translatable, and `flatpak sources` replaces `flatpak-node-generator` with a Node-free reader
for four lockfile formats.

**What the gap costs, counted rather than felt.** Of roughly fifteen GJS applications across
this ecosystem, exactly one is installable by someone who is not us: Learn6502, on Flathub,
Linux only. It pays about 685 hand-written lines for that, of which **158 are meson whose only
job is to call `gjsify build` and put the results in a prefix** — 66 of them
`GI_TYPELIB_PATH`/`LD_LIBRARY_PATH` plumbing that still carries the `linux-x86_64` spelling
ADR 0018 retired. The thirteen showcases ship no desktop entry, no metainfo, no icon and no
schema, so none of them can be installed at all, anywhere.

**The reference.** `refs/gtkx` answers the Linux half for React+TypeScript GTK4 apps, and the
interesting number is how little of it is per-format. Re-measured at **v1.5.0**: **5 979 lines
across 66 files** under `packages/cli/src/deploy/`, of which the `targets/` directory is
**1 139** — so **80.9 % is target-independent**. The same partition at v1.1.0 gives 80.9 % of
4 124: identical to the decimal, across a 45 % growth of the subsystem.

That is not a correction of the 73 % this paragraph used to carry — it is a different partition,
and both are defensible. `targets/` + `payload/` at v1.1.0 is 1 117 of 4 124, which rounds to
exactly the 73 % originally written. **The partition, not the number, is what went unrecorded**,
and a ratio whose denominator is unstated cannot be re-measured. `targets/`-only is named here
because it is the one that held its value across four releases; whoever re-measures next should
state theirs the same way.

The whole difference between a Flatpak and an `.rpm` is a four-line prefix map
(`refs/gtkx/packages/cli/src/deploy/payload/stage.ts:41`) plus three overlay cases — where the
copyright file goes, where the licence goes, and whether D-Bus activation is a `.service` file
or a non-`DBusActivatable` desktop entry. The map is byte-identical to v1.1.0's, where it sat at
`:35`; two constants were added above it since, one of them gettext's `SHARE_LOCALE`.

It still has no macOS and no Windows story at all — and the grep that establishes that has to be
written carefully, because the obvious one lies. `darwin|win32|macos|mach-o|\.dmg|\.msi` under
`deploy/` returns **zero hits** at v1.5.0. Adding `\.app` to that alternation returns dozens,
every one of them `.applicationId` or `.appimage`. Its only binary-format reader is still an ELF
parser.

One scope caveat that arrived with v1.5.0 and that a future re-measurement must not miss: the
deploy story no longer fits inside `src/deploy/`. `deploy/freedesktop/localize.ts` reaches into a
new sibling `src/i18n/`, so a line count scoped to `deploy/` now undercounts.

That ratio is the finding, and it generalises one step further than the reference took it:
**packaging looks like N problems and is one payload, a handful of layouts, and a packer per
format.**

## Decision

### 1. The command is `gjsify ship`

Collisions measured, not guessed. `deploy` is taken *conceptually* — `deploy-docs.yml` and the
`Deploy to GitHub Pages` job already make "deploy" mean *publish the website*. `publish` is npm
publishing. `pack` is the npm tarball. `dist/` is a build-output directory the tree checks for
literally. `package` is the most overloaded noun in a monorepo with ~200 of them. `ship` occurs
nowhere as a command or a concept, is a verb like its siblings (`build`, `run`, `check`,
`publish`), and names the outcome rather than the mechanism.

### 2. One payload, one layout per OS, one packer per format

The payload — the app bundle, its assets, its GSettings schemas, its icons and its metadata —
is produced ONCE and is identical everywhere. What differs is where the files sit and how the
result is wrapped:

| OS | layout | formats |
|---|---|---|
| Linux | prefix-relative (`bin/`, `lib/<app>/`, `share/`) | `.deb`, `.rpm`, Flatpak (`/app` instead of `/usr` — a one-line difference) |
| macOS | `<App>.app/Contents/{MacOS,Resources,Frameworks}` | `.dmg`, zip |
| Windows | program directory + shortcut metadata | installer, portable zip |

**Amended 2026-08-21 (§ A5):** this table says which formats exist and not WHERE each is
produced, which is a third axis — see the amendment.

Per-format code exists only where the FORMAT differs; per-OS code only where the LAYOUT
differs. A target that needs an extra file gets an overlay, never a branch in the staging code.
This is what lets the Flatpak module become `buildsystem: simple` + `cp -a stage/.`, which is
what removes meson from inside the sandbox.

### 3. The launcher derives its own prefix; the runtime finds itself from inside

On Linux the launcher resolves its prefix at runtime:

```sh
self=$(readlink -f "$0"); prefix=$(dirname "$(dirname "$self")")
```

A baked path forces a per-target payload and collapses § 2 back into N packaging
implementations.

On macOS the equivalent problem is not solved with environment variables at all, and this is
measured rather than assumed: SIP strips an inherited `DYLD_*` at the `/bin/sh` exec, so a
wrapper cannot hand the loader a path. GI takes it **from inside the process** instead —

```js
const repo = imports.gi.GIRepository.Repository.dup_default();
repo.prepend_search_path(dir);   // replaces GI_TYPELIB_PATH
repo.prepend_library_path(dir);  // replaces DYLD_/LD_LIBRARY_PATH
```

— measured on the macOS 15.7.9 VM under `env -u DYLD_FALLBACK_LIBRARY_PATH -u
DYLD_LIBRARY_PATH -u GI_TYPELIB_PATH` (`status/open-todos.md`, the third shape). ADR 0021 has
already decided this direction one layer down for prebuilds: resolution happens in-process and
the launcher is an optimisation. A shipped `.app` is the same decision applied to the app's own
runtime.

### 4. The runtime is DERIVED from the OS and the build target, not chosen per app

The rule: **on each OS, ship the runtime that OS's CI already proves.** Nothing here is a
preference.

| OS | runtime in the artifact | why, measured |
|---|---|---|
| Linux · `--app gjs` | none — `Depends: gjs (>= 1.86)` | GJS and GTK come from the distro. Bundling would be ~100 MiB of cargo cult. **Measured caveat: no released Debian satisfies that floor** — Debian went 1.82.3 (trixie) straight to 1.88.1 (forky), skipping 1.84 and 1.86. The honest floor is emitted anyway and warned about; see § Implementation status |
| Linux · `--app node` | none — `Depends: nodejs (>= 24)` / `Requires: nodejs(engine) >= 24` | **Amended and IMPLEMENTED (#1354 M0):** the launcher branches on `gjsify.app` and execs `node`, `assertShippableTarget` accepts it, and `assertLauncherMatchesInterpreter` refuses any package whose launcher and dependency disagree. The row read "bundled Node — no system Node can be assumed"; true of macOS and Windows, false of Linux, where every distribution ships one — bundling would be the same ~100 MiB cargo cult the `--app gjs` row rejects. The rpm spelling is not a style choice: `Requires: nodejs >= 24` is a silent NO-OP on Fedora, whose virtual `nodejs` Provide carries Epoch 1, so `0:24` is satisfied by `1:22.23.1` — measured with `dnf repoquery` on F44. ⚠️ And even the correct spelling does not put Node 24 on `PATH`: the alternatives-managed `/usr/bin/node` belongs to whichever `nodejs<stream>-bin` is installed, so `nodejs22-bin` + `nodejs(engine) >= 24` is a satisfiable state with `node` at 22. Floor honestly emitted and warned about, exactly like the GJS one |
| **macOS** | **Node + `@gjsify/node-gi` + `@gjsify/gtk-runtime-darwin-<arch>`** | this is the combination CI proves on both arches, with no Homebrew in the picture: the *batteries-included conformance* and *windowing proof* legs of `node-gi.yml` run green against the relocated bundle |
| **Windows** | **Node + `@gjsify/node-gi` + `@gjsify/gtk-runtime-win32-x64`** | **there is no GJS host on Windows** — no job in this repository installs one, and the `gjs` mentions in `docs/ci-selective.md` this line used to cite are about the affected-classifier bundle, not about Windows. So this is not a choice. The *batteries-included conformance* and *Adwaita Storybook proof* legs prove it without gvsbuild |
| `--app browser` | — | no OS-package question |
| `--app nativescript` | — | APK/IPA is a different pipeline; out of scope |

**GJS on macOS is a real option and deliberately not the first one.** It works: the macOS CI
leg runs `test:gjs` on both architectures, which the Windows leg cannot. What is missing is a
*relocatable* GJS — `packages/node-gi/scripts/build-gtk-runtime-darwin.mjs` says so in its own
header ("GJS ships no relocation"), and the bundles it produces carry the GTK/GI closure and no
`gjs` binary. Adding one is the same `otool`/`@loader_path` walk the script already performs,
seeded with `gjs` and its SpiderMonkey, plus the ad-hoc re-sign arm64 requires — a contained
extension, not a new mechanism. Until it exists, a macOS `.app` that must run TODAY runs Node,
and this table changes the day `@gjsify/gjs-runtime-darwin-<arch>` does.

### 5. Assembly is cross-platform; signing is not

The macOS and Windows runtime closures are relocated and ad-hoc signed when the BUNDLE is
built, and shipped as ordinary npm packages (ADR 0017). So assembling a `.app` or a Windows
program directory is file copying plus metadata, and a Linux host can do all of it.

What a Linux host cannot do is **Developer ID signing and notarisation** (`codesign`,
`notarytool`) or Authenticode signing. `gjsify ship` therefore separates *assemble* from
*sign*: assembling works anywhere, signing requires the host OS and credentials, and asking for
a signed artifact where neither is available fails with that sentence rather than producing an
unsigned file that Gatekeeper or SmartScreen will refuse. An unsigned artifact is a legitimate
output — it just has to say so.

**Amended 2026-08-21 (§ A1, § A4, § A5) and 2026-08-29 (§ A12-§ A17):** the boundary falls one step
earlier than this section draws it — a CONTAINER is produced where its format's tool lives, so a
Linux host assembles the `.app` but cannot write the `.dmg` around it. "SmartScreen will refuse" is
false: it warns until per-hash reputation accrues, signed or not. And signing is a payload
MUTATION, not a wrapper — measured, 106 of 106 Mach-O images in the darwin closure already carry a
signature. And "asking for a signed artifact where neither is available fails" holds only for an
identity that was ASKED for: no `--sign` at all is a loud skip at exit 0, not a refusal (§ A13).

### 6. A dependency that cannot be derived fails the build

The reference maps GI namespaces to distro packages through a four-entry table and returns
`[]` for anything unlisted (`refs/gtkx/packages/cli/src/deploy/depends.ts`). An under-declared
runtime dependency does not fail in CI; it fails on a user's machine, after the download, with
a dynamic-linker error. Ours fails the build and names the namespace. An escape hatch stays
(`ship.depends.{deb,rpm}`), because a table will always be incomplete — what may not stay is
the silence. On macOS and Windows the question does not arise: the closure is in the artifact.

### 7. The glibc floor is derived from the ELF, not authored

`gjsify.glibcRequires` must be measured from the binary rather than believed, because the
dynamic linker enforces the measured number and a host below it gets
`version 'GLIBC_x.y' not found` with no fallback. The floor is readable without `readelf` or
`ldd`: walk the section headers, read `DT_NEEDED` from `.dynamic`, take the highest `GLIBC_x.y`
in `.dynstr`.

**Correction, 2026-08-15 — this section shipped already-false and is kept as the record.** As
drafted it read "nothing checks it against the binary" and listed the work as separable stage 1.
Both were wrong on the day the ADR was accepted: the reader landed 2026-08-01 in `7896c51b02`
(#897) as `@gjsify/manifest-conformance`'s `binary.mjs` (`readElfNeeded`,
`readElfGlibcRequires`, `compareGlibcVersions`), and the rule that holds the declaration against
it is `prebuild-libc`'s Check B, selected by `scripts/audit-runtimes.mjs` and therefore already
part of a required check. An ADR is a decision record, so the wrong claim is corrected here
rather than deleted: a reader who took stage 1 as "the separable one, start there" would have
rebuilt a rule that has been gating the tree for two weeks.

### 8. `gjsify flatpak` migrates under `gjsify ship`

Flatpak becomes one format among several rather than a command of its own: today's nine
subcommands move to `gjsify ship flatpak <sub>`, and the metadata half they already do well —
desktop entry, AppStream metainfo, gettext templates, the Node-free source generator, the
Flathub tracking automation — becomes shared machinery that deb, rpm, `.dmg` and the Windows
installer read too. That is the point of the migration: those files are not Flatpak's, they are
the app's.

Two things this must respect. `gjsify.flatpak` is a **published config contract**, so the keys
move with a deprecation window in which both spellings resolve and the old one warns; and the
migration lands only once `ship` can actually stage, so the tree never carries two staging
models. Until then the flatpak commands keep working unchanged.

**Landed 2026-08-26, and the migration turned out to be TWO independent halves.** The FORMAT moved:
`gjsify ship --target flatpak` builds a bundle out of the staged payload, its module is
`buildsystem: simple` + `cp -a stage/.`, and meson is gone from inside the sandbox. The nine
SUBCOMMANDS have not: `gjsify flatpak <sub>` is unchanged, because `flatpak ci`, `deps`, `sources`,
`diff`, `release` and `sync-flathub` are Flathub-submission tooling with nothing to do with a
staged payload, and moving them is a rename with its own alias problem (`status/open-todos.md`).
Splitting the two is what let the deprecation window be HONEST rather than blanket: the six BUILD
keys moved to `gjsify.ship.flatpak` and warn from the old spelling, the `AppMetadata` half is an
alias and is not deprecated, and the toolchain keys are untouched because their commands have not
moved. Deprecating the whole block now would have warned on every invocation of a command that
still has nowhere else to read from.

### 9. AppImage is DEFERRED, and this names what would unblock it

Not "rejected". An AppImage makes one promise — *one file, no install, any distro* — and that
promise holds only if the file contains everything the target is not guaranteed to have. For a
GJS application that is GTK4, libadwaita, **GJS itself**, the typelibs and girepository.

The reference does not carry them: its AppDir holds the app tree and takes GTK4 from the host,
so on a host without GTK4 the "runs anywhere" file does not run. That is not an AppImage; it is
a tarball with a launcher, wearing the name of something that promises more.

Making it honestly needs a relocatable **Linux** runtime closure, and the tree's evidence is
that this is a project rather than a target: the bundles exist for `darwin-arm64`, `darwin-x64`
and `win32-x64` (`packages/node-gi/gtk-runtime-*`) and there is no Linux one, deliberately — on
Linux GTK has always come from the distro. Building one drags in the relocation work § 4
describes for macOS, plus the licensing question `status/open-todos.md` already logs against the
existing bundles (*"The GTK bundles declare `license: MIT` while shipping an LGPL closure"*),
which for a redistributed single file is a compliance item rather than a note.

**And the need it would serve is already served.** One file, no repository, offline install:

```
gjsify flatpak build --repo=/tmp/repo --bundle=app.flatpak   # exists today
flatpak install app.flatpak
```

`packages/infra/cli/src/commands/flatpak/build.ts` already wraps `flatpak build-bundle`. What
AppImage adds over that is *"and the user does not have Flatpak either"* — a real but narrowing
gap, and a poor trade against a Linux runtime closure nobody has built yet. It becomes worth
revisiting the day `@gjsify/gtk-runtime-linux-<arch>` exists, and is then mostly a packaging
step on top of a closure that had to be solved for its own reasons.

### 10. Reimplement from the design; copy nothing

`refs/gtkx` is **MPL-2.0** repo-wide with no per-file headers; gjsify declares MIT in 185
package manifests. MPL-2.0's copyleft is per-FILE and survives copying, so a lifted file would
be MPL inside an MIT tree and would contradict its own `package.json`. The designs above are
ideas, not code — the ELF reader in particular is re-derivable from the ELF specification,
which is what `refs/` is for.

## Consequences

**What it deletes.** Learn6502's 158 lines of meson glue, and the same 158 lines that each of
the thirteen showcases and every future app would otherwise write. Meson disappears from inside
the Flatpak sandbox. `gjsify flatpak` stops being a parallel universe with its own metadata
model. The authored `gjsify.glibcRequires` values stop being a claim nobody checks.

**What it costs.** A new top-level command in `@gjsify/cli` — no new published npm name, so no
first-publish bootstrap ([docs/publishing.md](../publishing.md)) — plus a pinned,
checksum-verified packer for deb/rpm, and the e2e suites to prove an artifact INSTALLS. The
last part is not optional: the reference tests only that its manifests render, and no CI job of
theirs ever builds a package. A `ship` that asserted on rendered YAML would be this repo's
green-CI-that-checked-nothing class on a new surface. macOS and Windows legs already exist in
`node-gi.yml` and are where the `.app` and installer proofs belong.

> **Correction (#1354 M0).** "No new published npm name" stopped being true. Carrying an
> interpreter into a `.app` or a Windows program directory needs one package per target —
> `@gjsify/node-runtime-{darwin-arm64,darwin-x64,win32-x64}` — and those three ARE a
> first-publish bootstrap, done by hand before the release that ships them. Linux still costs
> none: it declares a dependency instead (§ 4, amended).

**What stays open.** Whether the deb/rpm packer is vendored or hand-rolled — `.deb` is `ar`
plus two tars and `@gjsify/tar` exists, while an `.rpm` header is not worth hand-writing, so
the answer may differ per format. Whether a bundled Node is fetched at ship time or declared as
a platform package the way ADR 0017 already distributes native builds. Signing credentials:
who holds the Developer ID and the Authenticode certificate, and whether CI may use them.
`@gjsify/gjs-runtime-darwin-<arch>` (§ 4), which is what would make a macOS `.app` run GJS.

## Implementation

Staged, each stage independently useful and independently mergeable:

1. **ELF glibc floor** + a `@gjsify/manifest-conformance` rule holding `gjsify.glibcRequires`
   against the binary (§ 7). Already landed when this ADR was written — see § Implementation
   status. The numbering is kept so stages 2–7 keep the numbers other documents cite.
2. **The payload and the Linux layout** — `gjsify ship --stage` producing the tree and nothing
   else, proven by an e2e suite that inspects it.
3. **deb + rpm**, plus the dependency derivation of § 6, with an e2e suite that installs the
   artifact in a container and runs the binary.
4. **macOS `.app` + `.dmg`**, assembling `@gjsify/gtk-runtime-darwin-<arch>` and the node-gi
   prebuild, proven on the existing macOS legs; signing behind § 5's separation.
5. **Windows program directory + installer**, same shape against `gtk-runtime-win32-x64`.
6. **Flatpak as a format under `ship`** (§ 8), retiring the duplicate staging path once 2–3
   have landed. Landed — see § Implementation status.
7. **`@gjsify/gjs-runtime-darwin-<arch>`**, after which § 4's macOS row can change to GJS.

Follow-up work lands in `status/open-todos.md` per governance; this ADR records the why.

## Implementation status

**Landed: stages 2, 3 and 6.** `gjsify ship` stages the payload and packs `.deb` and `.rpm`, proven by
`tests/e2e/ship` — which builds real artifacts and reads them back with `rpm` (`-K`, `-qp --info`,
`-qpl`, `-qp --requires`, `-qp --scripts`, `-i --test`, `rpm2cpio | cpio -it`), GNU `ar` and GNU
`tar` — and `--target flatpak` packs a single-file bundle out of the same stage, proven by
`tests/e2e/ship-flatpak` reading it back with `flatpak build-import-bundle` + `ostree ls -R`.

**Landed since, and it is § A2 rather than a stage: the two-phase split.** `gjsify ship --stage` assembles and
stops; `gjsify ship --from-stage <dir>` packs a stage that arrived from another host with no project, no
`package.json`, no built bundle and no config in reach (#1268). `.gjsify-ship-stage.json` carries the closure —
`{settings (arch resolved at stage time), staged, overlay, namespaces, mtime}` — and each omission was measured to
fail SILENTLY at exit 0: without `staged` the launcher packs 0644, without the pre-rendered overlay the `.deb`
carries no `/usr/share/doc/<pkg>/copyright`, without `namespaces` its `Depends` loses `gir1.2-gtk-4.0` and
`gir1.2-adw-1`. `--expect-target <os>-<arch>` refuses a stage assembled for a different matrix leg, compared
against what the stage RECORDED rather than against the packing host, because packing an arm64 stage on an x64
runner is a supported path. The discriminating proof is a deletion: `tests/e2e/ship-from-stage` stages into a
tmpdir, deletes the project tree, packs, and asserts byte-equality with the single-host artifact.

**Landed since that, and it is § 2's own claim rather than a stage: the LAYOUT axis** (#1354 M1).
`gjsify ship <linux|darwin|windows>` is § A2's positional, and it decides which OS's layout is
assembled — `<App>.app/Contents/{MacOS,Resources,Frameworks}` and a Windows program directory
beside the prefix-relative Linux one. `utils/ship/layout.ts` holds the three rows and the map;
`planStage` still produces ONE plan, in the Linux/XDG shape, which is what makes the § 2 claim an
equality a test can check: `tests/e2e/ship-layout` assembles the same project three ways and
asserts the file set and every file's bytes agree modulo a map written out in the suite (importing
`place()` would have compared the implementation with itself and passed for any map at all).
`STAGE_LAYOUT_OS` — the constant `'linux'` this document's § A2 predicted would become the
positional's value — is gone; the manifest's `target.os` is the layout's, so `--expect-target
darwin-arm64` now names something. Three things the axis forced that § 2 did not predict:
`Contents/MacOS` is the first layout difference that is NOT a `prefix` substitution (the carried GI
files leave the bundle directory for `Contents/Frameworks`, and the launcher's own name changes on
Windows); the launcher needs three FORMS, two of them for measured reasons — the BSD `readlink`
macOS ships has no `-f`, and SIP strips an inherited `DYLD_*` at the `/bin/sh` exec, which is § 3's
in-process answer arriving as a launcher constraint; and `FormatDescriptor` needed a `layoutOs`
field distinct from `host.finishOn`, which is what settles open question 3 (a `.app` zip is
`finishOn: 'any'` with `layoutOs: 'darwin'`, so the two are not one field). ~~No format wraps the
two new layouts yet — they are `--stage` only, and a pack is refused by name rather than exiting 0
having produced nothing.~~ **Superseded for darwin by #1354 M2a below and for windows by #1354 M3**;
both layouts have formats now, so the refusal a `--app gjs` project meets is the INTERPRETER one on
either. The "no format wraps this layout" branch stays reachable — `assertPackable` prints it for
any layout `formatIdsFor` answers empty for — and is simply not reachable from any of the three
layouts that exist, which is what stages 4 and 5 being done means.

**And three corrections the first cut of that axis needed, all of the same shape — reading a
statement about a SHIPPED ARTIFACT as a statement about an assembly step.** (a) § 4 derives the
runtime an artifact CARRIES; taken as a per-layout launcher requirement it refused
`gjsify.app: "gjs"` — the only build target `ship` supports — for the macOS layout, while a project
declaring nothing staged `exec node …/gjs.js` in front of a bundle opening with
`import Gtk from 'gi://Gtk?version=4.0'`. Every launcher execs `gjs -m`; § 4's answer is
`Layout.shippedRuntime` plus a printed `Layout.runtimeGap`, and it becomes a launcher decision when
#1354 M0 puts an interpreter in the tree. (b) `gjsify.ship.targets` is a project DEFAULT, not a
claim about one run, so it is filtered to the layout while a typed `--target` is refused — strict
for both made `gjsify ship darwin --stage` exit 1 in this repository, whose own
`packages/infra/cli/package.json` declares `targets`. (c) `assertPayloadMatchesArch` guarded the
ARTIFACT, and this is the first milestone in which the STAGE is the deliverable, so it now also runs
in `assemble`: before that, `--stage --arch x64` over an arm64 Mach-O exited 0 and
`--expect-target darwin-x64` accepted the label.

**What the layout equality cannot see, named rather than discovered later.** Both new trees carry
the `share/…` files whose Linux correctness comes from a `.deb`/`.rpm` install scriptlet —
`glib-compile-schemas` above all, without which GSettings aborts at runtime — plus a `.desktop`
entry and an AppStream component neither OS reads. Sameness IS the defect there, so no file-set
comparison can reach it. `linuxInstallDependent()` is the list — exhaustive over `share/` rather than an
allow-list, keyed on one shared `SHARE` constant the four call sites import, and split by severity
so the schema entry (which ABORTS `g_settings_new()`, because every launcher points `XDG_DATA_DIRS`
at the staged `share/`) is not ranked with four that merely do nothing. The first version of it
claimed in prose that its rules could not drift; that was measured false over five independent
string literals, so the claim is now a mechanism or it is not made. Deciding what each entry becomes
needs the container, i.e. stages 4 and 5.
Flagged for stage 4 and not measured here: a loose `.typelib` in `Contents/Frameworks` is the
classic codesign/notarization complaint.

**Landed since, and it is the first half of stage 4: the macOS bundle SHAPE** (#1354 M2a). The
`<App>.app` the layout axis staged was a directory whose name ends in `.app` and nothing more —
`Contents/Info.plist` was absent, so LaunchServices had nothing to tell it which file under
`Contents/MacOS` to exec and the Finder shows a folder. M2a writes that file and `Contents/PkgInfo`,
adds a deterministic in-tree ZIP writer, and gives darwin two format rows (`macos-app`,
`macos-app-zip`, both `finishOn: 'any'`, `layoutOs: 'darwin'`). Assembled on Linux, unsigned. Six
things worth recording, because each was a decision and not a detail:

- **The seam is `Layout.metadata`, not another prefix rule.** `Contents/Info.plist` has no
  prefix-relative counterpart to be mapped FROM: `planStage` emits one plan in the Linux/XDG shape,
  `place()` sends everything unmatched to `dirs.other`, and `assertInsidePrefix` forbids escaping
  upward — so no planner rule and no `gjsify.ship.extraFiles` value can put a file at a bundle root.
  Required on every row, `[]` on the two that own nothing, so "no metadata yet" and "no metadata
  ever" stay different statements.
- **Eleven plist keys, every one cited to a file in `refs/node`** that a real macOS toolchain
  produced or consumes (`test/fixtures/macos-app-sandbox/Info.plist`, `deps/v8/gni/Info.plist`,
  `tools/gyp/pylib/gyp/mac_tool.py`). Keys that are merely plausible are not emitted, and the
  measurement behind that has a stated SCOPE: `grep -r … refs/` answers cheerfully after reading
  almost nothing, because 89 of 95 declared submodules are not checked out. Six were; the five
  candidate keys return 0 files across them against 3 for `CFBundleSignature` as the control.
- **`plutil` is macOS-only and its obvious Linux substitute is a trap.** Measured on Fedora 44
  against a `<dict>` whose `<key>` has no value: `plistutil` prints `<dict/>` at exit 0, and
  `xmllint --noout --valid --nonet` exits 4 on a CORRECT plist because the DTD is a remote URL — a
  constant, not a reader. The oracle is CPython's `plistlib`, a different implementation family,
  already precedent here, and already in the CI image. Same shape one format over:
  `unzip -Z1` prints names only and is blind to the single failure a distributed `.app` has, so the
  zip's reader is `zipinfo -l`, which shows the Unix mode and ships in the same `unzip` package.
- **`share/glib-2.0/schemas` aborted, and now does not.** Every launcher exports `XDG_DATA_DIRS` at
  the staged `share/`, and GSettings aborts on a schema directory with no `gschemas.compiled`; a
  `.app` has no postinst to compile one. It is compiled AT STAGE TIME — `requiredTools:
  ['glib-compile-schemas']` with `finishOn` still `'any'`, which is what `assertToolsInstalled`
  being separate from `assertHostCanFinish` is for. `--strict` is load-bearing and was measured:
  without it a malformed schema is skipped at exit 0 and a cache is written without it, so the stage
  looks compiled and the app still aborts on the schema that was dropped. Whether `gschemas.compiled`
  is host-endian is UNVERIFIED; it does not bite because both darwin targets and every runner here
  are little-endian.
- **M1's equality assertion is restated, not weakened.** `tests/e2e/ship-layout` deep-equals the two
  new file sets against the Linux one mapped through a hand-written map, and M2a adds files no map
  can produce. The invariant is now *identical modulo the map, plus an enumerated per-layout
  addition set*, asserted in both directions — the additions must also be ABSENT from Linux, which
  is what catches `gschemas.compiled` leaking into a `.deb`. Relaxing the `deepEqual` to a subset
  check was the cheap repair and would have stopped the suite catching a real layout bug.
- **Two things the first cut got wrong, both measured rather than reviewed.** `writePayload` was
  handed the staged paths verbatim, and every darwin path already begins with `<App>.app/` — so the
  artifact came out as `out/<App>.app/<App>.app/Contents/…`, a folder holding a bundle one level
  down, at exit 0, with the sibling zip correct the whole time. And `interpreters: ['node']` on both
  rows made `assertFormatCanRunInterpreter` refuse the DERIVED default set, so
  `gjsify ship darwin --stage` began exiting 1 for every `--app gjs` project — which is every
  project this command has, and the whole audience of the layout M1 added. A derived default is not
  a claim anybody made, so it is filtered with the reason printed; a typed `--target` is still
  refused by name.

`STAGE_SCHEMA_VERSION` went 4 → 5, decided against its own header's criterion rather than
reflexively. NOT for the two new format ids: `formats[]` carries new VALUES in a field whose meaning
is unchanged, and `readStageManifest` already refuses an unknown one by name, so an older gjsify
meeting a macOS stage fails closed with the right message. YES for `settings.name`, which is
REQUIRED — this reader meeting a schema-4 stage would fail on "name must be a string" instead of on
the one thing the reader can do about it.

~~What M2a does NOT do, stated so the milestone is not read as more than it is: nothing stages an
interpreter or a GTK closure into the bundle, so the `.app` runs only where `node` is already on
`PATH`. `resolveNodeRuntime` still has no caller outside its own spec, and `plan.ts` flattens
`bundledTypelibs` with `basename()`, which pointed at a `gtk-runtime-darwin-*` tree would destroy
every relative relation the relocation depends on. That is M2b, and it is why "unzip it on
macos-latest and open a window" is not a leg bolted onto this one.~~ **Done — #1354 M2b, below.**

**Landed since, and it completes stage 4's darwin half: the `.app` carries its RUNTIME** (#1354
M2b). `utils/ship/app-runtime.ts` stages four things, each resolved BY NAME from the project being
shipped and each `null`-not-throw, so a partial bundle is a reported intermediate rather than a
failure:

- the interpreter, `@gjsify/node-runtime-darwin-<arch>` → `Contents/MacOS/node` plus Node's own
  LICENSE. `resolveNodeRuntime` finally has the caller its header said it did not have;
- the relocated GTK closure, `@gjsify/gtk-runtime-darwin-<arch>` →
  `Contents/Frameworks/node-gi/prebuilds/darwin-<arch>/gtk/**`;
- the addon, `@gjsify/node-gi`'s `prebuilds/darwin-<arch>/node_gi.node`, SIBLING to that directory
  because its `@rpath` is `@loader_path/gtk/lib`;
- node-gi's JAVASCRIPT → `Contents/Resources/lib/node_modules/@gjsify/node-gi/`. This is the one
  that is easy to miss: `@gjsify/node-gi/*` is external in every `--app node` bundle by design, so
  a `gi://Gtk` import compiles to `require('@gjsify/node-gi/gi')` in the shipped file, and a `.app`
  has no consumer `node_modules`. Measured on a bundle staged the M2a way and run from an unrelated
  directory: `Error: Cannot find module '@gjsify/node-gi/gi'`, before any GTK question arises.

**TREE-PRESERVING, and that is the whole design.** The closure is staged with every relative path
carried through unchanged, because every relation inside it is relative — `@loader_path/<leaf>`
install names, `@loader_path/../../..` in `loaders.cache`, `@loader_path/gtk/lib` on the addon. The
paragraph above predicted what `bundledTypelibs` would do to it and the prediction was measured
through the built planner: three inputs at three depths collapse to one directory, and the result
has neither a `lib/` nor a `girepository-1.0/` for `resolveGtkRuntimeBundle()`'s existence probe.
`placeStage` therefore takes the staged runtime as already-stage-relative files, through the same
uniqueness check `Layout.metadata` goes through.

**The launcher gained two locators and still no `DYLD_*`.** `GJSIFY_GTK_RUNTIME` and
`NODE_GI_NATIVE` (plus `GJSIFY_GI_LIBRARY_PATH` when the app carries GI libraries of its own — the
writer #1410 shipped a reader for) are read by node-gi in JS and handed to GI through the binding,
so § A4's signing rule survives: dyld sees none of them. `Contents/Frameworks` is also where
`codesign` will be pointed at M6, which is why the closure does not live under `Resources` even
though putting it there would have made both variables unnecessary.

**What M2b does not claim.** The Linux half — `tests/e2e/ship-macos` — reads every staged Mach-O
back with `binary.mjs`'s `readLibrary()` and asserts the closure resolves inside the bundle; that is
a claim about the WIRING, on a host that cannot execute one instruction of it. The claim about macOS
is `node-gi.yml`'s `macos-app-assemble` → `macos-app-selfcontained` pair: assemble on Linux, then
unzip on `macos-latest` and `macos-15-intel` with no Homebrew gtk4/libadwaita and `PATH` reduced to
the system directories (so the runner's own Node cannot answer), and open a window.

**Landed since, and it is stage 5: the Windows program directory** (#1354 M3). `windows-dir` and
`windows-dir-zip`, `layoutOs: 'win32'`, both `finishOn: 'any'`, assembled on Linux, unsigned. It is
the same shape as stage 4 and the differences are all the OS's:

- **The stage IS the artifact's contents.** A `<App>.app` carries its own directory in the stage,
  because it is dragged to `/Applications` as one object; a Windows program directory does not,
  because an installer chooses `C:\Program Files\<Publisher>\<App>` and lays the contents into it.
  So `windows-dir` writes the payload with no rebase — and the ZIP has to SYNTHESISE the top level
  the `.app` zip inherits, or the archive expands into whatever directory the user was in with every
  entry individually correct.
- **There is no metadata file, and `Layout.metadata` answers `[]` because that is the answer.** A
  Windows installer's metadata lives in the `.msi`'s own tables, which is stage 5's second half and
  #1354 M5. Two format rows now wrap this layout and neither needed one.
- **The `.cmd` runs `"%HERE%node.exe"` and sets `GJSIFY_GTK_RUNTIME` + `NODE_GI_NATIVE`**, and
  deliberately does NOT put the carried closure on `PATH`. That is the counterpart of the `.app`
  form's "no `DYLD_*`" with the opposite reason: node-gi prepends the closure's `bin\` ITSELF,
  in-process, above its own `loadNative()`, because Windows re-reads the DLL search path at every
  `LoadLibrary`. A launcher-set `PATH` would be a second copy of a directory node-gi already derives
  from the locator.
- **Three vacuities closed, all on this layout.** `readLauncherInterpreters` read a `.cmd` with the
  POSIX rules and found nothing — batch has no `exec`, `%~dp0` carries its own separator, and the
  file is `node.exe` where the vocabulary is `node` — so `assertLauncherMatchesInterpreter` passed
  over a launcher running `gjs` under `gjsify.app: "node"`. And `readBinaryArch` recognised `MZ` and
  stopped, which made `assertPayloadMatchesArch` vacuous on the one layout whose native format IS
  PE. Both are measured in `tests/e2e/ship-windows`, red before green.
- **`win32-x64` only, and the blocker is upstream.** `wingtk/gvsbuild` hardcodes
  `self.platform = "x64"`; there is no arm64 GTK to build `@gjsify/gtk-runtime-win32-arm64` out of,
  and on Windows that bundle is the only GTK there is (#1117). `Layout.arches` carries the refusal
  and names it. `--stage` warns rather than refusing, because assembling a foreign-arch layout is
  what `tests/e2e/ship-layout` does on purpose.
- **One measurement no leg can make, and M3 does not pretend otherwise.** `node.exe` is a
  CONSOLE-subsystem image (Subsystem=3 at offset 0xD4; measured on v24.20.0's, and the issue records
  the same for v24.19.0) and the win-x64 release contains exactly one `.exe` — there is no
  `nodew.exe`. So a GUI launch of this artifact pops a console window, and every Windows CI leg
  starts the app from a shell and therefore inherits one: no leg can observe it. The assemble leg
  PRINTS the subsystem it read off the real binary; `status/open-todos.md` carries the gap.

**What M3 does not claim.** The Linux half — `tests/e2e/ship-windows` — reads every staged PE back
with `binary.mjs`, and there it stops: a PE records its imports in a data directory reached through
the section table, which that reader deliberately does not parse (`inspectable: false`). So the
macOS suite's "every dependency resolves inside the artifact" has no Windows counterpart, and
"every DLL this directory needs is inside it" has exactly one reader, `LoadLibrary`. That is
`node-gi.yml`'s `windows-dir-assemble` → `windows-dir-selfcontained` pair: assemble on Linux, then
unzip on `windows-latest` with no gvsbuild GTK and `PATH` reduced to the system directories (so the
runner's own Node cannot answer), and open a window.

That is also what closed the `dpkg` gap this section used to carry. `ship-pack-linux` (`main.yml:1914`) downloads a
stage onto a bare `ubuntu-latest` and packs there, so the `.deb` now meets a real `dpkg --install` — `--force-depends`
and deliberately not `--dry-run`, because the run worth having is the one that lays bytes down — then `dpkg --verify`
against the package's own md5sums, `dpkg --purge`, and `lintian` as a third reader.

**Stage 1 (the ELF glibc floor) was already landed when this ADR was written**, and this paragraph
previously said the opposite. Both halves are in the tree and have been since 2026-08-01,
`7896c51b02` (#897): the reader is `@gjsify/manifest-conformance`'s `binary.mjs`
(`readElfNeeded`, `readElfGlibcRequires`, `compareGlibcVersions`), and the rule holding
`gjsify.glibcRequires` against it is `lib/rules/prebuild-libc.mjs` Check B, which fails a
package whose committed artifacts outgrow their declared floor and, separately, one that
measures a floor it never declared. `scripts/audit-runtimes.mjs` selects `prebuild-libc`, so it
runs inside `Detect runtime-triplet drift` — a required check.

Stage 1 is nonetheless correctly numbered *outside* `ship`: it is about the PLATFORM packages'
declarations, and a `--app gjs` payload contains no ELF at all, so nothing in `ship` can
exercise it. The `ship` rule added here (`manifest-conformance/lib/rules/ship.mjs`) is what
keeps `gjsify.ship` from being a fifth unchecked declaration.

**Four things the ADR left open, and how they were settled.**

*The deb/rpm packer is hand-rolled, not vendored.* The reference downloads a pinned `nfpm`
binary; this tree writes both formats itself (`utils/ship/{ar,cpio,rpm-header,deb,rpm}.ts`, ~700
lines). Three reasons, in order: the packer has to run under GJS, where a Go binary cannot; it has
to run offline and inside a Flatpak sandbox, where a download cannot; and the CI image is Fedora,
so a `dpkg-deb`-based deb packer could never have been tested here at all. It is the same trade
`gjsify flatpak sources` already made against `flatpak-node-generator`. The payoff was immediate
and unplanned: writing the RPM header ourselves is what made `rpm` available as an INDEPENDENT
oracle, and it caught a real defect on the first artifact — the maintainer scripts carried dpkg's
`$1` convention (`[ "$1" = "configure" ]`), which inside an rpm scriptlet is never true, so the
package would have installed and refreshed nothing.

*Bundled Node stays open* (§ 4's `--app node` row). Nothing here needs it, and the question — ship
time fetch versus a platform package — is unchanged.

> **Settled (#1354 M0).** A platform package, in `@gjsify/gtk-runtime-*`'s shape: hand-written
> manifest, gitignored payload, `files:` overriding `.gitignore` at pack time. Node 24, three
> targets, `bin/node` + Node's `LICENSE` and nothing else. Linux gets none and declares
> `nodejs` / `nodejs(engine)` instead — and that half is code, not only a table row: the
> launcher branches on `gjsify.app`, the seed dependency follows the same field, and a real
> `.rpm` from the `--app node` fixture reads back `nodejs(engine) >= 24` with no `gjs` line.
> The one place it diverges from that precedent is the publish topology: gtk-runtime's payload
> is BUILT on the OS it targets and needs a runner per OS, ours is a digest-verified DOWNLOAD,
> so all three ride one ubuntu job.
>
> What is NOT yet built: nothing stages the bundled interpreter into a `.app` or a Windows
> program directory. That is the layout axis, and `utils/ship/node-runtime.ts` is the seam it
> will go through.

*Architecture is derived, not configured.* A payload with no `.so`/`.node` is `Architecture: all` /
`BuildArch: noarch`. Claiming `amd64` for a bundle of JavaScript would make apt refuse it on an
arm64 machine it runs on perfectly.

*The GJS floor is emitted honestly and warned about.* `Depends: gjs (>= 1.86)` is what the bundler
targets and what no released Debian provides. Lowering it silently would trade a package apt
refuses for one that installs and then dies on a syntax error, so `gjsify ship` prints the gap and
`gjsify.ship.minGjsVersion` is the deliberate opt-out.

**One thing this PR did that the ADR only implied.** § 8 says the metadata half of `gjsify flatpak`
is the app's, not Flatpak's. The AppStream and desktop-entry renderers moved out of
`commands/flatpak/scaffold.ts` into `utils/app-metadata.ts`, and `ConfigDataFlatpak` now extends a
shared `AppMetadata`, so `gjsify.ship` reads the same fields with no second copy and no config
rename. The command migration (§ 8's nine subcommands, the deprecation window) is still ahead.

## Amendment, 2026-08-21 — the host that owns a format produces it

Three sections above read as if a format this repository's Linux workstation cannot produce is a
format to defer. That is a statement about one machine, not about the work. This project already
builds per-platform native artifacts on per-platform runners — ADR 0017's distribution model,
`prebuilds.yml`'s Vala-C-on-Fedora → MSVC-on-Windows split, `node-gi.yml`'s build-here /
consume-there artifact pairs, `release.yml`'s per-OS publish legs. Host-bound formats are
therefore **in**, and what they need is a *declaration*, not a deferral.

Nothing here reverses a decision above; it moves one line and adds the field that keeps the move
honest.

### A1. The line falls between assembly and CONTAINER, one step before signing

§ 5 puts the boundary at signing. Measured, it falls earlier: a `<App>.app` **tree** is file
copying plus metadata and a Linux host does all of it, while the `.dmg` **around** it is a UDIF
image over a real HFS+/APFS volume — and no HFS+/APFS writer exists anywhere in this tree, with
`hdiutil` macOS-only. So the amended rule is:

> Assembly is cross-platform. **A container is produced where its format's tool lives, and a
> signature where its credentials live.** ~~A format declares which of the three it needs.~~

**Amended 2026-08-29 (§ A14).** The struck sentence overstated the data, and it is struck HERE and
not only recorded down in § A14, because the reader who stops at this rule is the reader who would
implement it. Measured, a format declares TWO of the three: `HostRequirement`
(`packages/infra/cli/src/utils/ship/types.ts:89-119`) has `finishOn`, `requiredTools`,
`installHint` and `oracle`, and no field for a credential. Read the rule as *a format declares
where it can be packed; the RUN declares what it can sign with.*

`status/open-todos.md`'s *"assembly is cross-platform … so a Linux host can build both"* is the
half-sentence this corrects; it is true of the layouts and false of the `.dmg`.

### A2. Two phases, one verb each

```
# PHASE 1 — assemble. Anywhere, under GJS, offline.
gjsify ship linux   [--target deb,rpm] [--arch <process.arch>] [--stage]
gjsify ship darwin  --stage  [--arch arm64|x64]
gjsify ship windows --stage  [--arch x64]

# PHASE 2 — finish. On the host the FORMAT declares.
gjsify ship darwin  --format dmg --from-stage <dir> [--sign <identity>] [--notarize <credential>]
gjsify ship windows --format msi --from-stage <dir> [--sign <identity>]

gjsify ship plan [--json] [--host linux|darwin|win32]
gjsify ship ci   [--out .github/workflows/gjsify-ship.yml] [--check] [--force]
gjsify ship dispatch --format dmg [--ref <git-ref>]
```

`ship sign` and `ship notarize` as separate verbs are **rejected on mechanics**: `codesign` runs
over the `.app` *before* the `.dmg` exists, then the image is signed, then notarised, then
stapled. Three verbs force the `.app` to become a durable intermediate that a later command
re-opens without the plan — exactly the divergence `utils/ship/stage-writer.ts` was built to
prevent. `--sign` / `--notarize` are flags on the finish phase; `ship dispatch` stays a verb of
its own because it touches no payload at all.

**Amended 2026-08-29 (§ A12, § A13, § A15).** Both flags are corrected above from booleans to
values, and the synopsis in this section carries the corrected form. `--sign` takes an IDENTITY —
an opaque string naming something the signing host already holds, never a certificate or a path to
one — and `--notarize` takes a second, unrelated credential. Absent, each SKIPS loudly at exit 0;
unsigned is the default path, not a special case. (This note read *"a name `codesign` resolves
against a keychain on the signing host"* until 2026-08-29. That the string resolves against a
KEYCHAIN is Apple's documented behaviour, not a finding — § A12 marks it, and a summary that drops
the marking is how an unmeasured claim gets promoted to a measured one.)

Phase 2's only input is a directory, so phase 1 also writes `.gjsify-ship-stage.json` at the stage
root carrying **the closure, not a settings dump**: `{ settings (with `arch` resolved at stage
time), staged, overlay, namespaces, mtime }`. Measured, each omission fails silently at exit 0 —
without `staged` the launcher packs 0644; without the pre-rendered overlay the `.deb` carries no
`/usr/share/doc/<pkg>/copyright` (Debian Policy § 12.5); without `namespaces` its `Depends` loses
`gir1.2-gtk-4.0` and `gir1.2-adw-1`, which is the failure § 6 exists to prevent.

### A3. Host-boundness is data, and the independent oracle is a REQUIRED field

This is what the amendment costs and how it is paid. Writing the RPM header ourselves is what made
`rpm` an *independent* oracle, and it caught a real defect in the first artifact. A host-bound
format built by the platform's own tool forfeits that: `hdiutil verify` reads what `hdiutil create`
wrote. So the reader is not prose, it is a field:

```ts
export interface HostRequirement {
    /** OSes whose tooling can run this packer. `'any'` = pure JS, under GJS, offline. */
    finishOn: 'any' | readonly HostOs[];
    /** Tools the packer EXECS. Empty iff we write the format ourselves. */
    requiredTools: readonly string[];
    /** How to install them, in this format's words. Required when `requiredTools` is non-empty. */
    installHint?: string;
    oracle: {
        /** Readers from a DIFFERENT implementation family than the packer. */
        readWith: readonly string[];
        /** Where each reader runs. A Linux-runnable reader is worth more. */
        readOn: readonly HostOs[];
        /** No independent discriminator yet. Legal to declare, ILLEGAL to release. */
        selfReading: boolean;
    };
}
```

Three fields rather than one `hostOs`, because the measurements split three ways: `finishOn` is not
`layout` (the `.app` tree is `'any'`, the `.dmg` is `['darwin']`); `requiredTools` is not implied by
`finishOn` (an `.msi` we write ourselves is `'any'` with no tools); and `oracle` is derivable from
neither. `selfReading: true` is the honest declaration that a format has no discriminator yet — the
`ship` conformance rule lets it be declared and refuses to release it.

`installHint` joined them when the first host-bound format landed, and for the same reason the other
three are data: the refusal that names a missing tool is ONE generic function, so a hint written
inside it says `dnf install flatpak flatpak-builder` to the first `.dmg` user too.

### A4. Signing is a payload MUTATION, not a wrapper — measured, and it kills the obvious design

Every shape of this handoff wants the stage to carry per-file `sha256` so the pack leg can prove it
received the bytes the stage host produced. On darwin that guarantee contradicts itself, and the
number is not close: **106 of 106** Mach-O images in `@gjsify/gtk-runtime-darwin-arm64@0.41.0` plus
`@gjsify/node-gi`'s `prebuilds/darwin-arm64/node_gi.node` already carry an `LC_CODE_SIGNATURE`
(read from Linux with `manifest-conformance/lib/binary.mjs`'s `readLibrary()`; 0 unsigned, 0 parse
errors). They are ad-hoc signed at bundle-build time because `install_name_tool` invalidates the
original and Apple silicon requires it. Under hardened runtime, library validation will not let a
Developer-ID-signed main executable load ad-hoc-signed dylibs, so the darwin leg must **re-sign
every one of them inside the stage** — at which point all 106 digests change, and the check that
was meant to prove same-bytes either refuses the artifact it exists to produce or is relaxed to
exempt 106 files and stops checking anything.

The rule that follows: **the stage digest covers the pre-sign tree; the artifact carries a second
digest set; and arrival is checked as "every non-Mach-O file byte-identical, every Mach-O identical
outside `LC_CODE_SIGNATURE` and `LC_UUID`"** — i.e. with a Mach-O-aware comparator, which is
`binary.mjs`, a dependency the CLI does not have today. `docs/prebuilds.md` already measures the
same byte shape one layer down: all 16 committed darwin dylibs are rewritten on every run at
identical size, every differing byte being `LC_UUID`, an `N_OSO` stab, or the ad-hoc signature.

Two by-products of the same probe, recorded so nobody re-runs it: the closure is genuinely
self-contained (**0** non-system dependencies unsatisfied inside it, 106 distinct leaf names), and
only 2 of 106 images carry an absolute rpath (`/opt/homebrew/lib`, on `libjpeg.8.dylib` and the
addon) — which `checkPrebuildDir` already decided is a working fallback rather than a defect,
because dyld skips an `LC_RPATH` that does not exist while a missing absolute `LC_LOAD_DYLIB`
aborts the load.

### A5. Corrections to sections above — kept as the record, per § 7's precedent

- **§ 2's table lists `.dmg` and zip for macOS and "installer, portable zip" for Windows** without
  saying where each is produced. Amended: `.app` tree and zip are `finishOn: 'any'`; `.dmg` is
  `['darwin']`; the Windows program directory and its zip are `'any'`; `.msi` is `'any'` if we
  write it and `['win32']` if WiX does. `.pkg` belongs in that table and was missing.
- **§ 5's "a Linux host can do all of it"** is true of `.app` and false of `.dmg` — see A1.
- **§ 5's "an unsigned file that Gatekeeper or SmartScreen will refuse"** is half false. Gatekeeper
  genuinely blocks; SmartScreen *warns* until per-file-hash download reputation accrues, signed or
  not. Authenticode buys a named publisher and tamper-evidence, not acceptance.
- **Apple is the binding constraint, not Microsoft** — § Consequences leaves both certificates open
  as one question. They are not symmetric: Developer ID has no OIDC route (`.p12` in a keychain
  plus an App Store Connect `.p8`), so stage 4 is what would introduce this repository's first
  long-lived signing secret, while Windows has a cloud-signing route. Sequence stage 4's credential
  question first. Note also that today's "no long-lived credential" baseline is false:
  `PREBUILDS_DEPLOY_KEY` is a repo-write SSH key on the branch ruleset's bypass list.
- **A universal `.app` stays rejected, and the evidence is replaced.** Do not cite
  "`Graphene-1.0.typelib` differs in 1640 bytes": decoded, those are 410 FunctionBlob reserved-bit
  fills with `is_static` identical on both sides, and a Fedora x86_64 build writes the *arm64*
  pattern — the fill tracks the g-ir-compiler build, not the architecture. Cite instead:
  `GLib-2.0.typelib` carries **969 directory entries on darwin-arm64 and 970 on darwin-x64**, the
  extra one being `VA_COPY_AS_ARRAY` (x86-64 SysV only), while **44 of 47 typelibs are
  byte-identical**. One arch-conditional entry plus `binary.mjs`'s refusal to parse fat Mach-O is
  already sufficient; the false generality is what would reopen `lipo` later on "the measurement
  was wrong".

### A6. What stays rejected, and what unblocks it — in § 9's voice

- **A hand-written HFS+/UDIF writer.** *A `.dmg` is the first thing in this design that is bigger
  than the thing it wraps. Every other format here is a container: a table of contents over bytes
  we already have. A UDIF is a container around a FILESYSTEM, and writing a filesystem is a project
  rather than a target — 1200-2000 lines where the entire existing packer surface is 1036, and
  every mistake is silent, because Finder mounts the image and shows an empty window. What it would
  buy is an independent reader, and 7-Zip already advertises `Dmg`, `HFS` and `APFS` handlers
  regardless of who wrote the file.* Unblocker: none wanted. `hdiutil` on a darwin runner, read back
  on Linux with `7z` plus `dmg2img` → `fsck.hfsplus -n`.
- **A hand-written MSI.** Feasible and ≈1300 lines, and the three constraints that forced the
  hand-written deb/rpm writers have no subject here: § 4 records that there is no GJS host on
  Windows at all. Unblocker: the day `ship` must pack an `.msi` inside a sandbox with no distro
  packages. Until then, one authored `.wxs` with a host-selected backend, cross-checked between
  `wixl` (Linux) and WiX (Windows) so the producer and the reader are not the same package —
  `msitools` ships both `wixl` and `msiinfo`, so a wixl-only path would be a self-oracle.
- **An `.icns` icon in the bundle.** *Every other file a `.app` carries is one this tree either
  copied or wrote in a format it can read back. An ICNS would be neither: `png2icns`, `icnsutil` and
  `iconutil` are all absent from this workstation and from the CI image, so an icon written here
  could only be checked by a reader written here — `oracle.selfReading: true`, which the format
  table lets a row DECLARE and `flatpak.spec.ts` reds for every row that does. So M2a ships no
  `.icns` and emits no `CFBundleIconFile`, and the hicolor PNG/SVG the payload already carries stays
  the only icon, unread on macOS: a bundle with no icon shows a generic one, which is visibly
  incomplete, where a bundle with a malformed one is a bug nobody on Linux can see.* Unblocker: an
  independent Linux ICNS reader in the CI image — `icnsutil` is the candidate — after which the key
  and the file land together, in one commit, with the reader gating them.
- **MSIX.** An unsigned one cannot be installed at all, and the property under test — "installs on a
  machine that never saw our certificate" — cannot be measured by the leg that holds the
  certificate. A self-signed cert in `TrustedPeople` buys a green leg that proves nothing.
  Unblocker: the same certificate Authenticode needs, so it is one decision, not two.

### A7. Consequence for the docs

`website/src/content/docs/ship/index.mdx` says the packers are plain JavaScript *"so the command
runs anywhere"*, and that there is *"no packaging file to keep in your repo"*. Both become false
here: `--format dmg` refuses on Linux, and `gjsify ship ci` scaffolds a workflow into the
consumer's repository. The honest replacement is A1's rule plus: *assemble anywhere, pack where the
format's tool lives, and never claim a signature we could not make.*

## Amendment, 2026-08-22 — translations are payload, and the prefix has to reach the app

### A8. `localeDir`: compiled catalogues, staged in the only layout that is ever read

§ 2 listed the payload as "the app bundle, its assets, its GSettings schemas, its icons and its
metadata". Translations were not in it, and nothing else carried them: an app with a working
gettext setup could be packaged and would show English on a German desktop, because the `.mo`
files simply were not in the artifact.

`gjsify.ship.localeDir` names a directory of COMPILED catalogues — `<lang>/LC_MESSAGES/<domain>.mo`,
which is the default output of `@gjsify/vite-plugin-gettext`'s `gettextPlugin` — and they are
staged into `share/locale/` with that structure preserved.

The structure is not a stylistic choice: `bindtextdomain` looks in `<dir>/<lang>/LC_MESSAGES/` and
nowhere else. So discovery REFUSES three shapes, all of them the same failure wearing different
clothes — a package that installs its translations and shows none of them:

| refused | why it would otherwise pass |
|---|---|
| a `.po` beside or instead of a `.mo` | `bindtextdomain` reads `.mo` only; a staged `.po` is a file nothing opens |
| a `.mo` outside `<lang>/LC_MESSAGES/` | the commonest slip is `msgfmt` run without the `LC_MESSAGES` level |
| a declared directory holding no `.mo` at all | a promise the package does not keep, and it packs green |

That failure mode is why the refusals exist rather than warnings. An untranslated UI is
indistinguishable from "this app has no German", so nobody reports it as a packaging bug — it is
the quietest possible way for a release to be wrong.

### A9. The launcher passes the locale directory, for the reason § 3 already gives

§ 3 established that the launcher derives its prefix at runtime so ONE payload becomes `/usr` in a
`.deb`, `/usr` in an `.rpm` and `/app` in a Flatpak. Catalogues inherit that problem exactly:
`bindtextdomain` takes a directory, and there is no environment variable the *library* reads on its
own (`TEXTDOMAINDIR` is honoured by the gettext command-line tools, not by glibc's
`bindtextdomain`). A baked `/usr/share/locale` would be wrong in a Flatpak and in every
`--prefix` tree.

So the launcher exports `GJSIFY_LOCALE_DIR="$prefix"/share/locale` when — and only when — something
was staged, and the app calls `bindtextdomain(domain, GLib.getenv('GJSIFY_LOCALE_DIR') ?? '/usr/share/locale')`.
Same division of labour as `XDG_DATA_DIRS` for icons and schemas: the launcher knows the install
layout, the app does not.

### A10. The locale tree drops out of the wholesale bundle staging

`discoverPayload` stages every file beside the bundle into `lib/<binary>/`, and `dist/locale/` sits
beside `dist/app.gjs.mjs` in the layout above. Measured on a probe package: the same `.mo` came out
at BOTH `share/locale/de/LC_MESSAGES/` and `lib/<binary>/locale/de/LC_MESSAGES/`. The second copy is
dead weight — nothing looks there.

This is the same class as `ship` once staging the test suite: whatever lies next to the bundle is
carried, whether or not it belongs in a package. The subtraction is targeted at the DECLARED locale
directory only, so a package that legitimately ships assets beside its bundle keeps them.

### A11. Handling a file type is not defining one

`MimeType=` in a desktop entry says "I open this type". It does not say the type EXISTS.

For a type the distribution already defines (`text/plain`, `application/pdf`) that distinction never
comes up. For a type of the project's own it decides whether the feature works at all, and the
failure mode is the quietest in this ADR:

| what is declared | what happens |
|---|---|
| `provides.mimetypes` alone, for a custom type | nothing on the system knows the type exists, so the file manager never assigns it, `MimeType=` matches nothing, and a double-click does nothing — no error, no log line |
| a shared-mime-info document with no cache refresh | detection reads the compiled cache under `share/mime`, not `share/mime/packages`, so the type stays unknown until something else happens to rebuild it |

Both are indistinguishable from "the application is not installed".

So `gjsify.ship.mimeTypes` DEFINES types — a shared-mime-info document staged as
`share/mime/packages/<app-id>.xml`, named after the app id for the same reason the GSettings schema
is (that directory is shared between packages, and a generic name is a collision) — and the package
runs `update-mime-database` in its post-install, alongside the desktop, icon and schema refreshes
§ A3 already established.

Declared types are folded into `provides.mimetypes` during resolution rather than being a second
list to keep in step. The desktop entry and the metainfo then need no knowledge of `mimeTypes` at
all: they already render `MimeType=` (with the `%f` field code § 5 requires) and `<mediatype>` from
that one field. Keeping the lists independent would make "defined but not handled" a state reachable
by omission — and that state installs cleanly and does nothing.

Discovery refuses four shapes, each of which would otherwise install and never resolve: a malformed
type name (`update-mime-database` ignores it), a glob with no wildcard (`bauplan` matches only a file
called exactly that), a type with neither a glob nor a parent (nothing can ever match it), and a
duplicate definition (which comment wins would depend on document order). An empty `comment` is
refused too, because a file manager then shows the user the raw type string.

## Amendment, 2026-08-29 — the signing interface is an identity, and unsigned is the default path

§ A2 writes the finish phase's signing surface as two booleans, `[--sign] [--notarize]`. Both are
the wrong shape, and that line is what #1354 M6 would be implemented against — so it is corrected
here, before M2 wraps the first container around a stage. Nothing above is reversed. § 5's *"an
unsigned artifact is a legitimate output"* is promoted from concession to DEFAULT PATH, and § A4's
re-signing rule is unchanged; what changes is who supplies the credential and where it lives.

### A12. `--sign` takes an IDENTITY, not a certificate

`codesign` is never handed a certificate. It is handed a STRING, and it is the string's job to
name an identity the signing machine already holds. The reference passes an opaque `$SIGN` straight
through (`refs/node/tools/osx-codesign.sh:16-21`):

```sh
codesign \
  --sign "$SIGN" \
  --entitlements tools/osx-entitlements.plist \
  --options runtime \
  --timestamp \
  "$PKGDIR"/bin/node
```

`productsign` takes the same value in the same shape (`refs/node/tools/osx-productsign.sh:12`).
One value of that string is reserved: `-` means ad-hoc, and this tree already writes it ~~three~~
**five** times plus once in the pool — `packages/node-gi/scripts/build-gtk-runtime-darwin.mjs:382`
and `:971`, `packages/node-gi/node-gi/scripts/stage-prebuild.mjs:147` and
`scripts/relocate-macho.mjs:192` (those four `codesign --force --sign -`),
`docs/poc/webkit-hardened-runtime-darwin.sh:126` (`codesign --force -s -`), and
`refs/node/test/common/sea.js:208` (`codesign --sign -`).

**Corrected 2026-08-29: the count was three.** It was assembled from the sites this amendment
happened to be looking at rather than from a grep, so `stage-prebuild.mjs` and `relocate-macho.mjs`
— neither of them obscure, both re-signing after `install_name_tool` for the same reason as the
other three — were simply not in the sample. The count a reader can reproduce is
`grep -rn "codesign" --include='*.mjs' --include='*.ts' --include='*.sh' . | grep -v '^./refs/'`,
minus the comment and doc-string hits it also returns. A number nobody can re-derive is the part of
a citation that rots first, so the command belongs beside it.

What the pool proves is exactly that much: the value is an opaque string, not a path, and `-` is a
legal one. *Where* `codesign` looks the private key up — a keychain search list — is Apple's
documented behaviour and is **not measured anywhere in this tree**; it is stated here as the reason
for the interface, not as a finding. The interface holds either way, because the operative fact is
the negative one: whatever the string resolves against, `gjsify ship` is not given the certificate.

So the flag is neither a boolean nor a path to a `.p12`, and § A2's synopsis is corrected in place:

```
gjsify ship darwin  --format dmg --from-stage <dir> [--sign <identity>] [--notarize <credential>]
gjsify ship windows --format msi --from-stage <dir> [--sign <identity>]
```

The project-level default is `gjsify.ship.sign.<os>.identity`, keyed per OS for the same reason
`gjsify.ship.flatpak` is keyed per format: a Developer ID string and an Authenticode subject are
different namespaces and must not share one field. The finish phase already knows which OS it is
in — `FormatDescriptor.layoutOs`, and the stage manifest's `target.os` — so the resolution needs no
new input. **Deliberately NOT settled here: an `entitlements` key.** § A16 is why.

### A13. Absent identity ⇒ skip, loudly, exit 0

The reference does this twice, identically, and it is the behaviour to copy
(`refs/node/tools/osx-codesign.sh:7-9`, `refs/node/tools/osx-productsign.sh:7-9`):

```sh
[ -z "$SIGN" ] && \
  echo "No SIGN environment var.  Skipping codesign." >&2 && \
  exit 0
```

Three properties, all of them wanted: no identity is not an error; the skip is printed rather than
silent; and it goes to stderr, so a pipeline that captures the artifact list still shows it. An
unsigned `.app` is a real deliverable for as long as no certificate exists — which, for this
project, is today — and § 5's refusal applies to the other direction only: **claiming** a signature
that was not made. (The reference's own message is copy-pasted: `osx-productsign.sh:8` says
"Skipping codesign" while skipping `productsign`. Ours names the step it skipped.)

### A14. `gjsify ship` never sees the certificate — and that is what makes third parties possible

Getting a `.p12` into a keychain is the signing HOST's step: a machine setup or a CI job, not this
command. `gjsify ship` will exec `codesign` with a name and pass no `--keychain` of its own, so
whatever the signing session already holds is what gets used. That sentence is the DECISION and not
a description: nothing in the CLI signs anything today — `grep -rniE 'codesign|notariz'
packages/infra/cli/src` returns 2 hits, both of them comments in `utils/ship/layout.ts` and its
spec. Three consequences, in the order they matter:

1. **No secret ever crosses the CLI's surface.** There is no `--certificate`, no `--p12`, no
   `--password`, and nothing to redact from a log line.
2. **External developers use their own identity with no fork and no fixture.** The configuration is
   the consumer's `gjsify.ship` block plus the flag, and the finish phase runs on the consumer's own
   macOS host under their own keychain. Nothing about JumpLink's identity is reachable from, or
   needed by, the code path.
3. **`HostRequirement` does not cover this, and § A1's rule overstated what the data says.** A1
   reads *"a container is produced where its format's tool lives, and a signature where its
   credentials live. A format declares which of the three it needs."* Measured, a format declares
   TWO of the three: `HostRequirement` (`packages/infra/cli/src/utils/ship/types.ts:89-119`) has
   `finishOn`, `requiredTools`, `installHint` and `oracle`, and no field for a credential. It is the
   right omission — `requiredTools: ['codesign']` answers "can this host run the tool", never "does
   this host hold the identity". The credential is per-RUN, not per-format, so it stays a flag.
   A1's sentence is amended to: *a format declares where it can be packed; the RUN declares what it
   can sign with.*

**Unverified, and marked as such rather than written as measured:** the exact incantation that puts
a `.p12` into a keychain on a fresh CI runner. `security import` and `security set-key-partition-list`
return zero files from `refs/node` at the pinned `0618e9f0`, against a control of 16 files for
`codesign` (`git grep -I -l -F -e <pattern>`). ~~Grepped across the whole pool.~~ **Struck
2026-08-29:** `refs/` is not greppable as a whole and this claim never measured it — 89 of the 95
submodules `.gitmodules` declares are uninitialised in a normal checkout and all 95 in a fresh
worktree, where `grep -rF codesign refs/` returns 0 hits for a string that IS in `refs/node`. The
gate says so in the same breath: `check-refs-citations` prints *"0 resolved in the 0 of 95 declared
submodules checked out here"*. `refs/node` is the only pool in the set that carries Apple signing
tooling at all, so it is the right place to have looked — but the scope reported has to be the
scope read. The one adjacent hit is
`refs/node/test/system-ca/README.md:44`, `security create-keychain -p "test" /tmp/node-test-dup.keychain`
— and it is a CA TRUST-STORE fixture for Node's system-CA tests, not a signing identity, so it
evidences the verb and not the procedure. Whoever implements M6 measures that step on a real runner
before writing it down anywhere as fact.

### A15. Notarisation is a SECOND credential, and the reference guards the wrong one

`--notarize` is not `--sign` with a longer wait. The two flags take unrelated inputs: one names an
identity present on the signing machine, the other an account credential, and the reference keeps
them in separate scripts with separate guards.

`refs/node/tools/osx-notarize.sh` is the trap to avoid, not the model to copy. It guards on three
environment variables — `NOTARIZATION_ID` (:14), `NOTARIZATION_PASSWORD` (:19),
`NOTARIZATION_TEAM_ID` (:24), each with its own skip-and-exit-0 — and then submits with none of them
(:39-42):

```sh
xcrun notarytool submit \
  --keychain-profile "NODE_RELEASE_PROFILE" \
  --wait \
  "node-$pkgid.pkg"
```

The three variables are read by nothing after the guard. So the script skips when the credential it
does not use is absent, and proceeds when it is present — while the credential it DOES use is a
keychain profile whose existence nothing checks. Set the three and omit the profile and it does not
skip — it reaches line 39 with nothing having looked at the profile, and what `notarytool` does
next is outside what this tree can measure. **The rule this repository takes from it: the guard
must test the credential the command actually consumes, and a skip must be reachable from exactly
the input the next line reads.** It is the green-CI-that-checked-nothing class § Consequences
already names, wearing a guard: a check standing in front of something other than what it claims
to protect.

**Left open, deliberately, and this is a claim NOT made:** which credential form `--notarize` takes.
The only shape evidenced in `refs/node` is `--keychain-profile <name>` (`osx-notarize.sh:40`), i.e. a
profile a prior `notarytool store-credentials` put in a keychain — that command appears nowhere in
`refs/node` either. The alternative usually cited, an App Store Connect API key passed as
`--key`/`--key-id`/`--issuer`, returns zero files there for `--key-id`, `--issuer`,
`App Store Connect`, `altool` and `store-credentials`, against the same 16-file `codesign` control.
Both are file-and-argument credentials rather than a keychain identity lookup, which is the
load-bearing difference from § A12; choosing between them is M6's measurement, not this amendment's
assertion. § A5 already writes the pair as *"`.p12` in a keychain plus an App Store Connect
`.p8`"* — that is what Apple OFFERS, and it is not a measurement of which form `--notarize` should
take; the two sentences sit at different confidence levels on purpose.

~~Grepped: no occurrence anywhere under `refs/`, and no `--issuer` outside LIEF's PE-signature
headers.~~ **Struck 2026-08-29, wrong twice over.** The scope is § A14's — `refs/node`, not the
pool. And the LIEF clause named an exception to an EMPTY set: `--issuer` has zero occurrences, so
there was nothing outside LIEF to exclude. What hits LIEF's PE-signature headers is the bare word
`issuer`, in 1 115 files in all (mbedtls, OpenSSL, npm's TLS fixtures) — two patterns were run and
one sentence was written about both, which is how a clause that reads like a careful exception ends
up describing neither. (`--key` on its own is no discriminator either, and is reported apart rather
than folded in: 9 files carry it, every one of them npm's generic *"set a config with `--key val`"*
placeholder or ngtcp2's TLS example, none Apple.)

### A16. What the identity does NOT settle: library validation

§ A4 establishes that the darwin leg must re-sign all 106 Mach-O images inside the stage, because
under hardened runtime library validation will not let a Developer-ID-signed main executable load
ad-hoc-signed dylibs. Note what § A4 measured and what it reasoned from: the **106 of 106**
signatures are a reading off the closure, while the loader rule they are fed into is Apple's
documented behaviour on the same footing as § A12's keychain — unmeasured here, and load-bearing
for this whole section. The obvious alternative is an entitlement, and the honest position is that
this repository has **not measured it either way**. What the pool does establish is narrower, and
worth writing down so nobody re-derives it:

- The entitlement is real and named `com.apple.security.cs.disable-library-validation`
  (`refs/node/tools/osx-entitlements.plist:13`).
- The reference GRANTS it: that plist is the one `osx-codesign.sh:18` hands to `--entitlements`
  beside `--options runtime`, and it grants six keys — `allow-jit` (:5),
  `allow-unsigned-executable-memory` (:7), `disable-executable-page-protection` (:9),
  `allow-dyld-environment-variables` (:11), `disable-library-validation` (:13),
  `get-task-allow` (:15).
- The reference is **not the same case as ours.** That script signs exactly ONE path —
  `"$PKGDIR"/bin/node` (`osx-codesign.sh:21`) — so nothing in it re-signs a closure at all, and the
  entitlement is doing a different job there from the one it would have to do here over 106 images
  shipped inside one artifact.

What is NOT known: whether that entitlement would let a Developer-ID-signed launcher load the
already-ad-hoc-signed closure unchanged, what it costs at Gatekeeper or notarisation, and whether it
is even reachable — this project's one hardened-runtime measurement
(`docs/poc/webkit-hardened-runtime-darwin.sh`, macOS 15.7.8 / x86_64; the three-case table is
`docs/adr/0022-webkit-on-darwin.md:308-312`)
was made ad-hoc, and its own header says ad-hoc code has no team identifier while some entitlements
are keyed on one (`:38-41`). So the design of record stays § A4's re-sign. An entitlement route is a
measurement M6 may make; until it does, neither branch is asserted here.

### A17. M6 needs no certificate, and neither does its oracle — plus one ordering constraint for M2

Ad-hoc signing requires no Apple Developer Program membership: it is what
`docs/poc/webkit-hardened-runtime-darwin.sh:38-39` uses precisely *"because it needs no developer
identity, so this runs on any machine and in CI"*, and what `refs/node/test/common/sea.js:208` does
in a test helper that skips on failure, or throws when its caller asked to verify the workflow
(`sea.js:210-216`) — and carries no credential in either branch, nor anywhere else in the file. So
the whole M6 pipeline — re-sign the closure inside the stage, then check arrival with the
Mach-O-aware comparator § A4 specifies (every non-Mach-O file byte-identical, every Mach-O
identical outside `LC_CODE_SIGNATURE` and `LC_UUID`) —
is a green CI leg with **no secret in it**, on a runner with no keychain of ours. A real Developer ID
later is a different VALUE for the same flag, not a different code path. That is the argument for
settling the interface now and the credential later, and it is why M6's ordering in #1354 (credential
question first, code last) does not block M2.

**And one constraint M2 has to respect even though it does no signing.** `--sign` makes the finish
phase a WRITER on a directory phase 1 produced — until now `--from-stage` only read it. `readStage`
compares each file's SIZE against `.gjsify-ship-stage.json`
(`packages/infra/cli/src/utils/ship/stage-writer.ts:85-89`, over `readStage` at `:91`), and that
comment already cites § A4 as the reason it is a size and not a `sha256`. A size is no more
re-sign-proof than a digest: whether a Developer ID `LC_CODE_SIGNATURE` is the same length as the
ad-hoc one it replaces is not measured, and the design must not depend on the answer. So the order
is fixed rather than bet on — **`readStage` validates the PRE-sign tree, the re-sign runs after it,
and the container is built after that** — and M2's `.app` packer must leave that seam where a later
`--sign` can be inserted between the two, instead of reading and packing in one pass.

## Amendment, 2026-08-30 — M6 landed, and three of its measurements amend § A15 and § A17

The interface § A12–§ A17 fixed is implemented (#1354 M6): `--sign <identity>` and
`--notarize <credential>` on the finish phase, `gjsify.ship.sign.<os>.identity` as the project
default, `utils/ship/signing.ts` holding the per-OS signer table, and
`.github/ship-oracle/verify-signed-arrival.mjs` as the comparator § A17 specifies. Nothing above is
reversed. Three things were MEASURED that those sections left as reasoning, and one claim made in
this document's own voice turns out to have been narrower than the pool.

### A18. `readStage` does refuse a re-signed tree, so § A17's ordering is not a precaution

§ A17 argues the order from "a size is no more re-sign-proof than a digest" and says the design must
not bet on the answer. Both halves are now measured, and they agree.

**Does `readStage` refuse a size change?** Yes. Append one byte to a staged file and it throws
*"… is 6 bytes in the stage and 5 in its manifest. The stage arrived truncated or was edited after
it was assembled."*

**Does an ad-hoc re-sign change the size?** Yes — **34 816 → 34 848 bytes, delta +32**, measured on
macos-latest/arm64 (2026-08-30) by copying one staged image out of a `.app` and running
`codesign --force --sign -` on the copy. The suite prints that number on every darwin run and
asserts nothing about it, because the design must not depend on it; what it settles is that § A17's
ordering is REQUIRED rather than defensive. A signer that wrote into the arriving stage would break
the very next `--from-stage` run of it.

**It is enforced structurally and not by convention**, which is what § A17 asked M2's packer to make
possible. `signPayload` TAKES what `readStage` returned and RETURNS what the packer consumes, so the
signed bytes are computed from the validated ones and cannot exist before them. The mutation happens
in a scratch directory the finish phase owns (`<outRoot>/signed/<format>/`); the stage is never
written to, and a `--from-stage --sign` run is therefore repeatable — which is itself an e2e
assertion, because it passes only for that reason.

The rule's ONE cost, recorded so nobody removes it as waste: signing runs per FORMAT, so a darwin
run that builds both rows signs the same images twice. It cannot be hoisted — each format's payload
carries that format's own overlay, and on darwin the licence lands INSIDE `<App>.app`.

### A19. The comparator's rule needs a third exemption, and it is a consequence rather than a concession

§ A17 specifies *"every Mach-O identical outside `LC_CODE_SIGNATURE` and `LC_UUID`"*. Implemented
against real load commands, that list is one short: `__LINKEDIT`'s `LC_SEGMENT_64` record carries
`filesize` and `vmsize`, and the signature blob lives INSIDE that segment by construction — a
signature of a different length moves the segment's end and nothing else. So the comparator masks
four regions, not two, and the fourth is the same fact as the first read off the segment that
contains what the first describes. Everything else — the mach header, every other load command,
every section, `__TEXT`, `__DATA` and the rest of `__LINKEDIT` — must match byte for byte, and
`dataoff` must be EQUAL in both images: a moved signature means the content in front of it changed
length, which no re-sign does.

It is `compareMachOAfterResign` in `packages/infra/manifest-conformance/lib/binary.mjs`, extended
there rather than built beside it because that file's header says *extend this file; never add a
second parser* — and because the alternative, a CPython twin in `.github/ship-oracle/`, would leave
two Mach-O parsers with nothing holding them to each other. Independence is not lost by that
choice: the other oracles in that directory read documents THIS TREE WRITES, where our own reader
would agree with itself, while here the mutation is made by Apple's `codesign` and the parser knows
nothing about it. The artifact is additionally read back by `codesign --verify --strict`, which
answers the other question — ours says the mutation was confined, Apple's says the signature is
valid.

### A20. Stapling IS evidenced — § A15 stopped quoting three lines early

§ A15 quotes `refs/node/tools/osx-notarize.sh:39-42` and this repository's implementation notes
initially recorded stapling as unevidenced. That was wrong, and the correction is the same shape as
the two § A12 and § A15 already carry: a claim assembled from the lines that were being looked at
rather than from a grep.

Measured on `refs/node` at the pinned `0618e9f0`, initialised in the worktree (89 of 95 submodules
are not, which is the trap § A14 was struck for), with `grep -rIl` and § A14's own control of **16
files for `codesign`**:

| pattern | files | what it is |
|---|---|---|
| `codesign` | 16 | the control |
| `--keychain-profile` | 1 | `tools/osx-notarize.sh` — as § A15 records |
| `notarytool` | 4 | that script plus three changelog entries |
| `stapler` | 4 | **`tools/osx-notarize.sh:58` plus three changelog entries** |
| `store-credentials` | 0 | as § A15 records |
| `--key-id` / `--issuer` | 0 / 0 | as § A15 records |
| `security import` / `set-key-partition-list` | 0 / 0 | as § A14 records |

`osx-notarize.sh:58` is `xcrun stapler staple "node-$pkgid.pkg"`, three lines past where § A15
stopped, preceded by an `xcrun spctl --assess --type install` gate at `:52`. So the reference's
sequence is submit → assess → staple, and only the first of the three is implemented here.

**What stays UNVERIFIED, and it is not the spelling.** The reference staples a `.pkg`; the only
file-shaped darwin artifact `gjsify ship` produces is a `.zip`, and whether `stapler` accepts one is
not measured anywhere in this tree. Adding a call that may refuse the single artifact it would ever
run on is code no run has exercised, deciding something it cannot justify — so it is an open item
with its measurement attached (`status/open-todos.md`) rather than a line of code. The same holds
one level up: `notarytool submit` itself has never run here, because notarisation needs an Apple
account and § A17's whole argument is that M6 does not.

### A21. What the ad-hoc proof does and does not reach

The darwin leg is green with no secret in it, as § A17 predicted: two real dylibs compiled by `cc`,
pre-signed the way the shipped closure arrives (`install_name_tool` invalidates the original, the
relocator re-signs — § A4's 106 of 106), staged into a `.app`, signed by the finish phase, and read
back by both oracles. `GJSIFY_SHIP_SIGNING_REQUIRE_CODESIGN=1` is what stops that leg passing on a
host with no `codesign`, and it is watched red on Linux.

Two limits, stated rather than implied. It runs over TWO images, not 106 — it measures the pipeline
and the comparator, not the scale. And an ad-hoc signature over an unchanged file is reproducible,
so one of the two fixtures carries a marker `--identifier` purely to guarantee that the re-signed
blob DIFFERS; without it a correct run could report every image `identical` and the comparator's
`signature-only` branch would never execute.

§ A16 is untouched: the `.app` bundle is not sealed and no entitlements are granted. The seal is
additionally blocked by something measurable on our side — the payload round trip is bytes plus mode
and carries no extended attributes, which is where a script main-executable's signature would have
to live.
