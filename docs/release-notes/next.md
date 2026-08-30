<!--
THE PROSE PREAMBLE FOR THE NEXT RELEASE.

`scripts/check-changelog-references.mjs --release-notes <version>` publishes this
file ABOVE the generated changelog section in the GitHub release body. Write here
in the PR that lands the change, while you still remember why it mattered — the
generated section already says what changed.

  · Prose is OPTIONAL. No prose costs a warning in the cut's job summary and
    nothing else; the body is then the changelog section alone.
  · It counts only if git says this file changed since the last tag, so the
    previous release's text can never reappear under a new version. There is no
    version to write down and nothing to reset by hand: after a release this file
    is stale by definition, and the next prose is simply the next edit.
    So REPLACE what you find here, do not append to it — right after a release
    this file still holds the text that shipped with it, and the tag is where
    that copy lives (`git show v0.28.0:docs/release-notes/next.md`).
  · It goes through the same broken-reference detector as CHANGELOG.md, so a
    fabricated issue or repository link fails the cut. Write `#123` for a real
    issue in this repo; put anything `#`-shaped that is NOT a reference in
    backticks (`PKCS#7`), and the same for npm scopes and at-rules (`@girs`,
    `@font-face`) so they are not read as GitHub accounts.
  · No `## [x.y.z]` heading — the preamble sits above the section, not beside it.

Everything below the last comment is published verbatim. Delete this comment or
leave it; comments are stripped either way, and a file holding only comments
counts as no prose.

A worked example is the v0.28.0 release body:
https://github.com/gjsify/gjsify/releases/tag/v0.28.0
-->

## What this release is about

**`gjsify ship` now produces a real macOS application bundle AND a real Windows program directory,
both assembled on Linux, and both carrying their own interpreter and their own GTK.**

---

### A `*.app` directory was not an application

The layout axis that landed last release staged `<App>.app/Contents/{MacOS,Resources,Frameworks}`
and stopped there. What it did not stage was `Contents/Info.plist`, and that file is the whole
difference between an application and a folder whose name ends in `.app`: LaunchServices reads it to
learn which binary under `Contents/MacOS` to exec and what identity to register the bundle under.
Without it the Finder shows a folder.

`gjsify ship darwin` now writes it, plus `Contents/PkgInfo`, and packs two artifacts out of the same
staged payload — the `<App>.app` itself and a deterministic zip around it. Both are assembled by a
Linux host and both are unsigned; signing is a later milestone and an unsigned artifact is a
legitimate output as long as it says so.

Eleven plist keys, each read off a file a real macOS toolchain produced or consumes rather than
recalled: the app id becomes `CFBundleIdentifier`, the display name becomes the bundle directory and
`CFBundleName`, and `CFBundleVersion` carries the packaging release where `CFBundleShortVersionString`
does not — the one place macOS has a field for a distinction this command already made. Keys that are
merely plausible are not emitted, and neither is an icon: nothing that can read an `.icns` back
exists on Linux or in this project's CI image, and an icon only we could check is not a check.

### Your GSettings schemas no longer abort the app

Every launcher points `XDG_DATA_DIRS` at the staged `share/`, and GSettings aborts on a schema
directory that holds sources with no `gschemas.compiled` beside them. On Linux the `.deb`/`.rpm`
install step compiles it; a `.app` has no install step, so the bundle would have died at its first
`Gio.Settings.new()`. The cache is now compiled while the tree is assembled, with `--strict` —
without that flag a malformed schema is skipped at exit 0 and a cache is written without it, so the
stage looks compiled and the app aborts on exactly the schema that was dropped.

Linux still gets no prebuilt cache, deliberately: there the install step compiles the system schema
directory, where your schemas merge with every other package's.

### The readers are not ours, and both were watched fail

`plutil` is macOS-only, and the substitute a reader reaches for first is a trap: `plistutil` accepts
a `<dict>` whose `<key>` has no value and prints an empty dict at exit 0, while
`xmllint --noout --valid` exits 4 on a *correct* plist because the DTD is a remote URL. So the plist
is read back with CPython's `plistlib`, and the zip with `zipinfo -l` rather than `unzip -Z1` —
which prints names only and is blind to the single failure a distributed bundle has, a launcher that
extracts `0644` and will not run.

