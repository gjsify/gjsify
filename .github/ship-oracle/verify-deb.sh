#!/usr/bin/env bash
# Read a `.deb` this project WROTE with the tools Debian itself uses.
#
# WHY THIS FILE EXISTS. `gjsify ship` writes the `.deb` by hand — no `dpkg-deb`,
# no vendored packer — because the packer has to run under GJS, offline, on a
# Fedora image where `dpkg-deb` does not exist (packages/infra/cli/AGENTS.md).
# That is what makes an independent reader worth having, and until this ran
# there was none: `status/open-todos.md` § `gjsify ship` item 8 records that
# **dpkg is on no CI runner this project uses**, so `tests/e2e/ship` reads the
# container with GNU `ar` and both inner tars with GNU `tar` and stops there.
# Everything below is the half that suite cannot do.
#
# WHY IT IS A FILE AND NOT AN INLINE `run:` BLOCK. `prebuilds.yml`'s
# emulated-build step states the rule: a real script reproduces by hand, which
# is how its qemu-version root cause was found. Reproduce this one with
#
#   bash .github/ship-oracle/verify-deb.sh ship/out/gjsify_0.41.0-1_all.deb ship/stage 3
#
# WHAT MAY NOT HAPPEN HERE: a silent skip. `tests/e2e/ship`'s `probe()` settled
# that — every assertion in this file sits behind a reader, so a missing reader
# would leave the file green having read nothing. Missing readers therefore
# exit 1 with their name.
#
# EVERY LOOP THAT CAN FAIL READS FROM `< <(…)`, never from a pipe. The
# right-hand side of a pipeline runs in a SUBSHELL, so an `exit 1` inside one
# ends the subshell and the script carries on green — the exact shape of
# "green CI that checked nothing" this repo keeps paying for.
#
# AND NO ASSERTION READS FROM A PIPE EITHER: `grep -q … <<<"$VAR"`, never
# `printf … | grep -q`. MEASURED on the first run that ever reached the tag gate
# below — `grep -q` exits at the match, `printf` dies of SIGPIPE (141) on its
# next write, and `set -o pipefail` promotes that to a failed pipeline, so a tag
# that IS in lintian's list reds with "this lintian does not know the tag".
# Worse than a flake that costs a run: it fabricates a specific, plausible, WRONG
# diagnosis and sends the next reader renaming a healthy tag. It needs an input
# bigger than one stdio flush — lintian's tag list is 49 KB — and it is a coin
# toss, not a platform difference: the same loop in a container missed 3 times in
# 300 iterations, on three different tags, having passed cleanly the run before.
# A here-string is not a pipeline, so there is nothing for pipefail to promote.
set -euo pipefail

DEB=${1:?usage: verify-deb.sh <artifact.deb> <stage-dir> <expected-payload-file-count>}
STAGE=${2:?usage: verify-deb.sh <artifact.deb> <stage-dir> <expected-payload-file-count>}
EXPECT_FILES=${3:?usage: verify-deb.sh <artifact.deb> <stage-dir> <expected-payload-file-count>}

fail() {
    echo "::error title=Ship .deb::$*"
    exit 1
}

require() {
    for tool in "$@"; do
        command -v "$tool" >/dev/null 2>&1 ||
            fail "$tool is not on PATH. It is how this script reads the artifact back, so skipping it would make every assertion behind it vacuous."
    done
}

require dpkg dpkg-deb dpkg-query apt-cache apt-get lintian cmp find sort awk sed

# ── 1. dpkg's OWN control parser accepts the control member ──────────────────
# `tests/e2e/ship` asserts these fields with regexes over a tar-extracted file.
# This is the same claim read by the program that will reject the package in
# real life — including the rules no regex encodes (RFC822 folding, field
# ordering tolerance, the mandatory single trailing newline).
echo "== dpkg-deb --info"
dpkg-deb --info "$DEB"

