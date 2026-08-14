# 24. `gjsify ship` — one staged tree, several install formats

- Status: **Proposed**
- Date: 2026-08-14
- Deciders: Pascal Garber
- Related: [ADR 0017 (native distribution)](0017-native-package-distribution.md), [ADR 0018 (OS-axis declaration)](0018-os-axis-declaration.md), [docs/publishing.md](../publishing.md), `status/open-todos.md` § *gjsify on Flatpak — remaining roadmap*

## Context

gjsify can build an application for four targets. It cannot hand a stranger something to
install, unless that something is a Flatpak.

Measured on this tree:

```
$ grep -rniE 'appimage|nfpm|dpkg-deb|rpmbuild|\.rpm\b' packages/infra/cli/src docs status | wc -l
0
```

Not a partial implementation, not a TODO — the question has never been asked. The half that
IS answered is answered well: `packages/infra/cli/src/commands/flatpak/` is 2 633 lines over
nine subcommands with six e2e suites behind it, one of which drives a real `flatpak-builder`.
It emits `.desktop.in` / `.metainfo.xml.in` gettext templates, so app metadata is
translatable, and `flatpak sources` replaces `flatpak-node-generator` with a Node-free reader
for four lockfile formats.

**What the gap costs, counted rather than felt.** Of roughly fifteen GJS applications across
this ecosystem, exactly one is installable by someone who is not us: Learn6502, on Flathub. It
pays about 685 hand-written lines for that, of which **158 are meson whose only job is to call
`gjsify build` and put the results in a prefix** — 66 of them `GI_TYPELIB_PATH`/`LD_LIBRARY_PATH`
plumbing that still carries the `linux-x86_64` spelling ADR 0018 retired. The thirteen
showcases ship no desktop entry, no metainfo, no icon and no schema, so none of them can be
installed at all. Every app that wants to ship writes that glue again.