Both readers live in `.github/ship-oracle/`, both are runnable by hand, and both are driven green
AND red on every pull request: a plist with one wrong character, a plist truncated mid-`<dict>`, a
bundle with no plist at all, an archive whose launcher was planned `0644`, and an archive that
carries `0755` under a DOS `version made by` — where the mode is in the file and no extractor will
ever read it as a mode.

### The bundle carries what a stranger's Mac does not have

macOS ships no Node and, as far as a downloaded application is concerned, no GTK. So the `.app` now
carries both: the interpreter at `Contents/MacOS/node` with Node's own LICENSE beside it, and the
relocated GTK/GObject-Introspection closure under `Contents/Frameworks`, in the sibling layout
`@gjsify/node-gi` walks — the addon and its `gtk/` directory next to each other, because the addon
reaches its dylibs as `@loader_path/gtk/lib`. The launcher execs `"$here/node"` instead of a name it
hopes to find on `PATH`.

**Tree-preserving, and that is the design rather than a detail.** Every relation inside a relocated
closure is relative: install names are `@loader_path/<leaf>`, the gdk-pixbuf loader cache addresses
each decoder `@loader_path/../../..` from the bundle's top level, and the addon's search path is
`@loader_path/gtk/lib`. Staging the closure through the existing `bundledTypelibs` path would have
flattened all of it to basenames and broken every one of those at once — with a `.app` that ships
two hundred megabytes and still cannot open a window.

**And a fourth thing, which is easy to miss and fatal to omit.** A `--app node` bundle keeps
`@gjsify/node-gi/*` external by design, so a `gi://Gtk` import compiles to
`require('@gjsify/node-gi/gi')` in the shipped file. A `.app` has no `node_modules` to resolve that
against — measured on a bundle staged the old way and run from an unrelated directory:
`Error: Cannot find module '@gjsify/node-gi/gi'`, before any GTK question arises. node-gi's
JavaScript is now staged into one the bundle owns.

**No `DYLD_*` anywhere in the launcher.** Under a hardened runtime a Developer-ID-signed executable
is restricted and dyld strips those variables, so a launcher depending on one works unsigned and
breaks the day the bundle is signed. What the launcher exports instead — `GJSIFY_GTK_RUNTIME`,
`NODE_GI_NATIVE`, `GJSIFY_GI_LIBRARY_PATH` — is read by node-gi in JavaScript and handed to
GObject-Introspection through the binding. dyld never sees any of them.

**What you add to your own `package.json`** is a real list, not an implicit one:
`@gjsify/node-runtime-darwin-<arch>` and `@gjsify/gtk-runtime-darwin-<arch>` as `devDependencies`,
`@gjsify/node-gi` as a `dependency`. None of them is an `optionalDependencies` edge on anything —
whoever ships an application declares the runtime it ships. `gjsify ship` prints what it staged and,
for anything missing, the package name to install; a bundle with no runtime still assembles, because
it is a working intermediate on any machine that already has a Node.

One caveat on that list, and it is measurable rather than a plan: the three
`@gjsify/node-runtime-*` names are **not published yet** — they 404 on npm while all three
`@gjsify/gtk-runtime-*` resolve — so `npm install` fails on those lines until the first publish,
which is a manual maintainer action because npm Trusted Publishing needs the package to exist
before CI can publish to it. `GJSIFY_NODE_RUNTIME` points the shipper at a directory in the
meantime. `scripts/check-shipped-runtime-packages.mjs` holds the gap and fails once it closes.

### The same thing one operating system over

