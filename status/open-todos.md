<!-- Authored Open-TODO sections — THIS FILE is the tracked source of truth (the
     rendered STATUS.md view is generated and gitignored). One `### <title>` per open item.
     A RESOLVED item is DELETED (its record is the commit + CHANGELOG that closed
     it) — the status-data check rejects struck-through / ✓ / "Completed"
     headings, so the done-log cannot regrow. -->

### `@gjsify/child_process` on Windows — 86 of 145 specs fail once the module can load at all

The specs took `TMP_DIR` from a literal `/tmp` and `realpathSync`'d it at MODULE
EVALUATION. On `win32-x64` that resolves against the current drive to `C:\tmp`,
which does not exist, so the module threw before defining a single test.

Measured on the win11-gjsify VM (Node 24.18.1), with no `C:\tmp` present:

| | before | after `tmpdir()` |
|---|---|---|
| output | 23 lines, `ENOENT: lstat 'C:\tmp'` | full run |
| tests run | **0** | **145** |
| failures | — (module never loaded) | 86 |

The 86 are pre-existing POSIX assumptions in the SPECS, not regressions and not
impl gaps — which is structural, not a judgement call: `@gjsify/child_process`
declares `runtimes.node: "none"`, so `test:node` never aliases
`node:child_process` to our polyfill and those specs run against NATIVE Node. Per
the testing rules a failure there means the TEST is wrong. What they encode:
shell built-ins assumed to exist (`echo`/`pwd`/`cat` under `cmd.exe`), POSIX
absolute paths, exit-code and signal semantics, and `/bin/sh`-shaped `shell:`
options. Node's own behaviour on Windows is the oracle for each.

The GJS run is the one that measures our impl, and it cannot run on Windows at
all (no `gjs` there) — so this package's Windows impl story is still unmeasured;
only its specs have been.

**Note for anyone re-measuring:** a hand-created `C:\tmp` makes the module-load
failure vanish without fixing anything (one existed on the test VM for several
hours and hid exactly this). It has been removed there. Do not re-create it.
### Bun DID hard-crash in the N-API teardown class — the first one, and the note that predicted it asked to be told

`scripts/cross-runtime.mjs` carves Deno out of exit-code gating for the
post-pass teardown abort (#47) and deliberately does NOT carve out Bun, on
measured grounds: *"~7000 Bun runs (arrays + the GObject/boxed-heavy files …,
full 37-file suite ×40, a probe holding 30k live boxed handles to process exit,
random `--smol` GC pressure) produced 0 crashes / 0 cores"*, and it closes with
an instruction — **"if Bun ever hard-crashes here, re-confirm with a gdb
backtrace (the Deno determination's bar) first."**

It has now happened, twice, on PR #923's CI (`ci-fedora:44`, bun 1.3.14,
`NODE_GI_NATIVE=prebuild`):

```
test/arrays.test.mjs:
  (pass) GStrv return → string[] … 8/8 assertions pass
free(): invalid pointer
  ✗ arrays
```

Note the marker: `free(): invalid pointer` is a **glibc heap abort**, not the
`SIGSEGV` inside `g_boxed_free` that the Deno determination is built on, and not
Bun's own `panic(main thread)`. Same family (a corrupt pointer reaching the
allocator at teardown, after every assertion has passed), different
manifestation — so the mechanism argument for Bun (deferred finalizers, run
single-threaded on the JS thread under `DeferGCForAWhile`, `napi_internal_remove_finalizer`
dedup) does not obviously cover it and should be re-checked rather than assumed.

Nondeterministic, and independent of that PR's contents: attempt 1 failed on
bun, attempt 2 on **deno**, attempt 3 passed, all on one commit; the job runs
`npm install` + node-gyp inside `packages/node-gi/node-gi` (sole dependency
`node-addon-api`), so nothing in that PR is reachable from it; the CI images
either side of the first failure are package-identical (797 packages, empty
`diff`, same `glibc-2.43-6`); 10 local `--only arrays` runs on unmodified `main`
were green.

**The RATE has changed, and that is the part the "~7000 runs / 0 crashes"
baseline no longer describes.** Three further hits inside one afternoon
(2026-08-02), all on `deno`, all on `arrays`, all on PRs that touch nothing
under `packages/node-gi/`:

| run | PR | outcome |
|---|---|---|
| 30751987456 | #935 | `✗ arrays`, re-run on the SAME commit → green |
| 30754859011 | #935 | green (the re-run above) |
| 30757696374 | #929 | `✗ arrays`, re-run on the SAME commit → green |

Every one stops at the identical place — nine assertions `ok`, then the process
disappears part-way through `INOUT byte-array container is handled, not
deferred: GLib.base64_decode_inplace()`, with no `ok`, no failure text and no
crash marker in the job log. That is a THIRD manifestation: not the
`SIGSEGV` in `g_boxed_free` of the Deno determination, and not the
`free(): invalid pointer` glibc abort recorded above — just a vanished process.
The absent marker is itself information: whatever kills it is not reaching the
glibc allocator's own check.

Two things follow. First, "nondeterministic" is now too weak a word for
planning — at roughly one hit per two runs on deno it is frequent enough to
reproduce deliberately rather than opportunistically, which removes the main
practical obstacle to the gdb step below. Second, anyone reading the 7000-run
baseline should know it was measured on BUN; nothing of that size has been run
against deno.

Next step is the one the note names, not a carve-out: reproduce under gdb (the
Deno case took ~8 cores on a loop of the boxed-heavy files) and get a backtrace.
Until then Bun stays on exit-code gating — a `pass>0 && fail===0 && <crash
marker>` carve-out added now would mask exactly the real Bun teardown bug this
might be, and the runs above show the marker is not even reliably present.

### The prebuild glibc floor is an accident of the build image, and the gate that says so only runs post-merge

Two halves, and the first one is now paid for. `prebuilds.yml`'s base image
decides which glibc our published binaries link against, so bumping it rewrites
`gjsify.glibcRequires` for every consumer without touching a line of source.
#897 bumped it 43 → 44 as part of a hygiene sweep across the workflows' images,
and glibc 2.43 re-versions `acosf`/`asinf`/`atan2f` — which lightningcss's colour
conversion calls — so the measured floor went 2.39 → 2.43 and main was red for
three consecutive `commit-prebuilds` runs. Reverted, with the reason written at
the `container:` line so the next hygiene sweep cannot repeat it.

**The gate worked; it just fired late.** `commit-prebuilds` runs
`audit-runtimes --check` on the freshly downloaded artifacts and refused them,
naming both numbers — exactly what the step's own comment predicted a base-image
bump would do. But `commit-prebuilds` is main-only, so the PR that caused it was
green. That is the shape AGENTS.md § "PR coverage parity" calls dishonest: a
green PR must predict a green main.

Closing it means running the same measurement in the BUILD legs, which do run on
`pull_request`. Two prerequisites, neither large:
- the legs need `nodejs` in their `dnf install` line (`audit-runtimes.mjs` is
  pure Node with no dependencies, which is why `audit-runtimes.yml` can run it
  with no install);
- the measurement must read the FRESHLY BUILT files, so the legs have to stage
  into the directory the artifact is actually published from. Today they stage
  into the bridge's own `prebuilds/`, which is also where the committed copy
  lives, so it happens to work — but after ADR 0017's split that is scratch
  space and the audit would silently measure the old committed binaries instead.
  Move the staging with the gate, in the same change.

**Still open underneath both:** the floor is OBSERVED, never CHOSEN. Even pinned
to `fedora:43` it moves the day that image's glibc re-versions something else.
Deciding it would mean building the three Rust bridges against a declared
baseline — an old-glibc container (manylinux/RHEL-derived) or
`cargo-zigbuild --target <triple>.<glibc>` — and then `gjsify.glibcRequires`
becomes an input the build satisfies rather than a number someone reads off the
result. That is a policy decision (how old a distro do we support?) and wants its
own change.
### `cli.gjs.mjs` byte-reproducibility is not closed — main shipped a non-reproducing bundle again

#906 merged a committed `packages/infra/cli/dist/cli.gjs.mjs` that does not
rebuild from its own source, and main stayed RED on `Verify committed bundles
rebuild from source` until #913 replaced it with CI's bytes. Every PR opened in
between inherited the failure.

The divergence is the module-order-derived minifier `$N` suffix drift
`release-cut.yml` documents — at the first differing byte the committed bundle
had `function e$1(` where a rebuild emits `function e$2(`, 338 bytes of
accumulated suffix differences, no semantic delta. That is the class
`globToEntryPoints`' per-glob sorting was supposed to have closed, so either the
sorting does not cover this input or something else feeds order into the build.

What is MEASURED, and what is not:

- **CI is not the unstable side.** The `rebuilt-bundles` artifacts from two
  independent runs (`30709249982` on `6257afe46`, `30710590470` on a PR branch)
  are BYTE-IDENTICAL at 6594347 B. Determinism across runs, commits and
  container instances is established, not assumed.
- **A local build produced a THIRD variant.** During the #913 work this
  checkout briefly held a 6595935 B `cli.gjs.mjs` that matched neither the
  committed 6594685 B nor CI's 6594347 B. It agreed with CI at the `e$2` site
  and diverged later instead (`$I()`/`QI` vs `JI()`/`qI`) — the same identifier
  shape, a different place. **Its provenance was NOT established**: nothing was
  knowingly built, and the trigger was not found before it was discarded. Treat
  it as a corroborating observation, not proof.

So the standing repair is real but manual — take CI's `rebuilt-bundles` bytes —
and it will be needed again. Worth closing properly, because the failure lands
on whoever pushes NEXT rather than on whoever caused it, and it costs a full
Fedora build to even see. Two directions, not exclusive: find the residual order
input (a warm per-package build cache is the obvious suspect — the entry-order
incident record notes the cache kept a raced order alive across rebuilds), or
stop hand-committing these artifacts and have CI be the only producer.

### `@gjsify/http2` lazy native-dispatcher loads still use a bare `require`

