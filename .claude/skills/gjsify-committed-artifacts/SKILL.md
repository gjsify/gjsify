---
name: gjsify-committed-artifacts
description: Read BEFORE editing packages/infra/cli/src, resolve-npm/lib, rolldown-plugin-gjsify/src or packages/infra/tsc — anything whose output is baked into a COMMITTED dist/*.gjs.mjs bootstrap bundle. Also read when a change appears to have no effect, when a build "succeeded" but nothing changed, or when CI reports bundle staleness. Triggers: "stale bundle", "cli.gjs.mjs", "verify-committed-bundles", "my change has no effect", "rebuild the bundle", "git hook".
---

# gjsify — committed artifacts and what a green build proves

The CLI bootstraps from committed bundles (`packages/infra/cli/dist/{cli,affected}.gjs.mjs`,
`packages/infra/tsc/dist/tsc.gjs.mjs`). **In this repo the code you edited is very often not the
code that runs** — a `.bin` shim resolves to the committed bundle, so a source edit with no
rebuild is invisible and every local check stays green.

Read [docs/build-artifacts.md](../../../docs/build-artifacts.md) before touching those sources.
The three rules that catch most of it:

1. **Verify freshness against the SOURCE, not the version string.** A matching version proves
   nothing about whether the bundle was rebuilt from the current source.
2. **An exit code is not evidence that anything was WRITTEN.** Check that the output file's
   mtime and content actually changed; a build can succeed and emit nothing.
3. **The `pre-commit` hook auto-stages what it rebuilds and is BEST-EFFORT** — its trigger list
   is a four-path heuristic, and it warns-and-skips when it cannot resolve a CLI. The exhaustive
   check is CI's rebuild-and-compare. `post-rewrite` covers rebase/amend, which `pre-commit`
   structurally cannot see, and only WARNS.

Never bypass with `--no-verify` / `SKIP_GJSIFY_HOOKS=1` to get a commit through — fix the cause.
