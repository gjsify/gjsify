# 149. A sixth Linux container: `snap`, packed by the host's `snapcraft`

- Status: **Proposed** (2026-11-20)
- Date: 2026-11-20
- Deciders: Pascal Garber
- Related: [ADR 0024](0024-ship-installable-artifacts.md) (the formats; § A6 the filesystem-writer
  refusal, § A24 the AppImage's host-tool rule), [ADR 0142](0142-a-fifth-linux-container-the-tarball.md)
  (the `gschemas.compiled` precedent), [ADR 0124](0124-ship-writes-a-release-record-per-artifact.md),
  [ADR 0148](0148-webext-submit-reaches-amo-and-the-store-api-survey.md) (the store-helper command
  group); `packages/infra/cli/src/utils/ship/{formats,flatpak,appimage}.ts`

## Context

`gjsify ship` on Linux has five containers over one payload: `deb`, `rpm`, `flatpak`, `appimage` and
the `linux-tar` pair. The Snap Store is the one Linux store with a large GNOME audience that none of
them reaches. A GJS app maps onto Snap cleanly, because the `gnome-core26` platform snap (measured
from the published revision, 2026-11-20) already carries `gjs` 1.88, GTK 4, libadwaita, libsoup 3 and
the typelibs, exactly as `org.gnome.Platform` does for a Flatpak. Nothing has to be bundled.

What the platform snap does NOT carry is the launcher glue. `desktop-launch` (fonts, XDG dirs,
`GSETTINGS`, the GPU wrapper) is copied into the app snap by `snapcraft`'s `gnome` extension at build
time from `snapcraft`'s own tree. It is GPL-3 code in a moving upstream, and the extension rewrites
plugs, layouts and environment per base (`core22`, `core24`, `core26`).

## Decision

One row in `FORMATS`, `layoutOs: 'linux'`, `prefix: '/usr'` (the AppImage layout: the staged launcher
computes its own prefix), `host.finishOn: ['linux']`, not in the default set.

**The packer generates a `snap/snapcraft.yaml` and runs the host's `snapcraft pack`.** It is the
Flatpak shape (a manifest handed to `flatpak-builder`), not the `.deb` shape (a container written
in-tree):

- `base: core26`, `confinement: strict`, `extensions: [gnome]`, one part with `plugin: dump` over the
  staged payload (`organize` to `usr/`), `apps.<binary>.command: usr/bin/<binary>`, `desktop:` and
  `common-id: <appId>` from the staged `.desktop` and metainfo. Name, version, summary and description
  come from the same package manifest the `.deb` reads.
- `gjsify.ship.snap` carries only what differs per app: `base`, `grade`, `confinement`, extra `plugs`,
  `name` (the store name, when it is not the binary name). `strict` plus the extension's plugs is the
  default, and an app that needs more says so by name (`home`, `removable-media`), the way
  `finishArgs` works for Flatpak.
- Like `linux-tar-flatpak`, the pack compiles `gschemas.compiled` into the payload when the extension
  does not (to be measured, see below).
- The `snapcraft` binary is required on PATH. The install hint names `snap install snapcraft
  --classic`. `--destructive-mode` is used when `GJSIFY_SNAP_DESTRUCTIVE=1`, otherwise snapcraft
  builds in LXD. The stage-only flow (`ship --stage`, then `--from-stage` elsewhere) lets a Fedora
  workstation assemble and an Ubuntu CI job finish.
- Artifact: `<binary>_<version>_<arch>.snap` plus the usual release record.

**Store helpers** go in a `gjsify snap` command group, modelled on `gjsify webext` (ADR 0148), in a
second step: `snap register <name>`, `snap upload [--release <channel>]` (credentials from
`SNAPCRAFT_STORE_CREDENTIALS`, never from a file in the tree) and `snap status`. They wrap
`snapcraft`; they add the release-record lookup and the refusal messages, not a second client.

## Rejected

- **Writing `snap.yaml` and the squashfs ourselves** (`mksquashfs`, no `snapcraft`). It would need a
  port of `desktop-launch` and the GPU wrapper, which is a GPL-3 copy tracking an upstream that changes
  per base, and it makes gjsify a squashfs-writer, which ADR 0024 § A6 rejects by name.
- **Bundling GTK/GJS in the snap** (a self-contained `core26` snap). No relocatable Linux closure exists
  (ADR 0024 § A24); the platform snap is the closure.
- **`classic` confinement as the default.** It needs a store review per snap and removes the point of
  the format. An app may declare it; gjsify does not choose it.
- **Vendoring or downloading `snapcraft`.** Same lines as `appimagetool`: not ours to license and
  audit, and a pack step must not fetch.

## Consequences

- Verification needs `snapcraft`, which this tree's Fedora workstation does not have. The e2e
  (`tests/e2e/ship-snap`) skips when it is absent, the way `ship-appimage` does; the unit tests cover
  the manifest generator without it, and the CI job that really packs runs on an Ubuntu runner.
- Open measurements, to be recorded in the packer header when taken: whether `gschemas.compiled` is
  needed in the payload; the strict-confinement plugs a typical gjsify app needs; arm64.
- The vocabulary check, the conformance rules (`TARGETS`) and `docs/ship-formats.md` learn the new
  id in the same change.
