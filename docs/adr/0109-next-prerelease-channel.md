# 109. A `next` prerelease channel publishes every green main merge

- Status: **Accepted** (2026-10-13)
- Date: 2026-10-13
- Deciders: Pascal Garber
- Related: ADR [0008](0008-release-versioning-policy.md) (release-train versioning);
  `.github/workflows/release.yml` (`publish-next`); `scripts/next-channel-version.mjs`;
  [docs/publishing.md](../publishing.md); consumer guidance in
  [docs/consuming-the-next-channel.md](../consuming-the-next-channel.md)

## Context

`@gjsify/*` ships as one release train (ADR 0008). The only way code on `main` reaches a consumer
app is a release cut: a tag, a 16-job `release.yml` run, GitHub release assets. That is the right
granularity for a published version and the wrong one for the apps built against the platform in
the same workspace — Learn6502, beifahrer, steuererklaerung. A fix those apps need lands on `main`
and then waits for a cut that bundles it with everything else, which is both slow and an incentive
to cut releases for one fix.

The workarounds in use are worse than the problem. A `link:` or `file:` dep on a local checkout
only works on the one machine that has it, and never in the app's own CI. A git dep on `main`
bypasses the build: the published packages ship `lib/` and a `dist/cli.gjs.mjs` that are gitignored,
so a git dep installs a tree with no compiled output. Vendoring a tarball by hand is a release cut
with no provenance.

What is missing is a channel: a version that exists on npm, is installable by name, carries main's
code, and is unmistakably not a release.

## Decision

1. **Dist-tag `next`, published on every green `main` merge.** The trigger is
   `workflow_run` on the `GJS` workflow (`main.yml`) concluding `success`, so the channel only
   carries code main's own CI accepted. `latest` is never moved by it.
2. **Version scheme `<next patch of root version>-next.<github.run_number>`** — today
   `0.63.1-next.N`. It sorts above every `0.63.0*` and below the eventual stable `0.63.1`, and `N`
   is monotonic per repository, so a `next` version never has to be compared against another one to
   know which is newer. Nothing derives it from git tags, so `release-it` is unaffected.
3. **Nothing is committed.** `scripts/next-channel-version.mjs --write` rewrites the CI checkout
   only: every manifest `version`, and every `workspace:^`/`workspace:~` spec to `workspace:*`.
   `main` never carries a prerelease version, and the release train's state stays exactly the tags.
4. **Intra-repo deps are pinned EXACTLY in a next tarball.** That is what the spec rewrite buys: a
   caret pin `^0.63.1-next.42` also admits the stable `0.63.1`, so an app on the channel would
   silently resolve a mixed stable/prerelease closure. `workspace:*` makes `gjsify pack`'s
   `rewriteWorkspaceDeps` emit the exact version, so `npm i @gjsify/cli@next` resolves an
   all-`next` closure. This is a deliberate local deviation from ADR 0008 decision 2 (published
   `workspace:^`), and it serves the same goal: the train's coherence, enforced harder on a channel
   where two adjacent versions are minutes apart.
5. **Every publishable package, every run — one version per run.** 218 packages. `gjsify affected`
   decides only *whether* a merge is worth a run (`skip-all`), never *which* packages to publish:
   with exact pins, a partial sweep would publish a `@gjsify/cli@0.63.1-next.42` whose siblings
   were never published at `-next.42`.
6. **It lives in `release.yml`, as a trigger and a job.** Every Trusted Publisher on npmjs.com is
   registered against the workflow *filename* (npm's OIDC claim is `workflow_ref`'s basename, and
   `gjsify trust` defaults to `release.yml`). A `next.yml` would need all ~218 packages re-trusted
   by hand before its first publish could succeed. `concurrency` is workflow-level too, so only a
   trigger in this file can be ordered against a release sweep.
