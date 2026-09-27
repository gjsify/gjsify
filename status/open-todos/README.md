<!-- Convention doc for this directory — NOT rendered into STATUS.md
     (scripts/generate-status.mjs skips README.md when it reads this directory). -->

# `status/open-todos/` — authored open work, one file per area

This used to be a single `status/open-todos.md`. It grew to 200+ `### <title>` entries
in one file, and nearly every PR touched it — so nearly every open PR went DIRTY on
nearly every merge (a rebase + a full CI run each, on a small runner pool). Splitting
one file per area means unrelated PRs touch different files and git merges them
without conflict.

## Where a new entry goes

Pick the file whose area name matches the package or subsystem your entry is about
(`node-gi.md` for `@gjsify/node-gi`, `nativescript.md` for the NativeScript bridge,
`ci.md` for workflow/gate/tooling follow-ups, and so on — the file names below are the
areas). If nothing fits, add a new `<area>.md` file; the generator picks up any `.md`
file in this directory automatically (except `README.md`).

Inside a file, add one `### <title>` heading per open item, same convention as before:

- One heading per open item, title as a short, specific sentence (not a package name
  alone — several entries per area is normal).
- A **resolved** item is **deleted**, never struck through or marked "Completed" — its
  record is the commit + CHANGELOG that closed it. `status-data` (part of
  `audit-runtimes --check`, every PR) rejects strike-through/✓/"Completed" headings.
- Never put a `###` heading inside an HTML comment — the generator's heading regex
  matches line-start only, so a commented-out heading silently never renders and
  `status-data` now catches this too.
- A deferral marker in source (`// TODO …`) that anchors here with `open-todos: <text>`
  (see `gjsify/todo-needs-anchor`) must match some heading's text as a **substring**,
  not a package name — `status-data` validates that the anchor still resolves to a
  real, un-resolved heading, in either direction.

## Current areas

| File | Area |
|---|---|
| `nativescript.md` | NativeScript bridge |
| `adwaita-web.md` | adwaita-web (browser custom elements) |
| `adwaita-core.md` | adwaita-core (shared headless behaviour) |
| `adwaita-ports.md` | Adwaita cross-port / gallery parity |
| `vocabulary.md` | `@girs`/`@gjsify` vocabulary alignment gate, ts-for-gir, dialect/JSX surfaces |
| `node-gi.md` | `@gjsify/node-gi` |
| `napi.md` | `@gjsify/napi` |
| `gamepad.md` | `@gjsify/gamepad` |
| `webgl.md` | `@gjsify/webgl` |
| `webrtc.md` | `@gjsify/webrtc` |
| `domparser.md` | DOM parsing (`@gjsify/domparser`, `dom-elements`, `dom-bridge`) |
| `gtk-host.md` | `@gjsify/gtk-host` (incl. react-jsx-runtime, window chrome, placement) |
| `blueprint.md` | Blueprint (`@gjsify/blueprint`) |
| `ship.md` | Packaging (`gjsify ship`, Flatpak, AppImage, `.rpm`) |
| `prebuilds.md` | Prebuilds and platform artifacts (musl, glibc, determinism) |
| `ci.md` | CI, workflows and repo gates |
| `macos.md` | macOS / darwin |
| `windows.md` | Windows / win32 |
| `runtime-apis.md` | Node.js runtime APIs (`fs`, `http2`, `sqlite`, `tls`, `process`, …) |
| `bundler.md` | Bundler and build tooling |
| `docs-refs.md` | Docs and `refs/` reference citations |
| `examples.md` | Examples and showcases |
| `devtools.md` | Devtools (`devtools-cdp`, `devtools-export`, `Screenshot(scope)`) |
| `fonts.md` | Fonts |
| `roadmap.md` | Architecture roadmap pointer (ADR backlog) |

This table is itself authored, not derived — if you add a new area file, add its row
here too.

## Migrated from a single file

This directory replaces `status/open-todos.md` (removed 2026-09-25, see
`docs/status-changelog.md` and the PR that made this split). Every entry that existed
in the old file still exists, unchanged, in exactly one of these files — verified at
migration time by a line-multiset diff, not an ongoing check.
