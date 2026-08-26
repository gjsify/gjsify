#!/bin/sh
# Build + verify every musl prebuild, INSIDE an alpine:3.24 container.
#
# WHAT THIS LEG IS FOR — it keeps the `libc: null` POLICY honest.
#
# musl is deliberately NOT a target token: the vocabulary is `<os>-<arch>` and
# the libc distinction rides the npm `libc` field, which
# `generate-platform-packages.mjs` MEASURES from the ELF. Its policy is that only
# a recorded glibc dynamic loader (`musl: 'incompatible'`) earns
# `libc: ["glibc"]`; an `'undetermined'` verdict declares nothing, because musl
# treats a `DT_NEEDED` of `libc.so.6` as a request for itself and loads such an
# image happily. So `@gjsify/<x>-linux-<arch>` installs on musl hosts BY DESIGN,
# and this leg is what stops that from being an assumption: it compiles the same
# sources against musl and runs them there. Nothing else in CI ever executes on
# musl.
#
# The policy is confirmed on real hardware, not only in a container: the
# COMMITTED glibc-built `@gjsify/sab-native-linux-arm64` artifact (`DT_NEEDED`
# `libc.so.6`, no `libc` field) loads and runs on a OnePlus 6T under
# postmarketOS — aarch64, musl 1.2, gjs 1.88.1, `/lib/libc.so.6` absent and only
# `libc.musl-aarch64.so.1` present — and `shared-buffer.gjs.spec.ts`'s whole
# surface passes there, including the `from_fd` second-mapping semantics that a
# load test cannot reach. The generator's own note cites an `alpine:3.24.1`
# container probe for six bridges; that probe was x64 only, so arm64 musl rested
# on the same reasoning with no measurement behind it until this one. The BUILD
# side of aarch64 is measured too now: the first run of this leg that ever
# executed compiled both bridges on `ubuntu-24.04-arm`, loaded both under
# Alpine's gjs and dlopened both with no library-path variable, in ~5 minutes.
#
# WHY THIS IS A SCRIPT AND NOT A JOB-LEVEL `container:`
#
# `prebuilds.yml`'s musl leg used `container: image: alpine:3.24`, which puts
# GitHub's own action runtime inside the container. On the arm64 runner that
# fails before anything is built:
#
#     JavaScript Actions in Alpine containers are only supported on x64 Linux
#     runners. Detected Linux Arm64
#
# `actions/checkout` is a JavaScript action, and the runtime it needs exists for
# musl only as an x64 binary. So the arm64 leg could never go green as written —
# it died at `Checkout repository`, every run, and coloured the whole workflow
# red while gating nothing. (Nothing about gjs or Alpine on arm64 is the
# problem: the container itself runs natively there. The limitation is entirely
# in GitHub's action runtime.)
#
# Inverting the containment fixes it and costs nothing: the JS actions run on the
# glibc host, and everything that must see musl runs in here. No emulation is
# involved on either arch — the runner's own architecture IS the target
# architecture, which is exactly what the machine check below asserts rather
# than assumes.
#
# Routing this through `emulated-build.sh` instead was considered and rejected:
# that script REFUSES Alpine deliberately, and its refusal names three things an
# apk branch would need — the third being that `build_pkg` stages into
# `prebuilds/linux-${ARCH}`, which on Alpine would overwrite a COMMITTED glibc
# artifact with a musl one while every downstream declaration check stayed green.
# Staging here cannot do that either: the target token carries `-musl`, so the
# directory is `prebuilds/linux-<arch>-musl/` and the committed glibc one is not a
# name this leg can produce — and the guard below independently refuses unless the
# host resolves as this leg's own musl token before anything is built.
#
# REPRODUCE LOCALLY (the property the QEMU legs have and this leg lacked). Both
# extra flags were paid for once: without a relabelling flag SELinux denies the
# bind mount on Fedora (`can't open '…/musl-build.sh': Permission denied`, which
# reads like a missing exec bit and is not), and without `--platform` a cached
# foreign-arch `alpine` image runs EMULATED behind nothing but a podman warning:
#
#     podman run --rm --platform linux/amd64 \
#       --security-opt label=disable -v "$PWD:/w" -w /w \
#       -e PREBUILD=linux-x64-musl -e MACHINE=x86-64 -e CI=true \
#       alpine:3.24 sh .github/prebuild-toolchain/musl-build.sh
#
# `--security-opt label=disable`, NOT `-v …:z`. `:z` relabels the work tree into a
# SHARED container category and `:Z` into a private one; either way the label is
# left behind on your checkout afterwards, and two concurrent `:Z` mounts lock
# each other out with a `Permission denied` that reads like a broken build.
# `label=disable` relabels nothing. This leg WRITES into the mount (that is where
# the artifacts have to end up), so `:ro` is not available here the way it is for
# the committed-artifact check — run it on a scratch copy of the tree if you do
# not want `build/` and `prebuilds/linux-*-musl/` appearing in your worktree.
#
# `-e CI=true` reproduces what CI enforces: it is what turns `${CI:+--locked}` in
# `lightningcss-native/meson.build` into `cargo build --locked`, i.e. whether a
# stale committed `Cargo.lock` FAILS or is silently updated. A bare `docker`/
# `podman run` inherits nothing, so the flag is the whole difference.
#
# POSIX `sh` ONLY. The Alpine base image has no bash — only busybox `sh` (ash).
# Verified in `alpine:3.24` that busybox ash takes everything used here:
# `set -euo pipefail`, the `case`-based `built()` helper, `while IFS='|' read`
# from a file, `${var%%pattern}`, `env -u`, `mktemp`, `trap … EXIT`,
# `tr '[:upper:]' '[:lower:]'`. No arrays anywhere, which is the one bashism the
# macOS legs rely on.
#
# Env in:
#   PREBUILD       `linux-<arch>-musl` — the target token, asserted below
#   MACHINE        file(1)'s spelling of the ELF e_machine this leg must produce
#   PREBUILD_SKIP  the `changes` job's JSON array, verbatim

