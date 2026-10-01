<!-- Authored Open-TODO sections — area: Prebuilds and platform artifacts.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### `HOST_TARGET` is libc-blind, so the audit dlopens the wrong directory on musl

`HOST_TARGET` in `packages/infra/manifest-conformance/lib/platforms.mjs` is
`${process.platform}-${process.arch}` and nothing more. `prebuild-artifacts`'s Half 2b
compares a committed directory's canonical token against it to decide which one to load
for real (`canon !== HOST_TARGET` → structural check only), so on an Alpine or
postmarketOS host it dlopens `prebuilds/linux-arm64/`, which is the glibc build and
cannot load there, and skips `prebuilds/linux-arm64-musl/`, which is the one that can.

Unreachable until the first `-musl` directory is committed, which is what #1607 arranges.
Measured on a OnePlus 6T (postmarketOS v26.06, musl 1.2.6, aarch64, gjs 1.88.1) against
that PR's own CI artifacts: the `linux-arm64` build of `@gjsify/lightningcss-native` fails
with `Error relocating …/libgjsify_lightningcss.so: gnu_get_libc_version: symbol not
found`, the `linux-arm64-musl` build loads and minifies CSS correctly. So the audit run on
such a host answers both halves wrongly at once.

Two things are missing and neither is a one-liner. A host-libc probe belongs in
`platforms.mjs`, which today reaches for no runtime facts beyond `process`; and a CI leg
that runs `audit-runtimes --check` on musl is what would keep the fix honest —
`check-committed-musl` is the closest thing and it deliberately reads binaries rather than
running the audit. Until both exist, the write side (`hostPrebuildTarget` in
`rules/prebuild-libc.mjs`) is the only libc-aware host token in the tree, and it is exact
by design.



### The `os-axis` candidate set cannot see a package whose DATA is OS-specific

Exposed by the entry above, and it is a gap in the rule rather than in a package.

`os-axis` derives who owes a `gjsify.os` from shipping source that READS the host OS —
`process.platform`, `os.platform()`, `@gjsify/utils/core`'s `hostOs()` and friends
(`packages/infra/manifest-conformance/lib/rules/os-axis.mjs`). That is the right
question for ADR 0018's original ten, all of which branch on the OS. `@gjsify/gtk-host`
reads the host OS **nowhere** — verified, zero matches across `src/**` — so it owes no
declaration and correctly has none. Its generated widget table is nevertheless
Linux-shaped, and a Windows host is missing two of its rows.

So the axis is blind in the same direction ADR 0018 says the RUNTIME axis is blind:
"never let one axis answer the other's question" is satisfied, and both still miss this.
A package whose TABLE is derived on one OS is exactly a package that owes an OS claim.

Not closed here because the honest fix is a second derivation signal, not a widened
regex, and picking one is an ADR-shaped decision: candidates could be derived from
"generates code from a platform-specific source" (which `gjsify.widgetVocabulary` and the
generator scripts already mark), or the claim could be demanded of any package a
GTK-bearing OS leg runs. Both are defensible; neither should be guessed at in a CI PR.
The measurement above is the evidence either would rest on.


### The prebuild glibc floor is OBSERVED, never CHOSEN (#924)

