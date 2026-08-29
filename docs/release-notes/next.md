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

**`gjsify ship darwin` now produces a real macOS application bundle, assembled on Linux.**

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

### What it does not do yet

The bundle carries no interpreter and no GTK closure, so it runs where `node` is already installed
and not yet on a stranger's Mac. macOS has GJS but no *relocatable* GJS, which is why the two macOS
formats accept `gjsify.app: "node"` only — a `gjs` project can assemble the layout and is told, by
name, why it cannot pack it. The `.dmg`, the Windows installer and signing are still ahead.

See [#1354](https://github.com/gjsify/gjsify/issues/1354) and
`docs/adr/0024-ship-installable-artifacts.md`.
