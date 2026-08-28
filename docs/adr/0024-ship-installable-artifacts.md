# 24. `gjsify ship` — one payload, a runtime policy per OS, several install formats

- Status: **Accepted** — stages 1, 2, 3 and 6 of § Implementation have landed; see § Implementation status
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
| Linux · `--app node` | bundled Node | no system Node can be assumed, and the app is Node |
| **macOS** | **Node + `@gjsify/node-gi` + `@gjsify/gtk-runtime-darwin-<arch>`** | this is the combination CI proves on both arches, with no Homebrew in the picture: the *batteries-included conformance* and *windowing proof* legs of `node-gi.yml` run green against the relocated bundle |
| **Windows** | **Node + `@gjsify/node-gi` + `@gjsify/gtk-runtime-win32-x64`** | **there is no GJS host on Windows** (`docs/ci-selective.md`), so this is not a choice. The *batteries-included conformance* and *Adwaita Storybook proof* legs prove it without gvsbuild |
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

**Amended 2026-08-21 (§ A1, § A4, § A5):** the boundary falls one step earlier than this section
draws it — a CONTAINER is produced where its format's tool lives, so a Linux host assembles the
`.app` but cannot write the `.dmg` around it. "SmartScreen will refuse" is false: it warns until
per-hash reputation accrues, signed or not. And signing is a payload MUTATION, not a wrapper —
measured, 106 of 106 Mach-O images in the darwin closure already carry a signature.

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
> signature where its credentials live.** A format declares which of the three it needs.

`status/open-todos.md`'s *"assembly is cross-platform … so a Linux host can build both"* is the
half-sentence this corrects; it is true of the layouts and false of the `.dmg`.

### A2. Two phases, one verb each

```
# PHASE 1 — assemble. Anywhere, under GJS, offline.
gjsify ship linux   [--target deb,rpm] [--arch <process.arch>] [--stage]
gjsify ship darwin  --stage  [--arch arm64|x64]
gjsify ship windows --stage  [--arch x64]

# PHASE 2 — finish. On the host the FORMAT declares.
gjsify ship darwin  --format dmg --from-stage <dir> [--sign] [--notarize]
gjsify ship windows --format msi --from-stage <dir> [--sign]

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
