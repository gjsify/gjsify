---
title: macOS app bundles
description: "gjsify ship darwin builds a macOS .app that carries its own Node and GTK, a zip around it, and a .dmg. What lands on disk, what your package.json declares, and which host can produce which format."
---

`gjsify ship darwin` turns a built app into a macOS application bundle and a zip
around it. Both assemble on any operating system, so a Linux or Windows
workstation can produce them. Only the `.dmg` needs a Mac.

```bash
gjsify ship darwin --arch arm64
```

```text
ship/out/My App.app
ship/out/my-app-1.2.3-1.macos.arm64.zip
```

The `.app` is what a user drags into `/Applications`. The zip is what a user
downloads, so its filename carries the version and the architecture and avoids
the spaces a display name may contain.

`--arch` takes `x64` or `arm64` and defaults to the architecture of the host you
run it on. It labels the artifact and picks which runtime packages are staged.
It does not cross-compile your payload, so pass the architecture your bundle was
built for.

## The runtime it carries

A target whose runtime resolves to `gjs` can stage the darwin layout and cannot
pack it:

```text
gjsify ship: macos-app and macos-app-zip wrap the darwin layout, and neither can
run this project …
```

Homebrew's GJS exists on a developer's Mac, not in a `.app` a stranger
downloads, and there is no relocatable GJS to put inside a bundle. Set
`gjsify.ship.app.darwin` to `"node"`, as
[Ship your app](/gjsify/ship/#what-macos-and-windows-carry) shows, and install
the pair for each architecture you ship, plus `@gjsify/node-gi`:

- `@gjsify/node-runtime-darwin-arm64` and `@gjsify/gtk-runtime-darwin-arm64`
- `@gjsify/node-runtime-darwin-x64` and `@gjsify/gtk-runtime-darwin-x64`

`--arch arm64` looks for the `darwin-arm64` pair and nothing else. Install only
what you ship: the arm64 interpreter unpacks to 122 MB and the x64 one to
124 MB, because each is a whole Node build.

`gjsify ship` names what it staged and what it did not, one line each:

```text
[gjsify ship] carries its own interpreter from @gjsify/node-runtime-darwin-arm64
[gjsify ship] carries its own GTK closure from @gjsify/gtk-runtime-darwin-arm64
[gjsify ship] carries its own node-gi runtime (16 file(s)) from @gjsify/node-gi
[gjsify ship] carries its own node-gi addon from @gjsify/node-gi
```

`GJSIFY_GTK_RUNTIME`, when set, names a directory holding `lib/` and
`girepository-1.0/`.

## What lands inside the bundle

```text
My App.app/
├── Contents/Info.plist           what makes this an application
├── Contents/PkgInfo
├── Contents/MacOS/my-app         the launcher
├── Contents/MacOS/node           the carried interpreter
├── Contents/Frameworks/node-gi/  the GTK closure and the node-gi addon
└── Contents/Resources/
    ├── lib/                      your built bundle
    └── share/                    icon, metainfo, schemas, licences
```

`Contents/Info.plist` and `Contents/PkgInfo` are what make a directory ending in
`.app` an application rather than a folder. Ship writes both from your
`gjsify.ship` block. The app id becomes `CFBundleIdentifier`, the display name
becomes the `.app` directory name and `CFBundleName`, `gjsify.ship.binaryName`
becomes `CFBundleExecutable`, and your version becomes
`CFBundleShortVersionString` with `version-release` in `CFBundleVersion`.

The launcher walks up from `Contents/MacOS` to find the bundle, so the `.app`
works wherever it sits. `/Applications` is a convention, not a path it needs.

**Your icon does not become the bundle icon.** The `Info.plist` carries no
`CFBundleIconFile`, so the Finder and the Dock show the generic application
icon. Your icon is still staged under `Contents/Resources/share/icons/`, where
GTK finds it for in-app use.

## Shipped fonts need nothing from your app here

`gjsify.ship.fonts` stages your faces into the bundle and adds an
`ATSApplicationFontsPath` entry to `Contents/Info.plist`, so macOS activates them
before any of your code runs. That is why the declarative route beats a call here:
the CoreText font map has no re-scan path, and the OS gets there first.

Two honest limits. The key is emitted from Apple's own documentation of it, and
**no CI leg here starts an `.app`**, so whether macOS then resolves the family is
not something this project has measured, unlike the Linux and Windows halves. And
a `.app` is the only macOS layout that carries fonts; there is no `.pkg` path.

The `initFonts()` call the [Windows](/gjsify/ship/windows/) row needs is still safe
to leave in a shared codebase. Pango's CoreText font map implements no runtime
registration, so the call answers `G_IO_ERROR_NOT_SUPPORTED` and the faces come
back under `declined` rather than `failed`. Nothing is lost: the `Info.plist` key
already activated the same directory before your code ran. You need no
`process.platform` branch. [Ship your own fonts](/gjsify/guides/bundled-fonts/) has
the detail, including what to check inside a running bundle.

## Make a .dmg

A `.dmg` is a UDIF image over a real HFS+ volume, and the only program that
writes one is `hdiutil`, which ships with macOS and exists nowhere else. Ask for
it anywhere else and you get a refusal naming the way across:

```text
gjsify ship: a macos-app-dmg artifact is packed on darwin and this host is linux …
```

So assemble on whichever machine you develop on and finish on a Mac. Name the
format in both runs, because phase one renders one licence overlay per format:

```bash
# anywhere, offline
gjsify ship darwin --stage --arch arm64 \
  --target macos-app,macos-app-zip,macos-app-dmg

# on a Mac, with ship/stage/ copied across
gjsify ship --from-stage ./stage --target macos-app-dmg
```

The result is `my-app-1.2.3-1.arm64.dmg`, a volume named after your display
name, holding the same `.app` the other two formats wrap.

The image has no `/Applications` symlink, so a user drags the app out of the
mounted volume to wherever they want it instead of onto an arrow.

## Sign it, or say you did not

Gatekeeper blocks an unsigned `.app` on a stranger's Mac. `--sign` runs on the
finish phase, on the host that holds the key:

```bash
gjsify ship --from-stage ./stage \
            --sign "Developer ID Application: You (TEAMID)"
```

With no identity the run skips signing, prints why, and exits 0. See
[Sign your artifacts](/gjsify/ship/signing/) for what `--sign` takes, what
`--notarize` does, and why unsigned is a legitimate result.

## A worked example

A project on any operating system, producing a signed arm64 bundle, a zip and a
`.dmg`. Steps 1 and 2 run on a Linux or Windows workstation. Step 3 runs on a
Mac that holds the Developer ID.

```bash
# 1. Declare the runtime, on the packaging host.
npm install --save-dev @gjsify/node-runtime-darwin-arm64 \
                       @gjsify/gtk-runtime-darwin-arm64
npm install --save @gjsify/node-gi

# 2. Assemble every darwin format you intend to pack.
gjsify ship darwin --stage --arch arm64 \
  --target macos-app,macos-app-zip,macos-app-dmg --verbose

# 3. On a Mac, with ship/stage/ copied across.
gjsify ship --from-stage ./stage \
            --expect-target darwin-arm64 \
            --sign "Developer ID Application: You (TEAMID)"
```

Add `--notarize <keychain-profile>` to step 3 once you have stored an Apple
credential with `notarytool store-credentials`. Read
[Sign your artifacts](/gjsify/ship/signing/#notarisation) first, because that
flag has never been run against a real Apple account.

Read step 2's output. The four `carries its own …` lines are what tell you the
bundle will start on a Mac with neither Node nor Homebrew GTK installed.

## Fix a failed run

| Message says | Fix |
|---|---|
| `macos-app and macos-app-zip … neither can run this project` | set `gjsify.ship.app.darwin` to `"node"` (or `gjsify.app`, for every target) and rebuild the bundle for Node |
| `a macos-app-dmg artifact is packed on darwin and this host is …` | `--stage` here, `--from-stage` on a Mac |
| `packing a macos-app on … needs glib-compile-schemas` | Fedora `sudo dnf install glib2`, Debian or Ubuntu `sudo apt install libglib2.0-bin` |
| `this stage was assembled for …, and --target names …` | re-run the `--stage` command with every format named |
| `no bundled interpreter`, naming `@gjsify/node-runtime-darwin-<arch>` | install it, or set `GJSIFY_NODE_RUNTIME` |
| `signing the darwin layout needs codesign` | sign on the finish phase, on a Mac |

## Where to next

- [Ship your app](/gjsify/ship/) has the shared `package.json` fields and the
  table of which host packs which format.
- [Windows artifacts](/gjsify/ship/windows/) is the same shape one operating
  system over.
- [CLI Reference → `gjsify ship`](/gjsify/cli-reference/#gjsify-ship) lists
  every flag and configuration key.
