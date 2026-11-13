# 142. A fifth Linux container: `linux-tar`, and a Flatpak-optimised variant of it

- Status: **Accepted** (2026-11-13)
- Date: 2026-11-13
- Deciders: Pascal Garber
- Related: [ADR 0024](0024-ship-installable-artifacts.md) (the formats; § A3 the oracle rule, § A24-§ A27
  the AppImage and its `gschemas.compiled` precedent), [ADR 0124](0124-ship-writes-a-release-record-per-artifact.md)
  (the release record beside every artifact); `packages/infra/cli/src/utils/ship/{formats,tarball}.ts`,
  `packages/infra/manifest-conformance/lib/rules/ship.mjs`

## Context

`gjsify ship` on Linux has four containers over one payload: `deb`, `rpm`, `flatpak` and `appimage`.
Two of them are the default. None is a plain download that unpacks anywhere, and none can serve as the
source of a Flatpak `extra-data` entry: a Flatpak that is built from an upstream archive (the model of
a flathub-style "wrapper" package) needs one `.tar.gz` at an http(s) URL whose contents the runtime can run.

A measurement (Beifahrer 0.1.30, `org.gnome.Platform//51`) showed that the launcher `ship` already
writes runs unchanged from such an archive, because it computes its own prefix. The runtime provides
`gjs` and GTK. Only one thing is missing from the shared Linux stage: `gschemas.compiled`. The stage
carries the schema XML and leaves the compile to a `.deb`/`.rpm` postinst; an extra-data tree has no
postinst, and `GSettings` aborts without the cache — the AppImage's finding, again.

## Decision

Two rows in `FORMATS`, both `layoutOs: 'linux'`:

- **`linux-tar`** — `<binary>-<version>-linux-<arch>.tar.gz`, one top directory of the same name, the
  Linux payload below it. No tool needed to pack: the archive is written in-tree (`@gjsify/tar` plus
  the deterministic gzip), like `.deb` and `.rpm`.
- **`linux-tar-flatpak`** — the same, plus `share/glib-2.0/schemas/gschemas.compiled`, compiled at pack
  time from the payload (the AppImage precedent; needs `glib-compile-schemas`). File name ends
  `-flatpak.tar.gz` so both can sit in one `out/`. Interpreter: `gjs` only, because
  `org.gnome.Platform` ships no `node`. Nothing is bundled — no interpreter, no GTK.

Both are `host.finishOn: ['linux']` and neither is in the default set: `defaultFormatIds('linux')` stays
exactly `['deb', 'rpm']`. Opt in with `--target` or `gjsify.ship.targets`.

**Hygiene is the packer's job.** The archive holds the payload and nothing else, so the stage's own
manifest sidecar is never in it. `assertTarballHygiene` refuses `.env`, `.env.*`, `.git`, `*.log`, and
`node_modules` unless the app runs on Node. Those are guards for a stage that grew something nobody
meant to publish.

### What it is not

- **Not a replacement for `.deb`/`.rpm`.** There is no install, no dependency field, no menu entry
  registration, no uninstall. A distro package stays the way to ship to a distro.
- **Not self-contained.** It takes `gjs` (or `node`) from the machine, like the distro packages do, with
  nowhere to declare it. The `appimage` is the self-contained one.
- **Not a FlatPark format.** No Flatpak manifest is generated here; the tarball is the input a separate
  generator consumes.

### Why a second row and not a flag or `finishOn: 'any'`

`defaultFormatIds` selects on `finishOn === 'any'`. `'any'` would put both rows into a bare
`gjsify ship` on Linux, changing what every project ships. A flag on one row would need a second axis in
`--target`, the closed vocabulary and `TARGETS` in `manifest-conformance`. A row per variant keeps all
four table-driven. `TARGETS` is updated in the same commit, and `scripts/check-ship-format-vocabulary.mjs`
holds the two lists together.

## Consequences

- Twelve format ids instead of ten. The vocabulary script, `TARGETS`, the three doc tables and the
  oracle table in `docs/ship-formats.md` follow.
- The oracle is GNU `tar` in `tests/e2e/ship-linux-tar` (a reader sharing no code with the writer) and
  `parseTar` in the unit suite. No new `.github/ship-oracle` script is needed.
- gzip bytes are deterministic per host (zlib vs zlib-ng differ), so reproducibility is asserted within
  one host only.
- Paths are limited to 255 characters (`createTarball` writes no pax headers).
