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

**A Flatpak is now a `gjsify ship` target, and meson leaves the sandbox.**

---

### One payload, and Flatpak is a row in a table

`gjsify ship` has staged one prefix-relative payload since 0.42.0 — `bin/`, `lib/<name>/`,
`share/` — and wrapped it as a `.deb` and an `.rpm`. ADR 0024 predicted that the whole difference
between that and a Flatpak would be "a four-line prefix map". Measured, it is `prefix: '/app'`, an
architecture table with no `noarch` in it, and a filename:

```bash
gjsify ship --target flatpak
flatpak install ./ship/out/org.example.MyApp-1.2.3-1.x86_64.flatpak
```

The generated module is the interesting part, because of what is not in it:

```json
{
  "buildsystem": "simple",
  "build-commands": ["mkdir -p /app", "cp -a stage/. /app/", "cp -a overlay/. /app/"]
}
```

If you have written a Flatpak for a GJS app before, that is the meson glue gone. Learn6502 carried
158 lines of it whose only job was to call `gjsify build` and copy the results into a prefix, 66 of
them setting `GI_TYPELIB_PATH` and `LD_LIBRARY_PATH` by hand. The launcher `ship` stages works out
its own prefix at run time, so nothing in the payload needs to know whether it landed in `/usr` or
`/app`.

### A format now says where it can be packed

Flatpak is the first `ship` target that needs tooling: only `flatpak build-bundle` writes an OSTree
static delta, and it runs on Linux. Rather than making that a footnote, each format declares it —
where it can be finished, what it execs, and who can read the artifact back — and `ship` refuses
instead of guessing:

```bash
gjsify ship --stage --target flatpak                       # here, any OS, offline
gjsify ship --from-stage ./ship/stage --target flatpak      # there, on a Linux runner
```

Three details are the difference between a declaration and a comment. The checks run **before** your
`build` script, so an absent `flatpak-builder` does not cost a full build to discover. The wrong OS
and a missing tool are two different messages, because the fixes are a different machine and a
package. And `flatpak` is deliberately *not* in the default target set — a bare `gjsify ship` must
not start demanding `flatpak-builder` of every project that only ever wanted a `.deb`.

### The `gjsify.flatpak` build keys have a new home, and a window

`runtime`, `runtimeVersion`, `sdkExtensions`, `appendPath`, `finishArgs` and `cleanup` now live at
`gjsify.ship.flatpak.*`. The old spelling still resolves, per KEY, so a project can move one at a
time; `ship` prints one line naming exactly what it inherited and where it goes. They are read from
`gjsify.flatpak` until 1.0.0.

What is **not** deprecated: the app metadata — `name`, `summary`, `developer`, `categories`,
`license`. Both blocks describe the same application and either may carry it, which is the whole
point of ADR 0024 § 8's "those files are not Flatpak's, they are the app's". And `gjsify flatpak
<sub>` is untouched: it is still the way to produce the committed manifest and AppStream files a
Flathub submission wants.

### How this is proven, and what is honestly not

A `.flatpak` is read back with `flatpak build-import-bundle` into a fresh repo and `ostree ls -R`,
which prints a path, a mode and a size per file — an independent reader, since ostree parses a delta
this project never wrote. That tier only runs where the tooling and the GNOME runtime are installed,
and it prints its skip where they are not; this project's Fedora CI image has neither.

So two tiers run everywhere, and both can fail on a real defect. One is structural. The other
executes the module's own `build-commands` under `sh` against a temporary prefix and compares what
lands, file by file and mode by mode, against the staged payload — with two negative controls,
because a comparison that cannot fail proves nothing: dropping the source's `skip` must put the
stage's own sidecar inside `/app`, and `cp -a stage /app/` without the trailing `/.` must lose the
launcher.

One measurement worth keeping, because it looks like a gate and is not: `flatpak-builder
--show-manifest` accepted an unknown source property and `buildsystem: "nonsense"` at exit 0. It
reads and normalises JSON. It validates nothing.