The gate half is CLOSED (#1009): `scripts/check-staged-prebuild-libc.mjs` now
runs as "Gate on the glibc floor of what this leg just built" in both build legs
of `prebuilds.yml` (native `:722`, QEMU `:967`), both of which run on
`pull_request`, and the legs carry `nodejs` in their `dnf install`. The staging
question that blocked it is settled too: legs stage via `stage-prebuild.mjs .
--scratch` into the bridge's own scratch directory while the committed binaries
live in the platform packages, so the gate measures the NEW bytes rather than
the old committed ones. A green PR predicts a green main here now.

The #897 incident that produced all of it is preserved where it can still act:
a 33-line banner at `prebuilds.yml`'s `container:` line records that the 43 → 44
bump moved the measured floor 2.39 → 2.43 (glibc 2.43 re-versions
`acosf`/`asinf`/`atan2f`, which lightningcss's colour conversion calls) and
red-lined main for three consecutive `commit-prebuilds` runs. It is pinned to
`fedora:43` for that reason, not by habit.

**What is still open is the deeper half, and it is a policy question, not a
patch.** The floor is a number someone reads off the build image. Even pinned to
`fedora:43` it moves the day that image's glibc re-versions something else.
Choosing it means building the three Rust bridges against a DECLARED baseline —
an old-glibc container (manylinux/RHEL-derived) or `cargo-zigbuild --target
<triple>.<glibc>` — so that `gjsify.glibcRequires` becomes an input the build
satisfies rather than a result it reports. The question underneath is "how old a
distro do we support?", which is why #924's own comment notes its title no
longer describes the state.


### Bundle determinism is unmeasured now that nothing is byte-compared against a commit

ADR 0002 untracked `cli.gjs.mjs` and `tsc.gjs.mjs`, which retires the failure this
entry used to track — a committed bundle that does not rebuild from its own source.
Four mechanisms produced it and all four are gone with the artifact: the
module-order `$N` minifier drift, a stale dependency closure, a release cut
restaling every open PR through the version baked into `buildHeaders()`'s
user-agent, and a rebase silently 3-way-text-merging two minified bodies with no
conflict and no size anomaly.

**What is left is the residual none of those explained**: whether a FULLY rebuilt
closure still emits a different `$N` suffix assignment on a different host. It was
observed once (a local 6595935 B variant matching neither the committed 6594685 B
nor CI's 6594347 B, provenance never established) and never reproduced after the
stale-closure cause was found. With the bundles untracked there is no longer a
committed copy to compare against, so the question has to be asked a different way:
build twice on ONE host with the build cache cleared in between, and compare. That
is the `--determinism` mode owed to `release-cut.yml` per ADR 0002 § Do not.

Its honest limit, which must be stated wherever it lands: it catches a
re-emergence of the ordering class on one host. It does NOT catch cross-host
divergence, which is what the original symptom actually was. Closing that needs
two hosts building the same commit, which nothing in CI does today.

**The one-host half of that question now has an answer, and it is no.** Measured
2026-09-03 while re-checking the `keepNames` entry below: the same
`gjsify build --app node` command over `@gjsify/module`'s node-gi harness entry,
run three times on one host with no source change between runs, produced two
distinct bundles — the first `__name(` call landing at byte 448 in two of them
and at byte 462 in the third, from two gi virtual modules swapping which one
binds the external `createRequire`. Equal byte length, different bytes, so a
size check would have called them identical. That is the `$N`-ordering class
re-emerging on a fully rebuilt closure, which is the residual this entry says was
observed once and never reproduced. It is reproducible now, and it is worth
measuring on a bundle nobody is holding a defect open on before reading much into
which module order is "right".

`affected.gjs.mjs` IS still byte-compared (`scripts/verify-committed-bundles.mjs`),
so the guard exists — it just covers 248 KB instead of 10 MB.


### `--platforms` credits an artifact from the WORKING TREE while its legend says "committed"

`collectNativePackages()` derives `shipped` from `readdirSync(<pkg>/prebuilds)` — presence on disk. The matrix legend renders that as **"artifact committed"**. For every bridge but one those agree, because their `prebuilds/` directories are tracked. `packages/node-gi/node-gi/.gitignore` ignores its own, and `stage-prebuild`/install leave one behind, so the same command prints a different table depending on whose machine it runs on:

    with a staged prebuilds/:  | `@gjsify/node-gi` | 2 | ○ | ○ | ○ | · | · | · | ✓ | ○ |
    without (clean checkout):  | `@gjsify/node-gi` | 2 | ○ | ○ | ○ | · | · | · | ○ | ○ |

Found by committing the generated Platform Support matrix and having a review notice the `✓` did not reproduce. The immediate hole is closed by not committing that file at all (`website/.gitignore`), which is why this is a ledger entry rather than a fix: the audit itself still answers a question it does not ask.

The fix is to credit from git rather than from the filesystem. What makes it more than a one-liner: `tests/e2e/prebuild-declaration-invariant` drives this code against SYNTHETIC packages, which are by construction untracked, so a tracked-ness requirement has to be a matrix-side credit rather than a change inside `collectNativePackages()`. Alternative, cheaper and honest: leave the measurement alone and change the legend to say "artifact present", which then no longer answers "can I install this there?" — the question the page exists for.


### Nothing byte-compares a committed prebuild, and macOS re-commits noise

docs/build-artifacts.md records that committed `prebuilds/**` binaries had no byte
guard at all (provenance proved the inputs; nothing compared the bytes). The v0.26.0 sweep
showed the other half of that gap: `commit-prebuilds` pushed six darwin-arm64
dylibs whose sizes were IDENTICAL to their predecessors (37144 -> 37144, and so
on) but whose bytes differed — non-reproducible Mach-O output (timestamps,
UUIDs). So every macOS prebuild run commits binary churn with no semantic
change, and that push moved `main` out from under an already-verified sweep
mid-release.

**Now measured to the byte, because the same non-reproducibility killed the
commit channel outright** (fixed separately, by removing the rebase — see the
sync script). Diffing two consecutive bot commits of unchanged sources
(`7f4e81291` -> `a03206649`): all **16** committed darwin dylibs changed, every
one at an identical size, and no linux `.so` changed at all — the ELF legs
reproduce exactly. Per file, on darwin-x64, EVERY differing byte is one of two
things: the 16-byte `LC_UUID` payload, and the `n_value` of the `N_OSO`
debug-map stabs, which is each intermediate object file's mtime (e.g.
`libgjsifytls.dylib`: 25 of 44264 bytes — 16 UUID + 9 spread over three
`N_OSO` timestamps, and nothing else). darwin-arm64 adds one more block, its
ad-hoc `LC_CODE_SIGNATURE` blob, whose hashes cover the header those bytes are
in. Zero bytes of `__TEXT`, `__DATA_CONST`, the string table, the chained
fixups or the exports trie differ in any of the sixteen.

**Both halves landed, and the byte count reproduces on a laptop.** Rebuilt on
macOS 27 / arm64: two clean builds of `@gjsify/terminal-native`, 39 152 B each,
differing in **112 bytes** — the 16-byte `LC_UUID` payload at 0x438, one byte of
the single `N_OSO` stab's `n_value` at 0x8530 (its low byte, because the two
builds fell a minute apart), and 95 bytes of the ad-hoc `LC_CODE_SIGNATURE` at
0x9760. So the ledger's darwin-x64 reading is the same defect on arm64 with the
signature added, and nothing else is in it.

**The cause is one flag, and it is not the UUID.** ld64 emits a DEBUG MAP into
any image whose objects carry DWARF — measured directly, by linking a `-g`
object with and without `-g` on the LINK line and reading the map both times —
so the stab's mtime is written whatever the link line says, and meson's default
`debug` buildtype is what puts `-g` on the compile. Every `meson.build` here now
declares `buildtype=plain`. Re-measured the same way, two clean builds differ in
**zero bytes** for all nine darwin bridges a laptop can build without rustc;
`@gjsify/gamepad-native` already had it, through `minsize`, for a different
reason. `nm -a` over the committed set closes the count: **13 of the 16
committed darwin-arm64 dylibs carried `N_OSO` stabs (1–4 each) and the three
cargo cdylibs carry none**, so no DEBUG-MAP channel exists in those three.

**And that last sentence was read as "the three cargo cdylibs reproduce", which
they do not.** `nm -a` reading zero `N_OSO` stabs establishes that no DEBUG-MAP
channel exists in them; it establishes nothing about any other channel, and the
gate below found one on its first run over a tree where all nine Vala bridges
were byte-identical: `@gjsify/lightningcss-native`'s `libgjsify_lightningcss.dylib`
differed in 16 bytes first at `0x670`, `@gjsify/oxfmt-native`'s in 15 first at
`0x768`, and `rolldown-native` differed too. The script then printed the debug-map
paragraph above about images this file had already counted as carrying no debug map.

**The REGION is measured, and it is the `LC_UUID` payload.** Read off the committed
artifacts with `readMachOLayout`, on a Linux host that can run none of them: the
`LC_UUID` payload of `libgjsify_lightningcss.dylib` sits at exactly `0x670`, of
`libgjsify_oxfmt.dylib` at exactly `0x768`, of `libgjsify_rolldown.dylib` at
`0x6b8` — the two reported first-differing offsets, and a 16-byte payload against
counts of 16 and 15 (one byte of a 16-byte value coinciding). It also agrees with
this entry's own whole-tree reading: every differing darwin-x64 byte was the
`LC_UUID` payload or an `N_OSO` `n_value`, and these three have no `N_OSO`.

**What is NOT established is why the linker chose a different UUID for output that
is otherwise byte-identical, and that needs a darwin runner.** Two candidates:

- **a build INPUT still differed.** The check built the second copy in `builddir/`
  while the leg had built the first in `build/`, so cargo's `--target-dir` — derived
  from the build directory in every `meson.build` that drives one — was a different
  absolute path in the two builds, and rustc records build paths where a
  `buildtype=plain` Vala build does not. The check now rebuilds in `build/`, so this
  candidate is eliminated from the comparison itself; a residue would be elsewhere
  (`TMPDIR`, a registry source path).
- **`strip = true`**, which all three `[profile.release]` tables carry. The linker
  computes the UUID over the image it LINKED; `strip` then removes part of that
  image. So the shipped bytes are a strict subset of what was hashed, and anything
  varying only in the stripped part reaches the artifact through the UUID and
  through nothing else — which is exactly the observed shape, 16 bytes and no
  others. **The measurement that separates the two: build each bridge twice with
  `strip = false` and diff.** The bytes that then differ outside the UUID name the
  channel; none differing says the variation is upstream of the link.

Until one of them is measured, `-Wl,-no_uuid` stays refused for the same reason it
is refused above — it deletes the evidence rather than the cause. The three stay
IN the gate: they are the only three artifacts in the tree whose reproducibility
nothing else asserts, the red is the first thing that ever looked at them, and
scoping the gate down to what already passes would freeze a defect the gate was
added to find. What changed instead is that the gate no longer names a cause: it
parses both builds' load commands and reports the region every differing byte is
in (`classifyMachOBuildDiff`), so the next red is evidence rather than a guess.

The ledger's earlier proposal — "the UUID needs `-Wl,-no_uuid` and the `N_OSO`
timestamps need the object mtimes normalised" — is wrong on both halves, which is
worth keeping because it is the obvious next guess. The UUID is a HASH over the
image including the stab, so stabilising the stab stabilises it: with `-g` gone
the UUID is byte-identical across builds and `-no_uuid` would buy nothing but a
missing `LC_UUID` load command. And there is no flag that normalises an object
mtime — `ZERO_AR_DATE=1` is `ar`, ld64's `-oso_prefix` rewrites the stab's PATH,
not its `n_value`, and touching `.o` files to a fixed date would leave the debug
map pointing at a timestamp no file carries. That "the UUID is a hash over the
image" reading is MEASURED for the thirteen: remove the stab and the UUID settles.
It is also what the three cargo cdylibs contradict — an output whose bytes are
equal outside a UUID cannot have hashed to two UUIDs — which is the whole reason
their cause is open above rather than deduced from this paragraph.

#### The three cargo cdylibs were never measured, and they do not reproduce either

That last count is the whole gap: `buildtype=plain` fixed the nine bridges a laptop
without rustc can build, and the three cargo cdylibs were left out of the
measurement rather than found reproducible — `nm -a` reads zero `N_OSO` stabs in
them, which says the debug map is not the cause, not that the cause is gone. A
`ci:macos` run said so: the gate red-lined on `@gjsify/lightningcss-native`,
`@gjsify/oxfmt-native` and `@gjsify/rolldown-native`, **48 differing bytes each,
first at the `LC_UUID`** (0x670 / 0x768 / 0x6b8), and nothing in `__TEXT`,
`__DATA_CONST` or the symbol table.

**The cause is rustc, and `install_name_tool` could never have reached it.**
Measured with rustc 1.98.1 / `ld` 27037.1 on macOS 27 / arm64: rustc gives a
cdylib the ABSOLUTE path of its own output as `LC_ID_DYLIB` —
`<builddir>/cargo-target/release/deps/libgjsify_lightningcss.dylib` — so the build
directory's name and LENGTH reach the artifact twice over. Once in the recorded
name, and once in the load-command block's SIZE, which is why two clean builds
from `build/` and `builddir/` also sat 8 bytes apart in `__TEXT`'s first section
address before a single byte of content was compared. And the per-build `(1)`
figures: 47 here, 48 on the runner, because a UUID is 16 bytes of digest and two of
them collided on one byte by chance.

`meson.build` normalised the name with `install_name_tool` afterwards, which is
right and was never enough, because ld64 had already computed the `LC_UUID` and
the ad-hoc `LC_CODE_SIGNATURE` over the image it emitted — with the absolute path
still in it — and `install_name_tool` recomputes neither. Worse, ld64's UUID is
not a function of the bytes it emits **at all**: with the name pinned at the link
so the two images were byte-identical outside the UUID payload, the UUIDs still
differed, and `md5` of each image with the UUID and the signature blanked was the
SAME value for both. So the shipped artifact carried an identity of the BUILD.
Control experiments that pin the rest of the link: the UUID does not move with the
output name, the output directory, an input's path or its length, an input's mtime,
nor the length of the link command line (two extra `-Wl` flags change nothing) —
and it does move with the cargo target directory's name length.

**Neither available flag was an option, which is the part worth remembering.**
`-Wl,-uuid <32 hex>` does not exist on this toolchain (`ld: unknown options:
-uuid`), and no `ld64.lld` ships with a CommandLineTools host, so it cannot be
pinned. `-Wl,-no_uuid` is worse than useless here: an arm64 link against a dylib
that lacks `LC_UUID` is REFUSED (`ld: missing LC_UUID load command in '…'`), and
the Vala half of each of these three bridges links exactly that library — so it
fails the build, it does not remove a field.

**So the fix is in the link, and the UUID is derived from the artifact.**
`cargo rustc --lib -- -C link-arg=-Wl,-install_name,@rpath/<leaf>` (ld64 takes the
LAST `-install_name`, verified, and a `-C link-arg` lands after rustc's own, so it
wins), and then `scripts/macho-set-uuid.mjs` writes the UUID last, as `md5` of the
whole image with the UUID payload and the signature blob blanked — the signature
has to be blanked because it hashes the page the UUID lives in, so neither can be
derived from the other — and re-signs with `codesign --force --sign -` ONLY for an
image that arrived signed (ld64 signs arm64 and leaves x86_64 unsigned, and adding
a signature to an unsigned image grows it by a page-aligned `__LINKEDIT` tail, which
is why `relocate-macho.mjs` has the same rule).

Note what this is NOT: `-no_uuid` in disguise. The load command keeps its 24 bytes
and its 16-byte payload, and the value is now a digest of the bytes being shipped,
so it is more meaningful than what ld64 wrote. And it hides nothing: the digest is
computed from the image, so if the CODE ever stops being a function of the sources
the UUID moves with it and the gate still reds. Measured after the change, on this
Mac: the rust cdylib is byte-identical across cargo target directories of different
name LENGTH, and `check-prebuild-reproducible.mjs` is green over the whole darwin
set. The ELF legs are untouched — a bare SONAME and no UUID load command have
nothing to pin — which is why `rust_cargo_cmd` stays `cargo build` off darwin.

**What remains is the half that cannot gate, and the reason is the runner, not
the repo.** `scripts/check-prebuild-reproducible.mjs` runs in the existing
`build-prebuilds-macos` leg and rebuilds every package that run staged, then
requires the two sets of bytes to be equal — so reproducibility is now GATED, on
the same `ci:macos` / push-to-`main` footing as the leg that already ran. The
same script compares the fresh bytes against the committed ones and REPORTS the
difference per file, because a gate there would be red on `main` for a correct
reason: the macOS runners install Homebrew unpinned, so a fresh build legitimately
differs from the committed artifact whenever a formula version moved, and landing
exactly those bytes is what `commit-prebuilds` is for. Closing this properly needs
a pinned Homebrew closure (or recorded per-formula versions to normalise), which
is a bigger decision than a byte comparison. Until then the ledger keeps its
claim, narrowed to what is true: the nine Vala-linked darwin artifacts are
reproducible and gated as such, the three cargo cdylibs are gated and currently
RED on their `LC_UUID` (above); the committed-vs-fresh comparison is measured and
printed, not enforced.

### `@gjsify/lightningcss-native` references `gnu_get_libc_version`, which musl lacks

The committed glibc build declares no npm `libc` filter, so npm installs it on
musl hosts, where `ldd` reports `gnu_get_libc_version: symbol not found` on both
of its libraries. GI binds lazily, so this is not a load failure — it is an
unbound relocation that crashes if and when that path is called, the same shape
that hid `sab-native`'s `fcntl64`/`__cmsg_nxthdr` until the musl leg started
checking committed artifacts.

Unlike `sab-native`, the reference is not ours to remove: it comes from a
crates.io dependency of the pinned `refs/lightningcss` build. So the fix is
either an upstream/dependency change, or a musl-built sibling package with
`libc: ["musl"]` beside a `libc: ["glibc"]` parent — which needs the target
vocabulary to carry a libc component it deliberately does not have today, plus
two new published npm names. Until then it is an ACCEPTED gap in
`musl_gap_reason()` in `.github/prebuild-toolchain/musl-committed-check.sh`,
printed on every musl run, and that entry FAILS the check the day the symbol
stops appearing — so it cannot outlive the problem. Since the check left
`musl-build.sh` it also runs on every PR and push touching the native paths, so
the gap is now re-measured continuously rather than only on a dispatch.


### `@gjsify/gamepad-native`'s linux shims reference glibc 2.38 symbols musl lacks

The committed `libgjsifygamepad.so` for linux-x64 and linux-arm64 links SDL3 statically, and
SDL3 is compiled on Fedora 43 against glibc 2.38. musl's `ldd` reports the C23 redirects
`__isoc23_{fscanf,sscanf,strtol,strtoll,strtoul,strtoull,vsscanf,wcstol}`, plus `wcslcpy`,
`wcslcat` and `fcntl64`, as not found — the same lazy-binding shape as `lightningcss-native`
above, and the reason the generated manifests record `glibcRequires: 2.38`.

The practical cost is small: `@gjsify/gamepad` defaults to libmanette on Linux, SDL is opt-in via
`GJSIFY_GAMEPAD_BACKEND=sdl`, and a shim that cannot load reports `absent`. The references are
not in our source but in how SDL3 was configured against that glibc, so the fix is either
building SDL3 on an older glibc (the redirects exist from 2.38 on) with SDL's own `wcslcpy`
fallback, or a musl-built sibling package. Until then it is an ACCEPTED gap in
`musl_gap_reason()`, which fails the day the symbols stop appearing.


### The musl leg BUILDS and load-tests a `-musl` prebuild; nothing commits one

`prebuilds.yml`'s `build-prebuilds-musl` is a gate now — it lost `continue-on-error` and its
`workflow_dispatch` gate, runs on every PR and push the workflow's paths reach, and compiles
`@gjsify/sab-native` + `@gjsify/lightningcss-native` inside `alpine:3.24` on native x64 and arm64
runners, load-tests each under Alpine's `gjs` and `dlopen(RTLD_NOW)`s them with `LD_LIBRARY_PATH`
unset. What it does NOT do is ship anything: the artifacts are uploaded and never committed, so a
musl host still installs the glibc binary and lives with the `gnu_get_libc_version` gap above.

Why the artifact is a separate change rather than one line more here, and what it needs:
- **`libc: ["glibc"]` on `@gjsify/lightningcss-native-linux-x64` is an install FILTER** that npm,
  yarn and pnpm all honour, so that package is not installed on a musl host at all. A `-musl`
  artifact reaches a user only via a package a musl host installs — either by dropping that
  filter from the existing platform package (the CLI already prefers `prebuilds/<os>-<arch>-musl/`
  over `<os>-<arch>/`, see `prebuildDirCandidates`), or by a new `…-linux-x64-musl` sibling. The
  second needs a manual npm first-publish + Trusted Publisher bootstrap BEFORE the release that
  ships it (`docs/publishing.md`); skipping that does not stall the train — the sweep tolerates
  the absent name and publishes whatever pins it (#1713) — which is why it is not smuggled into a
  CI fix.
- **`PLATFORM_RE`/`canonicalPlatform` in `packages/infra/manifest-conformance/lib/platforms.mjs`
  are still libc-blind** — `PLATFORM_RE` rejects `linux-x64-musl` and `canonicalPlatform` folds it
  down to `linux-x64`. That fold is not hypothetical: it silently swallowed the whole libc axis on
  the first attempt at the CI parser, which credited the Alpine leg with the glibc target and
  passed. `platforms-ci` now composes with `canonicalPrebuildTarget` instead, so the gap is
  unreachable from there; a COMMITTED `-musl` directory would reach it, and both functions must
  learn the optional suffix in that change.
- **`commit-prebuilds` needs the matching download + `git add`**, and this job is deliberately
  absent from its `needs` so a musl regression cannot take the commit path down with it.

Until then the leg's value is exactly what its script says: the npm `libc` policy — a
`libc`-less `@gjsify/<x>-linux-<arch>` is installed on musl hosts BY DESIGN — rests on the claim
that these sources work when built against musl, and nothing else in CI compiles or runs anything
on musl. That claim is now measured on BOTH arches: the leg's first real run built both bridges on
`ubuntu-latest` and `ubuntu-24.04-arm`, loaded both under Alpine's gjs, dlopened both with no
library-path variable and uploaded all four artifacts, in about five minutes per arch — which also
retires the "the aarch64 builds are INFERRED" caveat the workflow header used to carry.


### No `-musl` prebuild package is published, so the libc axis has nothing to resolve to

The CLI's libc axis is complete on the READ side. `detectHostLibc()` classifies the host under
GJS as well as Node, `hostPlatformTokens()` puts `linux-<arch>-musl` ahead of the default build,
`prebuildDirCandidates()` probes the suffixed directory first, `platformPackageName()` applies the
same preference to the companion NAME, and `applyPlatformFilter` honours npm's `libc` field.
Every one of those is unit-tested with an injected `libc: 'musl'`.

Nothing is published for any of it to find. Registry check against `registry.npmjs.org`, all ten
native bridges, measured 2026-09-08:

| target | published |
|---|---|
| `linux-arm64` | 10 / 10 |
| `linux-arm64-musl` | 0 / 10 — every one a 404 |
| `linux-x64-musl` | 0 / 10 — every one a 404 |

So `resolvePrebuildDirName()` falls back to the default build on every musl host, and
`muslPrebuildFallbacks()` (`packages/infra/cli/src/utils/detect-native-packages.ts`) exists to say
so at install time rather than let it stay silent. That report is a diagnosis, not a fix.

**What it costs, measured.** OnePlus 6, postmarketOS v26.06, musl 1.2.6, aarch64, gjs 1.88.1,
against the published 0.48.0 train: nine of the ten glibc prebuilds loaded and ran — musl aliases
`libc.so.6`/`libm.so.6` to itself, and a bridge linking only GLib records no libc at all. The
tenth, `@gjsify/lightningcss-native-linux-arm64`, answered
`Error relocating …/libgjsify_lightningcss.so: gnu_get_libc_version: symbol not found`. It failed
where nothing names libc: `gjsify install` had printed `System dependencies OK`, and the first
symptom was rolldown reporting `Could not load src/application.css`, the CSS bridge silently
absent from the bundle.

**Why this is an entry and not a fix.** `prebuilds.yml` already carries a `build-prebuilds-musl`
leg, so compilation is proven; what is missing is everything after it. `release.yml` does not
mention musl once, and as `prebuilds.yml` notes, `-musl` "is not a `gjsify.platforms` token in the
first place" — so the leg produces no publishable per-target package. Closing it means adding
`-musl` to the platform grammar's WRITE side, generating the per-target manifests
(`scripts/generate-platform-packages.mjs`), and extending the publish matrix. That is release
infrastructure whose first-publish bootstrap ([docs/publishing.md](../docs/publishing.md)) cannot
be rehearsed from a working copy, and every new `@gjsify/*` name needs a Trusted-Publisher
bootstrap before the release that ships it. `oxlint`, vendored in this very repo, ships
`@oxlint/binding-linux-arm64-musl`, so the shape is not in doubt — only the wiring.

**The whole incident reproduces from the committed artifacts, with `readelf` and no phone.** That
is worth more than the install-time report, because it is a gate rather than a message. Of the ten
`linux-arm64` bridges, exactly one image references a glibc-only symbol:

    $ readelf -sW packages/infra/lightningcss-native-linux-arm64/prebuilds/linux-arm64/\
        libgjsify_lightningcss.so | grep gnu_get_libc_version
    83: 0000000000000000  0 FUNC  GLOBAL DEFAULT  UND gnu_get_libc_version@GLIBC_2.17

The other nine reference none, which is exactly why nine of ten loaded on that phone. So the
symptom was predictable from this tree before it shipped, and the machinery to act on it already
exists: npm's `libc` field, honoured by `applyPlatformFilter`, would have marked the package
`inert` on a musl host — not downloaded, not installed — and `gjsify build` would have reported a
missing CSS bridge instead of dying inside one. `tests/e2e/install-platform-filter` was written
for precisely that outcome ("on Alpine the installer handed a glibc-only prebuild to a musl host
and failed at `dlopen` instead of at install time").

**Why the filter did not fire, measured.** `generate-platform-packages.mjs` writes `libc:
["glibc"]` only when `measurePrebuildLibc` finds a glibc DYNAMIC LOADER recorded, and that is a
deliberate, documented choice: musl resolves a `DT_NEEDED` of `libc.so.6` to itself, so declaring
`glibc` on the libc-agnostic bridges would refuse the install on the hosts where they work. The
hole is that the loader is not recorded consistently for the same source:

| target | `DT_NEEDED` loader | npm `libc` written | glibc-only symbol |
|---|---|---|---|
| `linux-x64` | `ld-linux-x86-64.so.2` | `["glibc"]` | yes |
| `linux-arm64` | none | none | yes |

Same package, same glibc floor (`2.39`), and the x64 half is filtered out on musl by an accident
of `DT_NEEDED` while the arm64 half installs and breaks. The predicate reads the loader; the
question is the SYMBOL.

**What has to be decided, and by whom.** Widening the predicate — `libc: ["glibc"]` for any image
whose undefined symbols include one musl does not export — makes more packages `inert` on musl and
needs a musl symbol set to be sound, so it is a policy change to `prebuild-libc`, not a repair.
Publishing `-musl` packages makes the question moot for the bridges that can be built twice.
Either way the CLI's install-time report stays useful for the residue, and neither is decidable
from a working copy.