PKG=$(dpkg-deb --field "$DEB" Package)
VERSION=$(dpkg-deb --field "$DEB" Version)
ARCH=$(dpkg-deb --field "$DEB" Architecture)
DEPENDS=$(dpkg-deb --field "$DEB" Depends)
[ -n "$PKG" ] || fail "dpkg-deb read an empty Package field"
[ -n "$VERSION" ] || fail "dpkg-deb read an empty Version field"
[ -n "$ARCH" ] || fail "dpkg-deb read an empty Architecture field"
echo "package=$PKG version=$VERSION arch=$ARCH"
echo "depends=$DEPENDS"

# ── 2. dpkg's own reader of the data member ──────────────────────────────────
echo "== dpkg-deb --contents"
CONTENTS=$(dpkg-deb --contents "$DEB")
printf '%s\n' "$CONTENTS"

# The launcher's mode, read out of the artifact by dpkg rather than out of the
# staged tree by `stat`. This assertion is what survives HAZARD 1: the artifact
# store does not preserve the executable bit, so `bin/<name>` is 0644 on the
# packing host, and the 0755 here can only have come from the mode PLAN
# travelling inside `.gjsify-ship-stage.json`. Make `readStage()` take modes
# from `statSync`, or drop `staged` from the sidecar, and this line reds.
grep -qE "^-rwxr-xr-x .* \./usr/bin/$PKG\$" <<<"$CONTENTS" ||
    fail "./usr/bin/$PKG is not 0755 in the data member. The mode plan did not survive the handoff — see readStage() and the sidecar's staged[]."

# Debian Policy § 12.5. Drop the pre-rendered overlay from the sidecar and this
# is the line that notices; nothing else in the pipeline does, and the package
# still installs.
grep -q "\./usr/share/doc/$PKG/copyright\$" <<<"$CONTENTS" ||
    fail "no /usr/share/doc/$PKG/copyright (Debian Policy § 12.5). The licence overlay did not travel."

# The sidecar is METADATA about the payload, not payload. Inside the package it
# would mean `readStage()` treated it as an ordinary staged file.
if grep -q 'gjsify-ship-stage\.json' <<<"$CONTENTS"; then
    fail ".gjsify-ship-stage.json was packed into the payload. The sidecar describes the stage; it must never be part of it."
fi

# dpkg applies uid/gid verbatim, so a build-user id here installs files owned by
# that id on the user's machine and the install still succeeds.
#
# TWO SPELLINGS, ONE CLAIM. `dpkg-deb --contents` renders the tar header's
# uname/gname when they are set and the numeric uid/gid when they are not, so
# `root/root` and `0/0` are the same package. `dpkg-deb --build` writes the
# names; `@gjsify/tar`'s `buildHeader()` writes ids 0 and leaves the name fields
# empty, which is the `tar --numeric-owner` convention the reproducible-builds
# recipes use and what `gjsify pack`'s npm tarballs — the same writer — look
# like. Demanding only the first spelling reds on a package that is correct,
# and a check that reds for cosmetics is one that gets `|| true`-ed (§ 4 says
# the same about lintian's exit code).
#
# What it still rejects is a THIRD spelling. `1000/1000` is a leaked id —
# lintian's `wrong-file-owner-uid-or-gid`, gated in § 4, reads that half too.
# `pascal/pascal` is a leaked NAME with the ids still 0, which nothing else here
# reads: GNU tar unpacking as root prefers the name over the id, so those bytes
# install as root under dpkg and as someone else under `tar -x`.
if awk '$2 != "root/root" && $2 != "0/0" { print; bad = 1 } END { exit bad ? 0 : 1 }' <<<"$CONTENTS"; then
    fail "the data member carries entries owned by neither root/root nor 0/0 — see the uid/gid and uname/gname fields in @gjsify/tar's buildHeader()"
fi