**The reference.** `refs/gtkx` (v1.1.0, pinned by #1180) answers the same question for
React+TypeScript GTK4 apps in 4 124 lines across 52 files, and the interesting number is how
little of it is per-format: **73 % is target-independent.** The whole difference between a
Flatpak and an `.rpm` is a four-line prefix map
(`refs/gtkx/packages/cli/src/deploy/payload/stage.ts:35`) plus three overlay cases — where the
copyright file goes, where the licence goes, and whether D-Bus activation is a `.service` file
or a non-`DBusActivatable` desktop entry.

That ratio is the finding. Packaging looks like four problems and is one problem plus four
prefixes.

## Decision

### 1. The command is `gjsify ship`

Collisions measured, not guessed. `deploy` is taken *conceptually* — `deploy-docs.yml` and the
`Deploy to GitHub Pages` job already make "deploy" mean *publish the website*. `publish` is npm
publishing. `pack` is the npm tarball. `dist/` is a build-output directory the tree checks for
literally. `package` is the most overloaded noun in a monorepo with ~200 of them. `ship` occurs
nowhere as a command or a concept, is a verb like its siblings (`build`, `run`, `check`,
`publish`), and names the outcome rather than the mechanism.

### 2. One staged, prefix-relative tree is the artifact

`gjsify ship` produces exactly one tree and every target installs it **unchanged**:

```
bin/<binary>                      position-independent launcher
lib/<binary>/{bundle.mjs,assets,gschemas.compiled,…}
share/{applications,metainfo,icons,glib-2.0/schemas,dbus-1/services}
```

`/usr` for deb/rpm, `/app` for Flatpak. Per-target code exists only where the FORMAT differs,
never where the payload does. A target that needs a file the others do not gets an overlay
directory, not a branch in the staging code.

This is the decision the rest hang off: it is what lets the Flatpak module become
`buildsystem: simple` + `cp -a stage/.`, which is what removes meson from inside the sandbox.

### 3. The launcher derives its own prefix

```sh
self=$(readlink -f "$0"); prefix=$(dirname "$(dirname "$self")")
```

A launcher that resolves its prefix at runtime is what makes ONE tree serve `/usr`, `/app` and
a mounted image. A launcher with a baked path forces a per-target payload, and the four-line
prefix map collapses back into four packaging implementations.

### 4. A `--app gjs` application does not bundle a runtime

The reference bundles Node (~100 MiB, SHA-256 verified, cached, stripped) because a GTKX app
IS Node. A `--app gjs` app needs **GJS**, which comes from `org.gnome.Platform` or from
`Depends: gjs (>= 1.86)` — bundling anything for it would be a hundred megabytes of cargo cult.

Stated per build target, because this is exactly where an idea copied wholesale would do
damage:

| target | staging + metadata + deb/rpm | bundled runtime |
|---|---|---|
| `gjs` | yes | **no** — declare the dependency |
| `node` | yes | yes, and only here |
| `browser` | no OS-package question | — |
| `nativescript` | out of scope: APK/IPA is a different pipeline | — |

### 5. A dependency that cannot be derived fails the build

The reference maps GI namespaces to distro packages through a four-entry table and returns
`[]` for anything unlisted (`refs/gtkx/packages/cli/src/deploy/depends.ts`). An under-declared
runtime dependency does not fail in CI; it fails on a user's machine, after the download, with
a dynamic-linker error. Ours fails the build and names the namespace. An escape hatch stays
(`ship.depends.{deb,rpm}`), because a table will always be incomplete — what may not stay is
the silence.

### 6. The glibc floor is derived from the ELF, not authored

`gjsify.glibcRequires` is authored today on the platform packages, and nothing checks it
against the binary. The floor is readable: walk the section headers, read `DT_NEEDED` from
`.dynamic`, take the highest `GLIBC_x.y` in `.dynstr`. No `readelf`, no `ldd`, ~150 lines.

**This one is separable and should not wait for the rest.** It converts an authored
declaration into a machine-checked one, which is what the `declarations` governance rule
demands of every `gjsify.*` key, and it pays off even if no `ship` command is ever written.

### 7. `gjsify flatpak` becomes a target of `ship`, later

Not in the first change. The nine subcommands keep working and keep their config; `ship` starts
by staging and by adding deb + rpm. Folding Flatpak in means unifying `gjsify.flatpak` with
`ship`'s config block, and that is a published contract change with its own decision to make.
Two commands that share a staging model and not yet a config key is an acceptable intermediate
state; two commands that duplicate the staging model is not.

### 8. AppImage is out of scope

The reference's AppDir carries the app and not GTK4, so "runs anywhere without installing" is
false on any host without GTK4. A GJS app would additionally have to carry GJS. gjsify can make
that promise honestly only by shipping a runtime bundle inside the image — a different, larger
decision. Better no AppImage than one that fails on the machines it was invented for.

### 9. Reimplement from the design; copy nothing

`refs/gtkx` is **MPL-2.0** repo-wide with no per-file headers; gjsify declares MIT in 185
package manifests. MPL-2.0's copyleft is per-FILE and survives copying, so a lifted file would
be MPL inside an MIT tree and would contradict its own `package.json`. The designs above are
ideas, not code — the ELF reader in particular is re-derivable from the ELF specification,
which is what `refs/` is for.

## Consequences

**What it deletes.** Learn6502's 158 lines of meson glue, and the same 158 lines that each of
the thirteen showcases and every future app would otherwise write. Meson disappears from inside
the Flatpak sandbox. The authored `gjsify.glibcRequires` values stop being a claim nobody
checks.

**What it costs.** A new top-level command in `@gjsify/cli` — no new published npm name, so no
first-publish bootstrap ([docs/publishing.md](../publishing.md)) — plus a pinned, checksum-verified
third-party packer for deb/rpm, and the e2e suites to prove an artifact INSTALLS. The last part
is not optional: the reference tests only that its manifests render, and no CI job of theirs
ever builds a package. A `ship` that asserted on rendered YAML would be this repo's
green-CI-that-checked-nothing class, on a new surface.

**What stays open.** Whether `gjsify.flatpak` and `ship`'s config block unify, and under which
name (§ 7). Whether the deb/rpm packer is vendored or hand-rolled — `.deb` is `ar` plus two
tars and `@gjsify/tar` already exists, while an `.rpm` header is not worth hand-writing, so the
answer may differ per format. Whether a `--app node` app's bundled runtime is fetched at ship
time or declared as a platform package the way ADR 0017 already distributes native builds.

## Implementation

Staged, each stage independently useful and independently mergeable:

1. **ELF glibc floor** + a `@gjsify/manifest-conformance` rule holding `gjsify.glibcRequires`
   against the binary. Needs nothing else here (§ 6).
2. **The staged tree** — `gjsify ship --stage` producing the payload and nothing else, proven
   by an e2e suite that inspects the tree.
3. **deb + rpm**, plus the dependency derivation of § 5, with an e2e suite that installs the
   artifact in a container and runs the binary.
4. **Flatpak as a target** (§ 7), retiring the duplicate staging path.

Follow-up work lands in `status/open-todos.md` per governance; this ADR records the why.