# `pipefail` is NOT a POSIX option, but busybox ash supports it and the steps
# this replaces all set it. Keeping it matters: `rustc -vV | grep '^host:'` and
# the `file -b` pipelines below would otherwise report success when their left
# side failed. Verified accepted by `alpine:3.24`'s ash.
set -euo pipefail

: "${PREBUILD:?PREBUILD must be set (e.g. linux-x64-musl)}"
: "${MACHINE:?MACHINE must be set (e.g. x86-64)}"

# ── ONE TABLE, and the destination is DERIVED from it ───────────────────────
#
# This file used to carry FOUR hand-maintained lists of the same two bridges —
# a build block each, a `for dir in …` machine check, a `while read` load test
# and a `for lib in …` dlopen list — and they disagreed. That is what the whole
# leg died on, and the failure did not name its cause:
#
#     ::error::GjsifySabNative prebuild in /tmp/musl-prebuilds/linux-x64-musl
#              does not load under gjs
#     JS ERROR: Requiring GjsifySabNative: Typelib file for namespace
#              'GjsifySabNative' (any version) not found
#
# Both packages were staged into ONE `--dest` directory, and
# `stage-prebuild.mjs` REPLACES its destination rather than merging into it
# (`rmSync(outDir)`, so a renamed library cannot ship a stale set). So
# lightningcss-native, staged second, deleted every file sab-native had staged;
# the machine check then read the same directory twice and reported
# lightningcss's two objects twice while sab-native's `.so` was judged by
# nothing; and the load test failed on a typelib that had been built correctly
# and then removed. Reproduced in `alpine:3.24` on x86_64 against the sources at
# 5f6485fa2 — nothing about musl, gjs or GI was involved.
#
# The fix is not a guard against the collision, it is removing the shape that
# can express one: `--scratch` DERIVES the destination from the package
# (`<pkg>/prebuilds/<target>/`), so two bridges cannot name one directory. That
# is also the flag every other build leg in `prebuilds.yml` uses, and what makes
# it correct here is the same property as there — this job uploads its artifacts
# and commits nothing. `--allow-undeclared` stays, because `linux-<arch>-musl`
# is deliberately in no `gjsify.platforms` (see the workflow header), and it is
# what `build-prebuilds-macos-experimental` pairs with `--scratch` for the same
# reason. A `-musl` suffix also cannot collide with the committed `linux-<arch>`
# of the pre-ADR-0017 layout, and the guard below independently refuses a host
# that does not resolve as this leg's own musl token.
#
# The two consequences worth stating, because they were both broken before:
#   • the artifacts land in the BIND-MOUNTED workspace, which is the only place
#     `actions/upload-artifact` can see them. `/tmp/musl-prebuilds` is inside a
#     `--rm` container, so both upload steps — `if-no-files-found: error` — could
#     never have found anything, whatever the build did.
#   • each bridge's directory is written and read by that bridge alone.
#
# A file, not a function: `bridges | while read` puts the loop in a subshell in
# every POSIX shell, so an `rc=1` set inside it is discarded — the exact shape of
# a check that cannot fail. Every loop below redirects from this file instead.
BRIDGES="$(mktemp)"
# dir|namespace|class — `dir` is the workspace-relative package directory (also
# the `changed-packages.mjs` skip key), `namespace` the GI namespace the typelib
# declares (= `meson.project_name()`), `class` a GObject class whose resolution
# forces GI to call `…_get_type` and therefore to dlopen the library.
#
# The Vala library leaf and the typelib file name are DERIVED from the namespace
# (`lib<lowercased>.so`, `<Ns>-1.0.typelib`) — the meson convention both
# `meson.build`s follow, and safe to derive for the reason
# `.github/prebuild-toolchain/darwin-bridges.mjs` derives the same leaf: the only
# consumer of the name is an error message naming the file it could not open.
cat > "$BRIDGES" <<'EOF'
packages/node/sab-native|GjsifySabNative|SharedBuffer
packages/infra/lightningcss-native|GjsifyLightningcss|Engine
EOF
trap 'rm -f "$BRIDGES"' EXIT