# The count is DERIVED from the stage job's own output — no file count is
# written down anywhere in this pipeline. Expected = the staged payload plus
# exactly one overlay file (the copyright).
ACTUAL_FILES=$(awk '/^-/ { n++ } END { print n + 0 }' <<<"$CONTENTS")
EXPECTED_FILES=$((EXPECT_FILES + 1))
[ "$ACTUAL_FILES" = "$EXPECTED_FILES" ] ||
    fail "the .deb carries $ACTUAL_FILES regular file(s); the stage held $EXPECT_FILES plus one copyright overlay = $EXPECTED_FILES"

# ── 3. every dependency NAME exists in a real archive ────────────────────────
# `utils/ship/depends.ts` says this out loud about its own table: the Debian
# column "follows the `gir1.2-<name>-<version>` convention every row above uses
# and is NOT verified against a Debian system … a wrong name fails at
# `apt install` with a clear error". Until this ran, nothing verified any of it.
# Names only, never versions: whether this archive currently ships a `gjs` new
# enough is Debian's release schedule, not our defect — that half is § 6.
echo "== dependency names exist in the archive"
while read -r name; do
    [ -n "$name" ] || continue
    if apt-cache show "$name" >/dev/null 2>&1; then
        echo "  ok   $name"
    else
        fail "Depends names \`$name\`, which does not exist in this archive. Fix the row in utils/ship/depends.ts' TYPELIB_PACKAGES, or the project's gjsify.ship.typelibPackages."
    fi
# `tr -d ' \t'` and NOT `tr -d '[:space:]'`: the latter deletes the newlines
# this loop reads by, collapsing every dependency into one unresolvable name —
# measured, and it would have made the whole check pass on a single bogus
# lookup that happens to fail loudly rather than silently. Alternatives (`a | b`)
# are split too, because either name must exist.
done < <(printf '%s\n' "$DEPENDS" | tr ',|' '\n\n' | sed 's/(.*//' | tr -d ' \t')

# ── 4. lintian, the third reader ─────────────────────────────────────────────
# GATED ON NAMED TAGS, NOT ON lintian's EXIT CODE. A hand-written package trips
# style tags whose names and severities move between lintian releases, so
# gating on the exit code buys a leg that reds for cosmetics and then gets
# `|| true`-ed — which is how a check stops meaning anything. Instead: the full
# output is printed (so the gap stays visible), error-severity tags surface as a
# warning, and a NAMED set must be absent.
#
# The named set is trustworthy only if lintian still knows those names, so each
# is validated against lintian's own tag list first. A renamed tag then reds
# with "lintian no longer knows this" instead of passing vacuously — that
# indirection is the whole point.
#
# `--fail-on none` IS PART OF THAT DESIGN, not a way to quiet the tool.
# lintian's exit code is not a tag count; it is a CONDITION the caller picks
# (`--fail-on error,warning,info,pedantic,experimental,override` — "define
# condition for exit status 2", default `error`). Measured on lintian 2.117:
#
#   --fail-on none, this package   0
#   --fail-on none, missing file   2   ("… is not a readable file")
#   --fail-on none, not an archive 1   ("Skipping …")
#   an unknown condition           255
#   default condition, E: tag      2
#
# The last two lines are the problem: under the DEFAULT condition "your package
# has an error tag" and "lintian never read your package" are the same code 2,
# and this gate's whole job is to tell those apart. Moving the tag verdict out
# of the exit code makes 0 reachable only by a completed analysis — so the named
# gate below runs on output that was really produced, and the tags decide
# nothing here but their own gate.
echo "== lintian"
set +e
LINTIAN_OUT=$(lintian --no-cfg --fail-on none --display-info --display-experimental "$DEB" 2>&1)
LINTIAN_RC=$?
set -e
printf '%s\n' "$LINTIAN_OUT"
[ "$LINTIAN_RC" -eq 0 ] ||
    fail "lintian exited $LINTIAN_RC under \`--fail-on none\`, a code it can only reach by NOT completing the analysis (2 = the file was unreadable, 1 = it was skipped as a non-archive, 255 = this lintian rejects the condition). Treating that as 'no tags' is how this gate would pass having read nothing."

