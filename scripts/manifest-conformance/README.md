# Repo-scoped conformance rules

The rules here register into the same registry as the portable ones in
[`@gjsify/manifest-conformance`](../../packages/infra/manifest-conformance/),
but they cannot leave this repository, because each one reads something only
this repository has:

| Rule | What makes it repo-scoped |
|---|---|
| `runtimes-drift` (in `../audit-runtimes.mjs`) | Path-based axis classification (`packages/node/*`, `packages/web/adwaita*`) plus five curated `@gjsify/*` package-NAME allowlists |
| `runtimes-reachability` (in `../audit-runtimes.mjs`) | Resolves slots of sibling `@gjsify/*` workspace packages |
| `curated-alias-routing` (in `../audit-runtimes.mjs`) | Audits `@gjsify/resolve-npm`'s own alias TABLE |
| `tier` | ADR 0003/0005 governance of the `@gjsify/*` release train; names `@gjsify/node-gi` explicitly |
| `platforms-ci` | Parses `.github/workflows/prebuilds.yml`'s matrix by filename |
| `pr-trigger-parity` | Reads `.github/workflows/*.yml`, and names `main` as the branch this repo merges into |
| `reverse-bridge-leg` | Reads `.github/workflows/*.yml` for the steps that run a package's node leg, and knows `gjsify foreach test` is this repo's other route to one |
| `refs-pin` | `refs/` submodules + Cargo path deps, verified against this repo's git index |
| `workflow-rev-pin` | Pairs a named workflow `env:` with a `refs/` gitlink of this repository |
| `stylesheet-font-families` | Reads the reason ledger `status/stylesheet-font-families.json` and names this repo's own packages in its diagnostics |

Scope is not a quality judgement — `runtimes-drift` is the most battle-tested
check in the set. It is about whether the rule would still be *true* somewhere
else. A check that is confidently wrong is worse than one that is absent.

## Registration is not selection

Every rule registers, so [`field-coverage`](../../packages/infra/manifest-conformance/lib/rules/field-coverage.mjs)
can see which `gjsify.*` declaration kinds have an owner. Which rules actually
*run* is a separate decision per entry point:

| Entry point | Runs |
|---|---|
| `scripts/audit-runtimes.mjs --check` (`audit-runtimes.yml`, every PR, no `paths` filter) | everything except `package-outputs` + `refs-pin` |
| `scripts/verify-package-outputs.mjs` (`main.yml` build job) | `package-outputs` — a POST-condition needing a built tree |
| `scripts/check-refs-pin.mjs <pkg>` (every `build:meson`) | `refs-pin`, for one package, before it produces a prebuild |
| `scripts/check-prebuild-loader-path.mjs <dir>` (`stage-prebuild.mjs`, `prebuilds.yml`) | the directory check — takes a path, not a manifest |

`refs-pin` and `workflow-rev-pin` split the same subject along that line: the first
compares the gitlink to a working COPY and therefore needs initialised submodules, the
second compares it to a workflow `env:` and needs only this checkout's `.git/index`, so
only the second can run on every PR — which is where a submodule sweep lands.

That index is read as a FILE, by [`git-index.mjs`](./git-index.mjs), never through
`git ls-files`. `windows-suites.yml` runs the same `--check` with every `\Git\` entry
removed from PATH — a deliberate part of what that leg measures — so it has a complete
checkout and no `git` binary, and a rule that shelled out died there. Skipping when the
binary is missing would have been a rule that passes everywhere without comparing
anything; `git-index.mjs` carries the full argument.

`node scripts/audit-runtimes.mjs --rules` prints the registry.

## The one script that is deliberately NOT a rule

`scripts/verify-committed-bundles.mjs` stays entirely on its own, and that is
structural rather than an oversight:

- Its subject is not a manifest. The "declaration" it checks is the set of
  committed `*.gjs.mjs` artifacts, DISCOVERED from `git ls-tree HEAD` so the
  file set and the bytes come from the same revision.
- It **validates the CLI's own artifact**. If it ran from inside the CLI, a
  stale bundle would verify itself — precisely the circularity it exists to
  break. No other check here has that property: `package-outputs` is the closest
  and does not, because its two self-referential failure modes (a missing
  `lib/index.js` or `dist/cli.gjs.mjs`) both stop the command from launching at
  all, i.e. they are loud.

The same reasoning is why the CI gate is `node scripts/audit-runtimes.mjs` and
not a `gjsify` subcommand: on a runner with no install, the only executable form
of the CLI is the COMMITTED bundle, so a rule added in source but not rebuilt
into it would silently not run.
