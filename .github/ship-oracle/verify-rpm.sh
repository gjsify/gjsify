#!/usr/bin/env bash
# Read an `.rpm` this project WROTE with rpm, on a host that is not ours.
#
# WHY PLAIN `fedora:44` AND NOT `ghcr.io/gjsify/ci-fedora:44`. ADR 0024 § A3:
# writing the RPM header ourselves is what makes `rpm` an INDEPENDENT oracle,
# and it caught a real defect in the first artifact this packer produced. Our
# own CI image has the whole toolchain baked in, which is exactly what would
# mask a runtime dependency the package forgot to declare. The claim under test
# is "a stranger can install this", so the reader runs on a stranger's machine.
#
# WHAT THIS ADDS OVER `tests/e2e/ship`. That suite already runs `rpm -Kv`,
# `-qp --requires`, `-qpl` and `rpm -i --test` on the Fedora CI image. It does
# NOT install, so it cannot see a `Requires` that names a package Fedora does
# not have, a mode that survives the header and not the payload, or an installed
# launcher that does not start. Those are §§ 5-8 below, and they are the reason
# this file is worth its ~90 seconds.
#
# Reproduce by hand:
#   docker run --rm -v "$PWD:/w" -w /w fedora:44 \
#     bash .github/ship-oracle/verify-rpm.sh ship/out/gjsify-0.41.0-1.noarch.rpm ship/stage
set -euo pipefail

RPM=${1:?usage: verify-rpm.sh <artifact.rpm> <stage-dir>}
STAGE=${2:?usage: verify-rpm.sh <artifact.rpm> <stage-dir>}

fail() {
    echo "::error title=Ship .rpm::$*"
    exit 1
}

# `find` (findutils) and `cmp` (diffutils) are NOT in the base image. Installed
# rather than probed, for `tests/e2e/ship`'s reason: a reader that can go
# missing turns every assertion behind it into a no-op.
dnf -y --disablerepo=fedora-cisco-openh264 install --setopt=install_weak_deps=False findutils diffutils >/dev/null
for tool in rpm dnf find cmp sort awk grep; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool is not on PATH inside the container"
done

# ── 1. both digests, verified by rpm ─────────────────────────────────────────
echo "== rpm -Kv"
KOUT=$(rpm -Kv "$RPM")
printf '%s\n' "$KOUT"
printf '%s\n' "$KOUT" | grep -qi 'SHA256' || fail "rpm did not report a SHA256 digest — the header this writer produced carries none"
# `if … then fail; fi`, never `grep … && fail`: under `set -e` an `A && B` whose
# A fails makes the whole list return non-zero and ends the script — silently,
# in the branch where nothing is wrong.
if printf '%s\n' "$KOUT" | tr '[:lower:]' '[:upper:]' | grep -qE 'BAD|NOT OK'; then
    fail "rpm reports a bad digest"
fi

# ── 2. the header, as rpm reads it back ──────────────────────────────────────
echo "== rpm -qp"
FIELDS=$(rpm -qp --qf '%{NAME}|%{VERSION}|%{RELEASE}|%{ARCH}|%{OS}|%{LICENSE}' "$RPM")
echo "$FIELDS"
IFS='|' read -r NAME VERSION RELEASE ARCH OS LICENSE <<<"$FIELDS"
[ -n "$NAME" ] || fail "empty NAME"
[ -n "$VERSION" ] || fail "empty VERSION"
[ "$OS" = linux ] || fail "OS is '$OS', not linux — rpm accepts -qp and -K on a package with no OS tag and refuses to build a transaction element from it"
[ -n "$LICENSE" ] || fail "empty LICENSE — both formats carry it as a required field"

# ── 3. the file list ─────────────────────────────────────────────────────────
echo "== rpm -qpl"
FILES=$(rpm -qpl "$RPM")
printf '%s\n' "$FILES"
printf '%s\n' "$FILES" | grep -qx "/usr/bin/$NAME" || fail "/usr/bin/$NAME is not in the header's file list"
printf '%s\n' "$FILES" | grep -qx "/usr/share/licenses/$NAME/LICENSE" || fail "no /usr/share/licenses/$NAME/LICENSE — the licence overlay did not travel"
if printf '%s\n' "$FILES" | grep -q 'gjsify-ship-stage\.json'; then
    fail ".gjsify-ship-stage.json was packed into the payload. The sidecar describes the stage; it must never be part of it."
fi
# Owning a directory the base system owns makes the package fight `filesystem`
# and `glib2` for it.
for owned in /usr /usr/bin /usr/share /usr/lib; do
    if printf '%s\n' "$FILES" | grep -qx "$owned"; then
        fail "the package claims ownership of $owned"
    fi
done