TAG_LIST=$(lintian-explain-tags --list-tags 2>/dev/null || lintian --list-tags 2>/dev/null || true)
[ -n "$TAG_LIST" ] ||
    fail "cannot enumerate lintian's tag list (tried \`lintian-explain-tags --list-tags\` and \`lintian --list-tags\`). Without it the tag gate below cannot tell an absent defect from a renamed tag."

# Each entry is a defect THIS writer can produce, not a wishlist. `deb.ts`
# generates the whole md5sums member by hand — the file list and every digest —
# so the four tags that read it back are all reachable from one loop there.
#   no-copyright-file                Policy § 12.5 — the overlay
#   no-md5sums-control-file          the control member's md5sums
#   md5sum-mismatch                  a digest in it (NOT `md5sums-mismatch`:
#                                    that name is in no lintian this ran on, and
#                                    the validation below is what said so)
#   file-missing-in-md5sums          a payload path the member omits
#   md5sums-lists-nonexistent-file   a member path the payload omits
#   malformed-md5sums-control-file   its line format
#   wrong-file-owner-uid-or-gid      data.tar owner ids
#   control-file-has-bad-owner       control.tar owner ids
#   malformed-deb-archive            the ar container and its member order
#   control-file-has-bad-permissions the control member's modes
for tag in no-copyright-file no-md5sums-control-file md5sum-mismatch \
    file-missing-in-md5sums md5sums-lists-nonexistent-file malformed-md5sums-control-file \
    wrong-file-owner-uid-or-gid control-file-has-bad-owner malformed-deb-archive \
    control-file-has-bad-permissions; do
    grep -qFx "$tag" <<<"$TAG_LIST" ||
        fail "this lintian does not know the tag \`$tag\`. It was renamed or removed — find its current name and update this list; do not delete the check."
    # `$` and not `( |$)` was the first spelling, and it silently under-matched:
    # lintian appends a POINTER to every tag that has one
    # (`E: pkg: wrong-file-owner-uid-or-gid usr/bin/foo 1000/1000`), so the tag is
    # not the last token on the line and at least three of the six gated tags
    # could fire without matching. They would then surface only as the
    # non-gating warning below — a gate that reports instead of failing.
    if grep -qE "[ :]$tag( |\$)" <<<"$LINTIAN_OUT"; then
        fail "lintian reports \`$tag\`."
    fi
done
echo "  none of the gated tags fired"

ERROR_TAGS=$(grep '^E:' <<<"$LINTIAN_OUT" || true)
if [ -n "$ERROR_TAGS" ]; then
    echo "::warning title=Ship .deb::lintian reports error-severity tags this leg does not gate on yet. Each is a real Debian Policy gap in the hand-written writer — ledger it in status/open-todos.md or fix it; do not let the set grow silently."
    printf '%s\n' "$ERROR_TAGS"
fi

# ── 5. a real install, with dpkg doing the unpacking ─────────────────────────
# `--force-depends` and not `--dry-run`: the run worth having is the one that
# lays bytes down. The dependency question is answered separately in § 3 (names)
# and § 6 (versions, when this archive can), so forcing it here takes Debian's
# release schedule out of a structural check.
echo "== dpkg --install"
sudo dpkg --install --force-depends "$DEB"
dpkg --status "$PKG" | sed -n '1,12p'
dpkg --status "$PKG" | grep -q '^Status: install ok installed$' ||
    fail "dpkg did not reach 'install ok installed'"

# dpkg recomputing the md5sums OUR writer put in the control member, against the
# files dpkg itself unpacked. Corrupt one digest in `deb.ts` and this reds.
echo "== dpkg --verify"
set +e
VERIFY=$(dpkg --verify "$PKG")
VERIFY_RC=$?
set -e
if [ "$VERIFY_RC" -ne 0 ]; then
    printf '%s\n' "$VERIFY"
    fail "dpkg --verify found files that do not match the package's own md5sums"
fi
echo "  clean"

