# Commit conventions

Use Conventional Commits: `<type>[scope]: <description>`, imperative, ≤50-char subject. House style is ≤50, but the required `Lint commit messages` check enforces config-conventional rules:

- `header-max-length` of 100 — the ceiling a squash subject `<title> (#N)` needs.
- `body-max-line-length` of 100 — a squash body IS the PR description, so a 101-column line reds the required check with `body's lines must not be longer than 100 characters [body-max-line-length]` and nothing else wrong.

`main` is **squash-only**. Branch commits are not linted. The `commitlint.yml` `repair-text` job edits the title/body itself (case, type synonyms, header, closing lists, wrapping, tables → comment) via `scripts/repair-pr-text.mjs`. Only a type or header the branch cannot supply stays red for you.

## Types

All types surface in `CHANGELOG.md` (`.release-it.json` `types`). Use the best fit:

`feat` · `fix` · `perf` · `revert` · `docs` · `refactor` · `build` · `ci` · `chore` · `test`

`style` is hidden.

## Scope

Lowercase package name without `@gjsify/` prefix:

```
fix(rolldown-plugin-gjsify): handle bare identifiers in app entries
```

Use `(e2e)` for e2e suites. Omit scope when crossing packages.
