---
title: Linux packages
description: "gjsify ship linux builds a .deb, an .rpm and a Flatpak bundle. What lands on disk, which dependencies are derived from your bundle, how to pick the architecture, and what to do when the build refuses."
---

`gjsify ship linux` turns a built app into a `.deb` and an `.rpm`. Run it in
your project root:

```bash
gjsify ship
```

```text
ship/out/my-app_1.2.3-1_all.deb
ship/out/my-app-1.2.3-1.noarch.rpm
```

A bare `gjsify ship` assembles the layout of the host you are on, so on a Linux
machine those two are what you get. Name `linux` explicitly when you are
packaging from a Mac or from Windows, which works: both packers are plain
JavaScript and run anywhere.

Nothing about gjsify needs to be on the user's machine. The package depends on
the distribution's own `gjs` or `nodejs`, GTK and typelib packages, and
`gjsify ship` works out which ones by reading your built bundle.

Set up your `package.json` first. [Ship your app](/gjsify/ship/#what-ship-reads-from-your-packagejson)
lists the fields all three operating systems share, and the two you have to set
yourself.

## Build the packages

```bash
gjsify ship --verbose
```

`--verbose` prints every staged file and the GI namespaces it found in your
bundle, which is the quickest way to see whether the payload is what you think
it is:

```text
[gjsify ship] staged 7 file(s) for linux in ship/stage/
[gjsify ship]   bin/my-app
[gjsify ship]   lib/my-app/gjs.js
[gjsify ship]   share/applications/org.example.MyApp.desktop
[gjsify ship]   share/glib-2.0/schemas/org.example.MyApp.gschema.xml
[gjsify ship]   share/icons/hicolor/scalable/apps/org.example.MyApp.svg
[gjsify ship]   share/metainfo/org.example.MyApp.metainfo.xml
[gjsify ship]   share/mime/packages/org.example.MyApp.xml
[gjsify ship] gi namespaces: Adw-1, Gtk-4.0
[gjsify ship] deb: ship/out/my-app_1.2.3-1_all.deb (2876 bytes)
[gjsify ship] rpm: ship/out/my-app-1.2.3-1.noarch.rpm (5976 bytes)
```

A real run prints more than this, and none of it is an error. Anything missing
from the AppStream component (`gjsify.ship.developer`, `summary`,
`description`, `license.project`, `homepageUrl`) is a warning, because the
package still installs and still runs. App stores are what will object. Fill
those in before you submit anywhere. You will also see a warning about the GJS
version this asks for on Debian; see [Choose the GJS floor](#choose-the-gjs-floor).

Already built? Skip the build step.

```bash
gjsify ship --skip-build
```

Want one format only, or the payload without any packing at all?

```bash
gjsify ship --target deb     # one format
gjsify ship --stage          # write ship/stage/ and stop
```

## Read the staged payload

Everything lands under `ship/`, which `--out` moves.

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

`stage/` is the whole app. The launcher in `bin/`, your bundle in
`lib/<name>/`, and the desktop entry, icon, AppStream metainfo, MIME types and
schemas in `share/`. `overlay/` holds what one format wants somewhere of its
own, which today is the licence and nothing else. Debian policy puts it in
`share/doc/<pkg>/copyright`, rewrapped as a machine-readable copyright file;
RPM puts the plain text in `share/licenses/<pkg>/`. A project with no licence
file gets no overlay at all.

Both packers read `stage/` back off disk rather than keeping it in memory, so
what you inspect is what a user installs.

Two details worth knowing.

**The whole bundle directory is staged.** `gjsify.main: "dist/gjs.js"` stages
all of `dist/` into `lib/my-app/`. Keep build leftovers out of that directory,
or point `gjsify.ship.bundle` at a clean one.

**`bin/my-app` is a small shell launcher.** It works out its own install prefix
from its own path, prepends `<prefix>/share` to `XDG_DATA_DIRS`, and then execs
`gjs -m` or `node` on your bundle. Because no path is baked in, the same
payload works installed under `/usr`, under `/app`, or anywhere else.

## Install and check the result

```bash
sudo dnf install ./ship/out/my-app-1.2.3-1.noarch.rpm     # Fedora, RHEL, openSUSE
sudo apt install ./ship/out/my-app_1.2.3-1_all.deb        # Debian, Ubuntu
```

Then run `my-app`, or find it in your application menu. Uninstalling is
`dnf remove my-app` or `apt remove my-app`, and the package refreshes the
desktop database, the icon cache, the MIME database and the compiled GSettings
schemas on the way in and out.

Before publishing, read the artifact back with the distribution's own tools
rather than trusting the packer:

```bash
rpm -qp --info     ship/out/my-app-1.2.3-1.noarch.rpm   # name, version, licence, summary
rpm -qpl           ship/out/my-app-1.2.3-1.noarch.rpm   # every installed path
rpm -qp --requires ship/out/my-app-1.2.3-1.noarch.rpm   # the derived dependencies
rpm -K             ship/out/my-app-1.2.3-1.noarch.rpm   # digests
ar t               ship/out/my-app_1.2.3-1_all.deb      # the three .deb members
```

For the app in the output above, `rpm -qp --requires` lists these first, ahead
of the `/bin/sh` its scriptlets need and rpm's own internals:

```text
gjs >= 1.86
libadwaita
gtk4
hicolor-icon-theme
glib2
```

You configured none of it. The GTK and libadwaita entries come from the `gi://`
imports in the built bundle, `hicolor-icon-theme` because this is a GUI app
rather than a `kind: "cli"` tool, and `glib2` (`libglib2.0-bin` on Debian)
because the payload installs a GSettings schema that has to be compiled at
install time.

Packing the same build twice gives byte-identical artifacts, which
[How It Works](/gjsify/how-it-works/#reproducible-ship-artifacts) explains.

## Translate the menu entry and the store listing

Point `gjsify.ship.localeDir` at a directory of compiled gettext catalogues in
`<lang>/LC_MESSAGES/<domain>.mo` layout, and `gjsify ship` folds them into the
generated freedesktop metadata:

```jsonc
"gjsify": { "ship": { "localeDir": "dist/locale" } }
```

```text
[Desktop Entry]
Name[de]=Versand-Demo
Name=My App
Comment[de]=Beweist, dass gjsify ship funktioniert
Comment=Prove that gjsify ship works
```

The AppStream component gets the matching `xml:lang` attributes. Both files stay
valid without the translations, and `desktop-file-validate` and
`appstreamcli validate` pass an untranslated file, so nothing else would have
told you they were missing.

`.po` sources are refused, because `bindtextdomain` reads `.mo` only. Compile
them first with [`gjsify gettext`](/gjsify/cli-reference/#gjsify-gettext). The
catalogues are staged into `share/locale/` and the launcher exports
`GJSIFY_LOCALE_DIR`.

## The Flatpak bundle

The same payload also becomes a single-file Flatpak.

```bash
gjsify ship --target flatpak
flatpak install ./ship/out/org.example.MyApp-1.2.3-1.x86_64.flatpak
```

It is not in the default set, because it is the one Linux format that needs
tooling on your machine. Install `flatpak-builder` and `flatpak` first, on
Fedora with `sudo dnf install flatpak flatpak-builder` and on Debian or Ubuntu
with `sudo apt install flatpak flatpak-builder`. A missing tool is a message
naming the package, before your build script runs.

The payload does not change. Ship stages one prefix-relative tree and the
launcher works out its own prefix at run time, so the same tree is `/usr` in a
`.deb` and `/app` in a Flatpak. That is why the generated Flatpak module is
three shell commands with no build system in it:

```json
{
  "name": "my-app",
  "buildsystem": "simple",
  "build-commands": ["mkdir -p /app", "cp -a stage/. /app/", "cp -a overlay/. /app/"]
}
```

The runtime and the sandbox permissions are the only things left to configure,
and every one has a default:

```jsonc
"gjsify": {
  "ship": {
    "appId": "org.example.MyApp",
    "flatpak": {
      "runtime": "gnome",
      "runtimeVersion": "50",
      "branch": "stable",
      "finishArgs": ["--device=dri", "--share=ipc", "--socket=fallback-x11", "--socket=wayland"]
    }
  }
}
```

`finishArgs` defaults to that GUI set for an app and to nothing at all for a
`kind: "cli"` tool. The app id names the exported ref, which is why the artifact
is `org.example.MyApp-1.2.3-1.x86_64.flatpak`.

An existing `gjsify.flatpak` block keeps working. `runtime`, `runtimeVersion`,
`sdkExtensions`, `appendPath`, `finishArgs` and `cleanup` are read from there
too, and ship prints one line naming the keys it inherited and where to move
them. Moving them is safe, because `gjsify flatpak init` and `flatpak ci` read
the new spelling as well. The app metadata (`name`, `summary`, `developer`,
`categories`, `license`) is not deprecated. Both blocks describe the same
application, and either may carry it.

For a Flathub submission you want [`gjsify flatpak init`](/gjsify/guides/flatpak-app/)
instead, which commits the manifest and the AppStream files to your repository.

## Pick the architecture

You usually do not have to. `gjsify ship` looks at the bytes in the payload. If
nothing in it is a native binary, the package is `Architecture: all` on deb and
`BuildArch: noarch` on rpm. A bundle of pure JavaScript really does install
everywhere, and claiming `amd64` would make apt refuse it on an arm64 machine
it runs on perfectly.

As soon as the payload carries a `.so`, a `.node` or any other native binary,
the package is labelled for one architecture. This host by default, or whatever
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

It labels the artifact and cross-builds nothing. Use it when you have already
produced a payload for that architecture, typically from a CI job running on
that machine.

## Look up a flag

| Flag | Default | What it does |
|---|---|---|
| `--target <fmt..>` | `gjsify.ship.targets`, else `deb,rpm` | Formats to build. Comma-separated or repeated. An unknown name fails before anything is built, and so does a format belonging to another operating system's layout. |
| `--out <dir>` | `gjsify.ship.outDir`, else `ship` | Output root, relative to the project. |
| `--stage` | `false` | Write the staged payload and stop, packing nothing. |
| `--from-stage <dir>` | none | Pack a payload an earlier `--stage` run wrote. Needs no project. |
| `--expect-target <os>-<arch>` | none | With `--from-stage`, refuse a stage assembled for a different matrix leg. |
| `--skip-build` | `false` | Package what is already built instead of running the project's `build` script. |
| `--arch <arch>` | this host | Target architecture in `process.arch` spelling. |
| `--verbose` | `false` | Print each staged file, the GI namespaces the bundle imports, and every tool a packer runs. |

`--sign` and `--notarize` belong to the macOS and Windows layouts. See
[Sign your artifacts](/gjsify/ship/signing/).

## Add a typelib ship does not know

Runtime dependencies are read from your built bundle's `gi://` imports and
mapped to the package that ships each typelib, which is why the deb and rpm
lists look nothing like each other for the same library. If your bundle reaches
a namespace the built-in table has never heard of, the build stops and names it:

```text
gjsify ship: the bundle imports gi://Nautilus, and no deb package is known to
ship that typelib.
```

That is deliberate. A missing runtime dependency does not fail at package time.
It fails on a user's machine, after the download, and reads like a bug in your
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

A mapping others will need too is worth a pull request against gjsify's own
table, which saves the next person the same detour.

`gjsify.ship.depends` is a different key for a different job. It appends
dependencies that are not typelibs at all (`dconf`, a helper binary, a font),
and it does not silence the failure above.

## Choose the GJS floor

The emitted dependency is `gjs (>= 1.86)`, which is the GJS the bundler
targets. **No released Debian satisfies it.** Debian went from 1.82.3 in trixie
straight to 1.88.1 in forky, skipping 1.84 and 1.86, so apt on trixie will
refuse your `.deb`. Fedora, forky, sid and current rolling distributions are
fine.

`gjsify ship` prints this rather than quietly lowering the number, because a
package apt refuses is a better outcome than one that installs and then dies on
a syntax error the older SpiderMonkey cannot parse.

If your bundle genuinely runs on an older GJS, say so:

```jsonc
"gjsify": { "ship": { "minGjsVersion": "1.82.3" } }
```

Test it on that version before you do. Lowering the floor to make apt happy
without checking is how you turn a clean refusal into a crash on first launch.

## Choose the Node floor, for `--app node` only

A `--app gjs` package declares no Node dependency at all, and this section does
not apply to it. A `--app node` bundle needs an interpreter, and on Linux it is
depended on rather than shipped:

```text
Depends: nodejs (>= 24)          # deb
Requires: nodejs(engine) >= 24   # rpm
```

`gjsify ship` picks the interpreter from `gjsify.app`, the same field your build
already uses, and the launcher it writes execs that one and no other. A package
therefore declares exactly one interpreter, and ship refuses to build one whose
launcher and dependency disagree.

The `>= 24` default excludes every current Debian stable and Ubuntu LTS:

| Suite | Node |
| --- | --- |
| Debian 13 trixie (stable) | 20 |
| Debian 14 forky (testing) | 24 |
| Ubuntu 24.04 LTS | 18 |
| Ubuntu 26.04 LTS | 22 |
| Fedora 43, 44, 45 | 22 by default, 24 installable from the base repo |

`gjsify ship` prints that rather than lowering the number quietly. If your
bundle genuinely runs on an older Node, say so, and test it there first:

```jsonc
"gjsify": { "ship": { "minNodeVersion": "20" } }
```

**A satisfied `Requires:` is not the same as Node 24 on `PATH`.** Fedora's
streams are parallel-installable and `/usr/bin/node` is an alternatives symlink
owned by whichever `nodejs<stream>-bin` package is installed, so `nodejs22-bin`
plus `nodejs(engine) >= 24` is a valid state in which `node` is still 22.
Measured with `dnf install --assumeno` on Fedora 44. No dependency any packager
can emit closes that. An app that truly requires 24 has to check
`process.versions.node` at startup and say so.

macOS and Windows have no system Node to depend on, so an artifact for those
carries its own. See [macOS app bundles](/gjsify/ship/macos/) and
[Windows artifacts](/gjsify/ship/windows/).

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
    "localeDir": "dist/locale",            // compiled .mo catalogues
    "mimeTypes": [                         // shared-mime-info types your app opens
      { "type": "application/x-my-app", "comment": "My App document", "globs": ["*.myapp"] }
    ],
    "depends": { "rpm": ["dconf"] },       // appended to the derived set
    "extraFiles": {                        // prefix-relative destination: project-relative source
      "share/my-app/data.json": "assets/data.json"
    },
    "execArgs": ["--gapplication-service"] // arguments the launcher passes before the user's
  }
}
```

`kind: "cli"` is the one switch that changes the shape of the payload. A console
AppStream component, no `.desktop` entry, and no icon requirement.

## Fix a failed run

Most refusals are one missing field away from working, and each one prints what
to set. The ones you are most likely to meet:

| Message says | Fix |
|---|---|
| no version, licence or maintainer | add `version`, `license`, `author` to package.json |
| not a usable package version | set `gjsify.ship.version` to something starting with a digit, using only letters, digits, `.`, `+` and `~` |
| no application id | set `gjsify.ship.appId` to a reverse-DNS id |
| no bundle to ship | point `gjsify.main` (or `main`) at the built bundle |
| the bundle does not exist | it is declared but not built, so run the build or drop `--skip-build` |
| no `build` script to run | add one, or pass `--skip-build` |
| a schema must be named after the app id | rename it to `<app-id>.gschema.xml` |
| cannot tell what size an icon is | use an SVG, a `128x128/` directory, or `icon-128.png` |
| a file in the bundle directory is a symlink | replace it with the real file; the payload has to stand alone |
| no package is known to ship a typelib | see [Add a typelib ship does not know](#add-a-typelib-ship-does-not-know) |
| a `<fmt>` artifact is packed on … and this host is … | that format is host-bound, so `--stage` here and `--from-stage` there |
| packing a `<fmt>` needs … not on PATH | install the named tool, or drop that target; `deb` and `rpm` need none |

## Where to next

- [Ship your app](/gjsify/ship/) compares this with the one-line installer,
  self-executing bundles and dlx.
- [macOS app bundles](/gjsify/ship/macos/) and [Windows artifacts](/gjsify/ship/windows/)
  cover the other two operating systems.
- [CLI Reference → `gjsify ship`](/gjsify/cli-reference/#gjsify-ship) is the
  condensed flag and configuration reference.
- [Flatpak: GUI app](/gjsify/guides/flatpak-app/) if you also want a Flathub
  listing. It reads the same metadata fields, so nothing is duplicated.