# The mode, on disk, after a real unpack — the end of the chain that starts at
# the mode plan in the sidecar.
[ -x "/usr/bin/$PKG" ] || fail "/usr/bin/$PKG is not executable after install"
[ -f "/usr/share/doc/$PKG/copyright" ] || fail "/usr/share/doc/$PKG/copyright is missing after install"

# Every staged byte, where the package said it would put it. The stage is the
# only place these bytes exist on this machine, so this is also the proof that
# the payload crossed the artifact store unaltered.
echo "== installed tree == staged tree"
while read -r rel; do
    [ -n "$rel" ] || continue
    cmp -s "$STAGE/$rel" "/usr/$rel" || fail "/usr/$rel differs from the staged $rel"
done < <(cd "$STAGE" && find . -type f ! -name .gjsify-ship-stage.json -printf '%P\n' | sort)
echo "  every staged file matches byte for byte"

# The installed program runs, and agrees with the package about what it is.
# `__PACKAGE_VERSION__` is a build-time define, so the bundle knows its own
# version with no package.json anywhere near it — which is exactly the situation
# an installed `/usr/lib/<name>/` is in. A mismatch here means the artifact was
# packed from a different bundle than the one whose version it advertises.
GJS_HAVE=$(dpkg-query -W -f='${Version}' gjs 2>/dev/null || true)
GJS_FLOOR=$(tr ',' '\n' <<<"$DEPENDS" | sed -n 's/.*gjs *(>= *\([^)]*\)).*/\1/p' | sed -n '1p')
RUNNABLE=no
if [ -n "$GJS_HAVE" ] && [ -n "$GJS_FLOOR" ] && dpkg --compare-versions "$GJS_HAVE" ge "$GJS_FLOOR"; then
    RUNNABLE=yes
fi
echo "== host gjs=$GJS_HAVE floor=$GJS_FLOOR runnable=$RUNNABLE"
if [ "$RUNNABLE" = yes ]; then
    REPORTED=$("/usr/bin/$PKG" --version)
    REPORTED_DEB=$(tr '-' '~' <<<"$REPORTED")
    echo "  $PKG --version => $REPORTED"
    case "$VERSION" in
    "$REPORTED_DEB"-*) : ;;
    *) fail "the installed $PKG reports $REPORTED but the package declares Version: $VERSION" ;;
    esac
else
    # NOT a skip that hides a defect: the reason is Debian's schedule, measured
    # in utils/ship/depends.ts (trixie ships 1.82.3 and forky 1.88.1; 1.84 and
    # 1.86 were skipped). The day this archive catches up, the branch above
    # starts gating by itself — nothing has to be remembered.
    echo "::notice title=Ship .deb::this runner's gjs ($GJS_HAVE) does not satisfy the package's floor ($GJS_FLOOR), so the installed binary was not executed. That is Debian's release schedule, not a defect — see DEFAULT_GJS_FLOOR in utils/ship/depends.ts. The .rpm leg runs the same payload on Fedora 44."
fi

echo "== dpkg --purge"
sudo dpkg --purge --force-depends "$PKG"
[ ! -e "/usr/bin/$PKG" ] || fail "/usr/bin/$PKG survived the purge"
[ ! -e "/usr/share/doc/$PKG" ] || fail "/usr/share/doc/$PKG survived the purge"
echo "  removed cleanly"

# ── 6. apt resolving the dependencies itself, when this archive can ──────────
# The "a stranger installs it" claim for the Debian side, gated only when the
# archive can satisfy the floor — same derivation as § 5, so it promotes itself.
if [ "$RUNNABLE" = yes ]; then
    echo "== apt-get install ./$DEB"
    sudo apt-get install -y "./$DEB"
    "/usr/bin/$PKG" --version >/dev/null
    sudo apt-get purge -y "$PKG"
    echo "  apt resolved every dependency and the installed binary ran"
else
    echo "::notice title=Ship .deb::apt cannot satisfy \`$DEPENDS\` on this archive, so the dependency-resolving install was not attempted."
fi

echo "verify-deb.sh: all assertions passed for $DEB"
