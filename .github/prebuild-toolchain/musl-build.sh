#!/bin/sh
# Build + verify every musl prebuild, INSIDE an alpine:3.24 container.
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
# Staging here cannot do that: it goes through `scripts/stage-prebuild.mjs` with
# an explicit `--dest` OUTSIDE the package tree, so no committed directory is
# reachable at all — and the guard below independently refuses unless the host
# resolves as this leg's own musl token.
#
# REPRODUCE LOCALLY (the property the QEMU legs have and this leg lacked). Both
# extra flags were paid for once: without `:z` SELinux denies the bind mount on
# Fedora (`can't open '…/musl-build.sh': Permission denied`, which reads like a
# missing exec bit and is not), and without `--platform` a cached foreign-arch
# `alpine` image runs EMULATED behind nothing but a podman warning:
#
#     podman run --rm --platform linux/amd64 -v "$PWD:/w:z" -w /w \
#       -e PREBUILD=linux-x64-musl -e MACHINE=x86-64 \
#       alpine:3.24 sh .github/prebuild-toolchain/musl-build.sh
#
# In CI neither is needed — no SELinux on the runners, and the runner's own arch
# is the target — which is precisely why the guard below asserts the arch instead
# of trusting the invocation.
#
# POSIX `sh` ONLY. The Alpine base image has no bash — only busybox `sh` (ash).
# Verified in `alpine:3.24` that busybox ash takes everything used here:
# `set -euo pipefail`, the `case`-based `built()` helper, `while IFS='|' read`
# over a heredoc, `${var%%pattern}`, `env -u`. No arrays anywhere, which is the
# one bashism the macOS legs rely on.
#
# Env in:
#   PREBUILD       `linux-<arch>-musl` — the target token, asserted below
#   MACHINE        file(1)'s spelling of the ELF e_machine this leg must produce
#   PREBUILD_SKIP  the `changes` job's JSON array, verbatim
#   STAGE_DIR      where artifacts land (default /tmp/musl-prebuilds). Outside any
#                  package ON PURPOSE — see the `--dest` note below.

# `pipefail` is NOT a POSIX option, but busybox ash supports it and the steps
# this replaces all set it. Keeping it matters: `rustc -vV | grep '^host:'` and
# the `file -b` pipelines below would otherwise report success when their left
# side failed. Verified accepted by `alpine:3.24`'s ash.
set -euo pipefail

: "${PREBUILD:?PREBUILD must be set (e.g. linux-x64-musl)}"
: "${MACHINE:?MACHINE must be set (e.g. x86-64)}"
# Outside the package tree, and that is the fix for the SECOND thing broken here.
# After ADR 0017 a bridge owns no `prebuilds/` — `stage-prebuild.mjs` resolves the
# destination to a sibling platform package and REFUSES when there is none. For
# this leg there never is one: it builds targets no package declares yet, so
# declaring them would publish a promise CI must reproduce and commit. Measured:
# the musl build of sab-native succeeds and staging fails with
# `sab-native-linux-x64-musl/ does not exist`. `--dest` names a destination
# instead of relaxing the default, so every other caller keeps the refusal.
STAGE_DIR="${STAGE_DIR:-/tmp/musl-prebuilds}"
echo "--- staging destination: ${STAGE_DIR}/${PREBUILD}"

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

# ── @gjsify/sab-native (GjsifySabNative) ────────────────────────────────────
if built packages/node/sab-native; then
    echo "--- building @gjsify/sab-native against musl"
    cd "$WORKSPACE/packages/node/sab-native"
    meson setup build .
    meson compile -C build
    node "$WORKSPACE/scripts/stage-prebuild.mjs" . --allow-undeclared --dest "$STAGE_DIR"
    ls -lh "${STAGE_DIR}/${PREBUILD}/"
    cd "$WORKSPACE"
else
    echo "--- @gjsify/sab-native: not in this run's package set, skipped"
fi

# ── @gjsify/lightningcss-native (GjsifyLightningcss) ────────────────────────
if built packages/infra/lightningcss-native; then
    echo "--- building @gjsify/lightningcss-native against musl (Rust cdylib + Vala bridge)"
    cd "$WORKSPACE/packages/infra/lightningcss-native"
    meson setup build .
    meson compile -C build
    # Matching by EXTENSION is what picks up both halves of the pair here
    # (`libgjsifylightningcss.so` + the `libgjsify_lightningcss.so` cdylib it
    # links), and the stager then runs `checkPrebuildDir()` over what it wrote —
    # the staged-sibling + `$ORIGIN` invariant, verified on musl.
    node "$WORKSPACE/scripts/stage-prebuild.mjs" . --allow-undeclared --dest "$STAGE_DIR"
    ls -lh "${STAGE_DIR}/${PREBUILD}/"
    cd "$WORKSPACE"
else
    echo "--- @gjsify/lightningcss-native: not in this run's package set, skipped"
fi

# ── each staged artifact's machine must match its directory ─────────────────
echo "--- verifying each staged artifact's machine matches its directory"
rc=0
for dir in packages/node/sab-native packages/infra/lightningcss-native; do
    built "$dir" || { echo "--- $dir: not built by this run, not verified"; continue; }
    out="${STAGE_DIR}/${PREBUILD}"
    if [ ! -d "$out" ]; then
        echo "::error::$out does not exist — the build ran but staged somewhere else"
        rc=1
        continue
    fi
    for lib in "$out"/*.so; do
        desc="$(file -b "$lib")"
        echo "$lib: $desc"
        case "$desc" in
            *"$MACHINE"*) ;;
            *) echo "::error file=$lib::expected a $MACHINE object in ${PREBUILD}, got: $desc"; rc=1 ;;
        esac
    done
done
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
    abs="${STAGE_DIR}/${PREBUILD}"
    echo "--- ${ns}.${sym} from ${abs}"
    # `< /dev/null`: the loop's stdin is the heredoc below, and a child that
    # reads it would eat the remaining rows.
    if GI_TYPELIB_PATH="$abs" LD_LIBRARY_PATH="$abs" gjs -c \
        "const T = imports.gi.${ns}.${sym};
         if (typeof T !== 'function') { throw new Error('${ns}.${sym} did not resolve to a class'); }
         print('${ns}.${sym} resolved — shared library loaded');" < /dev/null
    then :; else
        echo "::error::${ns} prebuild in ${abs} does not load under gjs"
        rc=1
    fi
done <<'EOF'
packages/node/sab-native|GjsifySabNative|SharedBuffer
packages/infra/lightningcss-native|GjsifyLightningcss|Engine
EOF
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
for lib in \
    "packages/node/sab-native|${STAGE_DIR}/${PREBUILD}/libgjsifysabnative.so" \
    "packages/infra/lightningcss-native|${STAGE_DIR}/${PREBUILD}/libgjsifylightningcss.so"; do
    pkg="${lib%%|*}"
    lib="${lib#*|}"
    built "$pkg" || { echo "--- $pkg: not built by this run, not dlopened"; continue; }
    echo "--- dlopen(RTLD_NOW) $lib with LD_LIBRARY_PATH unset"
    if env -u LD_LIBRARY_PATH /tmp/dlopen-rtld-now "$lib"; then :; else
        echo "::error::$lib does not fully resolve on musl"
        rc=1
    fi
done
exit $rc