Two sites load the optional native HTTP/2 dispatcher through a bare `require(...)` from ESM source — `src/client-session.ts` (`_setupNativeClient`, reached from `connect()`) and `src/server/http2-server.ts` (`_startNativeListen`, reached from `listen()`). This is the class documented in AGENTS.md § CJS-ESM Interop → "Our source is ESM": the call resolves at build time inside a bundle and is a `ReferenceError` from the unbundled `lib/` we publish. Neither obvious fix applies as-is:

- a **static import** would pull `native-{client-,}dispatcher`'s static `gi://GLib` / `gi://Gio` / `@gjsify/http2-native` imports into EVERY http2 consumer, defeating the optional-native-package design;
- **`await import()`** (the ESM way to lazy-load) requires making both call paths async, i.e. changing `connect()` / `listen()` — and Node's `listen()` contract is synchronous.

So it needs a real design decision inside `@gjsify/http2` (e.g. resolving the dispatcher during an already-async phase, or an explicit async opt-in), not a lint fix. Both sites carry an `oxlint-disable-next-line typescript/no-require-imports` with the reason inline; they are the only sanctioned disables of that rule in the tree.

### Manifest-conformance follow-ups

The five standalone declaration-vs-reality scripts are now one rule registry (`@gjsify/manifest-conformance` + `scripts/manifest-conformance/`). Three things were deliberately left out of that refactor so it stayed a refactor.

- **`gjsify manifest-check` is designed but not shipped.** The portable rules (`package-outputs`, `prebuild-artifacts`, `headless`, `field-coverage`) are already extracted into a package with a hand-written `lib/index.d.ts`, so the command is a thin wrapper over `selectRules({ scope: 'portable' })`. It was held back because it carries two costs a refactor must not smuggle in: the package has to flip from `private` to published, which needs the manual first-publish + Trusted-Publisher bootstrap BEFORE the next release train, and adding a command rebuilds `dist/{cli,affected}.gjs.mjs`, coupling the change to the committed-bundle gate. The name is settled: `manifest-check` — a sibling of `system-check` (machine has what the project needs) and distinct from `check` (types compile). Evidence it is worth doing: downstream consumers already declare `gjsify.storybook` (buchhaltung, pixel-rpg/map-editor) and `gjsify.prebuilds` (buchhaltung's ERiC package, which declares a prebuilds directory with NO `gjsify.platforms` — a hard failure in this repo, unchecked in theirs).
- **Five `gjsify.*` declaration kinds have no rule** and are deferred with a written reason in `scripts/manifest-conformance/unchecked-fields.mjs`, printed on every audit run. Four are judged unverifiable-by-construction (`defineFromPackageJson`, `flatpak`, `buildCache`, and `nativescriptPlatforms` until there is a per-platform artifact to compare against); the one remaining FINDING is `gjsify.storybook` (a typo in `stories` produces an empty component browser, not an error). `gjsify.main` and `gjsify.example` left the ledger when `package-outputs` claimed them.
- **The affected classifier does not know the conformance/status paths.** `scripts/audit-runtimes.mjs` is a `GLOBAL_TRIGGER`; `scripts/manifest-conformance/**`, `packages/infra/manifest-conformance/**`, `scripts/generate-status.mjs` and the authored `status/**` data are not classified (unknown paths fall back to a conservative full run). `status/*.md` is already covered by the blanket `*.md` IGNORE, but `status/status.json` is NOT — editing a package's authored status therefore forces a full CI run today, and `status/**` should join the docs-shaped IGNORE set. No coverage is lost today because `audit-runtimes.yml` carries no `paths` filter and runs on every PR, but the trigger/ignore tables and the rule locations should be brought back into agreement — an affected-classifier change rebuilds the committed `dist/affected.gjs.mjs`, so batch it with the next CLI-src touch.

### Toolchain hygiene follow-ups

- **`scripts/node-gi-consumer-harness.mjs` still resolves `gjsify` the broken way, knowingly.** `resolveGjsify()` returns `node_modules/.bin/gjsify` on an `existsSync` hit, which on Windows is the `sh` member of npm's shim trio and the one member the OS cannot execute — `execFileSync` gets ENOENT. `scripts/resolve-gjsify.mjs` is the fix and both other callers now use it; this one is not a one-line change. The working Windows form is `%COMSPEC% /d /s /c "<shim> <escaped args…>"`, which embeds the ARGUMENTS inside the quoted line, so the resolved command cannot be threaded through this file as the bare string that `runPackage`, `stageTestAssets` and the rest pass around — each site has to build its own invocation (`execGjsify(args, opts)` instead of `exec(gjsify, args, opts)`). Left because the harness drives `@gjsify/node-gi`, which needs GObject-Introspection and is Linux-only in practice, so there is no Windows run to repair; rewriting the threading blind on a harness this host cannot exercise would trade a known unreachable bug for an unmeasured change. Do it when the harness is next touched anyway.

- **A repo-relative path spelled in the HOST separator is a live bug class, and only the three measured sites are fixed.** `path.relative()` answers in `path.sep`, and every consumer in this tree assumes `/`: `audit-runtimes.mjs`'s `classifyAxis` reads the first `/`-split segment to decide a package's axis, and `platforms-ci` compiles a package's path into a REGEX and matches it against `working-directory: packages/node-gi/node-gi` lines in the workflow YAML. On Windows the first read `gjs\unit` as a single segment (five infra packages reported as MISSING a `gjsify.runtimes` declaration they are not supposed to carry) and the second compiled `packages\node-gi\node-gi`, in which `\n` is a newline (so `@gjsify/node-gi`'s macOS leg, which identifies itself by path alone, was reported as a declared platform CI never builds). Both were WINDOWS-ONLY: `audit-runtimes --check` was red on win32 and green on Linux for the same commit, so CI could not have caught either. Fixed at the three points where the value is produced — `toRecord` in `manifest-conformance/lib/context.mjs`, `collectNativePackages`, and `audit-runtimes.mjs`'s `toPosixRel` — with `split(sep).join('/')` rather than `replaceAll('\\','/')`, because a backslash is a legal POSIX filename character. What is NOT done is a sweep: any other `relative()` whose result is split, matched or compared has the same defect, and nothing enforces the convention. Worth either a documented rule ("repo-relative paths crossing a module boundary are forward-slash") or a helper the call sites must go through.

