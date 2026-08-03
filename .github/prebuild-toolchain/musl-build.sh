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
# on the same reasoning with no measurement behind it until this one.
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

# ── the COMMITTED glibc artifacts must resolve here too ─────────────────────
# The step above proves the artifacts THIS LEG BUILT are sound. It says nothing
# about the ones users actually get: `@gjsify/<x>-linux-<arch>` is built against
# glibc, declares no npm `libc` filter, and is therefore installed on musl hosts
# BY DESIGN (`generate-platform-packages.mjs` writes `libc: ["glibc"]` only for a
# recorded glibc dynamic loader, which a shared library never has). That design
# rests on one claim — every symbol those binaries reference exists in musl too —
# and until this step nothing anywhere tested it.
#
# It was false, measurably, for two of the ten bridges: `sab-native` referenced
# `fcntl64` + `__cmsg_nxthdr` and `lightningcss-native` references
# `gnu_get_libc_version`. None of it is a LOAD failure — GI binds lazily, so the
# typelib resolved and the package worked until the unbound path was first
# called. `@gjsify/worker_threads` therefore lost all four of its SharedBuffer
# cross-process tests on every musl host while being fully green on glibc, and
# the existing load test could not see it. This leg runs on real musl; asking it
# the question costs one loop.
#
# `ldd` is musl's OWN loader in list mode, so it reports every unresolved
# relocation at once rather than dlopen's first-error-only. Two failure classes
# come back and they are NOT the same: a "symbol not found" is a real libc gap
# and fails the leg, while "Error loading shared library" only means Alpine here
# lacks that system dependency (libmozjs-140 has no Alpine package at all). The
# second is reported as not-verified, never as broken — the same honesty the
# cross-arch load tests already practise.
#
# ACCEPTED GAPS carry a mandatory reason and are printed every run. The ledger is
# deliberately awkward in the same way `gjsify.platformsUncommitted` is: an entry
# whose package STOPS having the gap becomes a FAILURE, so it retires itself
# instead of rotting into a permanent exemption. `sab-native` is deliberately NOT
# in here — its two symbols were OURS to stop referencing, and it now resolves.
musl_gap_reason() {
    case "$1" in
    lightningcss-native-linux-*)
        echo "gnu_get_libc_version is referenced by a crates.io dependency of the pinned refs/lightningcss build, not by our own source, so it cannot be removed the way sab-native's fcntl64/__cmsg_nxthdr were. Options are an upstream change or a musl-built sibling package; tracked in status/open-todos.md."
        ;;
    *) echo '' ;;
    esac
}

# The bridges' own GNOME/system dependencies, so that as few packages as possible
# land in the not-verified bucket below. Kept as a SEPARATE install from the
# build toolchain because it buys check COVERAGE, not the ability to compile: a
# library missing here silences the verdict for that package rather than failing
# it, so every one added is one more artifact actually judged. `libmozjs-140`
# (@gjsify/napi) has no Alpine package at all and stays unjudged.
#
# WHAT A GREEN VERDICT HERE DOES NOT MEAN. This step judges RELOCATIONS, so it
# answers "can musl bind every symbol", never "does the host provide what this
# bridge needs at runtime". `@gjsify/webrtc-native` is the standing example and it
# is not hypothetical: `gst-plugins-bad` gives it `libgstwebrtc-1.0.so.0`, so it
# resolves cleanly and this check reports it green — while on the very same image
# `gst-inspect-1.0 webrtcbin` finds NOTHING. GStreamer 1.28's nice plugin needs
# libnice >= 0.1.23 and Alpine ships 0.1.22, so the webrtcbin ELEMENT is not built
# at all. Measured on alpine:3.24: library present, element and nice plugin both
# absent. So `@gjsify/webrtc` cannot work on Alpine or postmarketOS today no
# matter how well its prebuild links, and that is upstream, not ours:
#   https://gitlab.postmarketos.org/postmarketOS/pmaports/-/work_items/4443
#   https://gitlab.alpinelinux.org/alpine/aports/-/work_items/18092
# Adding the postmarketOS repositories on top of Alpine does NOT fix it, which is
# measured rather than assumed: on a real postmarketOS v26.06 device with the pmOS
# mirrors active, `apk list -a libnice` still reports 0.1.22-r0 — pmOS takes it
# from Alpine community unchanged — and `Gst.ElementFactory.find()` finds no
# `webrtcbin`, `nicesrc` or `nicesink` while `dtlssrtpenc` and `rtpbin` are both
# there, exactly the shape a libnice-gated nice plugin produces.
# Do not extend this step into an element check on that basis — it would be an
# accepted gap on day one with nothing we can do about it. It is recorded in
# status/open-todos.md so a green line here is not read as "works on musl".
apk add --no-cache \
    libepoxy gdk-pixbuf json-glib libsoup3 gnutls gstreamer gst-plugins-base gst-plugins-bad

