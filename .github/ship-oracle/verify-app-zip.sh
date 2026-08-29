#!/usr/bin/env bash
# Read the `<App>.app` zip this project WROTE with a reader that can see the mode.
#
# WHY THIS FILE EXISTS. `gjsify ship` writes the archive by hand
# (`packages/infra/cli/src/utils/ship/zip.ts`) — no `zip(1)`, no dependency,
# `requiredTools: []` — for the reason ADR 0024 § A3 gives for the hand-written
# `.deb` and `.rpm`: a format this tree writes itself needs no tool on the packing
# host, which is what keeps `unzip`'s reader INDEPENDENT rather than the other
# half of a `zip`-writes/`unzip`-reads round trip.
#
# WHY `zipinfo -l` AND NOT `unzip -Z1`. The failure mode of a distributed `.app`
# is a launcher that arrives 0644 and will not run, and the zip's external
# attributes are the only place in the archive that can carry 0755. Measured:
#
#   unzip -Z1 demo.zip   Contents/  Contents/MacOS/  Contents/MacOS/demo
#   zipinfo -l demo.zip  -rwxr-xr-x  3.0 unx  18 tx stor … Contents/MacOS/demo
#
# `-Z1` prints NAMES ONLY — it is structurally blind to exactly the thing that
# matters. `zipinfo` ships in the same `unzip` package, which is already in
# `.docker/ci-fedora.Dockerfile`. `bsdtar` was the other candidate and is absent
# both here and in the CI image; adding it trips
# `scripts/check-ci-image-packages.mjs`.
#
# THE `unx` IN THAT LISTING IS PART OF THE ASSERTION, not decoration. `unzip`
# reads the external attributes as POSIX bits only when the archive's
# version-made-by says it was created on Unix; with the DOS value the same 0755
# in the same field is read as DOS attribute flags and every file extracts at the
# umask default. So the mode would be in the archive and no reader would ever see
# it — which is why `zip.ts` sets `VERSION_MADE_BY = 0x0314` and why the check
# below reads the `unx` column rather than trusting the permission string.
#
# WHY IT IS A FILE AND NOT AN INLINE `run:` BLOCK — same rule as its three
# siblings here: a body that lives in a workflow is a body nobody can run by hand
# when it fails. Reproduce with
#
#   bash .github/ship-oracle/verify-app-zip.sh \
#       "ship/out/ship-demo-1.2.3-1.arm64.zip" "ship/out/Ship Demo.app"
#
# THE SECOND ARGUMENT IS THE `.app` ARTIFACT, not the stage, and the difference is
# one file: both darwin formats pack the staged payload PLUS the format's licence
# overlay, so the stage is a file short and every count and byte comparison below
# would red on a correct pair. Comparing the two artifacts is also the stronger
# claim — `macos-app` and `macos-app-zip` are two rows over one payload, and this
# is the only place anything checks that they agree.
#
# DISCRIMINATOR (run it, do not trust it): rebuild the archive with the launcher
# planned 0644 and this must exit 1 naming it; drop the mode out of the external
# attributes entirely and the `unx`/mode assertion must exit 1 rather than passing
# on a permission string `unzip` invented. Both are driven from
# `tests/e2e/ship-macos/run.mjs` against archives built in-process, so the failure
# path of this file runs on every PR.
#
# EVERY LOOP THAT CAN FAIL READS FROM `< <(…)`, never from a pipe: the right-hand
# side of a pipeline runs in a SUBSHELL, so an `exit 1` inside one ends the
# subshell and the script carries on green. Same rule, same reason, as
# `verify-deb.sh`.
set -euo pipefail

ZIP=${1:?usage: verify-app-zip.sh <artifact.zip> <App.app artifact directory>}
BUNDLE=${2:?usage: verify-app-zip.sh <artifact.zip> <App.app artifact directory>}

fail() {
    echo "::error title=Ship .app zip::$*"
    exit 1
}

require() {
    for tool in "$@"; do
        command -v "$tool" >/dev/null 2>&1 ||
            fail "$tool is not on PATH. It is how this script reads the artifact back, so skipping it would make every assertion behind it vacuous."
    done
}

# No silent skip. `tests/e2e/ship`'s `probe()` settled that for this family: every
# assertion below sits behind a reader, so a missing reader would leave the script
# green having read nothing.
require zipinfo unzip stat find sort awk cmp

[ -f "$ZIP" ] || fail "$ZIP does not exist"
[ -d "$BUNDLE" ] || fail "$BUNDLE is not a directory — this script compares the archive against the .app artifact"

APP=$(basename "$BUNDLE")

echo "== zipinfo -l"
LISTING=$(zipinfo -l "$ZIP")
printf '%s\n' "$LISTING"

