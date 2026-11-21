# 151. `ship` stages a hand-written metainfo verbatim

- Status: **Proposed** (2026-11-21)
- Date: 2026-11-21
- Deciders: Pascal Garber
- Related: `packages/infra/cli/src/commands/ship.ts`, `utils/ship/hand-metainfo.ts`,
  `utils/ship/localize-metadata.ts`, `gjsify.site.metainfo`, `gjsify release-notes`

## Context

`gjsify ship` always renders the AppStream component from `gjsify.ship` and then folds the staged
`.mo` catalogues into it. An app that keeps a hand-written, already-translated metainfo (inline
`xml:lang` names, summaries, descriptions and captions, screenshots with `environment="gnome:dark"`,
`<releases>`, a donation URL) shipped a package with no screenshots, an untranslated description and
text that had drifted from the hand file. That same file already feeds `gjsify site` and
`gjsify release-notes` through `gjsify.site.metainfo`.

## Decision

1. **`gjsify.ship.metainfo`** (path relative to the project) names a file `ship` stages as the
   component's metainfo, byte for byte. Fallback when unset: `gjsify.site.metainfo`, else today's
   rendering. The fallback applies only while `ship.releases` is empty, so a project that declares
   both keeps the rendering it has.
2. **The staged file is not re-translated.** It carries its own `xml:lang`; folding catalogues into
   it would add a second, conflicting `<name xml:lang>`. The desktop entry is still rendered from
   config and still translated.
3. **Two refusals, before anything is staged.** `<id>` ≠ `ship.appId`: the stage names the file by
   `appId` and stores resolve the component by the `<id>` inside it, so a mismatch installs and
   is invisible. `<launchable type="desktop-id">` ≠ `<appId>.desktop`: the desktop entry is staged
   under that name, so any other launchable gives Software a button that launches nothing. An absent
   launchable is not refused; `lintMetainfo` (the `flatpak check` rules) runs on the file and prints
   its findings as warnings.
4. **Releases come from the file.** An explicit `ship.metainfo` together with `ship.releases` is
   refused: the config entries would be dropped silently, and a merge would pick a winner nobody
   chose. The file need not carry `<release version>` = the package version — the release step may
   run after `ship` — so a missing entry is a warning.
5. **`screenshots[].environment`** accepts `gnome | plasma` with an optional `:dark` / `:light`, and
   `cli`, as AppStream defines it.
6. **The stage already carries it.** The metainfo is a staged file listed in
   `.gjsify-ship-stage.json`, so `--stage` / `--from-stage` need no new closure field; the e2e
   asserts the file crosses unchanged.

## Consequences

- One source for site, release notes and shipped package; it cannot drift.
- `@gjsify/manifest-conformance` checks that `ship.metainfo` exists (`PATH_KEYS`).
- A project using the file must keep `<id>`, `<launchable>` and `<releases>` in it; the config no
  longer fills gaps.
