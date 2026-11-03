# 130. Credits come from the git history; a file of overrides covers the rest

- Status: **Accepted** (2026-11-03)
- Date: 2026-11-03
- Deciders: Pascal Garber

## Context

An About dialog, a README and a release page all want the same list: who wrote the code and who
translated it. Kept by hand, that list is out of date after the first drive-by patch and omits
every translator who worked through Weblate. The git history already has the facts: commit authors,
`Co-authored-by:` trailers, and the files each commit touched. A `.mailmap` already says which
identities are one person.

## Decision

`gjsify credits` derives the list from `git log` and writes `credits.json`:
`{developers, translators, supporters}`, names only.

1. **Source.** Authors and `Co-authored-by:` trailers, with `.mailmap` applied (trailers through
   `git check-mailmap`). Merge commits are skipped. A shallow clone is an error, so a truncated
   history never passes for the full one and `--check` cannot be falsely stale.
2. **Developers and translators.** A commit that touches a file other than `.po` / `.pot` credits
   its people as developers. A commit that touches `.po` files credits them as translators of each
   language, the language being the `.po` basename (`de`, `pt_BR`). Weblate commits as a bot with
   the real translator in a trailer, so the bot is dropped and the trailer counts.
3. **Names only.** An e-mail address is read to recognise a bot or an AI co-author and is dropped
   before anything is built. No output carries one.
4. **Bots and AI co-authors** are dropped by a default list of patterns, matched on name and
   e-mail. `gjsify.credits.ignore` replaces that list; it does not extend it, so a project can see
   the whole rule in one place.
5. **Overrides.** `credits.overrides.json` adds people and excludes others. `supporters` has no
   other source, because a sponsor is not a commit. Unknown keys are rejected, so a typo does not
   silently do nothing.
6. **`--check`** exits 1 when the file on disk is stale, comparing parsed JSON so formatting does
   not matter. It gates a release job the way `gjsify upgrade --check` gates dependencies.

Git is read with `spawnSync`, not async `spawn`: the read is one bounded call and needs no
teardown contract.

## Consequences

- Credits are reproducible from the repository alone; a fresh checkout gives the same file.
- A contributor whose identity differs between commits appears twice until `.mailmap` joins them.
  That is the fix, not a workaround in this command.
- Someone who helped without committing (design, testing, money) appears only through the
  overrides file.
