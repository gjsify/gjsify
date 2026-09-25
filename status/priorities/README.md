<!-- Convention doc for this directory — NOT rendered into STATUS.md
     (scripts/generate-status.mjs skips README.md when it reads this directory). -->

# `status/priorities/` — the ordered priority list, one file per item

This used to be a single `status/sections/priorities.md`. Together with
`status/open-todos.md` it was one of the two files nearly every PR touched, so nearly
every open PR went DIRTY on nearly every merge. It is now one file per item instead.

## Layout

- `_intro.md` — required. The `## Priorities / Next Steps` heading and the paragraph
  explaining what this list is (and is not: it does not restate `open-todos/` entries).
- `<NN>-<slug>.md` — one file per priority item. Front matter:
  ```
  ---
  order: 1
  tier: high
  ---
  **Title.** Body text…
  ```
  `order` is what determines the rendered number and position — **not** the file's
  `NN` prefix or its position in a directory listing. The `NN` prefix exists only so
  the files sort near each other in a listing; rename a file without renumbering by
  leaving `order` as it was. `tier` is `high` or `low`. Two items sharing an `order`
  is a validation failure (`npm run status:generate` / `audit-runtimes --check`), not
  a silent collision — if you're adding an item, pick the next free order in the tier
  it belongs to.
- `_outro.md` — optional. Trailing prose that applies to the tier's items collectively
  rather than to one of them (kept short; if it grows, it is a sign one of the items
  should have said it instead).

## Adding, removing, reordering

- **Adding** an item: create a new `<NN>-<slug>.md` with the next free `order` in its
  tier, front matter, and body (no leading `N. ` — the generator adds the number from
  `order`).
- **Removing** an item: delete its file. Do not renumber the others — `order` values
  do not need to be contiguous, only unique within this directory.
- **Reordering**: edit the `order` front-matter fields of the affected files. Renaming
  a file's `NN` prefix is cosmetic and optional.

## Migrated from a single file

This directory replaces `status/sections/priorities.md` (removed 2026-09-25). See
`docs/status-changelog.md` and the PR that made this split.