# `lib<namespace lowercased>.so` — the leaf the typelib records and
# `g_module_open()` resolves at load.
vala_leaf() { printf 'lib%s.so' "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"; }

# Did THIS run build it? Keyed on the directory basename, the key
# `changed-packages.mjs` emits, quoted so `"sab-native"` cannot match a longer
# key. An unset/empty PREBUILD_SKIP builds and verifies everything — the same
# fail-open direction the workflow's `if:` gates took.
built() { case "${PREBUILD_SKIP:-}" in *"\"${1##*/}\""*) return 1 ;; *) return 0 ;; esac; }

# ── the toolchain ───────────────────────────────────────────────────────────
# apk names are NOT the Fedora ones: `ninja-build` (there is no `ninja`), `vala`
# (no `valac`), `gobject-introspection-dev` for `g-ir-compiler`. Alpine has no
# weak dependencies, so no `install_weak_deps` equivalent is needed. apk's rustc
# is used deliberately instead of rustup: rustup's `*-unknown-linux-musl` target
# defaults to `crt-static` ON, under which cargo CANNOT emit a cdylib at all —
# the artifact every Rust bridge here is.
echo "--- installing the Alpine toolchain"
apk add --no-cache \
    meson ninja-build gcc build-base pkgconf file binutils linux-headers \
    vala glib-dev gobject-introspection-dev \
    cargo rust musl-dev \
    gjs nodejs git
cat /etc/alpine-release
valac --version
meson --version
cargo --version
rustc --version
# The host triple decides the crt-static default, which decides whether a cdylib
# can be produced at all — print it, so a log alone answers the question if this
# ever fails.
rustc -vV | grep '^host:'
gjs --version
node --version
command -v g-ir-compiler

# ── the clobber guard, BEFORE anything is built ─────────────────────────────
# `hostStagingTarget()` is the exact function `stage-prebuild.mjs` uses to pick
# the directory it will `rmSync` and rewrite. If node ever failed to see this
# host as musl it would resolve `linux-<arch>` — a DECLARED, COMMITTED target —
# and the leg would silently replace a shipped glibc prebuild with a musl one.
# Importing the module runs no `main()` (it is guarded on `process.argv[1]`), so
# this is a pure read.
#
# It doubles as the proof that no emulation crept in: the token it resolves is
# derived from the running host, so agreement with `PREBUILD` means this
# container really is the architecture the matrix entry claims.
echo "--- confirming this container resolves as ${PREBUILD}"
resolved="$(node -e 'import("./scripts/stage-prebuild.mjs").then((m) => console.log(m.hostStagingTarget()))')"
echo "stage-prebuild.mjs resolves this host as: ${resolved}"
if [ "$resolved" != "$PREBUILD" ]; then
    echo "::error::this container resolves as \`${resolved}\`, not \`${PREBUILD}\`. Refusing to build:"
    echo "::error::staging would write into a committed glibc prebuild directory and overwrite it."
    exit 1
