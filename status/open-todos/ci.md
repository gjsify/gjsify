<!-- Authored Open-TODO sections — area: CI, workflows and repo gates.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### `statusCheckRollup.state` answers twice, and nothing here knows which answer merges

Measured 2026-09-19 on acca841ff1…0830 and c0629ff751…b5b1, deterministically and in the same
minute:

    statusCheckRollup { state }                       -> SUCCESS
    statusCheckRollup { state contexts(first:1){...} } -> FAILURE

Selecting `contexts` at all — even `first:1 { totalCount }` — flips it. The bare shape reads like
latest-per-context, the other like worst-over-all-entries. Both commits have a newest
`Lint commit messages` entry of SUCCESS with older FAILUREs; acca841ff1 has no other non-success
context at all. Two people measuring the same commit that day got opposite answers, each reading
the field correctly, and a claim built on one of them propagated into six files twice before
anyone re-derived it.

WHY IT MATTERS: `Lint commit messages` is one of the three required contexts on `main`, so
"is a superseded red still blocking?" has no answer from this field. The ruleset is different
machinery and cannot be read from history here — #1667 merged on c0629ff7 whose entries are
FAILURE then SUCCESS, but the ruleset carries `bypass_actors` (`OrganizationAdmin` and
RepositoryRole 5, both `bypass_mode: always`) and every merge in this repository is by the owner,
so it cannot tell a satisfied rule from a bypassed one. The rule-suite API records
`required_status_checks` per push and would settle it, but retains about a day, so #1667 has aged
out.

THE MEASUREMENT THAT CLOSES IT, and it is cheap: on any PR targeting `main` whose other two
required contexts are green, produce an older commitlint FAILURE followed by a newer SUCCESS and
read `mergeStateStatus`. BLOCKED means the ruleset weighs every entry; anything else means a PR
can be mergeable while the checks list reads red — which is its own trap and worth writing down.
Do not run it on a PR somebody is waiting to merge: it deliberately reddens it, and
`clear-superseded` then repairs it out from under the reading.

The commitlint fix does not depend on the answer — a verdict that is a function of the current
text leaves no stale entry for either aggregation to weigh — but two things downstream do: how
loudly a superseded red should be treated, and whether `clear-superseded` unblocks merges or only
restores legibility.

ALSO OPEN is the shape rather than the instance. `commitlint.yml` is the only workflow whose
verdict depends on something OTHER than the commit, so it is the only one where a conclusion can
be stale while the commit is not. Any future check that reads the PR description, a label or a
review inherits it, and nothing enumerates that class. Adjacent and untested: the void needs a
later run to exist, which an edit authored with `GITHUB_TOKEN` would not produce; no workflow
here holds `pull-requests: write` today, so the refusal path is reasoned and fixtured but has
never fired.


### `packages/framework/AGENTS.md` is over its own 20 KB target

**20729 B**, against the 20480 B target the root AGENTS.md sets for every agent context
file — 249 B over, and the first time this file has crossed it. It was 20421 B before
rule (9) grew to cover `/fonts`' second directory and the UI-font policy (ADR 0038
§ Amendment 2).

Nothing is broken: `check-agent-context-size.mjs` gates on the EXACT per-file ratchet
(re-baselined in the same commit) and on the 32 KiB hard cap where Codex silently
truncates the tail. This is a target, not a gate — `packages/infra/cli/AGENTS.md`
(27792) and `rolldown-plugin-gjsify/AGENTS.md` (24972) are further over.

Recorded because a target nobody notes is not a target the next time. **The lever is
cutting elsewhere in the same file**, not trimming rule (9) further: it is already at
the "rule plus one link" shape the budget section asks for.


### Three CI legs fetch at build time, and two of them are booked as "flakes"

Measured in one evening, 2026-09-11, across four parallel PRs:

- `Build @gjsify/node-gi native addon (node-gyp)` fetches `node-vX-headers.tar.gz`
  from nodejs.org — `attempt 1 failed with ECONNRESET`, no retry, job red.
- `brew install gtk4 libadwaita …` (darwin-x64) — exit 1 over `cairo … already
  installed and up-to-date`, red before `actions/checkout` had even run.
- The AppImage pack fetched its runtime from a **rolling** tag — fixed on this
  branch: pinned, digest-checked, `--runtime-file`.

The third was treated as a blocker because what it fetches ends up INSIDE a shipped
artifact. The first two are treated as flakes because they only cost a re-run. That is
a difference in consequence, not in kind: all three make a containerised job depend on
a third party being reachable and unchanged at the moment it runs.

The node-gyp one is the cheapest to close and the most frequent — bake the headers for
the pinned Node version into `.docker/ci-fedora.Dockerfile`, beside the `appimagetool`
and `runtime-x86_64` pins already there. node-gyp reads them directly; verified in its
own source and README rather than assumed:

    --tarball=$path   read the headers from a local tarball  (lib/install.js:175)
    --devdir=$path    where the headers are cached
    --nodedir=$path   skip the install step entirely         (lib/install.js:40)

Recorded because "re-run it, it's flaky" is how a systematic dependency stays
invisible: each occurrence looks like weather.



### A renamed ship artifact broke a workflow, and only one of nine references noticed

#1655 gave the two zip rows an OS label — `windows-dir-zip` became
`<binary>-<version>-<release>.windows.<arch>.zip`, `macos-app-zip` the `.macos.` twin — and its
own suite pins both names. What nothing pinned is the CONSUMER: `node-gi.yml` hard-codes the
old spelling at one site, so `Assemble a self-contained Windows program directory` exited 1 on
the next commit that ran it, and the two Windows jobs downstream failed at
`Unable to download artifact` — a chain whose first link is three jobs away from the rename.

The other eight references to a ship artifact in that workflow use a glob (`*.zip`,
`Get-ChildItem -Filter *.zip`, `ls *.zip | head -1`) and survived. That is the wrong lesson to
draw: a glob survives a rename by not checking it. The hard-coded one is the only site that
asserts the name at all, which is why it is the one that reported the change.

What is missing is the check that a format's `fileName` and the workflow text that consumes it
agree. `FORMATS` knows every name it can produce, and `.github/workflows/**` is a fixed set of
files, so the comparison is mechanical. Until it exists, a rename lands green and the breakage
appears in a job that names neither the format nor the PR that renamed it.

Related: the same shape as `CI's build-output cache key is the third answer to "what are this
package's inputs"` — a value with several copies, only one of which is held.



### CI's build-output cache key is the third answer to "what are this package's build inputs"