- **Testing "on Windows" from git-bash reports false greens, and nothing enforces the distinction.** Git for Windows puts `C:\Program Files\Git\usr\bin` on PATH, which supplies a real `chmod`, `cp`, `rm`, `sed` and `which`; every process spawned from that shell inherits them. npm, however, runs package scripts through `%COMSPEC%` (cmd.exe), where none of those exist. The two disagree on the same tree at the same commit — measured: `gjsify run build:infra` completed under git-bash and failed at `@gjsify/create-app` under cmd.exe, and `detectPackageManager()` in `utils/check-system-deps.ts` probes with `which`, which is ENOENT under cmd.exe (it returns the honest `unknown` there, but by accident rather than by construction). Any Windows claim therefore has to name the shell, or it means nothing. The reproducible check is to strip every `\Git\` entry from PATH and drive the command through `%COMSPEC%`; that is what the measurements behind 293a9a1 and this entry used. Worth a scripted harness in `tests/` if a Windows CI leg ever lands, since the runner images have Git on PATH too.

- **744 files are committed with CRLF, so a default Windows clone is dirty before you touch anything.** Measured on a fresh `git -c core.autocrlf=true clone --depth 1` of this repo — `core.autocrlf=true` being what Git for Windows' installer recommends: `git status` reports **744 modified files immediately**, none of them touched. The mechanism is a round-trip that does not close: those blobs already contain CRLF, checkout converts LF→CRLF, and the comparison normalises CRLF→LF against a blob that has CRLF, so they never match. By directory: `tests/` 480, `showcases/` 131, `website/` 84, `templates/` 38, `status/` 11 — `packages/` is entirely clean, which is why nothing downstream of a build ever noticed. By extension: `.ts` 318, `.mjs` 139, `.json` 108, `.md` 47, `.mts` 35. Invisible on Linux and macOS, and invisible on a Windows clone with `core.autocrlf=false` (which is what this repo's own dev VM had configured, and why it took a deliberately-default clone to see). The `.gitattributes` added in a9fa31a does NOT address this: it pins the byte-verified artifacts only, which is the correctness problem; this is the ergonomics one. Closing it means `* text=auto` plus a `git add --renormalize .` sweep — a project-wide policy change carrying a one-time 744-file diff, which is a maintainer decision rather than a drive-by. Until then a Windows contributor should set `core.autocrlf=false` before cloning, and any tooling that reads `git status` to decide what changed is unreliable there.

- **Nine fixtures re-implement the prebuild-target name instead of importing it.** `resolvePrebuildDirName()` / `prebuildDirCandidates()` (`packages/infra/cli/src/utils/detect-native-packages.ts`) are pure functions and already the single source of truth for `prebuilds/<os>-<arch>/` — but every e2e that needs that directory composes the name itself, and several translated `process.arch` into the `uname -m` machine on the way. The `<os>-<arch>` unification had to fix all nine by hand, and one (`tests/e2e/self-host/run.mjs`) was missed on the first pass precisely because the composed string never appears as a literal. Export a small test helper (or let fixtures import the CLI's built `lib/utils/detect-native-packages.js` directly, the way `tests/e2e/dlx-native-prebuilds` already imports `run-gjs.js`) so the name has exactly one definition, and delete the per-fixture copies. Until that lands, any change to the target vocabulary must be swept for BOTH shapes — the literal path AND the computed one.
- **`@gjsify/cli`'s `tsconfig.json` type-checks only what `src/index.ts` imports.** `files: ["src/index.ts"]` means `gjsify tsc --noEmit` never sees `src/affected-entry.ts` — the entry CI's `changes` job actually boots (`dist/affected.gjs.mjs` is bundled from it) — nor `src/test.mts`. A type error in either is caught only when the bundle build runs, i.e. in the pre-commit hook rather than in `check`. Widen to an `include` covering `src/**` (and confirm the emit stays `lib/**` only), or add the two entries to `files`.
- **`gjsify install` materialises EVERY platform package, so a cold install does ~4x the necessary work — this, not a wedge, is what the 30-min budget hits.** Measured on a fresh clone (linux-x64, warm tarball cache, 2026-07-28): 1597 packages / **4.78 GB** extracted, of which **183 packages / 3.36 GB (70% of the bytes)** declare an `os`/`cpu` that EXCLUDES the host, so npm/yarn/pnpm would never place them — six `@anthropic-ai/claude-agent-sdk-*` siblings at ~230 MB each, six `@pagefind/*`, plus the `@rolldown`/`@oxlint`/`@oxfmt`/`@img/sharp`/`@deltachat` binding sets. The fix is to honour `os`/`cpu` like every other package manager, and it is a TWO-part change because `--immutable` materialises straight from `gjsify-lock.json`: record `os`/`cpu`/`libc` on lock entries at resolve time, and filter at materialisation. That is a lockfile-format change + a full `gjsify-lock.json` regeneration, so it wants its own PR + e2e; the napi-rs entry-replacement in `napi-node-addon.ts` already selects its sibling BY HOST TRIPLE, so it is unaffected. Do NOT "fix" this by raising `--timeout`: a budget that exists to bound a hang must not be tuned to accommodate one.
- **The CLI `readStdinText` GJS branch can now collapse back to `readFileSync(0)`.** The core gap is CLOSED: `@gjsify/fs` maps the standard descriptors 0/1/2 onto the process's own Unix streams (`src/std-fd.ts`, GioUnix + a `/dev/stdin` fallback), so `readFileSync(0)` / `readSync(0, …)` / `writeSync(1|2, …)` work under GJS instead of coercing the number to the relative PATH `"0"` and throwing `ENOENT` — the shape every bundled npm package's Node stdin idiom hit. `utils/stdin.ts` therefore no longer needs its two GJS-specific readers (`imports.gi.GioUnix` + the `/dev/stdin` Gio.File fallback); both shrink to a single `readFileSync(0, 'utf-8')` for Node and GJS alike. Deferred as a SEPARATE change only because collapsing it rebuilds the committed `dist/{cli,affected}.gjs.mjs` bundles — do it in a byte-reproducible build environment alongside the next bundle rebuild, not as a source-only edit.

### CI coverage follow-ups

- **`prebuilds.yml` covers every Linux target on a PR; `darwin-arm64` is still proven for the first time AFTER the merge.** The workflow runs its BUILD legs on `pull_request` (native x64 + arm64 and the ppc64/s390x/riscv64 QEMU legs, Vala *and* the three Rust bridges — the break that motivated it, #827, was in the Rust dependency graph). Under real qemu-user (10.2.2, ppc64le): dependency install ~6 min, the Vala/GI packages compile in minutes; `@gjsify/lightningcss-native`'s Rust cdylib is the one expensive step — if a leg's total makes it the PR critical path, drop THAT package from the emulated legs rather than the architecture. `build-prebuilds-macos` remains the one PR-skipped leg (10x billing + the shared macOS concurrency pool); label a PR `ci:macos` to opt in. `prebuilds-summary` names the skipped legs per run. Closing the macOS gap permanently means either paying 10x per PR or a nightly full-matrix run. Pairs with the "nothing byte-compares a committed prebuild against a CI-built one" item below.
- **`@gjsify/rolldown-native`'s darwin-arm64 leg is PROVEN but not promoted, so `gjsify build` still has no bundler engine on macOS.** As of run 30271998319 the manual-dispatch `build-prebuilds-macos-experimental` job builds the Rust cdylib + Vala bridge on a real Apple-silicon runner, stages BOTH libraries, passes `check-prebuild-loader-path.mjs`, loads under Homebrew `gjs` and resolves its sibling cdylib with `DYLD_*` unset — every gate the required job applies to `lightningcss-native`/`oxfmt-native`. Missing is only the promotion: a build+collect+upload step in `build-prebuilds-macos`, `darwin-arm64` in the package's `gjsify.platforms`, and the download+commit wiring in `commit-prebuilds`. Until then the one job that covers the bundler engine on macOS runs on no automatic event.
- **`linux-ppc64`, `linux-s390x` and `linux-riscv64` have a working emulated BUILD but no committed prebuild yet, on all eight bridges that declare them.** Two defects stacked historically: `uraimo/run-on-arch-action` ignored the architecture whenever a custom `base_image` was set (the legs compiled x86-64 and staged it as ppc64/s390x/riscv64), and it reset binfmt to a qemu 7.2 under which Fedora's package manager does not survive emulation. The job now registers a pinned current qemu (`tonistiigi/binfmt:qemu-v10.2.3`) and runs `.github/prebuild-toolchain/emulated-build.sh` in the target-arch image. The mis-staged x86-64 artifacts were removed and each package records the gap in `gjsify.platformsUncommitted`, printed by `audit-runtimes --check` on every run. **A `commit-prebuilds` run on `main` is what closes it** — the audit then requires the `platformsUncommitted` entries to be deleted in the same change. Until then an exotic-arch consumer gets no native bridge and the guarded `imports.gi` probes degrade, which is the honest state rather than the previous unloadable one.
- **Fork PRs have no working CI at all.** Every container job pulls the PRIVATE `ghcr.io/gjsify/ci-fedora:<major>`, and a fork PR's `GITHUB_TOKEN` cannot read another repo's private package. Either publish the image publicly (it contains nothing secret — a Fedora + GNOME devel stack) or accept that external contributions cannot be validated until a maintainer pushes the branch.

### Cross-runtime reachability follow-ups (ADR 0014)

- **Nothing byte-compares a committed prebuild against a CI-built one.** `scripts/check-refs-pin.mjs` (wired into every `build:meson`) catches the three ways a locally-built native artifact diverges from its pinned source — checkout drift, version skew against the npm engine, and a stale `build/` dir ninja will not invalidate. What it cannot catch is a binary that was simply never rebuilt: the `rolldown-native` prebuild had drifted BEHIND its pin for an unknown number of commits and only surfaced when a rebuild finally happened. Close it by having `prebuilds.yml` rebuild and diff the committed artifact (or publish the CI-built one as the source of truth and stop committing hand-built binaries).
- **Three browser bundles are ledgered as NON-GATING in the `browser` CI job.** The axis runs (`main.yml` `browser` job: Playwright/Firefox over the bundles the Fedora `build` job stages, 51 discovered, 48 gating-green), but `$BROWSER_PROBE_GREP` carves out three that were red the moment it was first executed. (a) **`@gjsify/events`** and (b) **`@gjsify/util`** both declare `src/test.browser.mts` as `export * from './test.js'` — re-running the GJS/Node spec files in a browser, which AGENTS.md explicitly forbids (`events` hangs; `util` dies on a bare `process.env` read in one spec). (c) **`@gjsify/streams`** feeds STRING chunks into `new Response(stream).text()` in three cases; per the Fetch spec a body stream must yield `Uint8Array`, and Firefox enforces it where Chromium and undici are lenient — the spec needs `TextEncoderStream` in front of the `Response`. **The same forbidden `export * from './test.js'` shape is in 11 packages** (`assert`, `async_hooks`, `buffer`, `constants`, `diagnostics_channel`, `events`, `path`, `querystring`, `string_decoder`, `sys`, `util`); the other nine pass only because their specs happen to be pure logic. Rewrite all 11 to browser-globals-only entries, then delete the ledger.
- **`@gjsify/worker_threads` ships a `src/browser.ts` with NO browser-axis test coverage.** No `index.browser.spec.ts` backs its `test.browser.mts`, so nothing ever asserted against that entry — which is how the exported `workerData` stayed permanently `null` (fixed, found by reading rather than by a failing test). `@gjsify/zlib`, `@gjsify/vm` and `@gjsify/http` show the pattern to copy. Worth doing before the package is considered for `partial` → `polyfill`, since export parity alone would have passed that bug.
- **`@gjsify/web-globals` declares `node: "polyfill"` but re-exports `@gjsify/webaudio`** (`node: "none"`, hard-bound: `gi://Gst?version=1.0` + a top-level `Gst.init(null)`) from `src/index.ts` and `src/register.ts`. A `--app node` bundle therefore hard-requires the external `@gjsify/node-gi` at module load. Fix by downgrading the slot to `partial` or adding a `src/node.ts` platform entry. Reported on every `audit-runtimes --check` run.
- **The ten `browser:"partial"` slots are RESOLVED as partial — the residual work is per-package, not a slot sweep.** All ten were audited against the `platform-entry-parity` gate; none is promotable, because in every case a NAMED export is unavailable on the browser platform itself (the blocking export per package is recorded in each package's status entry / AGENTS.md row). Parity is necessary but not sufficient — it passes `sqlite`, whose `DatabaseSync` throws from its constructor; treat a green parity gate as permission to look, not a mandate to promote. Still open, per package: **`fs`** — close the 34-export gap over the in-memory `Volume` (does NOT unblock promotion while `FSWatcher` is a never-firing stub); **`sqlite`** — add a `./browser-worker` subpath declared `polyfill` backed by OPFS `createSyncAccessHandle`, leaving `./browser` at `partial`; **`ws`** — the only one of the ten without a `src/test.browser.mts` (its browser entry is 93 LOC; a small spec asserting the `WebSocketServer` ENOTSUP shape + CJS-compat statics closes it); **`crypto`** — only 2 of its 25 root modules have a platform dependency (`GLib.Checksum` in `src/hash.ts`, the `imports.gi` fallback in `src/random.ts`); replacing those makes the ROOT browser-clean with full synchronous Node semantics — the one path that would actually earn `polyfill` — and retires the 1,774-LOC `src/browser/` duplicate.
- **The `native` runtime slot means two different things, and the NativeScript bridge packages use the wrong one.** The routing rule reads `native` as "the RUNTIME provides this API — resolve to `<pkg>/globals`", but `packages/nativescript-bridge/*` declare `nativescript: "native"` in the sense "this package IS the native implementation". None of them ships a `globals.mjs`, so all five resolve to `@gjsify/empty` with a warn-once on ANY `--app nativescript` build that imports them BY NAME — a shipping bug, not a latent one. It also blocks `ALIASES_NODE_FOR_NATIVESCRIPT` from being composed through `withDerivedSlotRouting`. Fix by settling the vocabulary (either a new slot value for "this package is the runtime-native impl", or re-declaring the five as `polyfill`) — an ADR-sized decision because it changes a published `package.json#gjsify.runtimes` contract and `scripts/audit-runtimes.mjs`. Compose the NS table in the same change.
- **Rolldown 1.1.4 emits the `keepNames` helper AFTER its first use.** With `output.keepNames = true` (gjsify's default whenever `minify` is on) a minified bundle can contain `__name(fn, 'x')` at byte ~200 while the helper declaration appears ~9 kB later; `var` hoisting makes the early call `TypeError: __name is not a function`. Reproduced on `--app node` with the `@gjsify/module` node-gi test bundle (the `\0gjsify-gi-node:*` virtual module is ordered first); `--minify false` runs. Upstream (`refs/rolldown`, pinned `v1.1.4` in lockstep with `@gjsify/rolldown-native`) — needs a minimal reproducer filed, or a chunk-prelude workaround if the pin cannot move.

### `--app node` genuine-GJS-source detection is narrower than the reverse bridge it gates

`nodeGiGlobalsInject` keys on BARE ambient globals (`print`/`imports`/`ARGV`), so a genuine GJS source that uses `gi://` but logs via `console.log` — and passes no explicit `--globals` — is not recognised: its `@girs/*` value imports are emptied (`class extends undefined`) **and** its `/register` imports route to `@gjsify/empty`. Verified with both probes. This pre-dates ADR 0012 and hits `@girs/*` and registers equally; ADR 0012 only brought the two into parity via the single `isGjsSourceBuild` gate in `app/node.ts`. Fix by widening the SIGNAL itself — e.g. treat "a `gi://` specifier survived in the bundled graph" as a reverse-bridge build — which closes both at once.

### `@gjsify/node-gi` — a pointer struct FIELD whose length lives in a sibling field marshals EMPTY

`GstMapInfo.data` is a `guint8*` field whose length is carried by the sibling `size` field — a dependency GI cannot express for a struct-field READ. gjs resolves it; node-gi returns an empty array, and reports no error while doing so. Measured on a decoded audio sample: `map: ok=true size=8192 data.length=0` while `buffer.extract_dup(0, 8192)` returns 8192 bytes. That silent zero is what made audio inaudible on node for a whole investigation: every layer above reported success on an empty buffer. `@gjsify/webaudio` now uses the copying `gst_buffer_extract_dup`, which works on both runtimes — but any consumer reading a length-in-a-sibling-field pointer will hit this, and the empty result is indistinguishable from a genuinely empty buffer. Fix shape: honour the GIR's `array length=` annotation on struct FIELDS in the field reader (the call-argument path already does), and where the annotation is absent, prefer failing loudly over returning an empty array.

### `@gjsify/node-gi` — `GTK_IS_EVENT_CONTROLLER` assertion failures on the reverse bridge

Running any GTK app through node-gi intermittently produces `Gtk-CRITICAL **: gtk_event_controller_handle_crossing: assertion 'GTK_IS_EVENT_CONTROLLER (controller)' failed` and can take the process down mid-frame. NONDETERMINISTIC, which is the trap: single runs prove nothing in either direction. Measured on the showcase — node 1/6/1 criticals over three consecutive runs, bun likewise, deno clean in the same sample. It is INDEPENDENT of audio (still occurs with audio gated off, and on code predating the GValue marshalling fix). The event controllers are attached by `@gjsify/event-bridge` via `attachEventControllers`, so the likely shape is the JS wrapper for a controller being collected while GTK still holds the C object — a toggle-ref/lifetime question, not a GStreamer one.

### `@gjsify/node-gi` — the `$gtype` surface is incomplete

gjs exposes `$gtype` uniformly (`[object GType for 'X']`); node-gi does not, and the three shapes fail differently — measured against gjs on the same source: `Gio.ApplicationFlags.$gtype` is `undefined` (`makeEnum` freezes a plain member object, no lazy getter); `GLib.Variant.$gtype` is a static-method THUNK (`$gtype` falls through the struct proxy to method resolution); `String(Gio.Application.$gtype)` throws `Cannot convert object to primitive value` (the GType handle is a bare tagged External). The handle works fine as an ARGUMENT (`GObject.Value.init(GObject.TYPE_STRING)` round-trips), so this is a surface gap, not a marshalling one. Fix shape: attach the same lazy `$gtype` getter `defineLazyGType` gives classes to `makeEnum`'s frozen object and to the struct path that misses it, and give the GType handle a `toString`/`Symbol.toPrimitive` + `.name` so it prints like gjs's GType object.

### `@gjsify/napi` — a tsfn claim nobody hands back still leaks its control block

`finalize_env_tsfns` (`src/cc/tsfn.cc`) partitions `thread_count` by owner; only the claims a foreign thread demonstrably holds are joined (2 s deadline). Whatever is still outstanding afterwards makes the tsfn DETACH — its JS-side resources are freed and the control block is handed to whichever thread returns the last claim, which then frees it. That is Node's `MaybeDelete()` posture and it closes the force-free UAF window for good, but it inherits Node's consequence: **if no thread ever returns the claim, ~840 bytes leak for the process lifetime** (measured: 264 direct + 576 indirect, valgrind, 0 memory errors). Both outcomes warn unconditionally. Two residuals worth a decision later: an unattributed claim a foreign thread genuinely holds is not joined (safe, but the warning can only say "never attributed" — closing it needs an ownership signal N-API does not expose); nothing reclaims a detached control block at process exit (a per-env registry of detached tsfns would trade the leak for a much harder lifetime question; today the leak is accepted because Node accepts it). Measured on every CI run by `test/tsfn-teardown-gate.mjs` (Linux + macOS legs).

### Regenerate the register-globals closure map after a `GJS_GLOBALS_MAP` change

`node packages/infra/cli/scripts/generate-register-closure.mjs` (`--check` reports staleness). A stale map is fail-soft — builds stay correct but pay extra `--globals auto` analysis passes. (The related hazard — the committed CLI bundle inlining a stale map — is closed: `.githooks/pre-commit` triggers on `packages/infra/resolve-npm/lib/` and `packages/infra/rolldown-plugin-gjsify/src/`.)

### `@gjsify/rolldown-native` macOS prebuild — the last step to a Node-free toolchain on macOS

The Rust blocker is GONE (eventfd descriptors → portable anonymous pipes in `src/rust/src/wakeup.rs`; `cargo check --target aarch64-apple-darwin` green) and `meson.build` is darwin-ready — but no NATIVE macOS build has been promoted: run the manual-dispatch `build-prebuilds-macos-experimental` job, promote the package into the REQUIRED `build-prebuilds-macos` job, add `darwin-arm64` to `package.json#gjsify.platforms`, and commit the prebuild. Until that leg is green the docs must keep describing the Node-free toolchain as Linux-only. The CLI-side loading follow-ups are DONE (`detectNativePackages()` resolves `<os>-<arch>` for the running host; `buildNativeEnv()` emits the loader variable the host actually reads). Only the artifact itself is missing. (See also the CI coverage item above — the darwin leg is proven, not promoted.)

### Follow-up — adwaita-web style isolation (ADR 0010)

The style-isolation boundary reset (`scss/_reset.scss`) landed. Remaining: document the `--adw-*` / `--*` token set as the public theming contract on the website (the sanctioned external-override API — the counterpart to the isolation); if a second light-DOM Adwaita renderer ever appears, lift the boundary reset into `@gjsify/adwaita-core` (headless) so both share it; keep `$adw-components` in `_reset.scss` in sync with `src/elements/*` (guarded by `style-isolation.spec.ts`). Shadow DOM stays a documented FUTURE option, not adopted.

### Follow-up — adopt `@gjsify/adwaita-app` in the shell consumers (ADR 0009)

Adoption is opportunistic, not a rewrite — wire each consumer onto the shell package on its next shell touch: `@gjsify/storybook` (re-base `StorybookApplication` onto `AdwaitaApp`/`runAdwaitaApp`), buchhaltung (`app/src/frontends/desktop` — replace its hand-rolled application/nav/loadIntoStack/toast/dialog code; follows the release train), eco-retrofit (`cli/src/app` — same; also fixes its latent `Adw.Application.run(null)` → `runAsync()` hang class).

### Stale PixelRPG maker bundle — rebuild + recommit with `installDevtools`

`@gjsify/devtools` exports `org.gjsify.Devtools` correctly in every app config (verified rigorously, guarded by `tests/e2e/devtools-export`), and the css-as-string bare-`@import` gap that blocked the maker's rebuild under the global GJS CLI is fixed at the core (native `bundle()` path resolves + inlines bare-specifier `@import`s via `cssBundleResolver`; unresolvable imports fail loudly; `tests/e2e/css-as-string-bare-import`). Residual (map-editor repo, not gjsify): the committed `apps/maker-gjs/org.pixelrpg.maker` bundle predates the `installDevtools(this)` call — rebuild + recommit it. `installDevtools` logs `[gjsify-devtools] exported …` so "did devtools come up?" is answerable from the app's stderr.

### Architecture backlog — ADRs 0001–0008

Decisions in [docs/adr/](../docs/adr/README.md), prioritized backlog in [docs/reports/2026-07-01-architecture-review.md](../docs/reports/2026-07-01-architecture-review.md). Remaining open work (resolved sub-items are recorded in the commits/CHANGELOG that closed them):

- **ADR 0001 (P1)** — install non-destructive invariant: the Phase D.8 dedup pass is still open (the e2e guards, per-prefix lock, atomic writes and conflict warning have landed).
- **ADR 0006 (P1)** — per-package build cache: **CI wiring DEFERRED** — enabling it on the `main.yml` build steps timed out the serial `Build examples` step (cold cache + per-package closure re-hashing at scale). Remaining: (a) memoize input hashes across a single `foreach` before re-enabling in CI; (b) phase 2 = source-direct workspace-consumption spike.
- **ADR 0003 (P1)** — tiering shipped; the website still lacks a per-package tier index (the tier model is documented on the versioning page).
- **ADR 0002 (P1, after 0006)** — **amended 2026-08-02**; read the amendment before implementing, the original decision 2 is unimplementable. Minimal version-free `bootstrap/bootstrap.gjs.mjs` (install+run+integrity) built from the SAME commit stays tracked; the full CLI/tsc/bundler-engine come from a pinned `.gjsify/toolchain/` prefix, NOT from `gjsify-lock.json` (it holds 0 `@gjsify/*` entries — a workspace name can never appear there). `affected.gjs.mjs` and `tsc/lib/lib*.d.ts` now STAY tracked, with reasons; only `dist/cli.gjs.mjs` + `dist/tsc.gjs.mjs` get untracked. `tests/e2e/bootstrap-install` (does not exist yet — `bootstrap-cold-tree` stops at `--print-plan`) + `tests/e2e/bootstrap-pin` are the gate BEFORE the untracking. The pre-commit hook's four-path heuristic is replaced by a derived `bootstrap.inputs.json` + build-free verifier, not merely shrunk. Byte-reproducibility moves to `release-cut.yml`, it does not disappear.
- **ADR 0007 (P3, easy6502)** — superseded into the full Learn6502 app-web rewrite (own project). Foundation pieces (phone-shell trio, `<adw-source-view>`) have landed on adwaita-web; remaining: the app-web view implementations over these + the classic-tutorial removal + the learn-package HTML target.

(ADRs 0004, 0005 and 0008 are fully implemented.)

### N-API host in GJS (`@gjsify/napi`) — Phase 2+ follow-ups

Phase 0 (full `js_native_api.h` + module loader; better-sqlite3 byte-identical to Node, valgrind-clean; conformance 13 pass / 8 ledgered / 0 fail) and Phase 1 (tsfn surface; node-gi-under-shim byte-identical to native `gi://` across all 21 conformance programs — a CI test oracle, NOT a production path) are complete; the transparent `.node`→`loadAddon` build integration has shipped (`napiNodeAddonPlugin`, e2e-gated byte-vs-Node on all four addon-loading conventions). Open:

- **implement the deferred non-experimental stubs** — `napi_*_bigint_words`, `node_api_create_external_string_{latin1,utf16}`, `napi_create_external_arraybuffer` (currently loud stubs → several of the 8 ledgered conformance programs).
- **crash-class hardening (deferred, non-blocking)** — null `state->wrap` via a back-pointer to close a theoretical teardown-finalizer sibling-unwrap UAF; Node-parity, not a graduation gate.
- **the 4 `NAPI_EXPERIMENTAL` conformance addons** — `node_api_post_finalizer` / `node_api_create_object_with_properties` / `node_api_is_sharedarraybuffer`.
- **node-gyp golden drift watch** — the node-gyp goldens were generated on Node 24 but CI runs Node 22; watch the first CI run for golden drift.
- **cross-platform prebuilds** — macOS darwin-arm64 SHIPPED incl. the tsfn gate (conformance/consumer/valgrind widening deferred; no maintained arm64-macOS valgrind). **Windows (win32-x64): ATTEMPTED, blocked at gjs-on-Windows** — shim-side portability is done and Linux-verified (`.def` exports, `LoadLibraryEx` loader, manual-dispatch `windows` job); a prebuilt MSVC mozjs-140 now exists (servo/mozjs `mozjs-sys-v140.13.0-0`), but no prebuilt libgjs exists for Windows and servo's patched static-lib layout is not the pkg-config `mozjs-140` gjs's meson consumes, so gjs must still be source-built (clang-cl) — and behind that waits the delay-load host-binding wall (no POSIX global symbol namespace; an unmodified node-gyp `.node` binds `napi_*` against the host `.exe`, which `gjs.exe` does not export). Unblocks when a prebuilt libgjs-win32 appears OR gjs builds against the servo mozjs AND the delay-load host-binding is solved.

### GI/GObject runtime for Node (Axis 5) — deferred limitations

`@gjsify/node-gi` graduated Tier 3→2 per ADR 0005 (2026-07-14) — the four gate items landed (teardown crash, vfunc OUT/INOUT, GTK/Cairo layer, second real consumer), the GIMarshallingTests oracle sits at 370 pass / 0 fail, the Excalibur-WebGL and Adwaita-window/storybook GTK capstones render byte-identically to `gjs -m`, and the cross-runtime legs (Bun full core parity, Deno conformance subset) ship from one N-API binary. The step-by-step roadmap provenance lives in git/CHANGELOG. Known gaps left for follow-up PRs (each surfaces a clear error or is benign; none is silently wrong):

- **Cross-runtime consumer survey — prioritized backlog.** `scripts/node-gi-consumer-harness.mjs` generalizes the consumer proof (a package's OWN GJS suite runs `--app node` on node/bun/deno); the `consumer-suites` CI job gates the proof set `sqlite`+`http2`+`zlib` under `--require-pass`. Full survey + gap report: `docs/reports/node-gi-consumer-survey.{md,json}` — 17 packages already run unchanged. Remaining blockers, priority order: **P3** — GLib/GObject marshalling-helper gaps (`ByteArray.fromGBytes`, `GLib.filename_from_uri` undefined; blocks `child_process`/`os`/`module`); **P4** — `normalizeEncoding`/`checkEncoding` unresolved when a polyfill is `--alias`ed onto Node (`crypto`/`string_decoder`). Follow-ups: full 22-package `test:gjs-on-node` rollout + a non-gating full-survey CI job that publishes the table.
- **Bun/Deno conformance is a curated subset, not the full suite.** Excluded from `test:bun`/`test:deno`: the display/GTK tests (CI Xvfb leg), the `--expose-gc` toggle-ref stress leg (Node's GC-safety gate), and the mainloop/runasync/pump uv-integration cases (they assert the Node-only libuv↔GLib bridges; Bun/Deno drive the non-blocking case via `startMainContextPump`, and `async-gio-await` is ledgered for them accordingly).
- **Reverse-bridge polyfill routing over runtime natives** — on Node the global `fetch` stays the NATIVE undici one (the register convention never overrides an existing native), so `@excaliburjs/plugin-tiled`'s fetch-based fileLoader cannot load the root-relative `/res/…` asset paths our GJS fetch/XHR resolve against the program dir. This is what blocks the FULL `excalibur-jelly-jumper` on `gjsify run --runtime node` — everything else boots. Needs an opt-in GJS-parity-globals mode for reverse-bridge builds (route `fetch`/friends to the `@gjsify/*` polyfills over the runtime natives).
- **Gst audio decode/playback on node-gi is PROVEN on node, bun and deno; the residual is the bun/deno pump requirement.** The former nondeterministic decodebin SEGFAULT was the `(transfer full)` GObject IN-arg ownership bug in `marshal.cc`, fixed; measured clean against PipeWire (a real sink-input owned by the runtime pid, 0 crashes/CRITICALs over repeated runs). The harness verdict: node `pass 62/62`, bun/deno `partial 61/62` — the one failure is `onended` not firing in a BARE script, the already-ledgered no-auto-pump property (`ended` rides a `Gst.Bus` watch on the GLib main context; with the context advancing it fires on bun and deno too). Deciding whether `@gjsify/webaudio` should drive the context itself (it cannot import node-gi — ADR 0005 forbids the hard dep) or whether bun/deno should gain node's auto-pump is a separate cut. No CI leg exercises this (needs a sound device); the harness is the reproducible check. Related test-harness fix already landed: `@gjsify/webaudio`'s `test.mts` awaited the spec directly instead of routing through `@gjsify/unit`'s `run()`, so a broken assertion still exited 0 — the same shape is worth checking on any package whose `test.mts` does not call `run()`.
- **`@gjsify/xmlhttprequest` — on DENO every XHR stalls at `readyState 3`, so an asset loader never completes.** Reproduced on the jelly-jumper showcase (`--app node`, `--runtime deno`): all 26 resource requests reach readyState 3 within 10 ms and then NOTHING — no readyState 4, no load/error events, for the whole run. **Bun runs the identical bundle to completion**, so this is deno-specific. Ruled out by measurement (do not re-investigate): GLib sources fire, microtasks drain inside the blocking `Adw.Application.run()`, `Gio.File.load_contents_async` completes, and the two primitives `readFileUrl()` is built from return correct bytes on deno. The stall is inside `send()`'s `Promise.resolve().then(doFetch)` chain and needs instrumentation INSIDE `@gjsify/xmlhttprequest` (its `__GJSIFY_DEBUG_XHR` logs go through `console.log`, which the `--app node` bundle routes somewhere the terminal does not see — fixing that visibility is step one).
- **vfunc chain-up** — OUT/INOUT args supported; the remaining gap is multi-level JS-override chains (a registered subclass of a registered subclass), rejected with a clear error. INOUT *container* args stay deferred (a catchable throw, like the function path).
- **struct gaps** — struct *construction* (`new Ns.Struct({…})`), array-of-struct-by-value element field reads, and GValue BLOB (byte-array) marshalling (surfaced by the sqlite consumer — a bound `Uint8Array` doesn't persist and a BLOB return comes back as a raw boxed handle).
- **`worker.terminate()` mid-native-call** — the `Error::New` `SIGABRT` funnel is CLOSED (every fallible chain checks the swallowed-failure residue; stress: 0 aborts / 200 terminates on both loop shapes, guarded by `test/worker-terminate.test.mjs`). RESIDUAL: a lower-rate SIGSEGV (12/200 ≈ 6%, identical pre-fix) when the terminate lands while the worker OS thread is inside a blocking GLib C call — the terminating isolate racing an OS thread in native code, with no napi frame; pre-existing, the textbook "terminating a worker mid-native-call is documented-hazardous in Node generally" case. Closing it would need Node/V8 to quiesce in-flight native calls before freeing the worker isolate.

### child_process instant-exit pid — upstream GIO gap (issue #503; rewrite scoped + rejected)

`@gjsify/child_process`'s `spawn()`/`exec` read `child.pid` from `Gio.Subprocess.get_identifier()`, which returns `null` once GSubprocess's child-watch (GLib worker-thread context) reaps the child — so an instant-exit child on a saturated runner can lose its pid (Node always reports one). **Resolved at the test layer** (deterministic alive-when-checked process) + **documented as an upstream GIO limitation** (see Upstream GJS Patch Candidates). The `GLib.spawn_async_with_pipes_and_fds` + `DO_NOT_REAP_CHILD` rewrite was scoped and **rejected for now**: it regresses `child.kill()` to a `/bin/kill` shell-out and reimplements env/cwd/stdio/wait-status reaping on a critical path. Revisit IF: (a) a real consumer needs a reliable pid for instant-exit children, or (b) upstream GIO exposes a spawn-time pid. **Filed upstream: [GNOME/glib#3981](https://gitlab.gnome.org/GNOME/glib/-/work_items/3981)**; maintainer verdict: accessor "would be OK" but de-prioritised in favour of pidfds, so the deterministic alive-process test + spawn-time capture (`_capturePidAtSpawn`) is our stable, permanent posture, not a temporary workaround.

### `spawn(process.execPath, [cliBin, …])` under the GJS bundle (showcase.ts)

`showcase.ts` spawns `spawn(process.execPath, [cliBin, 'dlx', dlxSpec])` — the same `process.execPath`-is-the-bundle trap fixed in `spawnOxcLauncher`. Under the committed GJS bundle `process.execPath` is `gjs`/the `.mjs`, not `node`, so `gjsify showcase <name>` under the GJS bundle spawns the wrong interpreter. Two-part fix (mirror `spawnOxcLauncher`): resolve the launcher via `nodeBinary()`, and use the blocking spawn path under GJS (a command that returns normally must not rely on the async exit event — see AGENTS.md § Lint & format). The deeper root — making async `@gjsify/child_process` spawns usable from CLI commands that return normally — is worth a dedicated fix (would also unblock spawn-based `gjsify test` under GJS).

### `@gjsify/sqlite` exec() compound-statement (CREATE TRIGGER) splitting

`DatabaseSync.prototype.exec()`'s `#splitStatements()` is comment/quote-aware, but still a token-level scanner, not a parser — a compound statement whose body carries inner semicolons is shattered: `CREATE TRIGGER t … BEGIN INSERT …; … END;` splits at the `;` after the inner `INSERT`, yielding `incomplete input`. node:sqlite gets this right because SQLite's real parser knows `BEGIN…END`. **Clean fix = let libgda's own statement tokenizer do the splitting** — currently blocked because `Gda.SqlParser.parse_string()` used iteratively hits a double-free under GJS and `parse_string_as_batch()` returns `Gda.Batch` objects rather than `Gda.Statement`s. A heuristic port of SQLite's `sqlite3_complete()` state machine was considered and NOT taken (mis-handles `CASE…END;`, adds risk to the transaction `BEGIN; … COMMIT;` path). Revisit when the libgda `parse_string` limitation is resolved (then the hand-rolled splitter can be retired entirely).

### oxlint native path — deferred (JS-plugin host needs Node)

`gjsify lint` still spawns the npm `oxlint` Node launcher even under GJS. A `@gjsify/oxlint-native` GI bridge (mirroring `@gjsify/oxfmt-native`) could only run the Rust rule subset: the JS-plugin host that executes `.oxlintrc.json` `jsPlugins` (the internal `gjsify/register-class-order` rule) lives in the Node launcher, so a native lint would silently skip that rule — a worse failure mode than requiring Node. Options when picked up: (a) native lint as an explicit opt-in subset (`GJSIFY_OXLINT=native`, warn when jsPlugins are configured); (b) port `register-class-order` to a Rust rule upstream; (c) wait for oxlint's plugin host to become embeddable without Node. Until then: `gjsify format`/`fix`'s oxfmt half is Node-free under GJS, `gjsify lint` (and the oxlint half of `fix`) needs Node.

### gjsify on Flatpak — remaining roadmap

The `org.freedesktop.Sdk.Extension.gjsify` SDK extension (toolchain under `/usr/lib/sdk/gjsify`, no network and no Node at app-build time, x86_64 + aarch64, `gjsify-tsc` included, e2e-gated incl. a real `flatpak-builder` tier) and the Node-free self-build (the committed GJS bundle rebuilds the CLI itself via native rolldown; e2e `tests/e2e/self-host`) have both landed. Open:

- **Flathub-grade offline-sources build** — vendor via `gjsify flatpak sources` instead of `../` file paths; only needed for an actual Flathub submission, which is itself gated on Flathub's Generative-AI policy (extensions/runtimes are in scope → discretionary "mature, well-maintained" exception; a gjsify-owned OSTree remote sidesteps it).
- **Remaining Node touchpoints for a FULLY Node-free self-build** — oxc lint (oxlint's JS-plugin host needs Node — see the oxlint entry above) + switching the build-orchestrator entry from the Node CLI to `gjs -m cli.gjs.mjs`.
- **`gjsify install --offline`** — a fail-fast-on-cache-miss flag so a no-network sandbox install errors clearly instead of attempting (and slowly failing) a network fetch. Complements `gjsify flatpak sources`.

### Upstream PRs in flight (NativeScript) — track until merged

Two fixes contributed upstream so NS apps work without gjsify-side workarounds. **Both OPEN as of 2026-06-04.** Revisit when either merges + ships in a NativeScript release: drop the corresponding workaround, then bump the version floor / re-validate.

| PR | Fixes | Our interim workaround | Drop when merged + released |
|---|---|---|---|
| [NativeScript/NativeScript#11259](https://github.com/NativeScript/NativeScript/pull/11259) — `fix(vite): support Vite 8 / Rolldown` | `@nativescript/vite`'s function-replacement `resolve.alias` + `@rollup/plugin-commonjs` that Vite 8 / Rolldown reject | `@gjsify/nativescript-vite`'s `applyVite8Fixes()` drops both at compose time | When `@nativescript/vite` ships Vite-8 support, `applyVite8Fixes` can shrink to (or drop) the two fixes — gate on the `@nativescript/vite` version |
| [NativeScript/nativescript-cli#6056](https://github.com/NativeScript/nativescript-cli/pull/6056) — `fix(bundler): copy the vite bundle to native in non-watch builds` | NS CLI copies the Vite bundle into the APK only in watch mode; `ns build` / `ns run --justlaunch` leave `assets/app` empty → SBG fails | `tests/integration/nativescript/scripts/run-on-device.mjs` does `ns prepare` → manual copy → `gradle assembleDebug` | When the fixed NS CLI ships, the runner can use plain `ns build` / `ns run --justlaunch` again |

Check status: `gh pr view 11259 --repo NativeScript/NativeScript --json state` / `gh pr view 6056 --repo NativeScript/nativescript-cli --json state`. No CLA required on either repo; both are auto-reviewed by CodeRabbit — address only blocking findings.

### NativeScript apps that pull web-API third-party deps — eval-time global injection (Welle 5 follow-up)

On-device teapot re-validation confirmed the css-tree fix, but the teapot still does not render on NS V8: its third-party deps (`@nativescript/canvas-polyfill`, `@xmldom/xmldom`, `three`) instantiate web globals at module-evaluation time (`new TextEncoder()` / `new XMLHttpRequest()` / `new FileReader()` at top level) and NS V8 doesn't provide those globals that early. The same class as the `@gjsify/buffer` eager-`TextEncoder` bug, but in deps gjsify doesn't own. The gjsify-side fix is a composer feature: inject/seed the web-API globals (or hoist canvas-polyfill's registration) at the very top of the NS bundle, before any module evaluates — analogous to the GJS `process-stub` `renderChunk` prepend. Design open (which globals; seed-from-`@gjsify/web-*` vs hoist canvas-polyfill; `optimizeDeps`/`renderChunk` prepend). Until then, NS apps whose dependency graph instantiates web globals at eval time (canvas/WebGL/three.js stacks) build but crash on launch; headless logic packages run fine. Related open items:

- **NS CLI 9.0.6 Vite bundle-copy is watch-mode-only** — `compileWithoutWatch` never calls `copyViteBundleToNative`; the smoke runner works around it (manual copy after `ns prepare`); the real fix is the upstream NS-CLI PR above.
- **iOS smoke test** — only Android was validated on-device; the platform path is symmetric (`.ios` extensions, `__IOS__`/`__APPLE__` defines) but unproven; add an iOS build smoke test when a macOS runner is available.
- **Conditional-export precedence** — `resolve.conditions` keep upstream's `browser` active alongside `nativescript`; a package with divergent `browser` vs `nativescript` conditional exports may resolve its `browser` variant. Decide a policy (drop `browser` for NS, or document) + add a regression test.
- **Worker builds** — the upstream `worker` config is passed through verbatim; gjsify transforms are not propagated into `worker.plugins`. Validate + propagate when a worker-using NS showcase lands.
- **Full ownership (Level 3)** — the composer keeps `@nativescript/vite` as an optional peer. Owning the NS-runtime plugins outright remains the larger goal — gated on whether the peer proves a maintenance burden + the upstream NS-CLI pluggable-`bundler` PR.

### NativeScript pillar coverage (Welle 5+, parallel implementations)

The slot backfill (all 80 declarable packages), `@gjsify/native-fs-bridge`, the `@gjsify/crypto` NS entry and the on-device integration suite have landed. Remaining Wellen (each a separate PR/worktree):

- **Welle 5-D — `@gjsify/stream` + `@gjsify/http`-client** (M): client-side over NS' native `fetch()`; server-side (`createServer` etc.) throws ENOTSUP; `runtimes.nativescript: 'partial'`.
- **Welle 5-F — extend `tests/integration/nativescript/`** per pillar as 5-D lands (CI runner may need a privileged container for the NS emulator stack).
- **Welle 5-G — `gjsify create-app --template nativescript-*`** (M): mobile-app scaffold templates. Adwaita-feel-on-mobile is an open design question — could use NS' native UI with gjsify polyfills providing the data layer.

### NativeScript build-feature ownership — Level 3 (gjsify as a first-class NS production bundler)

Level 2 (platform file resolution + platform defines) is owned by gjsify. **Level 3 (north-star, L, multi-week):** make `gjsify build --app nativescript` (or the Vite preset) produce a standalone NS-loadable production bundle, replacing `@nativescript/{webpack,vite}` for the JS-bundling step. The NS-runtime subset still to replicate: main-entry + bundle-emit to NS's expected dist layout (≈150 LOC sans HMR), static-copy of `App_Resources`/fonts/assets, the `@NativeClass()` transform (≈43 LOC), optionally app-components/XML page registration (≈278 LOC — skippable for code-only canvas apps) + CSS/theme-core. HMR is the bulk of `@nativescript/vite`'s complexity and is NOT needed to ship (production-only target). **Hard blocker:** NS's CLI bundler dispatch is a hardcoded `webpack|rspack|vite` switch — `bundler: 'gjsify'` needs an upstream NS-CLI PR for a pluggable bundler, OR gjsify masquerades under the `vite` name (current Level-1 path). The spawn contract is discoverable (`node <bundler>/bin build --config=<path>`, `NATIVESCRIPT_BUNDLER_ENV` JSON env, dist copied into APK assets).

### Website & docs follow-ups

Collected user-tracked items — every one turns existing engineering work into something visible / measurable for users.

- **Test + extend the new showcases, then embed them on the website.** Each showcase needs: (1) a manual smoke-test on GJS (`gjsify showcase <name>` end-to-end), (2) gaps turned into fixes or tracked follow-ups, (3) a `website/src/content/docs/showcases/<name>.mdx` page embedding the browser entry for live demo + describing the GJS counterpart.
- **Bridge widgets docs on website.** `@gjsify/canvas2d` / `@gjsify/webgl` / `@gjsify/iframe` / `@gjsify/video` are documented inline in AGENTS.md but there is no user-facing doc explaining the pairing matrix (DOM element ↔ Bridge class ↔ GTK widget) and the `installGlobals()`/`onReady()` lifecycle. Target one Astro page under `website/src/content/docs/framework/bridges.mdx` with a minimal worked example per bridge.
- **Web/Node compat as progress bars on the website.** The Summary table is consumed by `website/scripts/generate-coverage.mjs` → `src/data/coverage.ts`; extend the same treatment per package on the detail pages.
- **Ship `gjsify` and `ts-for-gir` themselves as Flathub CLI apps.** The `gjsify flatpak --cli-only` path already produces the right shape; take both CLIs through the full Flathub-submission flow (manifest in `flathub/<app-id>`, `flatpak-builder` validation, appstreamcli + `flatpak-builder-lint`, screenshots/release notes).

### WebGL deferred items (Workstream D)

- **Optional headless drawing-buffer pre-allocation.** `_init()` (`webgl-context-base.ts`) leaves the headless-gl-style `_allocateDrawingBuffer` call commented out because `GtkGLArea` owns the surface. Re-enable if/when a non-GTK output path is added.

### Flatpak helper subcommands — downstream adoption (PR3–PR6)

`gjsify flatpak {init,build,deps,ci}` and the bundler-side primitives they lean on have landed. Remaining downstream work: PR3 (ts-for-gir-cli adopts `defineFromPackageJson`), PR4 (app-gnome Vite → `gjsify build`), PR5 (app-gnome flatpak workflow on top of `gjsify flatpak`), PR6 (CLI-flatpak example docs page — the documented `org.gjsify.TsForGir` shape: GNOME Platform runtime + read-only `/usr/share/gir-1.0` mounts).

### TLS gaps that Gio does not surface (Workstream B follow-up)

Server-side SNI, session resumption and channel binding are resolved (see the `@gjsify/tls`/`tls-native` status entries). Remaining gaps map to GnuTLS/OpenSSL features Gio's GI bindings do not expose:

- **OCSP stapling.** Neither client- nor server-side OCSP is exposed by Gio (`gnutls_ocsp_status_request_*` has no GI binding), so `tls.connect({requestOCSP})` / the `'OCSPResponse'` event cannot be implemented end-to-end without a native bridge wiring `request_ocsp_status` into `Gio.TlsConnection`. Partial unblocker shipped: `@gjsify/tls-native` Phase 1 `parseOcspResponse(bytes)` (RFC 6960 DER parser), surfaced via `@gjsify/tls` with the `hasOcspSupport()` graceful-degradation gate — consumers can fetch OCSP responses themselves (e.g. via the cert's AIA responder URL) and validate status without bypassing Gio's TLS stack. The Gio-side `request_ocsp` wiring (responses arriving automatically over the handshake) stays open.
- **DH params / explicit ECDH curves / ticket-key rotation.** Gio does not expose `g_tls_server_connection_set_dh_params` or equivalent. Server tuning happens via `GIO_USE_TLS=gnutls` env at process level; not per-connection.

### SharedArrayBuffer constructor opt-in (Mozilla pref)

- **`SharedArrayBuffer` constructor is unavailable in stock GJS** (`typeof SharedArrayBuffer` is `undefined` on GJS 1.88): Mozilla disables it unless the SpiderMonkey embedder opts in, and GJS does not. Upstream patch candidate: enable the SharedMemory pref in `gjs/engine.cpp` + the matching `Atomics.wait`/`notify` capability bits. Workaround landed: `@gjsify/sab-native`'s `SharedBuffer` (method-accessor API + free-function `atomics` namespace over memfd/mmap/futex) does not require the constructor at all and is wired into `Worker.postMessage`.
- **Generic `ArrayBuffer` cross-process transferList.** `Worker.postMessage(value, transferList)` for a plain `ArrayBuffer` (not a `SharedBuffer`) still goes through JSON IPC and stays a deep-clone, not a zero-copy hand-off — the SCM_RIGHTS side-channel only carries memfd-backed regions; arbitrary ArrayBuffers would need a generic binary IPC frame format (or a SharedBuffer-as-ArrayBuffer wrapper the structured-clone layer recognises). Lower priority — SharedBuffer covers the high-bandwidth workloads.

Use `@gjsify/worker_threads` `MessageChannel` (in-process) for zero-copy / pure-`ArrayBuffer` workloads today; cross-process SharedBuffer for shared-memory workloads across subprocess workers.

### ts-for-gir — extend integration suite beyond Phase 4b

Strategic goal: `ts-for-gir` runs unmodified on GJS. Phases 1–9 have landed (see the integration-coverage notes). Remaining:

- **Phase 6 / gjsify run:** runtime npm-package resolution for GJS bundles (GJS has no node_modules resolver; would need a C-level patch).
- **Phase 8 / GVariant type-inference:** full port of `gvariant-validation.test.ts` — requires `@girs` ambient declarations resolvable by the TypeScript compiler.

`refs/ts-for-gir/` is pinned at the commit corresponding to `@gi.ts/parser@4.0.0-rc.9`; bump the submodule alongside the published-package version when porting future phases.

### Universal DOM Container (`@gjsify/dom-bridge`)

Architectural vision for unified DOM-in-GTK: `document.createElement("canvas")` + `getContext("2d")` automatically creates the right GTK widget behind the scenes; `document.body` maps to a real GTK container hierarchy; each child element gets its own bridge transparently — making browser code "just work" in GTK without explicit bridge creation. Deferred from the initial bridge architecture — requires deeper integration between `Document`, `Element.appendChild`, and the GTK widget tree.

### Autobahn — wire into CI

Full Autobahn suite (core + permessage-deflate + performance 9.\*) is part of the committed baseline. Remaining: (1) the `6.4.x` NON-STRICT fragmented-text timing needs an upstream libsoup change (fragment-level UTF-8 validation — see Upstream GJS Patch Candidates); (2) Podman-in-CI needs privileged containers (or socket sharing) the Fedora-based CI doesn't currently grant — until then the suite is a manual opt-in run + baseline-commit workflow. Plan: wire the autobahn scripts into a nightly CI job once Podman-in-CI is unblocked.

### Autobahn driver — `System.exit()` bypass in bundled driver context

`System.exit(0)` called from the bundled driver's `Promise.then` continuation silently returns without terminating the gjs process (the GLib main loop `ensureMainLoop()` starts for Soup keeps the process alive after `main()` resolves), even though the same call works from a standalone script or a MainLoop idle callback. `scripts/run-driver.mjs` compensates with a watchdog (waits for the `Done.` marker, 3 s grace, then SIGKILL — no data loss; the report is flushed before `Done.`). Next steps to remove it: isolate whether the block is in `@gjsify/process`'s `exit()` shim, the `globalThis.imports` patching, or an interaction with `@gjsify/node-globals/register`; write a minimal reproducer outside the Autobahn pillar; fix root-cause and inline `gjs -m dist/driver-*.gjs.mjs` back into the package scripts.

### `@gjsify/sqlite` — expand API surface

Libgda does not expose session/changeset, WAL-mode toggles, backup or VFS APIs, so those are open gaps beyond the current DatabaseSync/StatementSync coverage. The closest paths: (a) wrap sqlite3 directly via libsqlite3 GI bindings (expensive — no upstream GIR), or (b) live with the libgda-shaped subset and document the gaps per API. (b) is the current direction; `sqlite.constants` (SQLITE_CHANGESET_\*) remains unimplemented until (a).

### WebRTC showcases (extended)

`webrtc-loopback` is a published showcase. Open follow-ups: `webrtc-video` could be a second showcase (getUserMedia + media pipeline; needs camera-permission UX — separate workstream); `webrtc-dtmf` / `webrtc-states` / `webrtc-trickle-ice` remain private reference implementations for specific spec behaviors, not end-user showcases.

### Doc-revert detection — a non-conflicting revert of a `main`-only edit

`a9e5ba63d` (on the status-as-data branch) rewrote the AGENTS.md governance
block against a copy of the file that predated #885's consolidation. Git merged
it without a conflict, because "replace one line with five" is a legitimate edit
on a region the other side had already rewritten — the merge base simply had
neither version. The result silently restored ~5 duplicated paragraphs that #885
had removed, and nothing in the pipeline could see it: prose has no test, no
type, and no conformance rule.

The generalisable check is cheap and does not need to understand prose: for each
line a PR REMOVES, ask whether that exact line was ADDED to the base branch after
the PR's merge base. A hit means the PR is reverting work it never saw. Real
reverts and genuine rewrites both trip it, so it must be a warning with an
explicit acknowledgement path (a `Revert-Of:` trailer, or a label), never a hard
gate. Cheapest home: a step in the `check` job over `git diff --merge-base`,
scoped to `*.md` first, since prose is where the class actually bites — source
regressions of this shape are usually caught by tsc, lint or a test.

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

### CHANGELOG links break on `#nnn` written inside commit bodies

conventional-changelog scans commit BODIES for issue references, so prose like
"pre-#885" or "#870/#873" becomes a link to `github.com/gjsify/pre-/issues/885`
and `github.com/870/gjsify/issues/873`. Both are in the published v0.26.0
changelog. Either stop writing bare `#nnn` mid-sentence in commit bodies (a
convention nothing enforces, so it will regress), or configure the parser's
`issuePrefixes`/reference handling so only trailer-style references count.

### Nothing byte-compares a committed prebuild, and macOS re-commits noise

AGENTS.md already records that committed `prebuilds/**` binaries are unguarded
(provenance proves the inputs; nothing compares the bytes). The v0.26.0 sweep
showed the other half of that gap: `commit-prebuilds` pushed six darwin-arm64
dylibs whose sizes were IDENTICAL to their predecessors (37144 -> 37144, and so
on) but whose bytes differed — non-reproducible Mach-O output (timestamps,
UUIDs). So every macOS prebuild run commits binary churn with no semantic
change, and that push moved `main` out from under an already-verified sweep
mid-release. Worth fixing at the source (reproducible flags) rather than by
suppressing the commit, since byte-reproducibility is what would let a future
check compare a committed prebuild against a CI-built one at all.

### What still writes to `main` unverified, after the bot push got a gate

`commit-prebuilds` now runs the checks that read its own output on the tree it is
about to push (`Gate the tree being pushed`), which closed the incident where
f5d250b32 cleared `gjsify.platformsUncommitted` under a CI-skip directive and left
`tests/e2e/platform-exemption-clearing` red on every open PR for hours. A sweep
done while fixing it found five more holes in the same write path. One is fixed
(`packages/napi/napi-linux-x64/prebuilds/` is no longer committed — it had no
producer, so the honest shape was a `gjsify.platformsUncommitted` entry, which is
what its darwin sibling already carried). The remaining four are verified reads,
none is fixed:

- **`download-artifact` MERGES and nothing prunes.** Each step extracts into an
  existing `prebuilds/<target>/` without clearing it, `git add` only adds, and
  `Refuse to delete a committed prebuild` forbids removal — so a `meson.build`
  change that renames a library or drops a `.gir` leaves the stale file beside the
  new one, and `files: ["prebuilds"]` publishes both.
- **The committed `.gir` files are validated by nothing on Linux.**
  `prebuild-artifacts` looks at `LIB_EXT[os]` and `.typelib`; `prebuild-libc` reads
  ELF. No rule enumerates expected files, only "at least one lib + at least one
  typelib", so a leg that stops emitting a `.gir` is silent.
- **`prebuild-artifacts`' dlopen probe degrades to a NOTE on `ubuntu-latest`,**
  which is the runner that gates the push: no libsoup3 / GStreamer / GTK4 /
  libepoxy, so the linux-x64 artifacts of http-soup-bridge, http2-native, webgl and
  webrtc-native are never actually loaded there. The gate proves declarations and
  file shape, not that an artifact loads.
- **Two `commit-prebuilds` jobs can race.** Non-PR runs get a concurrency group
  keyed by `run_id` with `cancel-in-progress: false`, deliberately — so a
  `workflow_dispatch` run overlapping a `push` run means one `git push` is rejected
  non-fast-forward, the step fails, and every binary that run downloaded is
  discarded with no retry.

Adjacent, same cause, different workflow: `commitlint.yml` triggers on
`pull_request` only, so neither bot path to `main` — the prebuild push nor
`chore: release v${version}` — is ever linted, while
`@release-it/conventional-changelog` walks exactly those commits to build the
CHANGELOG.

The one lever not pulled is **dropping the CI-skip directive from the prebuild
push**. Checked: it cannot loop (`prebuilds.yml`'s own `push` paths list sources,
meson files and scripts — not `packages/*/*/prebuilds/**`), and it would buy the
only coverage the new gate structurally cannot reach: the two specs that genuinely
LOAD a committed prebuild under GJS in `main.yml`'s `test` job. It costs one full
`main.yml` run per landing, which is rare. It detects rather than prevents, so it
is a complement to the gate, not a replacement — decide it deliberately.

### Neither `@gjsify/napi` release prebuild leg load-tests the artifact it ships

`release.yml`'s `napi-prebuild-linux` and `napi-prebuild-darwin-arm64` do `meson
setup` → `meson compile` → `cp` → `upload-artifact`, and stop. AGENTS.md's rule is
"ANY new prebuild job MUST end in a load test", and every other producer obeys it:
`napi.yml`'s own jobs run the full gate set, `node-gi`'s release legs run
`node --test test/smoke.test.mjs` against the staged prebuild, `prebuilds.yml`'s
macOS matrix ends in `gjs -c 'imports.gi.<Ns>.<Class>'` plus an env-free
`ctypes.CDLL`. `publish-napi` only `test -f`s the four downloaded files, which is
existence, not loadability — the exact distinction #832 was written about.

Pre-existing, and now load-bearing for linux-x64 rather than only for darwin: with
`packages/napi/napi-linux-x64/prebuilds/` no longer committed, `prebuild-artifacts`'
env-free `dlopen` no longer runs on it (it was the one napi check that actually
EXECUTED the artifact — verified loading under `gjs 1.88.1` before removal), and
napi.yml's gates load from `build/`, not from the prebuild path. So no job now proves
that the bytes a release publishes can be opened. Fix = the same two steps the macOS
legs already carry, added to both release legs; deliberately not done in the change
that removed the committed copy, because that PR landed hours before a `minor`
release and the release path is the one place a bad edit is unrecoverable.

### A workflow GitHub refuses to load reports the PR as GREEN

When GitHub rejects a workflow file it creates a run with ZERO jobs, hence zero
check runs — so the pull request shows green while the workflow never ran. The
only visible trace is a run oddly named after the file path instead of the
workflow name.

Measured: moving nine jobs onto the baked CI image deleted a single-line `run:`
and left a step carrying only a `name:`. GitHub refused the whole file, six
node-gi jobs silently did not run, and the PR reported **24 green checks**. It
was caught by asking why the expected job names were missing, not by any signal.

Another workflow CAN see what the broken one cannot report — `audit-runtimes.yml`
already runs pure-Node repo checks on every PR with no install — so the gate has
an obvious home. The trap is the checker itself: a hand-rolled YAML outline
scanner written for this produced 17 false positives on `prebuilds.yml` and
`release.yml`, both of which GitHub loads fine, and a check that cries wolf is
worse than none. Node ships no YAML parser, so the real options are `actionlint`
(purpose-built, one Go binary, catches far more) or python3 + PyYAML, which the
ubuntu runners already have and which gave the correct answer — exactly one
offending step — when used ad hoc. Pick one deliberately; do not hand-roll.

### `needsWebgl` in `showcases.json` is declared, parsed, and read by nobody

`packages/infra/cli/showcases.json` carries a `needsWebgl` boolean per showcase;
`discover-showcases.ts` declares it on `ShowcaseInfo` and coerces it into the
parsed record. Nothing anywhere reads that field — not `showcase.ts`, not the
website, not a test. It is the shape every rule in the manifest-conformance
registry exists to prevent, one directory away from where those rules look
(`field-coverage` governs `gjsify.*` keys in package manifests; this is a
free-standing data file).

It has already drifted in the way an unchecked declaration always does:
`excalibur-jelly-jumper` is recorded as `needsWebgl: false`, while Excalibur
0.32 uses WebGL2 exclusively — a fact the `WebGLBridge` init-render comment
documents in detail, because eagerly creating the webgl2 context there is what
keeps that showcase from rendering into the wrong FBO.

Two honest resolutions; pick one deliberately rather than leaving the third
state:

- **Delete it.** Every showcase that needs the bridge already declares
  `@gjsify/webgl` as a runtime dependency, which is what actually gets the
  typelib into the dlx tree. The field then encodes nothing the manifests do not.
- **Make it load-bearing.** `@gjsify/webgl` ships prebuilds for linux-x64,
  linux-arm64 and darwin-arm64 only, so `gjsify showcase three-geometry-teapot`
  on win32 installs a tree with no `prebuilds/<target>/` and dies at
  `gi://Gwebgl` with a raw GI error. A pre-flight keyed on this field could say
  which showcase needs which bridge and that the host has no prebuild for it —
  worth having while win32/darwin are active port targets. Needs the fix to
  `excalibur-jelly-jumper` in the same change, and a check so the next entry
  cannot be wrong for free.
