---
title: Windows artifacts
description: "gjsify ship windows builds a program directory that carries its own Node and GTK, a zip around it, and an .msi installer. What lands on disk, what your package.json declares, and what the packing host needs installed."
---

`gjsify ship windows` turns a built app into a Windows program directory and a
zip around it. Both assemble on any operating system, so a Linux or macOS
workstation can produce them. The `.msi` needs one extra tool, on Linux or on
Windows.

```bash
gjsify ship windows
```

```text
ship/out/My App/
ship/out/my-app-1.2.3-1.x64.zip
```

The program directory is what an installer lays down and a user browses to. The
zip is what a user downloads, so it carries the version and the architecture in
its filename.

`x64` is the only architecture. `gvsbuild`, the project that builds GTK for
Windows, publishes no arm64 binaries, so there is no GTK for a Windows on ARM
artifact to load. `--arch arm64` is refused by name rather than producing a
directory that cannot start.

## Your project has to be a Node project

Set `gjsify.app` to `"node"`. There is no GJS host on Windows at all, so nothing
on that operating system can run a `--app gjs` payload. Ship says so before it
packs anything.

## What your package.json declares

The program directory carries its own interpreter and its own GTK closure. Both
are resolved by name out of your `node_modules` when you run `gjsify ship`, so
they have to be installed on the machine that packages the app, not on the
machine that runs it.

