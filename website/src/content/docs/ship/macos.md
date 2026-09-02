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
ship/out/my-app-1.2.3-1.arm64.zip
```

The `.app` is the artifact a user drags into `/Applications`. The zip is the
artifact a user downloads, so it carries the version and the architecture in its
filename and avoids the spaces a display name may contain.

`--arch` takes `x64` or `arm64` and defaults to the architecture of the host you
run it on. It labels the artifact and picks which runtime packages are staged.
It does not cross-compile your payload, so pass the architecture your bundle was
built for.

## The darwin target has to be a Node target

A target whose runtime resolves to `gjs` can stage the darwin layout and cannot
pack it:

```text
gjsify ship: macos-app and macos-app-zip wrap the darwin layout, and neither can
run this project …
```

macOS does ship GJS through Homebrew, and that is a fact about a developer's
machine rather than about a `.app` a stranger downloads. There is no relocatable
GJS to put inside a bundle, so a downloadable macOS artifact runs on Node.

Say so for **this target alone**, which leaves a Linux package of the same
project on GJS:

```jsonc
{
  "gjsify": {
    "app": "gjs",                        // the project default — Linux keeps it
    "ship": { "app": { "darwin": "node" } }  // and macOS does not
  }
}
```

Setting `gjsify.app` to `"node"` works too and means something bigger: it moves
every target, including the Linux `.deb`, from `Depends: gjs` to
`Depends: nodejs`. Use the per-target key unless the whole application is a Node
application.

## What your package.json declares

The bundle carries its own interpreter and its own GTK closure. Both are
resolved by name out of your `node_modules` when you run `gjsify ship`, so they
have to be installed on the machine that packages the app, not on the machine
that runs it.

```jsonc
{
  "devDependencies": {
    // The Node interpreter, plus Node's own LICENSE.
    "@gjsify/node-runtime-darwin-arm64": "^0.44.0",
    "@gjsify/node-runtime-darwin-x64": "^0.44.0",
    // The relocated GTK and GObject-Introspection closure, one per architecture.
    "@gjsify/gtk-runtime-darwin-arm64": "^0.44.0",
    "@gjsify/gtk-runtime-darwin-x64": "^0.44.0"
  },
  "dependencies": {
    // node-gi's JavaScript and its prebuilt addon. A dependency rather than a
    // devDependency, because a --app node bundle keeps `@gjsify/node-gi/*`
    // external and requires it at run time.
    "@gjsify/node-gi": "^0.44.0"
  }
}
```

Ship one architecture and you need only its two packages. `--arch arm64` looks
for the `darwin-arm64` pair and nothing else.

An interpreter package is large. `@gjsify/node-runtime-darwin-arm64` unpacks to
122 MB and its x64 sibling to 124 MB, because each one is a whole Node build.
Install only the architecture you ship.

`gjsify ship` names what it staged and what it did not, one line each:

```text
[gjsify ship] carries its own interpreter from @gjsify/node-runtime-darwin-arm64
[gjsify ship] carries its own GTK closure from @gjsify/gtk-runtime-darwin-arm64
[gjsify ship] carries its own node-gi runtime (16 file(s)) from @gjsify/node-gi
[gjsify ship] carries its own node-gi addon from @gjsify/node-gi
```

When a package is missing you get the name to install instead, and the run still
produces a bundle. That bundle works on any machine that already has Node, which
is a useful intermediate and not something to hand to a user.

Two environment variables override the lookups, for a maintainer holding an
unpublished or patched build. `GJSIFY_NODE_RUNTIME` names a directory holding
`node` and its `LICENSE`. `GJSIFY_GTK_RUNTIME` names one holding `lib/` and
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

Your GSettings schemas are compiled into the bundle while it is assembled, which
is why the darwin formats need `glib-compile-schemas` on the packaging host. A
`.app` has no install step to compile them later, and GSettings aborts on a
schema directory that holds only sources.

Some of what a Linux package relies on its install step for has no macOS
equivalent. The `.desktop` entry, the AppStream component and the shared MIME
type document are carried and never read, because macOS reads none of them.
`gjsify ship` lists every such file on each run, so the payload holds no
surprise.

**Your icon does not become the bundle icon.** The `Info.plist` carries no
`CFBundleIconFile`, so the Finder and the Dock show the generic application
icon. Your icon is still staged under `Contents/Resources/share/icons/`, where
GTK finds it for in-app use.

## Shipped fonts need nothing from your app here

`gjsify.ship.fonts` stages your faces into the bundle and adds an
`ATSApplicationFontsPath` entry to `Contents/Info.plist`, so macOS activates them
before any of your code runs. That is the reason for choosing the declarative route
over a call: the CoreText font map has no re-scan path, and the OS gets there first.

Two honest limits. The key is emitted from Apple's own documentation of it, and **no
CI leg here starts an `.app`** — so that macOS then resolves the family is not
something this project has measured, unlike the Linux and Windows halves. And a
`.app` is the only macOS layout that carries fonts; there is no `.pkg` path.

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
- [Sign your artifacts](/gjsify/ship/signing/) covers `--sign` and `--notarize`.
- [Windows artifacts](/gjsify/ship/windows/) is the same shape one operating
  system over.
- [CLI Reference → `gjsify ship`](/gjsify/cli-reference/#gjsify-ship) lists
  every flag and configuration key.
