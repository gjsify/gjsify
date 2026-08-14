# 24. `gjsify ship` — one payload, a runtime policy per OS, several install formats

- Status: **Proposed**
- Date: 2026-08-14
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

**The reference.** `refs/gtkx` (v1.1.0, pinned by #1180) answers the Linux half for
React+TypeScript GTK4 apps in 4 124 lines across 52 files, and the interesting number is how
little of it is per-format: **73 % is target-independent.** The whole difference between a
Flatpak and an `.rpm` is a four-line prefix map
(`refs/gtkx/packages/cli/src/deploy/payload/stage.ts:35`) plus three overlay cases — where the
copyright file goes, where the licence goes, and whether D-Bus activation is a `.service` file
or a non-`DBusActivatable` desktop entry. It has no macOS and no Windows story at all.

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
| Linux · `--app gjs` | none — `Depends: gjs (>= 1.86)` | GJS and GTK come from the distro. Bundling would be ~100 MiB of cargo cult |
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

### 6. A dependency that cannot be derived fails the build

The reference maps GI namespaces to distro packages through a four-entry table and returns
`[]` for anything unlisted (`refs/gtkx/packages/cli/src/deploy/depends.ts`). An under-declared
runtime dependency does not fail in CI; it fails on a user's machine, after the download, with
a dynamic-linker error. Ours fails the build and names the namespace. An escape hatch stays
(`ship.depends.{deb,rpm}`), because a table will always be incomplete — what may not stay is
the silence. On macOS and Windows the question does not arise: the closure is in the artifact.

### 7. The glibc floor is derived from the ELF, not authored

`gjsify.glibcRequires` is authored today on the platform packages, and nothing checks it
against the binary. The floor is readable: walk the section headers, read `DT_NEEDED` from
`.dynamic`, take the highest `GLIBC_x.y` in `.dynstr`. No `readelf`, no `ldd`, ~150 lines.

**This one is separable and should not wait for the rest.** It converts an authored
declaration into a machine-checked one, which is what the `declarations` governance rule
demands of every `gjsify.*` key, and it pays off even if no `ship` command is ever written.

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
   against the binary. Needs nothing else here (§ 7).
2. **The payload and the Linux layout** — `gjsify ship --stage` producing the tree and nothing
   else, proven by an e2e suite that inspects it.
3. **deb + rpm**, plus the dependency derivation of § 6, with an e2e suite that installs the
   artifact in a container and runs the binary.
4. **macOS `.app` + `.dmg`**, assembling `@gjsify/gtk-runtime-darwin-<arch>` and the node-gi
   prebuild, proven on the existing macOS legs; signing behind § 5's separation.
5. **Windows program directory + installer**, same shape against `gtk-runtime-win32-x64`.
6. **Flatpak as a format under `ship`** (§ 8), retiring the duplicate staging path once 2–3
   have landed.
7. **`@gjsify/gjs-runtime-darwin-<arch>`**, after which § 4's macOS row can change to GJS.

Follow-up work lands in `status/open-todos.md` per governance; this ADR records the why.