`packageBuildInputs` (`packages/infra/cli/src/utils/package-inputs.ts`) is now the ONE definition
the build cache and `gjsify test` both read (#1651). The third copy is not TypeScript and was not
closed with them: `.github/actions/gjsify-setup/action.yml`'s `actions/cache` key is
`hashFiles('packages/*/*/src/**/*.{ts,mts,cts}')` plus the manifests, i.e. the same `src/**`
allow-list, with the same blind spot — and the workflow comment beside it already NAMES the
incident it cost (#821: `cli.gjs.mjs` inlines `packages/infra/resolve-npm/lib/*.mjs`, tracked
source that is not under `src/**`, so two revisions differing only there share a cache key). The
three `!` excludes there are documentation of intent, not enforcement; `Drop cache-restored
toolchain bundles` is what actually holds that line today.

A YAML `hashFiles()` glob cannot call a TypeScript function, so this needs a generated key input
rather than a shared call — a step that runs `gjsify` to print one hash over every package's
input set, fed into the `key:`. Two things to settle before writing it: the step runs BEFORE the
cache restore, so it may only use what a checkout plus the setup action already provides; and a
key computed from file CONTENTS (what `packageBuildInputs` hashes) differs from `hashFiles`'
semantics on symlinks and on files a `.gitignore` keeps out of the checkout, so the two must be
measured against each other on one revision before the swap, not assumed equal.

Bounded meanwhile: `GJSIFY_BUILD_CACHE` is set nowhere under `.github/`, so only the
`actions/cache` half is live, and its failure mode is a warm restore of a `lib/` tree that a
change outside `src/**` should have invalidated — which `verify-package-outputs.mjs` (the
warm-cache probe) does not see, because it asks whether the restored tree is COMPLETE, not
whether it is CURRENT.



### A node:test FILE fails with no named test and no message, on a leg nobody watches

**`packages/node-gi` `test/bytes.test.mjs`** on the Windows batteries-included leg
(`no gvsbuild`, staged prebuild, bundled GTK): `tests 10, pass 9, fail 1` where all
NINE named tests are green and the tenth "test" is the FILE — `'test failed'`, no
message, no assertion, no stack, no abort or access-violation anywhere in the log.
Immediately before it: `(node-gi) warning: could not watch a GLib poll fd from
libuv; falling back to timed main-context polling`. Green on rerun.

A napi case used to sit beside this one, on the theory that the two shared a shape.
They did not, and the theory cost a wrong grouping: that one was a conformance program
awaiting something nobody resolves, which exits 0 with a truncated transcript. Nothing
about it was file-level or unattributable once the reference leg stopped reporting
success for a run that never finished.

**The shape is the finding.** A `node:test` file that fails at FILE level reports
nothing usable: node attributes a post-test process problem to the file, so the log
carries a name and a duration and no cause. An assertion failure would print a diff;
this prints `'test failed'`.

**And the baseline WAS unknown, which is worse than the flake.** node-gi.yml's `scope`
job narrows the OS matrix, so on a `pull_request` or a `main` push the Windows legs run
only when `packages/node-gi/**`, `scripts/node-gi-consumer-harness.mjs`, `node-gi.yml`
itself or `.github/scripts/**` changed. Measured while chasing this: the leg is `skipped`
on every recent `main` push, so a green tick on `main` says nothing about it, and the last
run that actually EXECUTED it was two PRs earlier. Reading `main` as the baseline would
have blamed the wrong change — it nearly did. `ci-summary` now names, per job GitHub
resolved to `skipped`, the SHA at which that job last actually executed, so this half
costs a glance at the step summary.

**What a reader may and may not conclude, spelled out — because "unknown" is not "never
measured", and the loose version of this sentence sends the next person to the wrong
instrument.** `scope`'s `case "$EVENT"` answers `true` for every event that is neither
`pull_request` nor `push`, so the 03:17 UTC nightly and any `workflow_dispatch` run the
FULL matrix. Three separate readings, and only the third is a baseline for a commit:

- a green `main` tick at commit X says **nothing** about node-gi's Windows legs at X —
  `skipped` and `success` are the same colour in the checks UI;
- the last nightly says something about the `main` of that morning, so the newest Windows
  measurement is normally under a day old — but it is not this commit's, and a consumer-only
  merge lands between the two with no Windows leg of its own;
- `ci-summary`'s gate-history table is the only thing that tells those two apart, by naming
  the SHA at which each skipped leg last actually executed.

**What it would take, and what it costs today.** Closing it per-commit means dropping the
`scope` narrowing for `push` to `main` — the full macOS x10 / Windows x6 / arm64 matrix on
every merge, which is the cost `scope` exists to avoid, so this is a decision and not an
oversight. The cheaper half is already paid: the gate-history table. What is left unpriced
is that reading it is a convention rather than a mechanism — nothing fails, warns or blocks
when a Windows regression is attributed to a commit whose Windows legs never ran, which is
exactly the afternoon this entry cost.

What would make the next occurrence cost minutes instead of an afternoon, in order:

- **Make a file-level failure say something.** The two candidates are a `process.on('exit')`
  hook that prints the pending-handle set, and running the file with
  `--test-reporter=spec --test-force-exit` off so a hanging handle surfaces as a
  timeout with a name rather than as an exit code.
- Only then chase the cause. The `bytes` suite exercises GBytes ref lifetime across
  GC (`a callee that KEEPS the bytes stays valid after the engine drops its ref`), and
  it appeared in the run that first linked instance prototypes to their class
  (#1322) — a change that touches every wrapped instance. That is a hypothesis with
  no evidence behind it: the same leg passed on rerun with the same code.


### Three `gtk-os-suites.yml` steps cannot fail the build, and none is now merely unread

`gtk-os-suites.yml` carried FOUR `continue-on-error: true` steps — `rn-probe` on darwin, and
`gtk-host-probe`, `rn-probe-win32` and `conformance-win32` on win32 — each a deliberate probe
with a written retirement condition beside it, the arrangement
[ADR 0044](../docs/adr/0044-an-instrument-states-what-it-measured.md) argues for: a
knowingly-red gate teaches people to skip the job, and the next real finding then lands where
nobody looks. Three are left; `conformance-win32` was promoted on 2026-09-19.

**What it costs while it stands.** A `continue-on-error` step's CONCLUSION is forced to
`success`, so the job colour, the PR page, the REST/GraphQL checks and `gh pr checks` all
read green while the step exited 1. Only `steps.<id>.outcome` records what happened, and
only `scripts/report-probe-outcome.mjs` puts it where a person looks — a job-summary row
plus a `::warning::` annotation on the run and the PR.
`scripts/check-probe-outcomes-read.mjs` holds every such step to having an `id` that the
workflow reads, so a probe cannot go dark. The measured price of the gap it was born from
(#1552): on #1541's first push, run 33851595137 reported green on every gate while three
probes were red — 6 of 2042 on both darwin legs and 8 of 2038 on win32 — and TWO of the
win32 eight were not the PR's at all and had been failing with nobody counting them
(#1556). They were found by someone reading a log they had no reason to open.

**The class is closed, and the two instances that proved it were worth the trouble.** Both
remaining conditions are now `retire-when:` clauses beside their step, and
`scripts/check-probe-retirement.mjs` evaluates every one on every run and FAILS when one
comes true — which is what the last paragraph of this entry used to ask for. Measured
2026-09-19 over all 71 `push`-to-`main` runs from 2026-09-10, reading the
`::warning title=Probe failed::` annotations, scoped to the job that owns the step and
joined on the reader's `PROBE_LABEL`. A leg that was absent, skipped or cancelled measured
NOTHING and is counted as neither:

| probe | condition met | green | red | no measurement | verdict |
|---|---|---|---|---|---|
| `conformance-win32` | 2026-09-11, 0.49.0 | **58** | 5 | 8 | PROMOTED to a gate |
| darwin `rn-probe` | 2026-09-03, 0.46.0 | **0** | 70 | 1 | condition was WRONG |
| `gtk-host-probe` (win32) | no — #1446 open | 0 | 70 | 1 | left a probe |
| `rn-probe-win32` | 1 of 2 clauses | 0 | 70 | 1 | left a probe |

`conformance-win32`'s five reds are all between 04:24Z and 06:16Z on 2026-09-11, inside the
widening window that closed when 0.49.0 published at 08:08:06Z; it was green in all 48
measured runs afterwards and stayed advisory for every one of them.

Both met conditions were verified off the artifacts rather than off the dates, cache-busted
(`npm view` and a bare curl read a 300 s edge cache, `docs/publishing.md`): the published
`@gjsify/gtk-runtime-win32-x64` tarball carries `gstvorbis.dll` at 0.49.0 and 0.51.1 and not
at 0.48.0, and `d7da6c3b91` (#1488, closing #1438) is an ANCESTOR of `v0.46.0` and not of
`v0.45.0` — the ancestry is what proves the release carries it, and a date beside a version
number is not. So both conditions genuinely held. **A held condition still told us nothing
about whether the step passes**, which is why the new check fails on a ripe probe in BOTH
directions rather than only on a green one.

**A first pass at these numbers was wrong and the way it was wrong is the same defect.** It
read 25 green / 1 red over 21 runs, because it matched the annotation against the step's
`name` while the annotation carries `PROBE_LABEL` — a separate string nothing coupled to the
name — and because it searched every job in a run rather than the one that owns the step, so
a same-named GATING step's legs counted too. `check-probe-outcomes-read.mjs` now holds
`PROBE_LABEL` to the step name, which is what makes the join sound.

**What is still missing to retire each of the three left:**

- `rn-probe` (darwin) — the RELEASE condition is met and was a PROXY: the step was red in 70
  of 71 runs, on defects of its own. Its condition is now `retire-when: probe-green 5`,
  after three wrong proxies (an issue number, then "#1438 closes", then "the release
  carrying it"). What it is actually failing on, measured on run 35423439012 against a
  published 0.51.1 and none of it #1438:
  - **darwin-arm64 — 7 of 655, six of them FIXED in the tree and waiting on a node-gi
    release.** They were one node-gi defect with two halves, neither darwin-specific (this
    probe is simply the only place the React Native suite runs on node-gi). A JS `vfunc_*`
    override received its GObject arguments as raw engine handles (`gi.js`), which is the
    five `t.get_ancestor is not a function` in the rail's `RailLayout.vfunc_measure`; and
    the addon's vfunc trampoline never wrote OUT parameters back, so GTK read 0 for every
    size that override answered — the sixth, `Expected 0 to be greater than 0`. The gi.js
    half reaches the probe immediately; the C++ half needs the next published
    `@gjsify/node-gi`, and until then the same six stay red as size mismatches. Measured
    on a real macOS 27 arm64 host: 649/655 on the published addon, all six green on a
    locally built one (test: `packages/node-gi/node-gi/test/vfunc-out-params.test.mjs`).
    The seventh, a GTK diagnostic under `tabs` on the `Adw.ViewSwitcher` moving to a
    bottom bar, did not reproduce on that host.
  - **darwin-x64 — no count at all.** The runner exits 1 with no summary line, dying after
    `AppRegistry — the window the bootstrap builds (#1546, #1549) › publishes the window
    chrome`. A different and worse shape than arm64's seven, and not attributed.

  Whoever picks this up: re-measure arm64 once a node-gi release carries the vfunc OUT
  write-back, and the x64 death needs a local reproduction before it can be counted as
  anything.
- `gtk-host-probe` (win32) — condition: *the table stops offering Unix-only rows on a
  Windows host*. Blocked on the entry above (#1446); unchanged, now spelled as `tree-lacks`
  clauses over `src/generated/widgets.ts` plus `issue-closed 1446`.
- `rn-probe-win32` — needs #1446 as well as the release, plus the two POSIX-shaped image
  assertions attributed in the workflow header (`get_path()` answering the NATIVE path),
  which are the suite's expectation and not a win32 defect. Its release clause is MET and
  kept, because a met clause is how a conjunction shows which half is left.


### Nothing runs `build:infra` on a cold tree with no `node`

The bootstrap ADR 0002 documents — `gjs -m install.mjs` → `gjsify install
--immutable` → `gjsify run build:infra` — used to die at its THIRD step on a host
with no `node`, from a fresh clone. Measured 2026-08-19 on postmarketOS v26.06 /
aarch64 (OnePlus 6T, gjs 1.88.1, musl, no node) against `3ad411530`, in a
`git worktree` with no `lib/esm` anywhere:

    gjsify run --node-script: failed to bundle …/create-gjsify/scripts/process-template.mjs
    [@gjsify/create-app] gjsify run build exited with code 1

**Mechanism, and why the defect is closed.** `@gjsify/create-app`'s `build` runs
`node scripts/process-template.mjs`. With no `node`, `ensureGjsifyShimOnPath()`
re-enters the CLI as `gjsify run --node-script`, which bundles the script
`--app gjs` under `--globals auto` — and auto-globals RESOLVES a
`@gjsify/<pkg>/register[/…]` subpath per injected global (`--verbose` prints
`closure map expanded 1 → 21 global(s)` for a one-line `export {}` entry, spanning
`web-globals`, `abort-controller`, `buffer`, `web-streams`, `dom-exception`,
`formdata`, `perf_hooks`, `webcrypto`). In a cold clone the workspace copies have
no `lib/esm`, so every injection was unresolvable and `unresolved-workspace-import`
(correctly) failed the build. #1232 closed that: a TOOLCHAIN bundle now falls back
to the CLI's OWN directory once workspace resolution returns null. All 23 register
packages sit in `@gjsify/cli`'s transitive dependency closure, so a self-contained
install can answer — checked against `~/.local/share/gjsify/global`, where all 23
are present and built.

**What is still open is the MEASUREMENT.** No suite executes that third step.
`bootstrap-cold-tree` asserts the `--print-plan` BRANCH and exits without
spawning; `node-free-bootstrap` covers the install and a manifest invariant;
`node-script-cold-workspace` (#1232) drives the real `--node-script` path against
ONE planted unresolvable package rather than a whole cold tree. Every CI host has
`node`, so these scripts run natively and are never bundled at all. Until a leg
really runs `build:infra` on a tree with no `lib/esm` and `node` off PATH, the fix
is argued rather than observed — and the failure returns unseen.

It is worth recording what this is NOT, because both wrong turns were taken once.
It is not a `build:infra` ORDERING bug: `create-app` is merely the first
`node scripts/*.mjs` the chain reaches, and the same failure hit
`check-refs-pin.mjs`, so `build:prebuilds` could not start either. And it is not
fixable by dropping the EXPANDED half of the closure set — `auto-globals.spec.ts`
("closure-map expansion vs generator bypass") pins that the expansion is a seed the
pure iterative loop reaches anyway, so an expanded global is one the injected
register genuinely references. Dropping it trades a build error for a runtime
`ReferenceError`.


### No CI leg ever LAUNCHES a template on node, bun or deno

`gjsify.example.runtimes` on the seven templates declares four runtimes, and
`run.ts:238` validates `--runtime` against exactly that list, so the declaration
has teeth for the user and none for us. The BUILD half is now machine-checked (a
static case in `tests/e2e/create-app/run.mjs` holds every template to the
dependency closure its `--globals` list implies, which is what caught the pnpm and
Deno build failures). The LAUNCH half is still hand-verified: all sixteen
template x runtime combinations were run by hand, and one was confirmed end to
end, a deno-built `adw-canvas2d` with a real mapped toplevel.

Why nothing covers it today: `scripts/showcase-smoke.mjs` derives its matrix from
`packagesUnder(showcases/)` with `BOOTSTRAPPED_COLUMNS = ['gjs']`, and templates
are not under `showcases/`; `verify-package-outputs.mjs` skips them because all
seven are private. The two ways to close it, teaching showcase-smoke to derive
from `templates/` as well, or adding twelve GUI launch legs to the create-app
e2e, are both CI-matrix work with real flake surface: private D-Bus, Xvfb, dwell
timers, runaway GUI processes.

Deferred rather than half-built, and the two halves are not equally urgent: the
build half had a live blocker behind it, this one has a verified-true claim.


### Two CI comments still say rolldown-native has no Apple target

`.github/workflows/main.yml:736-739` says it "does not compile for Apple targets
at all (its Rust core wakes the GLib loop with `eventfd(2)`)", and
`prebuilds.yml:1029-1040` lists it under "WHAT IS DELIBERATELY NOT HERE" as "not
in the REQUIRED matrix". Both are contradicted by `prebuilds.yml:1225-1570`, where
`build-prebuilds-macos` builds, stages and load-tests it on both darwin arches
with `exit $rc`, and by `prebuilds.yml:1701`, which records the promotion and says
the load test was made FATAL there.

The website prose that repeated this has been corrected, so a reader is no longer
misled. These are the upstream source of that claim, and a stale comment is how it
grows back. Left for a commit of its own because both files path-filter CI job
selection, and editing them from a docs branch is churn where it is riskiest.


### A timed-out `describe` can still register a hook, and it lands on its parent

`@gjsify/unit` scopes `beforeEach`/`afterEach` per `describe` (#1554): a frame is pushed on
entry and popped when the body returns. A body that TIMES OUT does not return — `withTimeout`
rejects the wrapper, and nothing cancels the body, because a promise cannot be cancelled. So
the frame is popped while the body is still running, and a hook it registers afterwards lands
in whatever frame is current by then, which is the parent's.

**Measured**: a describe with `suiteTimeout: 40` sleeping 150 ms and registering its hooks
after the sleep — a later sibling test then logged `["LEAKED-before", "n-body", "LEAKED-after"]`.
Same symptom as the incident that motivated the scoping (an innocent neighbour), narrowed to a
suite that is already failing.

**Why it is not simply fixed.** Routing a late registration back to the describe it was
written in needs async context — `AsyncLocalStorage`, which lives in `@gjsify/async_hooks`, a
package `@gjsify/unit` may not depend on (tier direction, ADR 0003). A `closed` flag on the
frame does not help: the late write does not target the popped frame, it targets the parent.
What WOULD work is refusing to register into any frame once a timeout has been seen, which
trades a leak for a silently dropped hook — the same class, in the other direction.

The run is red and names the timed-out suite either way, so the cost is a confusing extra
failure rather than a silent one.


### Which `node scripts/*.mjs` calls are UNMEASURED on a Node-less host

The shim is indiscriminate WITHIN its scope: on a host with no `node`, EVERY
`node <file>.mjs` in every package script now re-enters the CLI (the CLI's own
internal spawns are deliberately out of reach — see `nodeShimDir`). That is right
for the build chain, whose four scripts are measured. It says nothing about the
rest, and some of them cannot work there at all:

| Call site | Expectation |
|---|---|
| `scripts/stage-prebuild.mjs` (13 sites), `scripts/check-refs-pin.mjs` (3) | plain `node:fs`/`node:path` — should work; reached only from `build:prebuilds` / `build:meson`, which need meson + a compiler anyway, so nobody has run them on such a host |
| `packages/node-gi/**` `scripts/{install,stage-prebuild,gimarshalling,conformance,cross-runtime}.mjs`, `packages/napi/napi/test/*-gate.mjs` | CANNOT work, and should not: they drive node-gyp or EXIST to exercise node/bun/deno. The shim will bundle them and they will fail further in — a worse message than "no node" |
| `packages/node-gi/gtk-runtime-*/scripts/build-gtk-runtime*.mjs` | assemble the darwin/win32 GTK bundles; those hosts have Node |
| root `install-git-hooks` | runs on a fresh clone BEFORE the CLI exists, so the shim is not on PATH yet either way |
| `.release-it.json` hooks | release-it is a Node program; its hooks run inside it |

Worth deciding rather than discovering: whether the shim should REFUSE for the
second row (a name-based deny-list is ugly; a `gjsify.nodeOnly` manifest flag is
honest) or whether "fails further in" is acceptable. Nobody has hit it yet
because every host that runs those has Node.


### `showcases` is 193 comment lines over its ceiling, and always was

`check-comment-budget.mjs` globbed `'*.ts' '*.mts' '*.mjs' '*.js' '*.cjs'` — a list
written before this tree had a `.tsx` file in it — so it never opened the 19 tracked
ones. Reading them changes two rows, and both numbers are what those trees have had all
along:

- **`showcases` 0.153 → 0.170** against a ceiling of **0.158**, which had been printing
  78 lines of SPARE. Seven files: the four host-counter / gallery apps and the three
  `rn-design-system` modules, 2434 code lines carrying 657 comment lines.
- **`packages/framework` 0.344 → 0.352** against 0.244. Already over before; the 12
  `gtk-host/type-tests/**` files add 114 code lines and 402 comment lines, a ratio of
  3.5 — a type-test is mostly prose about what `tsc` has to reject, which is the material
  a whole-tree ratio suits least.

**The ceiling was not raised, and `--update` cannot raise it** (it writes
`min(stored, measured)`). The gate REPORTS rather than gates: `--warn`, which is what CI
runs, exits 0 over an above-ceiling tree, so the honest number is what landed and
`showcases` now raises an Actions warning it did not raise before. Closing it means
cutting genuine restatement in those seven showcase files, or deciding a showcase's job
IS to be commented and saying so in a reviewed ceiling change. Not by moving full-line
comments onto code lines — the script's own header records that ~1670 trailing comments
are already invisible to it, so that direction buys a number and no clarity.


### Manifest-conformance follow-ups

The five standalone declaration-vs-reality scripts are now one rule registry (`@gjsify/manifest-conformance` + `scripts/manifest-conformance/`). Three things were deliberately left out of that refactor so it stayed a refactor.

- **`gjsify manifest-check` is designed but not shipped.** The portable rules (`package-outputs`, `prebuild-artifacts`, `headless`, `field-coverage`) are already extracted into a package with a hand-written `lib/index.d.ts`, so the command is a thin wrapper over `selectRules({ scope: 'portable' })`. It was held back because it carries two costs a refactor must not smuggle in: the package has to flip from `private` to published, which needs the manual first-publish + Trusted-Publisher bootstrap BEFORE the next release train, and adding a command rebuilds `dist/{cli,affected}.gjs.mjs`, coupling the change to the committed-bundle gate. The name is settled: `manifest-check` — a sibling of `system-check` (machine has what the project needs) and distinct from `check` (types compile). Evidence it is worth doing: downstream consumers already declare `gjsify.storybook` (buchhaltung, pixel-rpg/map-editor) and `gjsify.prebuilds` (buchhaltung's ERiC package, which declares a prebuilds directory with NO `gjsify.platforms` — a hard failure in this repo, unchecked in theirs).
- **Five `gjsify.*` declaration kinds have no rule** and are deferred with a written reason in `scripts/manifest-conformance/unchecked-fields.mjs`, printed on every audit run. All four remaining are judged unverifiable-by-construction (`defineFromPackageJson`, `flatpak`, `buildCache`, and `nativescriptPlatforms` until there is a per-platform artifact to compare against). The one entry that was a real FINDING — `gjsify.storybook` — is CLOSED: the portable `storybook` rule now resolves the declared directory the way `gjsify storybook` does and fails a path that does not exist or holds no `*.story.*`. Its ledger wording had gone stale as well: the 'empty browser, not an error' shape is the pre-#879 behaviour, when a bare `process.exit(1)` was deferred under GJS and the no-stories path fell through into the build and exited 0. That incident moved into the rule's header rather than being deleted with the entry. `gjsify.main` and `gjsify.example` left the ledger when `package-outputs` claimed them.
- **`gjsify pack`'s own shipped-vs-declared guard is still types-only, and the same `private` flag is why.** `assertTypeDeclarationsShipped` refuses to pack a `types`/`typings` file it can see but would not ship (the #655 guard) — the right place, because it fires at the moment of packing and protects CONSUMER trees too. The superset (every declared entry point, not just the type fields) lives in `scripts/verify-tarball-outputs.mjs` instead, because it needs `declaredPaths()` from this package and a published `@gjsify/cli` cannot depend on a `private: true` one — the same blocker as `gjsify manifest-check` above, and it closes with the same npm bootstrap. Measured gap while it stands: narrow a package's `files` so only `lib/esm/register.js` is excluded and `gjsify pack` exits 0 and writes a tarball whose declared `exports["./register"].default` is absent (13 type files shipped, so the existing guard stays quiet); the script catches it. Fold the script's check INTO the packer when the package is published, and keep the script as its repo-wide sweep.


### Toolchain hygiene follow-ups

- **A repo-relative path spelled in the HOST separator — CLOSED.** The entry asked for "either a documented rule … or a helper the call sites must go through"; both now exist. HELPER: `posixRelative()` / `toPosixPath()` are exported from `@gjsify/manifest-conformance`, so the one rule every repo-relative path in this tree depends on has exactly ONE definition — `audit-runtimes.mjs`'s local `toPosixRel` was byte-identical to `context.mjs`'s normalisation and is now an alias of the shared one. RULE: `docs/code-anti-patterns.md` carries it with both incidents intact (`classifyAxis` reading a `\`-separated path as a single segment, so five infra packages were reported as missing a declaration they must not carry; `platforms-ci` compiling a `\`-separated path into a regex in which `\n` is a NEWLINE, so node-gi's macOS leg read as a declared platform CI never builds) — both red on win32 and green on Linux for the same commit. The five `scripts/` sites that used the `replaceAll` spelling now go through the helper; that spelling is not merely uglier but WRONG, since a backslash is a legal POSIX filename character, so it trades a Windows bug for a POSIX one. Deliberately NO separate check watching for a raw `relative()`: a guard watching another mechanism is the named smell, and it could not distinguish a display string (where the host separator is arguably right) from a value about to be split. `windows-suites.yml` is what would catch a re-break, this whole class being invisible from Linux.

- **Testing "on Windows" from git-bash reports false greens, and nothing enforces the distinction.** Git for Windows puts `C:\Program Files\Git\usr\bin` on PATH, which supplies a real `chmod`, `cp`, `rm`, `sed` and `which`; every process spawned from that shell inherits them. npm, however, runs package scripts through `%COMSPEC%` (cmd.exe), where none of those exist. The two disagree on the same tree at the same commit — measured: `gjsify run build:infra` completed under git-bash and failed at `@gjsify/create-app` under cmd.exe, and `detectPackageManager()` in `utils/check-system-deps.ts` probes with `which`, which is ENOENT under cmd.exe (it returns the honest `unknown` there, but by accident rather than by construction). Any Windows claim therefore has to name the shell, or it means nothing. The reproducible check is to strip every `\Git\` entry from PATH and drive the command through `%COMSPEC%`; that is what the measurements behind 293a9a1 and this entry used. Worth a scripted harness in `tests/` if a Windows CI leg ever lands, since the runner images have Git on PATH too.

- **"744 files are committed with CRLF" — CLOSED, and it was NOT true at the commit that recorded it.** The entry claimed a fresh `git -c core.autocrlf=true clone --depth 1` reports 744 modified files immediately, by a mechanism it also stated: *"those blobs already contain CRLF"*. Re-measured on the win11-gjsify VM at `main`, two ways that agree:
  - **no tracked blob contains a CR byte at all.** `git grep -I -l $'\r' HEAD` → 0 of 4778 files; `git ls-files --eol` → 4294 `i/lf`, 381 `i/-text`, 95 empty, 8 `i/none`, and **zero** `i/crlf` or `i/mixed`.
  - **the reproduction produces nothing.** `git -c core.autocrlf=true worktree add --detach <tmp> HEAD` followed by `git -C <tmp> -c core.autocrlf=true status --short` → **0 modified files**, over all 4781 entries.

  The stated mechanism REQUIRES CR in the blobs, so with zero CR blobs it cannot occur — the two measurements are not independent confirmations, they are the claim and its precondition, both absent. Nothing in the history between then and now renormalises anything (`git log --all --grep` over renormal/line-ending/crlf/eol finds only the doc commits themselves), so the original measurement was most likely taken against a working tree rather than the index. Recording that here rather than deleting silently: the entry was about to justify a repo-wide `* text=auto` + `git add --renormalize .` sweep, a project-wide policy change with a one-time 744-file diff, and **that work does not need doing.**

  What remains TRUE and is worth keeping: `.gitattributes` (a9fa31a) pins the byte-verified artifacts with `-text`, and that is load-bearing — `core.autocrlf=true` would rewrite them and `verify-committed-bundles.mjs` would report them stale for files nobody touched. Since ADR 0002 untracked both `*.gjs.mjs` bundles the exposure is smaller, but `packages/infra/tsc/lib/**` and the prebuild payloads still need it.

- **`release.yml`'s two `napi-prebuild-*` legs staged by hand — CLOSED.** Both now call `node ../../../scripts/stage-prebuild.mjs .`, so the release path gets the extension match and `checkPrebuildDir()` like every other staging site, and `tests/e2e/prebuild-change-gate` scans `release.yml` too — the exemption cannot come back. The same change added the load test those legs were missing: they ended at `cp` + `upload-artifact` while `publish-napi` checked four files with `test -f`, so nothing proved a released artifact could be opened. Landing it after a release, not beside one, was the reason it waited.
- **Nine fixtures re-implement the prebuild-target name instead of importing it.** `resolvePrebuildDirName()` / `prebuildDirCandidates()` (`packages/infra/cli/src/utils/detect-native-packages.ts`) are pure functions and already the single source of truth for `prebuilds/<os>-<arch>/` — but every e2e that needs that directory composes the name itself, and several translated `process.arch` into the `uname -m` machine on the way. The `<os>-<arch>` unification had to fix all nine by hand, and one (`tests/e2e/self-host/run.mjs`) was missed on the first pass precisely because the composed string never appears as a literal. Export a small test helper (or let fixtures import the CLI's built `lib/utils/detect-native-packages.js` directly, the way `tests/e2e/dlx-native-prebuilds` already imports `run-gjs.js`) so the name has exactly one definition, and delete the per-fixture copies. Until that lands, any change to the target vocabulary must be swept for BOTH shapes — the literal path AND the computed one.


### CI coverage follow-ups

- **`prebuilds.yml` covers every Linux target on a PR; `darwin-arm64` is still proven for the first time AFTER the merge.** The workflow runs its BUILD legs on `pull_request` (native x64 + arm64 and the ppc64/s390x/riscv64 QEMU legs, Vala *and* the three Rust bridges — the break that motivated it, #827, was in the Rust dependency graph). Under real qemu-user (10.2.2, ppc64le): dependency install ~6 min, the Vala/GI packages compile in minutes; `@gjsify/lightningcss-native`'s Rust cdylib is the one expensive step — if a leg's total makes it the PR critical path, drop THAT package from the emulated legs rather than the architecture. `build-prebuilds-macos` remains the one PR-skipped leg (10x billing + the shared macOS concurrency pool); label a PR `ci:macos` to opt in. `prebuilds-summary` names the skipped legs per run. Closing the macOS gap permanently means either paying 10x per PR or a nightly full-matrix run. Pairs with the "nothing byte-compares a committed prebuild against a CI-built one" item below.


### Cross-runtime reachability follow-ups (ADR 0014)

- **Nothing byte-compares a committed prebuild against a CI-built one.** `scripts/check-refs-pin.mjs` (wired into every `build:meson`) catches the three ways a locally-built native artifact diverges from its pinned source — checkout drift, version skew against the npm engine, and a stale `build/` dir ninja will not invalidate. What it cannot catch is a binary that was simply never rebuilt: the `rolldown-native` prebuild had drifted BEHIND its pin for an unknown number of commits and only surfaced when a rebuild finally happened. Close it by having `prebuilds.yml` rebuild and diff the committed artifact (or publish the CI-built one as the source of truth and stop committing hand-built binaries).
- **Three browser bundles are ledgered as NON-GATING in the `browser` CI job.** The axis runs (`main.yml` `browser` job: Playwright/Firefox over the bundles the Fedora `build` job stages, 51 discovered, 48 gating-green), but `$BROWSER_PROBE_GREP` carves out three that were red the moment it was first executed. (a) **`@gjsify/events`** and (b) **`@gjsify/util`** both declare `src/test.browser.mts` as `export * from './test.js'` — re-running the GJS/Node spec files in a browser, which AGENTS.md explicitly forbids (`events` hangs; `util` dies on a bare `process.env` read in one spec). (c) **`@gjsify/web-streams`** feeds STRING chunks into `new Response(stream).text()` in three cases; per the Fetch spec a body stream must yield `Uint8Array`, and Firefox enforces it where Chromium and undici are lenient — the spec needs `TextEncoderStream` in front of the `Response`. **The same forbidden `export * from './test.js'` shape is in 11 packages** (`assert`, `async_hooks`, `buffer`, `constants`, `diagnostics_channel`, `events`, `path`, `querystring`, `string_decoder`, `sys`, `util`); the other nine pass only because their specs happen to be pure logic. Rewrite all 11 to browser-globals-only entries, then delete the ledger.
- **`@gjsify/worker_threads` ships a `src/browser.ts` with NO browser-axis test coverage.** No `index.browser.spec.ts` backs its `test.browser.mts`, so nothing ever asserted against that entry — which is how the exported `workerData` stayed permanently `null` (fixed, found by reading rather than by a failing test). `@gjsify/zlib`, `@gjsify/vm` and `@gjsify/http` show the pattern to copy. Worth doing before the package is considered for `partial` → `polyfill`, since export parity alone would have passed that bug.
- **The ten `browser:"partial"` slots are RESOLVED as partial — the residual work is per-package, not a slot sweep.** All ten were audited against the `platform-entry-parity` gate; none is promotable, because in every case a NAMED export is unavailable on the browser platform itself (the blocking export per package is recorded in each package's status entry / AGENTS.md row). Parity is necessary but not sufficient — it passes `sqlite`, whose `DatabaseSync` throws from its constructor; treat a green parity gate as permission to look, not a mandate to promote. Still open, per package: **`fs`** — close the 34-export gap over the in-memory `Volume` (does NOT unblock promotion while `FSWatcher` is a never-firing stub); **`sqlite`** — add a `./browser-worker` subpath declared `polyfill` backed by OPFS `createSyncAccessHandle`, leaving `./browser` at `partial`; **`ws`** — the only one of the ten without a `src/test.browser.mts` (its browser entry is 93 LOC; a small spec asserting the `WebSocketServer` ENOTSUP shape + CJS-compat statics closes it); **`crypto`** — only 2 of its 25 root modules have a platform dependency (`GLib.Checksum` in `src/hash.ts`, the `imports.gi` fallback in `src/random.ts`); replacing those makes the ROOT browser-clean with full synchronous Node semantics — the one path that would actually earn `polyfill` — and retires the 1,774-LOC `src/browser/` duplicate.
- **The `native` runtime slot means two different things, and the NativeScript bridge packages use the wrong one.** The routing rule reads `native` as "the RUNTIME provides this API — resolve to `<pkg>/globals`", but `packages/nativescript-bridge/*` declare `nativescript: "native"` in the sense "this package IS the native implementation". None of them ships a `globals.mjs`. The SHIPPING half of this is fixed: the missing-`globals.mjs` fallback no longer rewrites to `@gjsify/empty` (which had made `--app nativescript` unable to build the bridge tree at all — held now by e2e `ns-bridge-bundles`), it leaves the specifier alone and keeps the warn-once. What remains is the VOCABULARY: the declaration still says the opposite of what these packages mean. It also blocks `ALIASES_NODE_FOR_NATIVESCRIPT` from being composed through `withDerivedSlotRouting`. Fix by settling the vocabulary (either a new slot value for "this package is the runtime-native impl", or re-declaring the five as `polyfill`) — an ADR-sized decision because it changes a published `package.json#gjsify.runtimes` contract and `scripts/audit-runtimes.mjs`. Compose the NS table in the same change.
- **23 `native` slots ship a `globals.mjs` NARROWER than their root entry — 152 export names that are a `MISSING_EXPORT` waiting for a consumer.** A `native` slot routes the package ROOT to `@gjsify/<X>/globals`, exactly as `polyfill` + a declared subpath routes it to `src/<target>.ts`, so the `platform-entry-parity` invariant applies verbatim — and nothing checked it: the `globals-broken` probe only validates the `export … from '<spec>'` SOURCES a `globals.mjs` names, so every hand-written `export const X = globalThis.X` file passed it vacuously. Found when a `--app browser` build of `@gjsify/gamepad`'s OWN README example died with `"hasGamepadBackend" is not exported by "packages/web/gamepad/globals.mjs"`. `audit-runtimes --check` now REPORTS the whole set every run (`globals-entry-parity`, check 5 in `auditReachability`); making it fatal is a separate, cross-cutting change (AGENTS.md exception (c)) because the tree cannot pass it today. A further 17 packages are deliberately NOT compared and the skip is printed with them: their `globals.mjs` star-re-exports a runtime module (`export * from 'node:util'`), which surfaces the whole runtime surface and is not statically enumerable — reading those as gaps was the first version of this check crying wolf on 17 packages that are in fact complete, and `tests/e2e/runtimes-routing` disproves it by importing `format`/`inspect` through exactly that file. The skip carries a residual blind spot: a `globals.mjs` that stars a runtime module AND has a root export that module does not carry is skipped too, so a real gap there is invisible. Closing it means asking the runtime for the star target's export set — runtime EVALUATION, which `audit-runtimes` deliberately does not do (it must not crash on a browser-only re-export), so it needs its own decision rather than a quiet widening of this check. Two shapes hide in the remaining 152, and only one is a re-export away: names the RUNTIME provides (`@gjsify/assert`'s `strictEqual` from `node:assert`, `@gjsify/webcrypto`'s `Crypto`) versus names it does not (`@gjsify/gamepad`'s Manette→W3C mapping tables) — no `globals.mjs` in the tree imports its own package body, so the second shape needs a platform entry, i.e. a slot decision, not a line in `globals.mjs`.
- **The `keepNames` helper `__name` is CALLED before it is declared in the `@gjsify/module` node-gi bundle.** With `output.keepNames = true` (gjsify's default whenever `minify` is on) the `--app node` bundle calls `__name(load$1, 'load')` inside the `\0gjsify-gi-node:*` virtual module that is ordered first, while the declaration lands roughly nine kilobytes later; `var` hoisting makes the early call `TypeError: __name is not a function`. `--minify false` emits no `__name` at all and gets past it.

  **Re-measured 2026-09-03 and it STILL REPRODUCES**, against resolved `rolldown@1.1.4`, `@rolldown/binding-linux-x64-gnu@1.1.4` and `@gjsify/rolldown-native@0.45.0`: `node scripts/node-gi-consumer-harness.mjs @gjsify/module --runtimes node` builds a bundle whose first `__name(` sits at byte 448 and whose `__name=` declaration sits at byte 9965, and running that bundle on node throws `TypeError: __name is not a function` verbatim. Both engines agree — the npm crate under the Node CLI and `@gjsify/rolldown-native` under the GJS CLI emit the same ordering — so the engine is not the discriminator the `refs/rolldown` framing below implies. Repeated identical builds are not byte-reproducible (the determinism entry above carries that measurement); the ordering fault is in every variant.

  **The old title named the wrong layer, and that is how a careful re-measurement can miss this.** Rolldown does not emit the helper into a chunk prelude: `keepNames: true` driven straight against its JS API over synthetic graphs — plain named functions and classes, deep import chains, CJS interop, an external-first module, code splitting — emits no `__name` anywhere. The helper is a MODULE. Each library build writes `lib/esm/_virtual/_rolldown/runtime.js` declaring `__name`, the package entry imports it for side effect, and no built library calls it — a side-effect import with no side effect, the shape AGENTS.md already names. So the ordering at fault is ordinary module order in the APP build, and the reproducing condition is not "a `gi://` import plus a bare `print()`" but the harness's own entry: `src/test.node-gi.harness.mts`, generated from `test.mts` with the `print(…)` inject trigger, built with `--alias node:module=…`. Building `src/test.mts` directly instead yields a bundle with the declaration at byte 325, its sole call at byte 19404 and no gi-node virtual module in it at all — correct order, and not this entry's reproduction. That bundle has already been mistaken for this one once.

  Next: file the reproducer against the layer that actually owns the fault. An upstream issue phrased as a rolldown `keepNames` bug will not reproduce, because rolldown emits no helper on its own; the open question is why the app build orders a `\0gjsify-*` virtual module ahead of the helper module it depends on. The pin (`refs/rolldown` `v1.1.4`, lockstep with `@gjsify/rolldown-native`) may not need to move at all.


### Two e2e suites still owe the shared harness, for different reasons

Sixteen of the twenty suites that stood up a private `node:http` registry now use
`startMockRegistry`, and `check-e2e-harness-duplication.mjs` has a
`registry-server` rule so a twenty-first copy fails. Its ALLOWED ledger is
self-retiring, so each remaining entry has to be answered rather than forgotten.

**`install-script` — the registry half is deferred, not exempt.** Its subject is
the bootstrap downloader (SHA-256 digest routes, the content-addressed cache, the
retry on a dropped connection), which `onRequest` expresses; the packument
registry beside it is ordinary and would migrate with no option at all. It was
NOT migrated because it could not be verified: on the workstation the migration
was written on, two of its nine cases fail before any change, with
`No version of @gjsify/cli satisfies 0.0.99-test` from a run that has its own
`XDG_CACHE_HOME`, its own global prefix and its own registry. CI is green on
`main`, so this is local — but a migration verified only by "the same two still
fail" is not verified, and that is the whole reason the other sixteen were
believed. Find the local cause first; the migration is then mechanical.

**A SECOND duplication class sits in the same files and is deliberately not
ruled on yet.** A spawn-and-collect helper — `runChild` / `runHarness` — is
`runCli` minus the hardcoded CLI entry, and appears in eleven suites, only five
of which were in this migration. `native-install`'s copy genuinely cannot fold
in: it runs a temp harness file with `--no-warnings`, not the CLI entry. So the
fix is a shared `runNode(file, args)` that `runCli` itself delegates to, and a
checker rule for it would touch six suites unrelated to the registry work —
which is why it is a task and not a line in that PR.


### oxlint native path — deferred (JS-plugin host needs Node)

`gjsify lint` still spawns the npm `oxlint` Node launcher even under GJS. A `@gjsify/oxlint-native` GI bridge (mirroring `@gjsify/oxfmt-native`) could only run the Rust rule subset: the JS-plugin host that executes `.oxlintrc.json` `jsPlugins` (the internal `gjsify/register-class-order` rule) lives in the Node launcher, so a native lint would silently skip that rule — a worse failure mode than requiring Node. Options when picked up: (a) native lint as an explicit opt-in subset (`GJSIFY_OXLINT=native`, warn when jsPlugins are configured); (b) port `register-class-order` to a Rust rule upstream; (c) wait for oxlint's plugin host to become embeddable without Node. Until then: `gjsify format`/`fix`'s oxfmt half is Node-free under GJS, `gjsify lint` (and the oxlint half of `fix`) needs Node.


### A scaffolded workflow is read by actionlint, and a registry keeps it that way

Item 9 of the `gjsify ship` roadmap, closed. `gjsify flatpak ci` writes a GitHub Actions
workflow into somebody ELSE's repository and four `assert.match` regexes over raw text were
the only thing that had ever looked at it — never parsed, never actionlint'd, never run.
**Measured on the real scaffolded `flatpak.yml`, one mutation each (actionlint 1.7.7), where
"yaml" is the plain `YAML.parse` a hand-rolled structural check would be built on:** unclosed
`[` in `branches:` — both refuse; `runs-on:` → `runs_on:` — actionlint refuses, YAML accepts;
`actions/checkout@v4` stripped of its ref — actionlint refuses, YAML accepts; `github.sha` →
`github.shaX` — actionlint refuses, YAML accepts; `jobs:` → `jbos:` — actionlint refuses,
YAML accepts; `on:` → `onn:` — actionlint refuses, YAML accepts; an unterminated `if` inside
a `run:` block — **both ACCEPT**. All four original regexes still match every one of those
seven documents, because each asserts a substring the mutation does not touch.

Two things that follow, and both are in `scripts/check-scaffolded-workflow.mjs`. A YAML parse
alone catches one of seven, so structural assertions of our own would be close to the vacuum
they replace — actionlint is the reader, for the reason `audit-runtimes.yml` already gives
about this repo's own workflows. And actionlint is BLIND to the last row, because it runs
with `-shellcheck=` empty and parses workflow syntax rather than the shell inside `run:` — so
the chain is two readers and neither is redundant, the second being the existing
`check-workflow-run-syntax.mjs --root`, reused rather than reimplemented. `flatpak ci` emits
no `run:` block today, which makes that reader vacuous ON THIS SCAFFOLDER and not on the
class; the ledger's minimum bar for `ship ci` was `bash -n` on every extracted `run:` block,
and it is already wired for the day `ship ci` exists.

**Three traps worth not rediscovering.** (1) `actionlint` with no file arguments discovers
workflows by walking a GIT REPOSITORY — pointed at a scratch directory it exits 3 with "no
project was found in any parent directories", so generated output must be passed as an
explicit file path (`git init` also works and costs more). (2) `bash -n` accepts
`if [ -z "$x" ; then echo hi; fi`: a `[` missing its `]` is a RUNTIME error from the builtin,
not a parse error, so the first negative control here proved nothing and had to be replaced
with an unterminated `if`. (3) The coverage scan's first version read raw source and named
`utils/gjsify-shim.ts`, which merely mentions `.github/workflows/release-cut.yml` in a prose
comment — comments are stripped before the grep now, because a rule that cries wolf earns an
exception list and an exception list is where the real scaffolder eventually hides.

**What is NOT closed, and it is worse than "one of the two readers is missing".** `actionlint`
is on no runner image this repo uses and in no `dnf install` in `.docker/ci-fedora.Dockerfile`.
Without it NOTHING reads the scaffolded document: the other reader parses the shell inside
`run:` blocks, `flatpak ci` emits none, so it reads zero of them and exits 0. Measured — on
such a host the pair prints OK for a `flatpak.yml` whose `runs-on:` is misspelled `runs_on:`,
which is the defect this whole exercise exists to catch. So the document test sits behind
`e2eSkipReason('flatpak', …)` and SKIPS there instead of reporting a pass: a skip is visible in
the shard output, a green assertion that read nothing is not (#1550). Two ways to make it RUN,
in increasing cost — add the pinned + checksummed actionlint download `audit-runtimes.yml`
already carries to `main.yml`'s `e2e` job and name the suite in `GJSIFY_E2E_REQUIRE`; or put
actionlint in the CI image, which must be its OWN PR because `build-ci-image.yml` publishes
only on a push to `main` and a PR that adds the tool and hard-requires it in one step can never
go green (the trap `msitools` hit in #1354 M5). Until one of those lands, the leg that really
runs is a developer with actionlint on PATH, plus `--coverage`, which needs no tool at all.


### The baked CI image is `linux/amd64` only, so three arm64 jobs still `dnf install` every run

`build-ci-image.yml` publishes `ghcr.io/gjsify/ci-fedora:<major>` for
`platforms: linux/amd64`, with the comment "When we add aarch64 runners we'll
grow this list". They were added. Three jobs run on `ubuntu-24.04-arm` —
`node-gi.yml/arm64`, `prebuilds.yml/build-prebuilds` (arm64 leg) and
`release.yml/node-gi-prebuild-linux` (arm64 leg) — and have no image to move to,
so each still pays a full `dnf install` from Docker Hub on every run. One of the
three is on the RELEASE path.

That cost is not hypothetical: during the v0.26.0 sweep `napi` failed outright
when `docker pull fedora:44` timed out against registry-1.docker.io three times
before the container existed, and the storybook bundle job was killed by its
45-minute timeout TWICE with ~41 of those minutes inside a single `dnf install`
— a step whose normal cost is 22 seconds. Neither failure had anything to do
with the code; the same commit was green on the PR.

The earlier version of this item claimed the switch needed a SECOND baked image
because "several of these jobs are minimal ON PURPOSE (the Node-free install
proof, 'no system GTK' conformance)". That premise was checked and is FALSE —
every one of them installs gjs and the GNOME devel set itself, and no job
asserts that a system library is absent. Ten of the thirteen have since switched
to the one image with no property lost.

Remaining work is therefore a single edit with a real cost attached: add
`linux/arm64` to that `platforms:` list. Building it under QEMU on an x64 runner
would be slow enough to matter for a weekly cron plus every Dockerfile PR, so
the shape worth measuring first is a native `ubuntu-24.04-arm` build leg joined
into one manifest. Nothing needs to be remembered afterwards:
`scripts/check-ci-image-packages.mjs` DERIVES the exemptions from the published
arch list, so widening it turns all three from "excused" into "must switch" on
the next run, and its hand-written ledger is already empty.


### A gate whose fixture reads what the gated job writes — SECOND instance

`gate-pushed-tree.sh` exists because `tests/e2e/platform-exemption-clearing`
seeded its fixture from a `gjsify.platformsUncommitted` value that the bot then
CLEARED, and `main` was red for every open PR for hours (f5d250b32, 2026-08-03).
The same shape reappeared inside the fix for it, and was caught in review rather
than in production: `tests/e2e/prebuild-declaration-invariant` copied the
missing-`.gir` ledger out of the checkout and asserted it had at least two
entries — while the clearing script that runs earlier in the same job exists to
reduce that file to `{}`. The first `main` run to land the ten `.gir` files would
have cleared all ten, failed the gate on the ledger it had just correctly
emptied, and discarded every downloaded binary. That fixture is hermetic now.

Twice is a class. What is missing is a check on the GATE LIST itself: no suite in
`gate-pushed-tree.sh`'s `node --test` list may read repository state that the
steps before it write (the two clearing scripts' outputs, the staged
`prebuilds/` directories, the manifests the generator rewrites). The awkward part
is that some of those suites read committed artifacts ON PURPOSE —
`prebuild-loader-path` asserts exact glibc floors of bytes this job replaces — so
the rule cannot be "fixtures may not read the tree". A first cut that would have
caught both instances: fail a gate-listed suite that reads a path the same job's
clearing scripts print on stdout, which is a set the job already computes.

**Measured 2026-08-16, before building it: the naive form of that cut is 3-for-3
false.** The mutated set is derivable without running anything — both clearing
scripts take `--dry-run`, and what they WRITE is fixed (`clear-satisfied-gir-gaps`
→ `scripts/manifest-conformance/prebuild-gir-gaps.mjs`; `clear-committed-platform-exemptions`
→ the package manifests). But matching those paths as strings against the five
gate-listed suites flags `platform-exemption-clearing`, `prebuild-declaration-invariant`
and `prebuild-change-gate`, and all three are hermetic: the two known instances were
FIXED by moving to synthetic trees, and a fixed suite still names the path it builds a
copy of. A check with a 100 % false-positive rate gets disabled, and then protects
nothing — `check-workflow-inline-scripts.mjs`'s header records the same lesson from its
own first draft ("23 findings, 21 false").

So the discriminator is not the path, it is the ROOT: a read anchored at the
repository (`MONOREPO_ROOT`, `ROOT`) versus one anchored at a tmpdir the suite
made. That is what the check has to see, and it is why this is not a grep.


### What still writes to `main` unverified, after the bot push got a gate

`commit-prebuilds` now runs the checks that read its own output on the tree it is
about to push (`Gate the tree being pushed`), which closed the incident where
f5d250b32 cleared `gjsify.platformsUncommitted` under a CI-skip directive and left
`tests/e2e/platform-exemption-clearing` red on every open PR for hours. A sweep
done while fixing it found five more holes in the same write path. THREE are now
fixed and deleted from this list: `packages/napi/napi-linux-x64/prebuilds/` is no
longer committed (it had no producer, so the honest shape was the
`gjsify.platformsUncommitted` entry its darwin sibling already carried); the
committed `.gir` files are validated on every target rather than only darwin; and
a rejected `git push` no longer discards the run's binaries. Two remain verified
reads with nothing done about them:

- **`download-artifact` MERGES and nothing prunes.** Each step extracts into an
  existing `prebuilds/<target>/` without clearing it, `git add` only adds, and the
  staging script's deletion refusal forbids removal — so a `meson.build` change
  that renames a library or drops a `.gir` leaves the stale file beside the new
  one, and `files: ["prebuilds"]` publishes both. One direction of the `.gir` half
  is closed (a directory with NO `.gir` now fails `prebuild-artifacts`); a STALE
  extra file is still silent, and that is the half this entry is about — no rule
  enumerates the expected file set, only its minimum.
- **`prebuild-artifacts`' dlopen probe degrades to a NOTE on `ubuntu-latest`,**
  which is the runner that gates the push: no libsoup3 / GStreamer / GTK4 /
  libepoxy, so the linux-x64 artifacts of http-soup-bridge, http2-native, webgl and
  webrtc-native are never actually loaded there. The gate proves declarations and
  file shape, not that an artifact loads.

Adjacent, same cause — and the release half is now CLOSED: `commitlint.yml` triggers on `push` to
`main` as well, so the release cut's direct `chore: release v${version}` commit is linted, which
matters because `@release-it/conventional-changelog` walks exactly those commits. The prebuild push
stays unlinted and NO trigger can change that — `[skip ci]` skips the workflow run itself, so
dropping it (the lever below) is the only route, and that is its own deliberate cost decision.

The one lever not pulled is **dropping the CI-skip directive from the prebuild
push**. Checked: it cannot loop (`prebuilds.yml`'s own `push` paths list sources,
meson files and scripts — not `packages/*/*/prebuilds/**`), and it would buy the
only coverage the new gate structurally cannot reach: the two specs that genuinely
LOAD a committed prebuild under GJS in `main.yml`'s `test` job. It costs one full
`main.yml` run per landing, which is rare. It detects rather than prevents, so it
is a complement to the gate, not a replacement — decide it deliberately.


### 13 integration suites are held out of the CI gate, each for a measured reason

The gate half now exists: `main.yml`'s `integration` job runs the measured-green subset on the
`run-integration` output the classifier had been emitting into a step summary and nothing else.
What remains open is the other 13 suites. This entry is what is left of "35 suites run on no
event" after the per-suite measurement that entry asked for.

MEASURED, per suite, in `ghcr.io/gjsify/ci-fedora:44` with a cold bootstrap (published cli →
`install --immutable` → `build:infra` → `build`, all green): 21 green with assertions executed,
13 held out, 1 (`devtools-cdp`) exiting 0 while asserting nothing. Sequential wall time for the
21 is under four minutes on a 20-core host; the CI runner has four cores, so the job is budgeted
at 20 minutes. Per-suite causes are recorded beside each suite in
`status/integration-coverage.md` — that file, not this entry, is where a suite's status belongs.

The blanket phrase this entry set out to test, "CI-incompatible preconditions", is retired: it
holds for four suites (podman for `autobahn`, an Android device for `nativescript`, the native
`node_datachannel.node` for `webtorrent`, `openssl(1)` for `tls-session`) and covered nine others
that had simply never been run and are failing. Of the four, only `tls-session`'s is retired —
`.docker/ci-fedora.Dockerfile` bakes `openssl`, and the suite rejoins `main.yml`'s `--include`
once `build-ci-image` has republished the tag; see its note in `status/integration-coverage.md`.

The remaining work, in the shape it should be done:

- **Six suites are genuinely red** — `axios`, `chalk`, `debug`, `mcp-typescript-sdk`,
  `ts-for-gir`, `undici` (`socket.io` is green again and back in the allowlist). One cause per
  commit, and each returns to the allowlist in the commit that makes it green. They were SEVEN
  causes, not one: a single shared defect was the
  first hypothesis and the measurement refuted it. Two of them (`chalk`, `ts-for-gir`) fail on the
  NODE leg, which by this repo's own rule means the test is wrong rather than the implementation.
- **`undici` should be looked at first, and at the BUILD rather than the suite.** Its failures
  read `me is not a function` — a mangled identifier reaching a call site is a bundling symptom,
  and if it is one it will not be confined to this suite.
- **`mcp-inspector-cli` needs no fix, only an ordering.** It reads an example's `dist`, which
  `build:examples` produces and `build` does not.
- **Do not delete `run-integration`.** Still true, and now for the opposite reason: it gates a job.


### This ledger goes stale silently, and the two obvious guards were measured and rejected

Two entries here — the `on('Display')` X11/Wayland gate and the DISPLAY-gated GTK
skips — described a tree that had not existed for days. `capabilities.ts`
(`canRealizeSurface`/`canRealizeGl`, #1133) and `node-gi`'s `test/display-gate.mjs`
had already landed the exact shape the second entry ASKED for, down to lifting the
copy-pasted predicate into one shared helper, and five macOS GTK job families
including a windowing proof were green on both arches. Both entries were deleted in
the change that added this one. The cost is not tidiness: an agent asked for the
next development steps read this file, believed it, and proposed work that was
already merged.

The generate-status corpse check cannot see this class. It matches the SHAPE of a
resolved heading (`~~`, `✓`, `Completed`), and a stale entry has none of those — it
reads exactly like live work, because it was.

Two guards suggest themselves. Both were measured against this file, and both are
worse than nothing:

- **Flag an entry that references a CLOSED issue.** 34 distinct issue references
  across 92 sections; 6 point at closed issues (#503, #655, #997, #1002, #1101,
  #1107). Every one of the six is legitimate provenance — *"Found closing #1107"*,
  *"the #655 guard"*, *"issue #503"* naming an upstream GIO bug in another tracker,
  and #1002's own text already says *"is closed as"*. Six false positives, zero
  findings. It would also have missed both stale entries, which carried no issue
  reference at all.
- **Flag an entry naming a path that does not exist.** 23 of 92 sections name one,
  and they are overwhelmingly correct prose using package-relative shorthand
  (`lib/esm/index.js`, `src/index.ts`, `test/arrays.test.mjs`). Failing on those
  would train everyone to bypass the check within a week.

What the two stale entries had in common is not an anchor, it is a QUOTE: each
one quoted a source fragment (`` `!!(DISPLAY || WAYLAND_DISPLAY)` ``) from a
repo-rooted file it named. A check that held such a quote to still occurring in
that file would have failed the day `capabilities.ts` landed, offline and with no
network.

**That measurement has now been made, and it is the third guard worse than
nothing.** Implemented as described — sentence-scoped, pairing each backticked
fragment with each repo-rooted path named in the same sentence — it produced 98
checkable pairs over this file and flagged 42 of them (2026-08-16). The sampled
flags are false without exception, and they fail in one way: **the check cannot
tell a QUOTE from a MENTION.** `` `packages/node-gi/**` `` is a glob,
`` `build:prebuilds` `` is a script name, `` `DYLD_LIBRARY_PATH` `` is an
environment variable — none of them claims to be text occurring in the file the
sentence also names, and a ledger is mostly mentions. Narrowing the pairing does
not reach the class: what would have to be recognised is the difference between
"this file CONTAINS this string" and "this file is ABOUT this thing", which is
the judgement the guard was supposed to replace.

So all three obvious guards are measured and rejected, and the two genuinely
stale entries in this round were again found by READING the tree against the
file — the licence entry (all three `gtk-runtime-*` manifests declare
`SEE LICENSE IN gtk/THIRD-PARTY-NOTICES.md`, and `bundled-license.mjs` holds
them there) and the doc-revert entry (`scripts/check-doc-revert.mjs` exists,
wired advisory into `audit-runtimes.yml`, and its header records that the
signature THIS FILE proposed was measured backwards — the entry was not merely
closed, it was still publishing a wrong instruction). Both deleted in the change
that added this paragraph.

The honest state of the art is therefore: no guard, and a reading pass whenever
this file is used to plan work. What stays buildable is far narrower than a quote
check — a JSON or YAML FRAGMENT an entry pastes verbatim can be held to still
parsing out of the file it names, because a pasted structure is unambiguously a
quote rather than a mention. There is about one such fragment here, so that
machinery would be honest and nearly idle, which is the correct size for it.


### Nothing checks that a published `lib/` holds no test output

`verify-package-outputs.mjs` asserts that every DECLARED output EXISTS, and
`verify-tarball-outputs.mjs` asserts that every declared output is in the TARBALL.
Neither asks the opposite question — whether the tarball also carries files nothing
declared — so a build tsconfig whose `exclude` misses a spec extension ships the
specs and every check stays green.

`@gjsify/rolldown-plugin-vue` had exactly that: `exclude: ["src/test.mts",
"src/**/*.spec.ts"]`, where the other six packages with a `tsconfig.build.json`
also list `src/**/*.spec.mts`. Measured — with only the `.spec.ts` entry, an added
`src/probe.spec.mts` emitted `lib/probe.spec.mjs` + `lib/probe.spec.d.mts`, and
`files: ["lib"]` publishes them. It is now excluded as `src/**/*.spec.*`, one
pattern that cannot miss an extension, which removes the drift for that package
rather than watching for it.

The repo-wide state was measured before reaching for a gate, and it is why there is
no gate: over the non-private workspaces, **84 packages already pack test-shaped
files** — mostly `lib/types/*.spec.d.ts`, and 8 pack executable spec code
(`@gjsify/webgl`'s `lib/esm/conformance/*.spec.js`, `@gjsify/fetch`'s
`lib/*.spec.js`, `@gjsify/adwaita-web`'s `src/*.spec.ts`, `@gjsify/tsc`'s
`src/index.gjs.spec.ts` + `src/test.mts`). Some of those are deliberate — webgl's
conformance suite is something a consumer runs — so the check would need a curated
allowlist on day one, which is the shape this repo keeps deleting. The cheap version
of the mechanism (assert every `src/**/*.spec.*` is excluded from the build
tsconfig) only reaches the 7 packages that HAVE a build tsconfig, i.e. it would
guard the one case already fixed and none of the 84.

So the decision to make first is a policy one: do published packages ship their
specs at all? Once that has an answer, the check belongs in
`verify-tarball-outputs.mjs`, which already computes the packed set per package
from `gjsify pack`'s own oracle and needs no new CI step.


### `check-e2e-harness-duplication` matches a NAME, so an unrelated helper reads as a copy

`scripts/check-e2e-harness-duplication.mjs:85` detects the `run-cli` rule with
`/\bfunction runCli\s*\(/` — the identifier, not what the function does. The rule exists
for a measured reason (its own header: `runCli` had existed in eight signatures, so a
correction to the writer landed in one of nine drifted copies), and the shared module is
the right answer for a suite that really does drive the CLI.

But `tests/e2e/ci-cancel-superseded-runs/run.mjs` tripped it while doing something the
shared helper cannot: it writes an `--import` prologue that replaces `globalThis.fetch`,
feeds run ids on **stdin**, and wants the `spawnSync` RESULT rather than a throw or a
promise. `mock-registry.mjs`'s `runCli(cliEntry, args, {cwd, env, timeoutMs})` spawns with
`stdio: ['ignore', 'pipe', 'pipe']` and takes no `input`; `runCliSync` throws on a non-zero
exit, which is the opposite of what that suite asserts. So the fix there was to name the
helper for what it runs (`runCancelScript`) — accurate, and it stops the false positive —
not to route it through a harness that answers a different question.

That leaves the rule able to catch the next accurate-but-similarly-named helper, and
unable to catch a real copy that spells itself `runCommand`. Narrowing it wants a
behaviour discriminator — a spawn whose first argument is a CLI entry, say — and a
measurement of how many of the 151 suites change verdict under it, which is why this is
an entry rather than a patch in the PR that hit it.


### Six e2e suites assert "no `gi://` import survived" by looking for four characters

`tests/e2e/{app-browser,ns-bridge-bundles,node-gi-build,storybook-on-node,vite-plugin-gjsify}`
and `tests/e2e/gi-renderer-arms` decide whether a build leaked a GI edge with
`bundle.includes('gi://')` / `bundle.includes('@girs/')`. **Fourteen assertion sites**, thirteen
negative and one — `storybook-on-node/run.mjs:155`, *"gjs bundle should keep gi:// specifiers
external"* — positive:

    tests/e2e/app-browser/run.mjs:86,91,137,142
    tests/e2e/ns-bridge-bundles/run.mjs:199,200
    tests/e2e/node-gi-build/run.mjs:98,103
    tests/e2e/storybook-on-node/run.mjs:144, and :155 (the POSITIVE one)
    tests/e2e/vite-plugin-gjsify/run.mjs:142,147
    tests/e2e/gi-renderer-arms/run.mjs:146,147

A fifteenth site, `gi://` asserted PRESENT at `gi-renderer-arms/run.mjs:256`, is not one of them:
it is the counter-example these fourteen need and is described at the end of this entry.

The claim each of them makes is *"no `gi://` import survived this build"*. What each of them
measures is *"those four characters do not appear anywhere in the output text"*. Today the two
answers agree, and they agree BY LUCK: nothing in a bundle happens to mention the specifier in
any position other than an import.

**Measured, from the ADR 0034 stage 9 arm (#1580).** That arm emits a virtual module whose
runtime refusal originally quoted the import it was refusing —

    const SPEC = "gi://Adw?version=1";
    …
    throw new Error(SPEC + ' on --app ' + APP + ': ' + RENDERER + ' has no ' + String(property) …)

— and the string is reachable, so rolldown keeps it. Both green probe bundles then carried
exactly **one** `gi://` occurrence, **zero** of which were import-shaped. A/B on one tree
state, same fixture, only the refusal wording differing:

    quoting the specifier   browser       500 197 B   1 occurrence, 0 of them an import
                            nativescript  214 036 B   1 occurrence, 0 of them an import
    naming the parts        browser       500 202 B   0 occurrences
                            nativescript  214 041 B   0 occurrences

"Not an import" is a claim about POSITION, and deciding it needed a second reading of the same
bytes — no occurrence sits after a `from` and a quote. That is the whole point: the substring
guard cannot make that distinction at all, and the distinction is the only thing it is trying
to assert.

The local fix was to stop quoting the URL: the refusal names namespace and version separately,
and both bundles carry zero. That is recorded in `plugins/gi-renderer.ts`'s header as a
constraint on what the arm may SAY, which is the wrong place for it to live permanently: a
diagnostic's wording should not be load-bearing for a test assertion.

**One thing that entry got wrong, and it narrows the claim.** It read as though `app-browser`
and `ns-bridge-bundles` were the guards forcing the wording. They are not, and could not be:
neither passes `--gi-renderer`, so the arm never composes in their builds and its diagnostic
cannot appear in their bundles. Measured — `grep -rl 'giRenderer\|gi-renderer' tests/` returns
`gi-renderer-arms/run.mjs` and `gi-renderer-arms/probe-runner.mjs`, and nothing else. The
wording constraint is therefore SELF-imposed by `gi-renderer-arms:146`, which is also the good
news: two of the fourteen sites are in the suite that owns the rule, and fixing those two alone
retires it, with no other suite's population to re-run.

`fixtures/textual-mention.ts` in that suite is now the executable form of this entry's argument
— a bundle that carries the four characters with no import among them, proved not by a second
reading of the bytes but by the build having exited 0 where an import-shaped occurrence would
have been refused by name.

**What an import-shaped check would have to read instead.** Not the text. Either (a) the emitted
IMPORT STATEMENTS — parse the bundle and take the `source.value` of every `ImportDeclaration`,
every `Export*Declaration` with a `source`, and every `ImportExpression` with a literal argument
(`acorn` is already in the tree and `utils/scan-named-imports.ts` already does this shape for
the React Native gate) — or (b) the module graph, if the CLI grows a way to report the
specifiers a build left external. Fourteen sites also means this wants ONE helper in
`tests/e2e/helpers.mjs`, not fourteen copies; the copies are themselves the "duplication instead
of a helper" anti-pattern, and fourteen of them are why the fix has to be one edit rather than
fourteen judgements about what each suite meant.

**Should it change? Yes** — but the positive site is the stronger reason, not the negative ones.
A negative substring check fails LOUDLY and on the wrong PR, which is annoying and attributable.
`storybook-on-node:155` is the other direction: it passes as long as the four characters appear
ANYWHERE, so the day a `gi://` string lands in that bundle for any other reason, the assertion
goes green having stopped measuring whether the gjs target still externalises the specifier —
the green-that-checked-nothing class this repository pays most for.

**Not changed in #1580, deliberately.** Twelve of the fourteen sites are load-bearing for five
suites that PR otherwise does not touch, and rewriting a guard across a population one has not
re-run is how a guard gets quietly weakened. The arm ships with the narrower rule instead (its
EMITTED refusal may not quote a `gi://` URL), and this entry is the retirement condition for
that rule. Retiring it needs only the two sites in `gi-renderer-arms` — the twelve elsewhere
constrain nothing about the arm.



### Three more commands answer an empty selection with exit 0

#1587 was one command resolving an empty set, doing nothing and reporting success. The
fix is in, and a sweep of every command in `packages/infra/cli/src/commands/` asked the
same question of each: *when the selection resolves to EMPTY, what happens?* Most answer
well — `foreach --include`, `onboard --packages`, `storybook`, `ship`, `run`, `check`,
`trust`, `dev` and every `flatpak` subcommand exit NON-ZERO, and `prune`, `upgrade`'s
dependency filters, `install`, `info` and `affected` print a line saying they found
nothing. Four did not.

**The worst of them was a GUARD that goes green, and it is CLOSED** — kept here because
the incident is the reason the remaining three are written down at all.
`gjsify barrels --paths <dir>` skipped a directory it could not read and `--check` called
that no drift: the generator caught the `readdir` failure, logged it only under
`--verbose` and continued, while the command exited non-zero only on `drift > 0`, so a
typo'd or renamed path contributed 0 and the check passed for a barrel nothing had looked
at. It guarded "zero paths given" and never "this path is not there" — the exact
asymmetry `assertEveryIncludeMatches` was written to close for `foreach`. Now
`unscannableBarrelPaths` refuses every named path that is not a readable directory before
anything is generated, and the generator stays tolerant for programmatic callers, which
is the split the two callers actually want.

The three that remain, ranked by what a later step then measures:

1. **`gjsify build` has no guard for an entry / `--library` glob matching no files.**
   `rolldown-plugin-gjsify/src/utils/entry-points.ts:102-105` returns `[]`, which flows
   into `input` (`library/lib.ts:83`, `app/gjs.ts:153`) and on to `runBundle`. Every
   post-build guard is offender-based and passes trivially on nothing:
   `assertGjsBundleLoadable` returns when both offender lists are empty,
   `assertGjsBundleParses` `continue`s on empty code, `computeCommonRoot` even has an
   explicit `paths.length === 0 → 'src'` fallback. Whether rolldown itself refuses
   `input: []` is NOT determined from this tree, and that is the point: the no-match path
   is reachable (`commands/build.ts:6-26` records a win32-backslashed pattern where
   "nothing ever matches, and no output file is written"), and build is precisely the
   step whose artifact a later step measures.
2. **`gjsify upgrade --workspace <glob>` prints one line and exits 0** where `foreach`
   asserts (`commands/upgrade.ts:161-164`). `applyWorkspaceFilter` cannot tell "the
   pattern named something that does not exist" from "the exclude emptied a real set", so
   a stale name or a quoting mishap reports success having edited nothing, and the
   following `install` + `build` measure the OLD versions. Cheapest of the three to fix:
   the assert exists twice already (`commands/foreach.ts:593`,
   `utils/onboard-discovery.ts:73`).
3. **`gjsify pack` on an unbuilt package writes a `.tgz` of `package.json` + README and
   prints its name at exit 0** (`commands/pack.ts:283-306`). The comment at `:276-282`
   names the incident — `@gjsify/tsc` shipped an empty `lib/` for the whole v0.4.37-0.7.2
   window — and puts the guard in `scripts/verify-tarball-outputs.mjs`, OUTSIDE the
   command, so a `pack` → `publish` that does not run that script is unheld.

Deliberate and left alone: `clear` and `copy` wildcards that match nothing (shell parity,
argued for in `utils/clear-targets.ts:98-104` and `utils/copy-targets.ts:97-99`), and
`ship --stage`'s `formats (none — …)` line.

**What would close them**: one shared assert with the shape `assertEveryIncludeMatches`
already has — *a pattern the caller wrote that matched nothing is an error, a filter that
emptied a real set is not* — applied at the selection sites above, `barrels` having taken
the first of them by hand. The distinction is the whole content of the rule, and it is why
a blanket "empty is an error" would be wrong for `prune` and `foreach --exclude`.

### A `readdirSync` walk feeding `assert.deepEqual` can swap two correct findings (#1707)

`bundle-search-paths.mjs`'s `auditPayloadSearchPaths` built its `findings` array from
`filesUnder`, a recursive `readdirSync` walk with no sort anywhere, and the e2e leg that diffs a
GJS run against a Node run compared the two `findings` arrays with `assert.deepEqual` from
`node:assert/strict` — `deepStrictEqual`, index-wise for arrays. Node's `readdirSync` and GJS's
`Gio.File.enumerate_children` are two independent unsorted enumerators: the same SET of files
can arrive in a different ORDER from each, so a correct result could fail on whichever finding
landed first. It happened once, on #1707 — two findings simply swapped, and
`findings.length === 2` passed on both sides, so a count-only glance called it clean. Estimated
rate roughly 1 in several hundred to a thousand runs; it does not reproduce on a `tmpfs` host,
which preserves insertion order, so two separate machines came back clean on repeated local runs
before the swap was diagnosed from the CI log.

Fixed by sorting `findings` by `(file, kind)` inside `auditPayloadSearchPaths`, before it
returns. That key is total: the escape check and the unresolvable check run independently over
the same image, so one file can carry both findings, but never the same `kind` twice for one
file. The sort is the guard — every consumer now sees one canonical order regardless of which
enumerator walked the tree — and a reversed-walk fixture built to reproduce the swap fails the
pre-fix function and passes the sorted one.

A repo-wide sweep for the same shape (`deepEqual`/`toEqual` against a walk, a glob, an
`Object.keys`, a `Map` or a `Set`) found it already guarded everywhere else it currently occurs
— both sides sorted before comparison, e.g. `tests/e2e/homepage-run-variations/run.mjs`,
`tests/e2e/ship/fixture.mjs`, `tests/integration/fast-glob/src/*.spec.ts`. One LATENT case
remains unguarded: `scripts/clear-committed-platform-exemptions.mjs`'s `packageManifests()`
walks `packages/<pillar>/<name>` with a plain unsorted `readdirSync` and builds its
`cleared`/`paths` result from that order. `tests/e2e/platform-exemption-clearing/run.mjs` only
ever asserts against `[]` or a single element today, so nothing flakes yet — but a fixture with
two simultaneous clears would hit exactly this class, and nothing there sorts.


### A PR-body rule with nothing enforcing it landed a session URL on `main`

The convention was already real: a PR body may carry `🤖 Generated with [Claude
Code](https://claude.com/claude-code)` but not the `claude.ai/code/session_…` URL beside it,
because the body becomes the squash commit BODY and that URL is then permanent — useful only to
whoever had the session open. `commitlint.yml`'s `Check the squash body the PR body becomes`
step already read the body for line length; it never checked for this. #1699 merged GREEN and
`b3590e8fec` carries the URL at line 150 of `main`'s history, unfixable without a rewrite this
repo does not do.

A same-day sweep of `main`'s first-parent history found the convention was already loose well
before #1699: 380 of 2408 commits carry a session URL. None of the 7 PRs open at the time did.
`scripts/check-pr-body-lines.mjs` now refuses both the URL and a `Co-Authored-By: Claude …`
trailer, and keeps the permitted attribution line allowed.