fi

WORKSPACE="$PWD"

# ── build every bridge in the table ─────────────────────────────────────────
# Both bridges build identically (`meson setup` + `meson compile` + stage), so
# the loop is the whole difference between them — the Rust half of
# lightningcss-native is driven by its own `meson.build` custom_target, not from
# here. Staging matches artifacts by EXTENSION, which is what picks up BOTH
# halves of a Vala+Rust pair (`libgjsifylightningcss.so` plus the
# `libgjsify_lightningcss.so` cdylib it links), and the stager then runs
# `checkPrebuildDir()` over what it wrote — the staged-sibling + `$ORIGIN`
# invariant, verified here on musl.
#
# `< /dev/null` on every child: the loop's stdin is $BRIDGES, and a build tool
# that read it would swallow the remaining rows.
while IFS='|' read -r dir ns class; do
    [ -n "$dir" ] || continue
    if ! built "$dir"; then
        echo "--- ${dir}: not in this run's package set, skipped"
        continue
    fi
    echo "--- building ${dir} (${ns}) against musl"
    cd "$WORKSPACE/$dir"
    meson setup build . < /dev/null
    meson compile -C build < /dev/null
    node "$WORKSPACE/scripts/stage-prebuild.mjs" . --scratch --allow-undeclared < /dev/null
    ls -lh "prebuilds/${PREBUILD}/"
    cd "$WORKSPACE"
done < "$BRIDGES"

