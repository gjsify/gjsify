#!/bin/sh
# Do the COMMITTED glibc prebuilds for one `linux-<arch>` target resolve on musl?
#
# WHY THIS IS ITS OWN FILE
#
# It has two callers and must have exactly one body. `musl-build.sh` runs it at
# the end of the dispatch-only build leg, where it began; `prebuilds.yml` runs it
# in two more places the build leg cannot reach — a `check-committed-musl` job on
# every PR and push that touches the native paths, and inside `commit-prebuilds`
# just before the binaries are committed. A second copy of the ledger below would
# be a second truth, and the ledger is the part that must not drift: an entry that
# stops applying is a FAILURE here, so a stale copy fails in one place and passes
# in another.
#
# WHY IT HAD TO LEAVE THE BUILD LEG
#
# `build-prebuilds-musl` WAS `if: github.event_name == 'workflow_dispatch'` AND
# `continue-on-error: true`, so nothing it asserted could reach a PR or a merge
# and it could not colour anything red even on a dispatch. It has since lost
# both, which makes that the history of the split rather than its justification.
# What keeps the two separate is the next paragraph's distinction plus one fact:
# this half needs no build at all — it reads binaries already in the tree — so it
# can also run inside `commit-prebuilds`, where a build leg has no business being.
# Two questions, two jobs: that one asks whether the SOURCES work when compiled
# against musl, this one whether the binaries users actually get resolve there.
#
# WHAT IT ANSWERS, AND WHAT IT DOES NOT
#
# `@gjsify/<x>-linux-<arch>` is built against glibc, declares no npm `libc`
# filter, and is therefore installed on musl hosts BY DESIGN
# (`generate-platform-packages.mjs` writes `libc: ["glibc"]` only for a recorded
# glibc dynamic loader, which a shared library never has). That design rests on
# one claim — every symbol those binaries reference exists in musl too — and
# until this check nothing anywhere tested it.
#
# It was false, measurably, for two of the bridges: `sab-native` referenced
# `fcntl64` + `__cmsg_nxthdr` and `lightningcss-native` references
# `gnu_get_libc_version`. None of it is a LOAD failure — GI binds lazily, so the
# typelib resolved and the package worked until the unbound path was first
# called. `@gjsify/worker_threads` therefore lost all four of its SharedBuffer
# cross-process tests on every musl host while being fully green on glibc, and a
# load test cannot see that. This runs on real musl; asking the question costs
# one loop over files that are already there.
#
# The static `prebuild-libc` rule in `audit-runtimes --check` deliberately does
# NOT cover this class: `muslVerdictOfNeeded()` reads `DT_NEEDED` and says so in
# its own words — only a real dlopen on a musl host settles a SYMBOL question.
#
# POSIX `sh` ONLY — the Alpine base image has no bash, only busybox ash. No
# arrays, no bashisms; `pipefail` is not POSIX but busybox ash accepts it and the
# `grep`/`sed` pipelines below need it.
#
# REPRODUCE LOCALLY (`:z` for SELinux on Fedora; `--platform` so a cached
# foreign-arch image cannot run emulated behind a warning):
#
#     podman run --rm --platform linux/amd64 -v "$PWD:/w:z" -w /w \
#       -e TARGET=linux-x64 \
#       alpine:3.24 sh .github/prebuild-toolchain/musl-committed-check.sh
#
# Env in:
#   TARGET  the committed `linux-<arch>` directory to judge. Asserted against the
#           container's own machine below — see the guard.

set -euo pipefail

: "${TARGET:?TARGET must be set (e.g. linux-x64) — the committed prebuild directory to judge}"

# ── the container's machine must BE the target's machine ────────────────────
# Without this the check does not degrade to "unverified", it degrades to a
# GREEN LIE, which is measured rather than feared. Running TARGET=linux-arm64 in
# an x86_64 alpine:3.24 container: musl's `ldd` does not refuse the foreign
# object at all — it lists its dependencies, resolves them against the HOST's
# x86_64 libraries, and reports the AArch64 relocations it cannot apply as
# `unsupported relocation type`, a phrase that matches neither of the two
# verdict filters below. Twelve of the thirteen committed arm64 objects came
# back "every relocation resolves"; the thirteenth was credited with its
# accepted gap by coincidence. Exit code 0, nothing judged.
#
# So the arch is asserted here rather than arranged for by the caller, and the
# `unsupported relocation type` class is ALSO given a verdict below — one guard
# is a rule, two make the rule's absence loud. `uname -m` is the machine the
# kernel presents to this process, so agreement with TARGET is what proves no
# emulation crept in either.
target_arch="${TARGET##*-}"
case "$(uname -m)" in
    x86_64) host_arch=x64 ;;
    aarch64) host_arch=arm64 ;;
    *) host_arch="$(uname -m)" ;;