7. **npm only.** No GitHub release, no tag, no release asset, no `@gjsify/napi` /
   `@gjsify/node-gi` / `*-runtime-*` prebuild (12 packages, dedicated jobs on macOS and Windows
   runners, not workspace members). Those stay on `latest`; the `publish-next` job therefore holds
   narrower permissions than `publish` — `contents: read`, no `actions: write`.

## Consequences

- An app pins `"@gjsify/cli": "next"`, runs `gjsify install`, and is on main's code minutes after a
  merge. `install` locks the exact version it resolved, so a lockfile still describes one tree.
- Going back is `"@gjsify/cli": "^0.63.0"` and an install — no republish, because `latest` was never
  touched.
- **Right after a stable cut, dist-tag `next` points BELOW `latest` for a while:** `0.63.1-next.99`
  is less than the `0.63.1` the cut just published. An app on the channel is briefly behind the
  release. The next merge to `main` publishes `0.63.2-next.N` and fixes it. Not worth automating
  around; worth knowing before reading it as a bug.
- `next` versions accumulate on the registry and are never unpublished. Each is a legitimate
  immutable version; only the dist-tag moves.
- `release-it --preRelease=next` by hand would mint a colliding preid. Use the channel or cut a
  stable release; a hand-rolled `next` prerelease is now a name collision.
- The 12 prebuild packages are a real exclusion, not an oversight: an app on `next` that needs a
  main-only fix inside `@gjsify/node-gi` still waits for a release cut.
- A red `publish-next` means the channel is stale. It is not a release gate and blocks nothing.
- Every merge now runs a ~35 min 218-package publish sweep, skipped when `gjsify affected` reports
  nothing publishable.

## Alternatives rejected

- **A separate `next.yml` workflow.** Clean, and it cannot publish: ~218 Trusted Publishers are
  registered against `release.yml` by filename, and re-registering them is manual work per package
  with no API worth trusting for it. Concurrency would also stop being shared with the release.
- **`push: branches: [main]` as the trigger.** Fails the `pr-trigger-parity` conformance rule,
  which requires matching `pull_request` coverage for any push-to-main trigger — and a job that
  mints an npm publish token structurally cannot run on a pull request. The PR-side half that rule
  asks for exists in the shape it can have: `next-channel-version.mjs --check` in
  `audit-runtimes.yml` grades the rewritability of the tree on every PR. Keying on `workflow_run`
  additionally buys the property that matters more: `next` carries only code CI accepted.
- **Commit the prerelease version to `main`.** Would put a `-next.N` version in git history on
  every merge, make every PR conflict on 218 manifests, and feed `release-it` a version it would
  have to reason about.
- **Publish only the affected packages.** Half the runtime, and an uninstallable closure: exact
  pins to sibling versions that were never published.
- **Caret pins inside the channel, as on `latest`.** Lets `^0.63.1-next.42` resolve the stable
  `0.63.1` and hands the consumer a mixed closure that no CI leg has ever tested.
- **A sliding `0.0.0-next.<sha>` version.** Unordered by semver, so an app cannot express "at
  least this one", and `gjsify upgrade` has nothing to compare.
- **One shared concurrency group with the release.** GitHub keeps one *pending* run per group and
  cancels the older one, so a queued `next` run would evict a queued `only=` recovery run — the
  thing `docs/publishing.md` says to batch rather than lose.

## Implementation

`scripts/next-channel-version.mjs` (derivation + rewrite, `--check` / `--write` / `--json` /
`--github-output`), the `workflow_run` trigger, the concurrency expression, the two
`github.event_name != 'workflow_run'` guards and the `publish-next` job in
`.github/workflows/release.yml`, the root `npm:publish:next` script beside `npm:publish:prebuilt`,
the PR-side `--check` step in `.github/workflows/audit-runtimes.yml`, and `isDistTagSpec` in
`packages/infra/cli/src/commands/upgrade.ts` so `gjsify upgrade` leaves a dist-tag spec alone
instead of overwriting it with a version range.