# ── each bridge's staged set must be COMPLETE and of this machine ───────────
# Two assertions in one pass, and the completeness half is the one that was
# missing: a bridge this run BUILT must still have a `.so` and its typelib in its
# own directory when the verification reads it. That is what a destination shared
# between two packages destroys, and the symptom without this assertion is gjs
# reporting a typelib "not found" three steps later — a message that names musl
# and GI rather than the staging that deleted the file.
echo "--- verifying each staged set is complete and of this machine"
rc=0
while IFS='|' read -r dir ns class; do
    [ -n "$dir" ] || continue
    built "$dir" || { echo "--- $dir: not built by this run, not verified"; continue; }
    out="$WORKSPACE/$dir/prebuilds/${PREBUILD}"
    if [ ! -d "$out" ]; then
        echo "::error::$out does not exist — the build ran but staged somewhere else"
        rc=1
        continue
    fi
    typelib="${out}/${ns}-1.0.typelib"
    if [ ! -f "$typelib" ]; then
        echo "::error::${dir} staged no ${ns}-1.0.typelib in ${out}."
        echo "::error::The build produced one (g-ir-compiler is a meson target and the stager"
        echo "::error::refuses a typelib with no .gir), so it was staged and then REMOVED —"
        echo "::error::stage-prebuild.mjs replaces its destination, so a destination shared with"
        echo "::error::another package erases this one. Every bridge stages with --scratch."
        rc=1
    fi
    found=0
    for lib in "$out"/*.so; do
        # An unmatched glob stays literal in POSIX sh, so a directory with no
        # `.so` at all would otherwise reach `file -b` as a non-existent path and
        # abort under `set -e` with the shell's own message rather than this one.
        [ -e "$lib" ] || break
        found=$((found + 1))
        desc="$(file -b "$lib")"
        echo "$lib: $desc"
        case "$desc" in
            *"$MACHINE"*) ;;
            *) echo "::error file=$lib::expected a $MACHINE object in ${PREBUILD}, got: $desc"; rc=1 ;;
        esac
    done
    if [ "$found" -eq 0 ]; then
        echo "::error::${dir} staged no shared library at all in ${out} — see the typelib note above."
        rc=1
    fi
done < "$BRIDGES"
[ "$rc" -eq 0 ] || exit $rc

# ── load-test every prebuild under Alpine gjs ──────────────────────────────
# The protocol the Fedora and macOS legs use, unchanged: resolving a GObject
# class forces GI to call the class's `…_get_type` symbol, which is what dlopens
# the recorded shared library. A typelib that is merely FOUND resolves the
# namespace and then throws here.
#
# LD_LIBRARY_PATH is set on purpose and is NOT a workaround for a musl defect: a
# typelib records the BARE leaf name of its library, so a GI_TYPELIB_PATH-only
# load fails identically for every bridge on glibc (verified on both). The CLI's
# `buildNativeEnv()` exports exactly this variable for exactly this reason, so
# passing it here makes the test match what a real `gjsify` run does — do not
# "fix" the non-bug.
echo "--- load-testing every musl prebuild under Alpine gjs"
rc=0
while IFS='|' read -r dir ns sym; do
    [ -n "$dir" ] || continue
    built "$dir" || { echo "--- ${ns}: not built by this run, not load-tested"; continue; }
    abs="$WORKSPACE/$dir/prebuilds/${PREBUILD}"
    echo "--- ${ns}.${sym} from ${abs}"
    # `< /dev/null`: the loop's stdin is $BRIDGES, and a child that reads it
    # would eat the remaining rows.
    if GI_TYPELIB_PATH="$abs" LD_LIBRARY_PATH="$abs" gjs -c \
        "const T = imports.gi.${ns}.${sym};
         if (typeof T !== 'function') { throw new Error('${ns}.${sym} did not resolve to a class'); }
         print('${ns}.${sym} resolved — shared library loaded');" < /dev/null
    then :; else
        echo "::error::${ns} prebuild in ${abs} does not load under gjs"
        rc=1
    fi
done < "$BRIDGES"
[ "$rc" -eq 0 ] || exit $rc

# ── every relocation must resolve with no library-path variable ─────────────
# The stricter half, and the one that makes this leg worth running: GI opens a
# library with G_MODULE_BIND_LAZY, so the gjs step above binds only what it
# touches — and a missing symbol is precisely why both packages in this leg need
# a musl build in the first place (`fcntl64`, `__cmsg_nxthdr`,
# `gnu_get_libc_version`). RTLD_NOW binds everything. With LD_LIBRARY_PATH
# unset, the only way the Vala half of lightningcss-native can find its sibling
# cdylib is its own `$ORIGIN` RUNPATH — the dynamic twin of
# `check-prebuild-loader-path.mjs`.
echo "--- proving every relocation resolves with no library-path variable"
# No `-ldl`: musl has no separate libdl.
cc -o /tmp/dlopen-rtld-now .github/prebuild-toolchain/dlopen-rtld-now.c
rc=0
while IFS='|' read -r dir ns class; do
    [ -n "$dir" ] || continue
    built "$dir" || { echo "--- $dir: not built by this run, not dlopened"; continue; }
    lib="$WORKSPACE/$dir/prebuilds/${PREBUILD}/$(vala_leaf "$ns")"
    echo "--- dlopen(RTLD_NOW) $lib with LD_LIBRARY_PATH unset"
    # `< /dev/null` for the same reason as every other child in this file.
    if env -u LD_LIBRARY_PATH /tmp/dlopen-rtld-now "$lib" < /dev/null; then :; else
        echo "::error::$lib does not fully resolve on musl"
        rc=1
    fi
done < "$BRIDGES"

# ── the COMMITTED glibc artifacts must resolve here too ─────────────────────
# The step above proves the artifacts THIS LEG BUILT are sound. It says nothing
# about the ones users actually get, and answering that is now its own script:
# `musl-committed-check.sh`, which carries the reasoning, the accepted-gap ledger
# and the incident behind them.
#
# It left this file because this leg cannot be the only caller. It WAS
# `workflow_dispatch`-only and `continue-on-error: true` back then, so nothing it
# asserted could colour a PR — both of those are gone now, but the split stands on
# what made it worth doing: the committed-artifact question needs no build, so it
# also runs where a build leg has no business being. Two more places today (a
# `check-committed-musl` job, and a step inside `commit-prebuilds` before the
# binaries are committed), and one body is what keeps the self-retiring ledger
# from drifting between them.
#
# `TARGET` is this leg's token without the libc suffix: the committed directory
# holding the glibc artifacts users actually get. Called under `if`, not bare —
# it exits non-zero on a real gap and `set -e` would abort before the combined
# verdict below.
cd "$WORKSPACE"
echo "--- handing over to the committed-artifact check"
if TARGET="${PREBUILD%-musl}" sh .github/prebuild-toolchain/musl-committed-check.sh; then :; else
    rc=1
fi

exit $rc