esac
if [ "$host_arch" != "$target_arch" ]; then
    echo "::error::this container is ${host_arch} (uname -m: $(uname -m)) but TARGET is ${TARGET}."
    echo "::error::musl's ldd does NOT refuse a foreign-arch object — it resolves it against the"
    echo "::error::host's libraries and reports 'unsupported relocation type', which no verdict"
    echo "::error::below matches, so this check would exit 0 having judged nothing. Run it on a"
    echo "::error::native runner for that arch, or register QEMU and pass"
    echo "::error::\`docker run --platform linux/${target_arch}\`."
    exit 1
fi

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
# land in the not-verified bucket below. Every library added here is one more
# artifact actually judged rather than silenced. `libmozjs-140` (@gjsify/napi)
# has no Alpine package at all and stays unjudged.
#
# WHAT A GREEN VERDICT HERE DOES NOT MEAN. This judges RELOCATIONS, so it answers
# "can musl bind every symbol", never "does the host provide what this bridge
# needs at runtime". `@gjsify/webrtc-native` is the standing example and it is not
# hypothetical: `gst-plugins-bad` gives it `libgstwebrtc-1.0.so.0`, so it resolves
# cleanly and this check reports it green — while on the very same image
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
# Do not extend this into an element check on that basis — it would be an accepted
# gap on day one with nothing we can do about it. It is recorded in
# status/open-todos.md so a green line here is not read as "works on musl".
echo "--- installing the system libraries the committed bridges link against"
apk add --no-cache \
    libepoxy gdk-pixbuf json-glib libsoup3 gnutls gstreamer gst-plugins-base gst-plugins-bad

echo "--- checking every COMMITTED glibc prebuild in ${TARGET} resolves under musl"
rc=0
checked=0
for so in packages/*/*/prebuilds/"${TARGET}"/*.so; do
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
    # The third class, and the reason the arch guard above is not alone. On a
    # NATIVE run this cannot occur: measured over every committed linux-x64
    # object in an x86_64 container, `ldd` emits no `Error relocating` line that
    # is not a `symbol not found`. It appears only when the loader is being shown
    # an object for another machine — which is precisely the state in which the
    # other two verdicts go quiet and the loop reports success.
    badreloc=$(echo "$out" | grep -c 'unsupported relocation type' || true)
    accepted=$(musl_gap_reason "$pkg")
    # ORDER IS LOAD-BEARING: a genuinely absent library makes the SYMBOL verdict
    # meaningless, because musl's loader then reports every symbol that library
    # would have provided as not-found too. Judging symbols first blamed musl for
    # a container that simply lacked libepoxy — every `epoxy_gl*` entry in
    # `@gjsify/webgl` came back a "gap", none of them real. So: no library missing
    # is the PRECONDITION for judging symbols at all.
    if [ "$badreloc" -gt 0 ]; then
        echo "::error::$pkg ($(basename "$so")) produced ${badreloc} 'unsupported relocation type' line(s)."
        echo "    musl's loader is being shown an object built for another machine. Nothing"
        echo "    about musl compatibility was measured for it — the two verdicts below go"
        echo "    quiet in exactly this state, which is why this one exists. Check TARGET"
        echo "    (${TARGET}) against the container's arch ($(uname -m))."
        rc=1
    elif [ -n "$libs" ]; then
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
# A glob that matched nothing would make this a silent no-op, which is the failure
# mode the repo keeps paying for (`--include` matching zero workspaces, a `files`
# glob shipping nothing). There are committed linux-x64 and linux-arm64 prebuilds;
# if this finds none, the layout moved.
if [ "$checked" -eq 0 ]; then
    echo "::error::no committed prebuilds/${TARGET}/*.so found — this check verified nothing"
    rc=1
fi
echo "--- judged ${checked} committed object(s) in ${TARGET}"

exit $rc
