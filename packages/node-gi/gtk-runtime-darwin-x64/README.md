# @gjsify/gtk-runtime-darwin-x64

Batteries-included, **relocated** GTK / GObject-Introspection runtime bundle for
**macOS on Intel (x64)**. It lets [`@gjsify/node-gi`](../node-gi) load `gi://`
namespaces (GLib · GObject · Gio · cairo · Pango · Graphene · Gdk) with **no
Homebrew GTK** installed on the host.

Platform-gated (`os: ["darwin"]`, `cpu: ["x64"]`), tier 3 (experimental). On any
other platform npm skips it and `@gjsify/node-gi` falls back to a system/Homebrew
GTK. The heavy `gtk/` payload is **not committed** — it is built on an Intel macOS
CI runner and shipped via the package tarball / staged into node-gi's
`prebuilds/darwin-x64/gtk/`.

## Why this package exists

`@gjsify/node-gi` shipped a loadable `darwin-x64` addon prebuild before this
package existed, so an Intel Mac got a working reverse bridge and then still had to
`brew install gtk4 …` by hand — while an Apple-silicon Mac and a Windows box did
not. That was **one bridge running two policies**, the asymmetry
[`AGENTS.md`](../../../AGENTS.md) warns about. This package is the missing half.

It is the Intel sibling of
[`@gjsify/gtk-runtime-darwin-arm64`](../gtk-runtime-darwin-arm64) and shares its
builder — see that package's README for the full mechanism (closure walk,
`@loader_path` relocation, ad-hoc re-signing, how node-gi finds and activates a
bundle, and the env-free re-exec).

## The builder is SHARED, not copied

Both darwin packages are built by the one parameterised script
[`../scripts/build-gtk-runtime-darwin.mjs`](../scripts/build-gtk-runtime-darwin.mjs).
Nothing about the relocation pass is arch-dependent, so a per-package copy would
have been a third near-duplicate of a ~360-line pass — the shape `AGENTS.md` names
as the place to lift a helper.

Two properties make the shared script safe to point at either package:

- **the target is derived, never passed** — `darwin-${process.arch}` comes from the
  running Node (the same discipline `scripts/stage-prebuild.mjs` uses), so a leg
  cannot stamp one arch's closure with another arch's name;
- **`--out` is cross-checked** against the destination package's own `os`/`cpu`
  declaration, so an Intel runner cannot populate the arm64 package's `gtk/` (and
  vice versa). That is the class of bug that shipped x86-64 binaries into
  `prebuilds/linux-ppc64/` for weeks.

It lives beside the packages (under `packages/node-gi/`) rather than in the
repo-root `scripts/` dir because `packages/node-gi/**` is both the affected
classifier's IGNORE list and `node-gi.yml`'s `paths:` trigger: an edit here runs
node-gi's own CI and does not force a full `main.yml` run.

The relocation assertion also moved INTO that script, and it is brew-prefix
**derived**. The per-job YAML greps for the literal `/opt/homebrew` — correct on
Apple silicon, where the Homebrew prefix is `/opt/homebrew`, and **vacuously true on
Intel**, where it is `/usr/local`. A hardcoded grep would have been the first thing
this bundle got wrong.

## Layout

```
gtk/
  lib/                 relocated dylibs (@loader_path-linked, ad-hoc re-signed)
  girepository-1.0/    typelibs (GLib/GObject/Gio/cairo/Pango/Graphene/Gdk/…)
  manifest.json        target + builder + counts + sizes + dylib list
```

`manifest.json` records the `builder` path, so a consumer holding only the tarball
can find the recipe that produced its bytes — the tarballs no longer carry a
per-package copy of the script.

## Install

```sh
npm install @gjsify/node-gi @gjsify/gtk-runtime-darwin-x64
```

`@gjsify/node-gi` resolves the bundle via
`require.resolve('@gjsify/gtk-runtime-darwin-x64')` (candidate 4 of
`resolveGtkRuntimeBundle()`) — no loader change was needed to add this arch.

> **Not a dependency of `@gjsify/node-gi`, deliberately.** #910 made the arm64
> bundle a dependency and #920 reverted it: an installed bundle satisfies candidate
> 4, so a job that built the addon against Homebrew GTK re-execs onto the *bundle's*
> typelibs with native code linked against a *different* GTK — wrong method entries,
> then a 29-minute timeout. Install it explicitly when you want the no-Homebrew
> path.

## CI status — read this before trusting the "no Homebrew" claim

- **Built + load-tested on every `packages/node-gi/**` PR** by `node-gi.yml`'s
  `macos-gtk-runtime` → `macos-gtk-batteries-included` chain (matrix leg
  `arch: x64`, runner `macos-15-intel`). The batteries-included job never
  `brew install`s GTK, so a green run *is* the conformance: the bundle self-satisfies
  or nothing loads.
- **Published** by `release.yml`'s `publish-gtk-runtime-darwin` job (matrix leg
  `x64`), which builds the bundle on an Intel runner and OIDC-publishes only this
  package with the populated `gtk/`.
- **NOT yet covered:** the `--windowing` GUI proof (`macos-gtk-windowing-runtime` →
  `macos-gtk-windowing`) runs on arm64 only. Tracked in `status/open-todos.md`.

`macos-15-intel` is the last x86_64 macOS image GitHub Actions offers (through
August 2027), which puts a horizon on this package's CI coverage.