`gjsify ship windows` produces a program directory and a zip around it, and the runtime staging is
the same module: what differs is where each piece lands, which is the layout's answer and not a
second code path. The interpreter sits beside the launcher as `node.exe` — under the name the Node
release uses, derived from the same function that found the source file — and the GTK closure under
`lib\node-gi\prebuilds\win32-x64\`. Windows is the harder of the two cases, not the easier one:
macOS at least has a GJS you could install, and Windows has no GJS host at all.

**The zip carries a top level the directory does not.** A `<App>.app` is dragged to `/Applications`
as one object, so the bundle directory is part of what is staged. A Windows program directory is
not: an installer picks `C:\Program Files\<Publisher>\<App>` and lays the contents into it. So the
archive synthesises the directory — without it, unzipping scatters `app\`, `share\` and a loose
`.cmd` into whatever folder you were in, with every file individually in the right place.

**The launcher sets no `PATH` for the bundled GTK, and that is deliberate.** Windows has no rpath, so
`PATH` is where a DLL is found — but node-gi already prepends the closure's `bin\` in-process,
before it loads its addon, because Windows re-reads the DLL search path at every `LoadLibrary`. What
the launcher owes it is the locator, and a second copy of that directory would be the one that goes
stale.

**`win32-x64` only.** `gvsbuild` publishes no arm64 GTK — it hardcodes the platform — so there is
nothing to build a Windows/ARM runtime bundle out of, and on Windows that bundle is the only GTK
there is. `gjsify ship windows --arch arm64` says so and names the upstream issue.

**One thing to know if you ship this to a user.** `node.exe` is a console-subsystem program and the
Node release ships no windowed variant, so starting the application from a shortcut leaves a console
window open behind it. It is recorded rather than hidden: no CI leg can observe the defect (every
Windows job starts the app from a shell and already has a console), so the assemble job prints the
subsystem it read off the binary instead of pretending to check it.

### Signing takes an identity, not a certificate — and it is proven with neither

`gjsify ship --sign <identity>` signs the payload on the finish phase. What it takes is the STRING
`codesign` and `signtool` look a private key up by, never a certificate: there is no
`--certificate`, no `--p12`, no `--password`, and nothing on this surface can leak into a log line.
Getting a key into a keychain is the signing host's job. The project default is
`gjsify.ship.sign.<darwin|win32>.identity`, keyed per OS because a Developer ID string and an
Authenticode subject are different namespaces.

**Absent identity skips, loudly, at exit 0.** Unsigned stays the default path and a legitimate
deliverable. What is refused is the other direction — claiming a signature that was not made — so
the skip is printed to stderr and names the step it skipped.

**Signing is a mutation of the payload, not a wrapper around it.** Under a hardened runtime a
Developer-ID-signed executable will not load ad-hoc-signed dylibs, and all 106 Mach-O images in the
shipped darwin GTK closure are ad-hoc today — they have to be, because relocating them invalidates
whatever signature they arrived with. So the darwin leg re-signs every image inside the payload and
the packers receive new bytes. The order is fixed rather than bet on: the staged tree is validated
against its manifest FIRST — that check compares file SIZES, and a size is no more re-sign-proof
than a digest — then the payload is signed, then the container is built. The arriving stage is never
written to, so a `--from-stage --sign` run can be repeated.

**And the whole thing is proven in CI with no secret in it.** `codesign --sign -` is ad-hoc and
needs no Apple Developer Program membership, so a macOS leg signs a real Mach-O payload and two
readers check the result: Apple's own `codesign --verify`, and a new arrival comparator that answers
the question no verifier does — every non-Mach-O file byte-identical, every Mach-O identical outside
its signature. A real Developer ID later is a different value for the same flag, not a different
code path.

`--notarize <keychain-profile>` is there too, and it is honest about itself: notarisation needs an
Apple account, which is exactly the credential this milestone does without, so the flag, the guard
and both refusals are covered and the submission has never run. The Windows half is in the same
position for the same reason — `signtool` has no ad-hoc mode. Both gaps are written down in
`status/open-todos.md` with what WAS measured for each.

### What it does not do yet

The `.dmg` and the Windows `.msi` are still ahead, and so is notarisation. The asymmetry between the
two platforms is worth knowing: Gatekeeper BLOCKS an unsigned `.app`,
while SmartScreen only warns until a download builds reputation, so the Windows directory is usable
today in a way the macOS bundle is not. macOS has GJS but no *relocatable* GJS and Windows has no
GJS at all, which is why all four new formats accept `gjsify.app: "node"` only; a `gjs` project can
assemble either layout and is told, by name, why it cannot pack it.

See [#1354](https://github.com/gjsify/gjsify/issues/1354) and
`docs/adr/0024-ship-installable-artifacts.md`.