# ── 4. modes, from the header, and the file count ────────────────────────────
# The rpm twin of the dpkg 0755 assertion, and it fails for the same single
# cause: the mode plan travels in `.gjsify-ship-stage.json`'s `staged[]` because
# the artifact store does not preserve an executable bit. Two formats reading
# the same regression is what makes it unmissable.
echo "== rpm -qp --dump"
DUMP=$(rpm -qp --dump "$RPM")
printf '%s\n' "$DUMP" | awk -v name="/usr/bin/$NAME" '$1 == name { print }' | grep -q ' 0100755 ' ||
    fail "/usr/bin/$NAME is not mode 0100755 in the header. The mode plan did not survive the handoff — see readStage() and the sidecar's staged[]."

STAGED=$(cd "$STAGE" && find . -type f ! -name .gjsify-ship-stage.json -printf '%P\n' | sort)
STAGED_COUNT=$(printf '%s\n' "$STAGED" | grep -c . || true)
PACKED_COUNT=$(printf '%s\n' "$DUMP" | awk '$5 ~ /^0100/ { n++ } END { print n + 0 }')
EXPECTED=$((STAGED_COUNT + 1))
[ "$PACKED_COUNT" = "$EXPECTED" ] ||
    fail "the .rpm carries $PACKED_COUNT regular file(s); the stage held $STAGED_COUNT plus one licence overlay = $EXPECTED"

# ── 5. requires ──────────────────────────────────────────────────────────────
echo "== rpm -qp --requires"
REQUIRES=$(rpm -qp --requires "$RPM")
printf '%s\n' "$REQUIRES"
printf '%s\n' "$REQUIRES" | grep -qE '^gjs( |$)' || fail "no gjs requirement — the launcher execs gjs"
printf '%s\n' "$REQUIRES" | grep -qx '/bin/sh' || fail "no /bin/sh requirement — the launcher is a POSIX shell script"
for feature in CompressedFileNames FileDigests PayloadFilesHavePrefix; do
    printf '%s\n' "$REQUIRES" | grep -q "rpmlib($feature)" ||
        fail "no rpmlib($feature) — declaring these is what makes an older rpm refuse the package cleanly instead of misreading its file list"
done

# ── 6. rpm builds a real transaction element ─────────────────────────────────
# The check that catches a missing OS or ARCH tag, which `-qp` and `-K` accept.
echo "== rpm -i --test"
rpm -i --test --nodeps "$RPM"

# ── 7. Fedora resolves every Requires ITSELF, then the payload installs ──────
# This is the half `tests/e2e/ship` structurally cannot do, and the one that
# reads the rpm column of `TYPELIB_PACKAGES` — every name in it is a claim about
# a Fedora package that has never been checked against a Fedora repository.
echo "== dnf install"
# --disablerepo=fedora-cisco-openh264 is REQUIRED, not tidiness (#1057): this
# package's Requires reach gdk-pixbuf2, which pulls openh264 through a HARD
# chain (libheif → libopenh264.so.8), so install_weak_deps=False does not drop
# it — and that repo is separately hosted, so its outage fails the whole
# transaction and reads here as "the .rpm is broken".
dnf -y --disablerepo=fedora-cisco-openh264 install "./$RPM"
rpm -q "$NAME"

# rpm re-verifying its own digests, sizes and modes against what it unpacked.
echo "== rpm -V"
if ! VOUT=$(rpm -V "$NAME"); then
    printf '%s\n' "$VOUT"
    fail "rpm -V found installed files that do not match the header"
fi
echo "  clean"

[ -x "/usr/bin/$NAME" ] || fail "/usr/bin/$NAME is not executable after install"

echo "== installed tree == staged tree"
while read -r rel; do
    [ -n "$rel" ] || continue
    cmp -s "$STAGE/$rel" "/usr/$rel" || fail "/usr/$rel differs from the staged $rel"
done <<<"$STAGED"
echo "  every staged file matches byte for byte"

# ── 8. the installed program runs, and agrees about what it is ───────────────
# Fedora 44 ships GJS 1.88, so unlike the Debian half this always gates. The
# version comes from the `__PACKAGE_VERSION__` build-time define, i.e. from the
# BUNDLE — a mismatch means the artifact was packed from a different bundle than
# the one whose version it advertises.
REPORTED=$("/usr/bin/$NAME" --version)
echo "  $NAME --version => $REPORTED"
[ "$REPORTED" = "$VERSION" ] ||
    fail "the installed $NAME reports $REPORTED but the package declares Version: $VERSION"

echo "== dnf remove"
dnf -y remove "$NAME" >/dev/null
[ ! -e "/usr/bin/$NAME" ] || fail "/usr/bin/$NAME survived the erase"
[ ! -e "/usr/lib/$NAME" ] || fail "/usr/lib/$NAME survived the erase — its own directories must be owned, or rpm -e leaves them"

echo "verify-rpm.sh: all assertions passed for $RPM"