echo "--- checking every COMMITTED glibc prebuild for this arch resolves under musl"
committed_target="${PREBUILD%-musl}"
checked=0
for so in packages/*/*/prebuilds/"${committed_target}"/*.so; do
    [ -f "$so" ] || continue
    checked=$((checked + 1))
    pkg=$(echo "$so" | sed 's|^packages/[^/]*/||;s|/prebuilds/.*||')
    out=$(ldd "$so" 2>&1 || true)
    # `|| true` on both: under `set -e` a `grep` that matches NOTHING exits 1 and
    # a failing command substitution aborts the script — so the healthy case (no
    # unresolved symbols) killed the loop at the first clean package, silently,
    # while the exit code looked like a verdict. An exit code is not evidence
    # that the loop ran.
    syms=$(echo "$out" | grep 'symbol not found' | sed 's/^.*so: //;s/: symbol not found//' | sort -u | tr '\n' ' ' || true)
    # The glibc dynamic loader appears as a DT_NEEDED of every Rust cdylib here
    # and musl of course does not ship it. Its absence is the NORMAL case this
    # whole check exists to characterise — musl substitutes itself — so it must
    # not be read as a missing dependency, or the packages with a real gap
    # (lightningcss-native) would be the ones silenced.
    libs=$(echo "$out" | grep 'Error loading shared library' | sed 's/.*shared library //;s/:.*//' \
        | grep -vE '^(ld-linux[^ ]*|ld64\.so\.[0-9]+)$' | sort -u | tr '\n' ' ' || true)
    accepted=$(musl_gap_reason "$pkg")
    # ORDER IS LOAD-BEARING: a genuinely absent library makes the SYMBOL verdict
    # meaningless, because musl's loader then reports every symbol that library
    # would have provided as not-found too. Judging symbols first blamed musl for
    # a container that simply lacked libepoxy — ~200 `epoxy_gl*` "gaps" in
    # `@gjsify/webgl`, none of them real. So: no library missing is the
    # PRECONDITION for judging symbols at all.
    if [ -n "$libs" ]; then
        echo "--- $pkg: NOT VERIFIED here — absent system libs: $libs"
    elif [ -n "$syms" ] && [ -n "$accepted" ]; then
        echo "--- $pkg: ACCEPTED musl gap ($syms) — $accepted"
    elif [ -n "$syms" ]; then
        echo "::error::$pkg ($(basename "$so")) is installed on musl but does not resolve there: $syms"
        echo "    Either stop referencing the glibc-private symbol (preferred — one"
        echo "    artifact then serves both libcs), or declare libc: [\"glibc\"] on"
        echo "    $pkg so npm refuses the install instead of failing at first call."
        echo "    NOTE: this reads the COMMITTED binary, which is what users get."
        echo "    A source fix does not clear it until the prebuild is rebuilt and"
        echo "    re-committed, and \`commit-prebuilds\` is main-only — so the PR that"
        echo "    fixes the source stays red here until it lands. That is the honest"
        echo "    state (the shipped artifact really is still broken), not a bug."
        rc=1
    elif [ -n "$accepted" ]; then
        echo "::error::$pkg resolves fully on musl, so its accepted-gap entry in musl_gap_reason() no longer applies — delete it."
        rc=1
    else
        echo "--- $pkg: every relocation resolves"
    fi
done
# A glob that matched nothing would make this whole step a silent no-op, which is
# the failure mode the repo keeps paying for (`--include` matching zero
# workspaces, a `files` glob shipping nothing). There are committed linux-x64 and
# linux-arm64 prebuilds; if this leg finds none, the layout moved.
if [ "$checked" -eq 0 ]; then
    echo "::error::no committed prebuilds/${committed_target}/*.so found — this check verified nothing"
    rc=1
fi

exit $rc
