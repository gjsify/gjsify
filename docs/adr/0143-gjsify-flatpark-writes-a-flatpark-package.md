# 143. `gjsify flatpark` writes a FlatPark package from a ship stage

- Status: **Accepted** (2026-11-14)
- Date: 2026-11-14
- Deciders: Pascal Garber
- Related: [ADR 0124](0124-ship-writes-a-release-record-per-artifact.md) (the release record),
  [ADR 0142](0142-a-fifth-linux-container-the-tarball.md) (`linux-tar-flatpak`);
  `packages/infra/cli/src/{commands/flatpark.ts,utils/ship/flatpark.ts}`

## Context

A FlatPark registry entry (`registry/<app-id>/`) is a manifest with extra-data sources, an
`apply_extra.sh`, a `resolve-update.sh`, desktop file, metainfo, icon and `flatpark.yml`. Writing it
by hand per app and release drifts from what `ship` already knows.

## Decision

`gjsify flatpark [project] --out <dir>` reads a `gjsify ship --stage` directory and writes the package
directory. It only writes files: no network, no hashing, no push, no PR.

- `url`, `sha256` and `size` come only from `<artifact>.gjsify-release.json` (ADR 0124). A missing
  record aborts. The URL is `https://github.com/<repo>/releases/download/<tag-prefix><version>/<artifact>`.
- `apply_extra.sh` carries no version; the asserted path derives from `binaryName`.
- Output is byte-identical across runs: the release date is the UTC date of the stage mtime, sources
  are sorted by arch, and no absolute path, hostname or timestamp is written.
- The stage's own desktop file, metainfo and hicolor PNG are reused. App IDs come from config.
- A `noarch` record takes the stage target arch; two records for one arch are an error.

## Consequences

The release must be built and recorded before the package is generated. Approving the app upstream
(`upstream_approved`) stays a maintainer step; it is written as `false`.