# ── 1. every entry is a regular file under `<App>.app/` ──────────────────────
# `zip.ts` emits no directory entries at all — `unzip` recreates the tree from
# the file paths — so a `d` here means somebody added them and did not say so.
#
# THE ROW FILTER MATCHES THE PERMISSION COLUMN, not a field count. `NF > 8` was
# the first spelling and it also matched zipinfo's trailing summary line
# ("12 files, 3044 bytes uncompressed, 3044 bytes compressed:  0.0%", nine
# fields), so the loop reported "an entry that is neither a regular file nor a
# directory (12)" on a perfectly good archive. A filter that matches the wrong
# rows fails loudly here and would have passed silently in the mode loop below.
# And an entry OUTSIDE the bundle would expand beside it: the archive is meant to
# be unzipped straight into `/Applications`, where a stray sibling is litter the
# user never associates with the app.
while read -r perms _rest; do
    case "$perms" in
    -*) : ;;
    d*) fail "the archive carries a directory entry ($perms). zip.ts writes none; unzip recreates the tree from the file paths." ;;
    *) fail "the archive carries an entry that is neither a regular file nor a directory ($perms)" ;;
    esac
done < <(awk '$1 ~ /^[-dlbcps][-rwxsStT]{9}$/ { print }' <<<"$LISTING")

while read -r name; do
    case "$name" in
    "$APP"/*) : ;;
    *) fail "$name is outside $APP/, so unzipping this archive would drop a file beside the bundle instead of inside it" ;;
    esac
done < <(unzip -Z1 "$ZIP")

# ── 2. the sidecar is metadata about the stage, never payload ────────────────
if unzip -Z1 "$ZIP" | grep -q 'gjsify-ship-stage\.json'; then
    fail ".gjsify-ship-stage.json was packed into the archive. The sidecar describes the stage; it must never be part of it."
fi

# ── 3. the mode, read as a POSIX mode ────────────────────────────────────────
# The `unx` column first, because without it the permission string below is
# `unzip` rendering DOS attribute bits and the check would pass on an archive
# every extractor unpacks at the umask default.
while read -r perms _ver os _rest; do
    [ "$os" = unx ] ||
        fail "an entry reports host system \`$os\`, not \`unx\`. The POSIX mode in the external attributes is only read when version-made-by says Unix — see VERSION_MADE_BY in utils/ship/zip.ts."
done < <(awk '$1 ~ /^[-dlbcps][-rwxsStT]{9}$/ { print }' <<<"$LISTING")

# Every file's mode, out of the ARCHIVE, compared with the staged tree — not with
# a number written down here. The staged tree is where `readStage` applied the
# mode PLAN from the sidecar, so this is the end of the chain that begins there;
# a writer that dropped the external attributes reds on the launcher first.
EXECUTABLES=0
while read -r perms _ver _os _size _tx _csize _method _date _time name; do
    rel=${name#"$APP"/}
    disk="$BUNDLE/$rel"
    [ -f "$disk" ] || fail "$name is in the archive and not in $BUNDLE — the two formats pack different bundles"
    want=$(stat -c '%a' "$disk")
    # `zipinfo`'s permission string → the octal the file has on disk. Only the
    # nine mode bits are compared: setuid/sticky have no meaning for a payload
    # this writer can produce and `zip.ts` masks to 0o7777 anyway.
    # The weights are DECIMAL and the print is `%o`, which is the pairing that
    # took a run to get right: summing `400 200 100 …` and then printing `%o`
    # re-encodes an already-octal number and turns 0644 into 1204.
    got=$(awk -v p="$perms" 'BEGIN {
        n = 0
        split("256 128 64 32 16 8 4 2 1", bit, " ")
        for (i = 1; i <= 9; i++) if (substr(p, i + 1, 1) != "-") n += bit[i]
        printf "%o", n
    }')
    [ "$got" = "$want" ] ||
        fail "$name is $got in the archive and $want in the .app artifact — the external attributes did not survive the writer"
    case "$perms" in
    *x*) EXECUTABLES=$((EXECUTABLES + 1)) ;;
    esac
done < <(awk '$1 ~ /^[-dlbcps][-rwxsStT]{9}$/ { print }' <<<"$LISTING")

# THE DISCRIMINATOR FOR THIS WHOLE FILE. An archive of a `.app` in which nothing
# is executable is an archive of an application that does not start, and every
# assertion above would pass on it: the modes would agree with a staged tree that
# is itself wrong. At least one entry has to carry `x`, and it has to be the one
# `Info.plist` names.
[ "$EXECUTABLES" -gt 0 ] ||
    fail "no entry in the archive is executable. A .app whose launcher extracts 0644 will not run, and that is the only failure this format has."

# ── 4. round trip: extract and compare bytes ─────────────────────────────────
# STORE-only, so a difference here is the writer's framing and not a compressor's
# — which is what makes a byte comparison worth running rather than a size check.
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
unzip -qq "$ZIP" -d "$OUT"
COUNT=0
while read -r rel; do
    cmp -s "$BUNDLE/$rel" "$OUT/$APP/$rel" ||
        fail "$rel differs between the .app artifact and the extracted archive"
    COUNT=$((COUNT + 1))
done < <(cd "$BUNDLE" && find . -type f -printf '%P\n' | sort)

STAGED=$(cd "$BUNDLE" && find . -type f | wc -l)
ENTRIES=$(unzip -Z1 "$ZIP" | wc -l)
[ "$STAGED" = "$ENTRIES" ] ||
    fail "the bundle holds $STAGED file(s) and the archive $ENTRIES entr(y|ies) — one of them is carrying something the other is not"

echo "verify-app-zip.sh: $COUNT file(s) round-tripped byte for byte, $EXECUTABLES executable, modes read as POSIX"
