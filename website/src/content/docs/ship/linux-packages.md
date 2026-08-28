---
title: deb & rpm packages
description: "The practical guide to `gjsify ship`: prerequisites, every flag, what the staged payload looks like, how to install the result and how to pick the architecture."
---

`gjsify ship` turns a built GJS app into a `.deb` and an `.rpm`. Run it in your
project root:

```bash
gjsify ship
```

It runs your `build` script, stages one payload, and packs that same payload
into each format. Everything else on this page is about what it needs from you
and what you can change.

## Get your project ready

`gjsify ship` derives almost everything, but a few things it cannot guess.
Check these before the first run:

| package.json | Needed for | Override |
|---|---|---|
| `name` | the package name and the `bin/` entry | `gjsify.ship.binaryName` |
| `version` | `Version:` in both formats | `gjsify.ship.version` |
| `license` (an SPDX id like `"MIT"`) | a required field in both formats | `gjsify.ship.license.project` |
| `author` as `"Name <you@example.org>"` | `Maintainer:` / `Packager:`; dpkg refuses a package without one | `gjsify.ship.maintainer` |
| `gjsify.main` (or `main`) | the bundle the launcher executes | `gjsify.ship.bundle` |
| — | the human-readable display name: the `.desktop` `Name=`, the AppStream `<name>`, and the `<name>.app` directory a macOS layout is staged into | `gjsify.ship.name` (defaults to a title-cased `binaryName`) |
| `scripts.build` | the build step that runs first | pass `--skip-build` instead |

Your `version` is rewritten on the way in, because npm and dpkg disagree about
what a prerelease is. A leading `v` is dropped, `+buildmetadata` is dropped with
a warning, and `1.2.0-rc.1` becomes `1.2.0~rc.1`. That last one matters: both
dpkg and rpm sort `1.2.0~rc.1` *before* `1.2.0`, the way npm does, while they
read `1.2.0-rc.1` as release `rc.1` of version `1.2.0` and sort it *after*, so a
prerelease published that way would never upgrade to the release. A version
neither format can spell stops the run instead of being guessed at.

You also need a reverse-DNS **app id**, because it names the desktop entry, the
AppStream component and the installed icon. Set `gjsify.ship.appId`, or let it
fall back to `gjsify.flatpak.appId` if you already ship a Flatpak. If your
package name is itself reverse-DNS (`org.example.MyApp`), that is used.

Two more things are picked up automatically when they follow the usual GNOME
layout, and are worth having:

- **Icons** from `data/icons/` or `data/icons/hicolor/`, or wherever
  `gjsify.ship.icon` points (a single file or a directory). SVGs land in
  `scalable`; for PNGs the size is read from a `128x128/` path component or from
  a trailing number in the filename (`icon-128.png`). Without an icon your app
  shows a placeholder in menus and app stores, and ship warns about it.
- **GSettings schemas**: any `*.gschema.xml` under `data/`, or under
  `gjsify.ship.schemas`. Every installed schema on the system shares one
  directory, so each file's name has to start with your app id.

A `LICENSE`, `LICENSE.md`, `LICENSE.txt`, `COPYING` or `COPYING.md` in the
project root is found on its own and installed where each format expects it.

Finally, your project has to build for GJS. If `gjsify.app` is set to anything
other than `"gjs"`, ship refuses instead of producing a package that installs
and then fails to start.

## Build the packages

```bash
gjsify ship --verbose
```

`--verbose` prints every staged file and the GI namespaces it found in your
bundle, which is the quickest way to see whether the payload is what you think
it is:

```text
[gjsify ship] staged 6 file(s) in ship/stage/
[gjsify ship]   bin/my-app
[gjsify ship]   lib/my-app/gjs.js
[gjsify ship]   share/applications/org.example.MyApp.desktop
[gjsify ship]   share/glib-2.0/schemas/org.example.MyApp.gschema.xml
[gjsify ship]   share/icons/hicolor/scalable/apps/org.example.MyApp.svg
[gjsify ship]   share/metainfo/org.example.MyApp.metainfo.xml
[gjsify ship] gi namespaces: Adw-1, Gtk-4.0
[gjsify ship] deb: ship/out/my-app_1.2.3-1_all.deb (2524 bytes)
[gjsify ship] rpm: ship/out/my-app-1.2.3-1.noarch.rpm (5117 bytes)
```

