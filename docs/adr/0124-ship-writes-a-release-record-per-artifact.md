# 124. `gjsify ship` writes a release record beside every artifact, and the site reads signing from it

- Status: **Accepted** (2026-10-29)
- Date: 2026-10-29
- Deciders: Pascal Garber
- Related: [ADR 0024](0024-ship-installable-artifacts.md) (the formats, and its amendment of
  2026-10-29: the `.dmg` is signed itself), [ADR 0040](0040-gui-launcher-and-the-macos-seal.md)
  (the darwin seal, notarisation and stapling), [ADR 0120](0120-a-developer-page-and-a-blog.md)
  (`@gjsify/site`); `packages/infra/cli/src/commands/ship.ts`,
  `packages/infra/site/src/site-data/{github,downloads,types}.ts`

## Context

`@gjsify/site` builds an app's download page from the GitHub `releases/latest` payload:
`classifyAsset` maps a file name to an OS, a format and an arch, and nothing else is known about
the file. In particular the page cannot tell a Developer-ID-signed, notarised `.dmg` from an
unsigned one, or an Authenticode-signed `.msi` from an unsigned one.

That difference is what a visitor meets first. An unsigned or un-notarised macOS app is blocked
by Gatekeeper with no "Open" button; the person has to find *System Settings → Privacy & Security
→ Open Anyway*. An unsigned Windows installer is stopped by SmartScreen behind *More info → Run
anyway*. Neither path is discoverable, and a visitor who does not know it reads the app as broken
or as malware. A signed and notarised artifact needs neither hint, and showing it there is noise.

Apps on gjsify ship both ways today and will keep doing so: a release workflow signs only when it
has the secrets, a fork never has them, and the Windows signer (`signtool`) has never run in this
repository (ADR 0040, still UNVERIFIED). So the page has to handle both states per artifact, and
the state has to come from the release itself rather than from a project setting that goes stale.

The only party that knows what happened to an artifact is the `gjsify ship` run that wrote it:
which identity `codesign` or `signtool` used, whether `notarytool` returned `Accepted`, whether
`stapler` attached a ticket. That run ends today with a log line and nothing machine-readable.

## Decision

### D1. Every FILE artifact gets a record beside it

After an artifact is finished — signed, notarised and stapled where the run asked for that —
`gjsify ship` writes `<artifact-file-name>.gjsify-release.json` next to it in `out/`:

```json
{
  "schema": 1,
  "artifact": "eu.jumplink.Learn6502-0.8.1-1.arm64.dmg",
  "sha256": "…",
  "size": 87411328,
  "format": "macos-app-dmg",
  "os": "darwin",
  "arch": "arm64",
  "signature": { "kind": "identity", "identity": "Developer ID Application: … (TEAMID)" },
  "notarized": true,
  "stapled": true,
  "generator": "@gjsify/cli 0.64.12"
}
```

- `signature.kind` is `none` (no `--sign`), `adhoc` (`--sign -`) or `identity`. Only `identity`
  carries a name, and that name is the certificate's subject, which is public in every signed
  file anyway.
- `notarized` and `stapled` are what happened, not what was asked. A `.zip` that was accepted
  and could not be stapled says `"notarized": true, "stapled": false`; a Windows artifact says
  `false` for both because there is no such step.
- `sha256` and `size` are taken from the bytes on disk AFTER the last step. Stapling writes into
  a `.dmg`, so a hash taken earlier describes a file nobody downloads.
- A directory artifact (`macos-app`, the Windows program directory) gets no record: it is never
  a release asset, the container beside it is.

A step that fails makes `ship` exit non-zero before the record is written, so a record never
claims a step that did not finish.

**One record per artifact, not one per run or per release.** A release is assembled by several
jobs on several hosts — Linux stages and packs, macOS packs the `.dmg`, Windows packs the `.msi` —
and each uploads its own files. A per-release file would need a merge job and a second writer
for the same name; a per-run file would need a naming rule for runs. A per-artifact record is
named by the artifact, cannot collide, and travels with it through whatever `cp`/`upload`
glob the workflow already uses, provided the glob matches it.

### D2. The site trusts a record only for the bytes it describes

`@gjsify/site` reads every `*.gjsify-release.json` asset of the release, matches it to the asset
named in its `artifact` field, and accepts it only if its `sha256` equals that asset's GitHub
`digest` (`sha256:<hex>`, part of the REST asset object). A record whose hash does not match —
an artifact re-uploaded after a re-build, a record copied from another release — is ignored, and
the artifact counts as unsigned.

`DownloadTarget` gains `signing: 'notarized' | 'signed' | 'unsigned'` for `darwin` and `win32`
targets; other platforms leave it unset.

- `darwin`: `notarized` needs `identity` + `notarized`; `signed` is `identity` alone. Gatekeeper has
  blocked a downloaded, un-notarised app since macOS 10.15, and macOS 15 removed the
  Control-click way around it, so `signed` gets the same hint as `unsigned`.
- `win32`: `signed` needs `identity`; SmartScreen reputation is not something a record can
  claim, so there is no stronger state.

A missing record means `unsigned`. That is the conservative reading: a hint shown for a signed
file costs the visitor one sentence, a hint missing for an unsigned file costs the download.

### D3. The hint is rendered by the site, in the site's catalogue

For a target that needs it, the download widget shows a short note with the OS's own path —
macOS: *System Settings → Privacy & Security → Open Anyway*; Windows: *More info → Run anyway* —
as gettext strings in `po/site.pot` with the German catalogue. A `notarized` darwin target or a
`signed` win32 target shows none.

### Rejected

- **Encoding the state in the file name** (`…-signed.dmg`). It changes download URLs between a
  signed and an unsigned build of the same version, and a name is the easiest claim to get
  wrong by hand.
- **A project setting** (`gjsify.site.signed: true`). It describes the project, not the release,
  and is wrong for the first release a fork or a secret-less run publishes.
- **The site verifying signatures itself.** That means downloading every artifact at build time
  (tens to hundreds of MB each) and parsing a CMS signature or an Authenticode blob without
  `codesign`/`spctl`; it still could not ask Apple whether a ticket exists.

## Consequences

- **The record is self-reported.** It is written by the release workflow, and anyone with write
  access to the release could upload a false one. The digest binding guards against staleness,
  not forgery. The same person could also upload an unsigned binary, so the record adds no new
  trust boundary; it only makes the page honest about what the workflow did.
- Every signed or unsigned file asset gains a small sibling, so the release asset list doubles.
  `classifyAsset` already ignores `.json`, so the download list does not change.
- Release workflows must upload the records. A workflow that copies `out/*.zip` by glob (Learn6502
  does) drops them silently, and the page then shows the hint for a signed file — the safe
  failure, but a failure. The workflow change is part of adopting this.
- The site build makes one extra request per record. The site already fetches the release
  payload at build time; the records are fetched in the same pass and cached with it.

## Implementation

1. `@gjsify/cli`: a `release-record.ts` beside `utils/ship/signing.ts` that builds the record
   from `PackInput` and the step outcomes, and writes it as the last act of `packOne` for
   file artifacts. Unit tests for every `signature.kind`, the zip's `notarized`-not-`stapled`
   case, and the hash being taken after stapling. `docs/ship-formats.md` names the file.
2. `@gjsify/site`: `parseLatestRelease` keeps `digest`; `load.ts` fetches the records;
   `buildDownloadTargets` sets `signing`; `downloadWidget()` renders the note; strings in
   `po/site.pot` and `po/de.po`. Tests for match, digest mismatch and absence.
3. Consumers (Learn6502 first): upload `ship/out/*.gjsify-release.json` with the artifacts.
