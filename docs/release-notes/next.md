<!--
THE PROSE PREAMBLE FOR THE NEXT RELEASE.

`scripts/check-changelog-references.mjs --release-notes <version>` publishes this
file ABOVE the generated changelog section in the GitHub release body. Write here
in the PR that lands the change, while you still remember why it mattered — the
generated section already says what changed.

  · Prose is OPTIONAL. No prose costs a warning in the cut's job summary and
    nothing else; the body is then the changelog section alone.
  · It counts only if git says this file changed since the last tag, so the
    previous release's text can never reappear under a new version. There is no
    version to write down and nothing to reset by hand: after a release this file
    is stale by definition, and the next prose is simply the next edit.
    So REPLACE what you find here, do not append to it — right after a release
    this file still holds the text that shipped with it, and the tag is where
    that copy lives (`git show v0.28.0:docs/release-notes/next.md`).
  · It goes through the same broken-reference detector as CHANGELOG.md, so a
    fabricated issue or repository link fails the cut. Write `#123` for a real
    issue in this repo; put anything `#`-shaped that is NOT a reference in
    backticks (`PKCS#7`), and the same for npm scopes and at-rules (`@girs`,
    `@font-face`) so they are not read as GitHub accounts.
  · No `## [x.y.z]` heading — the preamble sits above the section, not beside it.

Everything below the last comment is published verbatim. Delete this comment or
leave it; comments are stripped either way, and a file holding only comments
counts as no prose.

A worked example is the v0.28.0 release body:
https://github.com/gjsify/gjsify/releases/tag/v0.28.0
-->

## What this release is about

**Windows and macOS stop being aspirations and become checked claims.**

Both platforms had been "supported" in the sense that nobody had measured them. When someone
finally did, `main` — green on every existing check — was carrying **144 failing assertions on
Windows** and a full red suite on macOS. Not one was a defect in an implementation. They were
specs that spelled a POSIX answer as though it were *the* answer, which is precisely the failure
mode a Linux-only pipeline cannot see: on Linux the POSIX literal cannot fail.

So this release does two things that belong together. It fixes what was broken, and it closes
the hole that hid it: the operating system is now a **declared field** (`package.json#gjsify.os`)
that a conformance rule checks, and two new CI legs actually execute package suites on Windows
and macOS. A claim that nothing runs is not a claim.

**If you build under GJS in a project (not a global install), upgrade** — `gjsify build` could
not work there at all, and now does. **If you contribute to this repository**, note that
`cli.gjs.mjs` and `tsc.gjs.mjs` are no longer committed files.

---

### The OS is a declared, machine-checked claim (ADR 0018)

`gjsify.os` joins `gjsify.runtimes` and `gjsify.platforms` as an axis packages declare and a rule
enforces. Nine packages are backfilled; `field-coverage` now sees 19 kinds in scope against 15
claimed, so the declaration cannot land without its check.

Four claims deliberately sit below `supported`, each printing its reason on **every** run — pass
or fail — rather than hiding behind a green tick:

```
child_process win32=partial  a win32.ts exists and NOTHING RUNS IT
os            win32=partial  same structural gap, plus spec failures
process       win32=partial  the uname path is unreachable without a GJS host
util          win32=partial  win32 silently gets the LINUX errno table
```

An honest "partial" with a named gap is available. A silent one is not.

### Windows and macOS suites now run in CI

`windows-suites.yml` runs the Node pillar on Windows, under **cmd.exe with the Git-for-Windows
PATH entries removed** — because Git ships `chmod`, `cp`, `sed` and `which`, npm runs scripts
through `%COMSPEC%` where none exist, and a leg using bash would faithfully reproduce a false
green.

`macos-suites.yml` is the stronger of the two, because macOS *has* a GJS host: both `test:node`
and `test:gjs` run. Neither leg is a required check by design — Windows minutes bill at 2×, and
a required check that fails to *start* blocks every PR forever. They are read, not waited on.

### `gjsify build` now works in a project that installs under GJS