A real run prints more than this, and none of it is an error. Anything missing
from the AppStream component (`gjsify.ship.developer`, `summary`, `description`,
`license.project`, `homepageUrl`) is reported as a warning, because the package
still installs and still runs; it is app *stores* that will object, which is a
different day's problem. Fill them in before you submit anywhere. You will also
see a warning about the GJS version this asks for on Debian; see
[Choose the GJS floor](#choose-the-gjs-floor).

Already built? Skip the build step:

```bash
gjsify ship --skip-build
```

Want one format only, or the payload without any packing at all?

```bash
gjsify ship --target deb     # one format
gjsify ship --stage          # write ship/stage/ and stop
```

The same payload also becomes a Flatpak — `gjsify ship --target flatpak`, opt-in
because it is the only format that needs `flatpak-builder` on the packing host.
That one is covered in [Ship your app](/gjsify/ship/#the-flatpak-target).

## Read the staged payload

Everything lands under `ship/` (change it with `--out`):

```text
ship/
├── stage/                       one payload, prefix-relative
│   ├── bin/my-app
│   ├── lib/my-app/…
│   └── share/…
├── overlay/
│   ├── deb/share/doc/my-app/copyright
│   └── rpm/share/licenses/my-app/LICENSE
└── out/
    ├── my-app_1.2.3-1_all.deb
    └── my-app-1.2.3-1.noarch.rpm
```

`stage/` is the whole app: the launcher in `bin/`, your bundle in `lib/<name>/`,
and the desktop entry, icon, AppStream metainfo and schemas in `share/`.
`overlay/` holds what one format wants somewhere of its own, which today is the
licence and nothing else. Debian policy puts it in `share/doc/<pkg>/copyright`,
rewrapped as a machine-readable copyright file; RPM puts the plain text in
`share/licenses/<pkg>/`. A project with no licence file gets no overlay at all.

Both packers read `stage/` back off disk rather than keeping it in memory, so
what you inspect is what a user installs. That also means `gjsify ship --stage`
and a full run write the same `stage/` tree.

Two details worth knowing:

**The whole bundle directory is staged.** `gjsify.main: "dist/gjs.js"` stages all
of `dist/` into `lib/my-app/`. Keep build leftovers out of that directory, or
point `gjsify.ship.bundle` at a clean one.

**`bin/my-app` is a small shell launcher.** It works out its own install prefix
from its own path, prepends `<prefix>/share` to `XDG_DATA_DIRS`, and then execs
`gjs -m` on your bundle. Because no path is baked in, the same payload works
installed under `/usr`, under `/app`, or anywhere else.

## Install and check the result

```bash
sudo dnf install ./ship/out/my-app-1.2.3-1.noarch.rpm     # Fedora, RHEL, openSUSE
sudo apt install ./ship/out/my-app_1.2.3-1_all.deb        # Debian, Ubuntu
```

Then run `my-app`, or find it in your application menu. Uninstalling is
`dnf remove my-app` / `apt remove my-app`, and the package refreshes the desktop
database, the icon cache and the compiled GSettings schemas on the way in and
out.

Before publishing, it is worth reading the artifact back with the distro's own
tools rather than trusting the packer:

```bash
rpm -qp --info     ship/out/my-app-1.2.3-1.noarch.rpm   # name, version, licence, summary
rpm -qpl           ship/out/my-app-1.2.3-1.noarch.rpm   # every installed path
rpm -qp --requires ship/out/my-app-1.2.3-1.noarch.rpm   # the derived dependencies
rpm -K             ship/out/my-app-1.2.3-1.noarch.rpm   # digests
ar t               ship/out/my-app_1.2.3-1_all.deb      # the three .deb members
```

For the app in the output above, `rpm -qp --requires` lists these first, ahead
of the `/bin/sh` its scriptlets need and rpm's own `rpmlib` internals:

```text
gjs >= 1.86
libadwaita
gtk4
hicolor-icon-theme
glib2
```

None of that was configured. The GTK and libadwaita entries come from the
`gi://` imports in the built bundle, `hicolor-icon-theme` because this is a GUI
app rather than a `kind: "cli"` tool, and `glib2` (`libglib2.0-bin` on Debian)
because the payload installs a GSettings schema that has to be compiled at
install time.

### Build it reproducibly

Packing the same build twice gives byte-identical artifacts. Timestamps come
from your bundle's mtime, or from `SOURCE_DATE_EPOCH` when that is set, which is
what makes two different checkouts of the same source produce identical bytes:

```bash
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) gjsify ship
```

This holds per JS runtime. The payload is gzipped through the Web
`CompressionStream`, whose output is implementation-defined, so an artifact
built under Node and one built under GJS need not match each other byte for
byte.

## Pick the architecture

You usually do not have to. `gjsify ship` looks at the bytes in the payload: if
nothing in it is a native binary, the package is `Architecture: all` (deb) and
`BuildArch: noarch` (rpm). A bundle of pure JavaScript really does install
everywhere, and claiming `amd64` would make apt refuse it on an arm64 machine it
runs on perfectly.

As soon as the payload carries a `.so`, a `.node` or any other native binary,
the package is labelled for one architecture: this host by default, or whatever
`--arch` says.

```bash
gjsify ship --arch arm64
```

`--arch` takes `process.arch` spelling and maps it per format:

| `--arch` | deb | rpm |
|---|---|---|
| `x64` | `amd64` | `x86_64` |
| `arm64` | `arm64` | `aarch64` |
| `ia32` | `i386` | `i686` |
| `arm` | `armhf` | `armv7hl` |
| `riscv64` | `riscv64` | `riscv64` |
| `ppc64` | `ppc64el` | `ppc64le` |
| `s390x` | `s390x` | `s390x` |

It labels the artifact; it does not cross-build the payload. Use it when you
have already produced a payload for that architecture, typically from a CI job
running on that machine.

## Look up a flag

| Flag | Default | What it does |
|---|---|---|
| `--target <fmt..>` | `gjsify.ship.targets`, else `deb,rpm` | Formats to build. Comma-separated or repeated. An unknown name fails before anything is built, and so does a format belonging to another OS's layout — `gjsify ship darwin --target deb` is an error. `gjsify.ship.targets` is treated differently on purpose: it is a project default, so a name that wraps another layout is dropped with a printed note rather than failing the run. |
| `--out <dir>` | `gjsify.ship.outDir`, else `ship` | Output root, relative to the project. |
| `--stage` | `false` | Write the staged payload and stop, packing nothing. |
| `--from-stage <dir>` | — | Pack a payload an earlier `--stage` run wrote. Needs no project: no `package.json`, no config, no built bundle. |
| `--expect-target <os>-<arch>` | — | With `--from-stage`: refuse a stage assembled for a different matrix leg. Compares against what the stage recorded, not against this host. |
| `--skip-build` | `false` | Package what is already built instead of running the project's `build` script. |
| `--arch <arch>` | this host | Target architecture in `process.arch` spelling. |
| `--verbose` | `false` | Print each staged file and the GI namespaces the bundle imports. |

## Add a typelib ship does not know

Runtime dependencies are read from your built bundle's `gi://` imports and
mapped to the package that ships each typelib, which is why the deb and rpm
lists look nothing like each other for the same library. If your bundle reaches
a namespace the built-in table has never heard of, the build stops and names it:

```text
gjsify ship: the bundle imports gi://Nautilus, and no deb package is known to
ship that typelib. [...] Fill the gap in package.json: [...]
```

That is deliberate. A missing runtime dependency does not fail at package time;
it fails on a user's machine, after the download, and reads like a bug in your
app. Add the row yourself:

```jsonc
"gjsify": {
  "ship": {
    "typelibPackages": {
      "Nautilus-3.0": { "deb": "gir1.2-nautilus-3.0", "rpm": "nautilus" }
    }
  }
}
```

If you find a mapping that others will need too, a pull request adding it to
gjsify's own table saves the next person the same detour.

`gjsify.ship.depends` is a different key for a different job: it appends
dependencies that are not typelibs at all (`dconf`, a helper binary, a font).
It does not silence the failure above.

## Choose the GJS floor

The emitted dependency is `gjs (>= 1.86)`, which is the GJS the bundler targets.
**No released Debian satisfies it.** Debian went from 1.82.3 in trixie straight
to 1.88.1 in forky, skipping 1.84 and 1.86, so apt on trixie will refuse your
`.deb`. Fedora, forky, sid and current rolling distributions are fine.

`gjsify ship` prints this rather than quietly lowering the number, because a
package apt refuses is a better outcome than one that installs and then dies on
a syntax error the older SpiderMonkey cannot parse.

If your bundle genuinely runs on an older GJS, say so:

```jsonc
"gjsify": { "ship": { "minGjsVersion": "1.82.3" } }
```

Test it on that version before you do. Lowering the floor to make apt happy,
without checking, is how you turn a clean refusal into a crash on first launch.

## Choose the Node floor — only for `--app node`

A `--app gjs` package declares no Node dependency at all, and this section does
not apply to it. A **`--app node`** bundle needs an interpreter, and on Linux it
is depended on rather than shipped:

```
Depends: nodejs (>= 24)          # deb
Requires: nodejs(engine) >= 24   # rpm
```

`gjsify ship` picks the interpreter from `gjsify.app` — the same field your build
already uses — and the launcher it writes execs that one and no other. A package
therefore declares exactly one interpreter, and `gjsify ship` refuses to build one
whose launcher and dependency disagree.

**The two names are not interchangeable, and getting rpm's wrong fails
silently.** `Requires: nodejs >= 24` is a no-op on Fedora: the virtual `nodejs`
Provide carries Epoch 1, so a bare `>= 24` desugars to `0:24` and is satisfied by
`1:22.23.1`. Measured with `dnf repoquery` on Fedora 44 — `--whatprovides 'nodejs
>= 24'` answers **nodejs22**, while `--whatprovides 'nodejs(engine) >= 24'`
answers nodejs24. `gjsify ship` emits the correct spelling for you; the reason is
written down here because a hand-written spec file will get it wrong.

The `>= 24` default excludes **every current DEB stable and LTS**:

| suite | Node |
| --- | --- |
| Debian 13 trixie (stable) | 20 |
| Debian 14 forky (testing) | 24 |
| Ubuntu 24.04 LTS | 18 |
| Ubuntu 26.04 LTS | 22 |
| Fedora 43 / 44 / 45 | 22 by default, 24 installable from the base repo |

`gjsify ship` prints that rather than lowering the number quietly. If your bundle
genuinely runs on an older Node, say so — and test it there first:

```jsonc
"gjsify": { "ship": { "minNodeVersion": "20" } }
```

⚠️ **A satisfied `Requires:` is not the same as Node 24 on `PATH`.** Fedora's
streams are parallel-installable and `/usr/bin/node` is an alternatives symlink
owned by whichever `nodejs<stream>-bin` package is installed — so
`nodejs22-bin` plus `nodejs(engine) >= 24` is a perfectly valid state in which
`node` is still 22. Measured with `dnf install --assumeno` on Fedora 44. No
dependency any packager can emit closes that; an app that truly requires 24 has to
check `process.versions.node` at startup and say so.

macOS and Windows have no system Node to depend on, so an artifact for those
carries its own interpreter from `@gjsify/node-runtime-<target>`. You add nothing
to `package.json`: those packages are resolved **by name** at ship time.

## Configure it in package.json

Every key has a derived default, and metadata you do not set here falls back to
`gjsify.flatpak`. Both blocks describe the same application, so a project that
already ships a Flatpak often needs no `gjsify.ship` block at all.

```jsonc
"gjsify": {
  "main": "dist/gjs.js",
  "ship": {
    "appId": "org.example.MyApp",          // else gjsify.flatpak.appId, else package.json#name
    "binaryName": "my-app",                // else the package name, npm scope stripped
    "name": "My App",                      // the human-readable name in menus and stores
    "summary": "A small demo application", // one line, 80 chars or fewer, no full stop
    "kind": "app",                         // "cli" for a headless tool: no .desktop, no icon
    "icon": "data/icons",                  // a file or a directory of sized files
    "schemas": "data",                     // where the *.gschema.xml files live
    "categories": ["Utility"],             // also decides deb Section: and rpm Group:
    "release": "1",                        // package revision within one app version
    "minGjsVersion": "1.86",
    "depends": { "rpm": ["dconf"] },       // appended to the derived set
    "extraFiles": {                        // prefix-relative destination: project-relative source
      "share/my-app/data.json": "assets/data.json"
    },
    "execArgs": ["--gapplication-service"] // arguments the launcher passes before the user's
  }
}
```

`kind: "cli"` is the one switch that changes the shape of the payload: a console
AppStream component, no `.desktop` entry, and no icon requirement.

## Fix a failed run

Most refusals are one missing field away from working, and each one prints what
to set. The ones you are most likely to meet:

| Message says | Fix |
|---|---|
| no version / licence / maintainer | add `version`, `license`, `author` to package.json |
| not a usable package version | set `gjsify.ship.version` to something starting with a digit, using only letters, digits, `.`, `+` and `~` |
| no application id | set `gjsify.ship.appId` to a reverse-DNS id |
| no bundle to ship | nothing declares one: point `gjsify.main` (or `main`) at the built bundle |
| the bundle … does not exist | it is declared but not built: run the build, or drop `--skip-build` |
| no `build` script to run | add one, or pass `--skip-build` |
| a schema must be named after the app id | rename it to `<app-id>.gschema.xml` |
| cannot tell what size an icon is | use an SVG, a `128x128/` directory, or `icon-128.png` |
| a file in the bundle directory is a symlink | replace it with the real file; the payload has to stand alone |
| no package is known to ship a typelib | see [Add a typelib ship does not know](#add-a-typelib-ship-does-not-know) |
| a `<fmt>` artifact is packed on … and this host is … | that format is host-bound: `--stage` here, `--from-stage` on the host it names |
| packing a `<fmt>` needs … not on PATH | install the named tool, or drop that target — `deb` and `rpm` need none |

## Where to next

- [Ship your app](/gjsify/ship/) compares this with Flatpak, the one-line
  installer, self-executing bundles and dlx.
- [CLI Reference → `gjsify ship`](/gjsify/cli-reference/#gjsify-ship) is the
  condensed flag and config reference.
- [Flatpak: GUI app](/gjsify/guides/flatpak-app/) if you also want a Flathub
  listing. It reads the same metadata fields, so nothing is duplicated.