```jsonc
{
  "devDependencies": {
    // The Node interpreter, plus Node's own LICENSE.
    "@gjsify/node-runtime-win32-x64": "^0.44.0",
    // The relocated GTK and GObject-Introspection closure.
    "@gjsify/gtk-runtime-win32-x64": "^0.44.0"
  },
  "dependencies": {
    // node-gi's JavaScript and its prebuilt addon. A dependency rather than a
    // devDependency, because a --app node bundle keeps `@gjsify/node-gi/*`
    // external and requires it at run time.
    "@gjsify/node-gi": "^0.44.0"
  }
}
```

:::caution[`@gjsify/node-runtime-win32-x64` is not yet published to npm]
Measured against the registry on 2026-08-30, with `@gjsify/cli@0.44.0` as the
control: `@gjsify/gtk-runtime-win32-x64` and `@gjsify/node-gi` resolve at
`0.44.0`, and `@gjsify/node-runtime-win32-x64` answers 404. The first publish of
a new name is a manual maintainer step, because npm Trusted Publishing needs the
package to exist before CI can publish to it. It is queued.

Until it lands, `npm install` fails on that line. Drop it and the rest of the
block still gets you a program directory carrying its GTK closure and node-gi.
What it will not carry is the interpreter, and `gjsify ship` says so on every run
rather than letting you find out from a user. `GJSIFY_NODE_RUNTIME` points the
lookup at a directory holding `node.exe` and its `LICENSE`, which is how to get a
complete directory today.
:::

`GJSIFY_GTK_RUNTIME` overrides the GTK lookup with a directory holding `bin/`
and `girepository-1.0/`. When either package is missing, ship names it and still
produces a directory. That directory works on a machine that already has Node
and GTK, which is a useful intermediate and not something to hand to a user.

## What lands inside the program directory

```text
My App/
├── my-app.cmd     the launcher
├── node.exe       the carried interpreter
├── app/           your built bundle
├── lib/node-gi/   the GTK closure and the node-gi addon
└── share/         icon, metainfo, schemas, licences
```

There is no metadata file in the directory. What a Windows installer says about
an application lives in the `.msi`'s own tables, so the directory holds only the
program.

`my-app.cmd` finds its own directory from `%~dp0`, so the tree works unzipped
anywhere and works again once an installer lays it into `C:\Program Files`. It
runs `node.exe` from beside itself rather than a bare `node`, and it points
`GJSIFY_GTK_RUNTIME` at the carried closure so node-gi loads that one. The file
uses CRLF line endings, which is what `cmd.exe` reads.

The zip carries a top level the staged tree does not. Without it, unzipping
would scatter `app\`, `share\` and a loose `.cmd` into whatever folder the user
was in.

The directory is named after `gjsify.ship.name`. Windows reserves `< > : " / \
| ? *`, the control characters, and the device names `CON`, `PRN`, `AUX`, `NUL`,
`COM1` to `COM9` and `LPT1` to `LPT9` at every path, and it silently strips a
trailing dot or space. Ship refuses a display name containing any of those
rather than producing an archive that extracts under a different name than the
launcher resolves against.

Your GSettings schemas are compiled while the tree is assembled, which is why the
windows formats need `glib-compile-schemas` on the packaging host. There is no
install step to compile them later, and GSettings aborts on a schema directory
that holds only sources.

The `.desktop` entry and the AppStream component are carried and never read,
because Windows reads neither. Ship lists every file in that state on each run.

## Build the installer

`--target msi` wraps the same program directory in a Windows Installer package.

```bash
gjsify ship windows --target windows-dir,windows-dir-zip,msi
```

That produces `ship/out/my-app-1.2.3-1.x64.msi` beside the other two artifacts.
The installed tree is the tree the zip expands to. Nothing about the payload
changes.

What the installer adds is the three things a directory cannot do on its own:

- It lays the program directory under `%ProgramFiles%\My App`, which
  `msiexec INSTALLDIR=…` overrides.
- It writes one Start-Menu shortcut, aimed at the same `.cmd` launcher.
- It appears in Add/Remove Programs, taking its name, version and publisher from
  the MSI, and `msiexec /x` removes every file it installed.

The upgrade code is derived from your app id, so installing a newer version
replaces the older one instead of leaving both on the machine. Keep the app id
stable across releases.

### The .msi needs a tool

`msi` is not in the default set, because it is the one Windows format that needs
a program this CLI does not carry. Ship writes the installer's source document
itself and hands it to whichever compiler the host has:

| Host | Install |
|---|---|
| Fedora | `sudo dnf install msitools` |
| Debian, Ubuntu | `sudo apt install msitools` |
| Windows | [WiX Toolset v3.14](https://github.com/wixtoolset/wix3/releases), with its `bin` directory on `PATH` |

So you can build a Windows installer from a Linux workstation, or from Windows
without installing anything from the Linux side. macOS cannot pack this format.

A missing compiler is a message naming the package, before your build script
runs:

```text
gjsify ship: packing a msi on linux needs glib-compile-schemas and wixl, and
wixl is not on PATH.
```

### The .msi refuses a prerelease version

Windows Installer's `ProductVersion` is `major.minor.build` and nothing else. No
prerelease suffix, no build metadata. `major` and `minor` are at most 255 and
`build` at most 65535, and a field over the limit is truncated by the installer
rather than rejected.

Ship refuses `1.2.0-rc.1` instead of dropping the suffix, because `1.2.0~rc.1`
and `1.2.0` would then carry the same `ProductVersion`, the upgrade rule could
not tell them apart, and installing one over the other would leave both on the
machine. Set `gjsify.ship.version` to a plain `x.y.z`, or drop `msi` from the
targets for prerelease builds.

## One thing to know before you hand it to a user

`node.exe` is a console-subsystem program and the Node release ships no windowed
variant, so starting the app leaves a console window open behind it. That
applies to the `.cmd` launcher and to the shortcut the `.msi` writes. Nothing
here hides it.

## Signing is optional here in a way it is not on macOS

SmartScreen only warns about an unsigned download, until per-file reputation
accrues. Gatekeeper blocks an unsigned macOS bundle outright. So an unsigned
Windows program directory is a usable artifact in a way a `.app` is not.

`--sign <identity>` passes a name to `signtool` on a Windows host. See
[Sign your artifacts](/gjsify/ship/signing/), which also records that no run in
the gjsify repository has ever invoked `signtool`.

## A worked example

A project on any operating system, producing all three Windows artifacts. The
`.msi` step needs `msitools` on Linux, so it can run in the same place.

```bash
# 1. Declare the runtime, on the packaging host.
npm install --save-dev @gjsify/gtk-runtime-win32-x64
npm install --save @gjsify/node-gi

# 2. Install the MSI compiler.
sudo dnf install msitools glib2      # Fedora

# 3. Build everything.
gjsify ship windows \
  --target windows-dir,windows-dir-zip,msi --verbose
```

Step 1 omits `@gjsify/node-runtime-win32-x64`, because that name still answers
404. Point `GJSIFY_NODE_RUNTIME` at a directory holding `node.exe` and its
`LICENSE` to get a directory that runs on a Windows machine with no Node
installed.

To split the work instead, assemble here and pack on Windows:

```bash
gjsify ship windows --stage --target windows-dir,windows-dir-zip,msi
gjsify ship --from-stage ./stage --expect-target win32-x64 --target msi
```

`--expect-target` uses the `win32` spelling, because that is what a running
process computes about itself. The positional accepts both `windows` and
`win32`.

## Fix a failed run

| Message says | Fix |
|---|---|
| the windows layout cannot run a `gjs` app | set `gjsify.app` to `"node"` and rebuild the bundle for Node |
| `the windows layout is not assemblable for --arch arm64` | use `--arch x64`; there is no Windows on ARM GTK to load |
| `packing a msi on … needs … wixl` | install `msitools`, or WiX Toolset v3.14 on Windows |
| `is not a version an .msi can carry` | set `gjsify.ship.version` to a plain `x.y.z` |
| `the windows layout would put this app in a directory called …` | set `gjsify.ship.name` to a name Windows can hold |
| `no bundled interpreter`, naming `@gjsify/node-runtime-win32-x64` | install it, or set `GJSIFY_NODE_RUNTIME` |

## Where to next

- [Ship your app](/gjsify/ship/) has the shared `package.json` fields and the
  table of which host packs which format.
- [Sign your artifacts](/gjsify/ship/signing/) covers `--sign` and `--notarize`.
- [macOS app bundles](/gjsify/ship/macos/) is the same shape one operating
  system over.
- [CLI Reference → `gjsify ship`](/gjsify/cli-reference/#gjsify-ship) lists
  every flag and configuration key.