The GJS bundler engine is an optional peer of `@gjsify/cli`, correctly — a plain
`npm install @gjsify/cli` on Node must not drag in Linux prebuilds. But nothing installed it for
a *project*: npm skips optional peers, and the native backend does not resolve peer dependencies
at all. Under GJS there is no npm `rolldown` fallback, so **every `gjsify build` hard-failed**,
and the error arrived buried under ~60 lines of command help.

A project install now lays the engine down when the host can run `gjs` and does not have it.
Verified end to end against the real registry: native packages detected went 5 → 8, and
`gjsify build index.ts` writes a 132 KB bundle where it previously had no engine to load (#1005,
ADR 0020).

Two things fell out of that work and are worth naming on their own:

- **A runtime error no longer prints command help.** yargs treats a rejected handler like a usage
  error, so an accurate diagnosis scrolled out of view under a help dump that read as "bad
  arguments". Usage errors still print help; runtime errors now print the error.
- **The distro install hint was silently empty on exactly the hosts that needed it.** Package
  manager detection shelled out to `which`(1), which the minimal Fedora CI containers do not
  ship, so the hint printed nothing there. Two downstream projects had already found their
  missing system library by hand.

### The committed CLI bundles are gone (ADR 0002)

`packages/infra/cli/dist/cli.gjs.mjs` and `packages/infra/tsc/dist/tsc.gjs.mjs` are no longer
tracked — **10,197,542 B of committed artifact**, plus the apparatus that guarded their
staleness: a `post-rewrite` hook, its e2e suite, two per-job bundle verification steps and a
recovery procedure. CI now bootstraps from the published `@gjsify/cli` and builds them; they are
still packed into tarballs and still shipped as release assets. Untracking is not unshipping.

The cost this removes was measured, three times in three days: a release restaling every open PR
by one byte, an `+18 B` drift on all three artifacts from a `packages/web/` commit no hook
covered, and a five-file change that had to carry an unrelated 6.6 MB hunk and was rejected as
stale anyway.

`affected.gjs.mjs` stays committed on purpose. The CI classifier boots it before any install and
it gates every other job, so a stale copy does not error — it silently classifies today's work
with an older commit's rules, and the run still looks green.

### Fixes

- **`net.isIP()` accepted addresses Node rejects.** The GJS entry asked the host's
  `inet_pton(3)`, and BSD accepts leading zeros in an IPv4 octet where glibc does not — so
  `0177.0.0.1` and `127.000.000.001` classified as valid IPv4 on macOS. Leading-zero octets are
  the classic parser-confusion vector, since `0177.0.0.1` is `127.0.0.1` to anything reading
  octal. Both entries now share one pure classifier, and cross-checking it against Node over 34
  inputs found two further bugs the split had hidden: `:::1` classified as IPv6, and
  `::ffff:127.0.0.1` classified as not an IP at all.
- **`os.networkInterfaces()` reported loopback's IPv6 address as external.** `internal` was
  derived from the address (`=== '127.0.0.1'`) instead of the interface's `IFF_LOOPBACK` flag, so
  `::1` came back external while `127.0.0.1` on the same interface came back internal. Two specs
  had asserted otherwise all along; they passed only because the CI image ships no `iproute`, so
  the primary code path never ran there (#1023).
- **`os.cpus()` returned no `times` on macOS**, where Node guarantees numbers — `+cpu.times.user`
  was silently `NaN` — and warned once per core per call. It now reports the documented all-zero
  contract.
- **`gjsify run` in a workspace did not change directory before dispatching in-process** (#1024).

### Known and open

- The per-CPU tick counters `os.cpus()` reports on macOS are all zero. Mach's
  `host_processor_info` is unreachable from GJS and no userland tool prints cumulative per-core
  totals. The assertion is declared as an expected failure that runs and retires itself the day a
  reader exists, rather than being skipped.
- Nothing yet stops a new call site inside the CLI from bypassing the spawn/teardown contract the
  `pack` hang came from. The contract is documented and the fix is in; the guard that would make
  a future bypass visible is not (#1012).
- `gjsify install --immutable` (the CI shape) still cannot acquire the GJS bundler engine, because
  the lockfile a frozen install consumes does not name it. It now says so and names the durable
  fix: declare `@gjsify/rolldown-native` so the lockfile carries it (#1005, ADR 0020).
