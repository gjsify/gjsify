#!/usr/bin/env bash
# Read an `.msi` back with a reader from a DIFFERENT family than the one that
# wrote it — #1354 M5, ADR 0024 § A3.
#
# WHY THIS FILE EXISTS AND WHAT IT IS NOT. `gjsify ship` does not write the MSI
# format; it writes a `.wxs` and hands it to a compiler (`utils/ship/msi.ts`). So
# unlike the `.deb` and the `.rpm`, there is no independence to be had by
# construction, and § A6 records the shape that buys it instead: ONE authored
# document, TWO compilers, each one's output read by the other's family.
#
#   `wixl` (msitools) writes on Linux  →  `msiexec` (Windows Installer) INSTALLS
#                                         it on the windows leg and the leg then
#                                         RUNS the installed launcher
#   WiX v3 writes on Windows           →  this script reads it on Linux
#
# THAT IS WHY THE THIRD ARGUMENT IS NOT OPTIONAL DECORATION. Run against the file
# its own package produced, everything below is msitools agreeing with msitools.
# `msiinfo suminfo` prints the producer into the `Application:` field, so the
# caller states which family it expects and this script refuses a file that does
# not match. Prefix the expectation with `!` to assert the NEGATIVE — which is what
# the cross-read job wants, because "not msitools" is a claim about independence
# that does not depend on WiX's exact wording.
#
# WHY `msiinfo` AND NOT `7z`. Both can open the container — an MSI is a Compound
# File Binary and 7-Zip advertises a handler — but `7z l` lists STREAMS: it sees
# `app.cab` and the mangled table names, not the File/Component/Directory/Shortcut
# ROWS. Every question worth asking here ("does the installer create a shortcut",
# "does it install under the program directory", "is the upgrade code stable") is a
# question about a row. `msiinfo export <table>` answers those; `7z` is
# structurally blind to them, the way `unzip -Z1` is blind to a mode.
#
# WHY IT IS A FILE AND NOT AN INLINE `run:` BLOCK — the same rule as its four
# siblings here: a body that lives in a workflow is a body nobody can run by hand
# when it fails. Reproduce with
#
#   bash .github/ship-oracle/verify-msi.sh \
#       ship/out/ship-demo-1.2.3-1.x64.msi "ship/out/Ship Demo" msitools
#   bash .github/ship-oracle/verify-msi.sh \
#       incoming/wix.msi "incoming/Ship Window Demo" '!msitools'
#
# THE SECOND ARGUMENT IS THE PROGRAM DIRECTORY the `.msi` was built from, i.e.
# `windows-dir`'s artifact — the same pairing `verify-app-zip.sh` uses and for the
# same reason: comparing the installer against the directory is the only place
# anything checks that the three rows over the windows layout agree.
#
# DISCRIMINATOR (run it, do not trust it): `tests/e2e/ship-msi/run.mjs` drives
# every refusal below against a MUTATED copy — a file deleted from the directory,
# the shortcut row emptied, a wrong producer claimed — and asserts exit 1. Without
# those, a script that returned 0 unconditionally would leave the whole suite green.
#
# EVERY LOOP THAT CAN FAIL READS FROM `< <(…)`, never from a pipe: the right-hand
# side of a pipeline runs in a SUBSHELL, so an `exit 1` inside one ends the
# subshell and the script carries on green. Same rule, same reason, as
# `verify-deb.sh` and `verify-app-zip.sh`.
set -euo pipefail

MSI=${1:?usage: verify-msi.sh <artifact.msi> <program directory> <producer|!producer>}
DIR=${2:?usage: verify-msi.sh <artifact.msi> <program directory> <producer|!producer>}
PRODUCER=${3:?usage: verify-msi.sh <artifact.msi> <program directory> <producer|!producer>}

fail() {
    echo "::error title=Ship msi::$*"
    exit 1
}

require() {
    for tool in "$@"; do
        command -v "$tool" >/dev/null 2>&1 ||
            fail "$tool is not on PATH. It is how this script reads the artifact back, so skipping it would make every assertion behind it vacuous."
    done
}

# No silent skip, for the reason `tests/e2e/ship`'s `probe()` gives: every
# assertion below sits behind a reader.
require msiinfo msiextract find sort cmp awk tr

# `msiinfo export` writes the MSI **IDT** text format, whose line terminator is
# CRLF by specification — measured: the last byte of every exported table here is
# `\r\n`. So the LAST column of every row carries a trailing `\r` and the first
# does not, which is a difference that shows up only when two tables are compared
# against each other and looks exactly like a mismatched row. It cost one run of
# this script. Stripped once, here, rather than at each awk: no identifier, GUID or
# path in these tables can contain a carriage return.
#
# NEVER pipe `msiinfo` into a truncating reader. `msiinfo export … | head` makes it
# print `error: libmsi_database_export / msiinfo: internal error (function failed)`
# on EPIPE, which reads as a corrupt database and is nothing but the pipe closing —
# the same run that measured the CRLF chased that for ten minutes first.
idt() {
    msiinfo export "$MSI" "$1" | tr -d '\r'
}

[ -f "$MSI" ] || fail "$MSI does not exist"
[ -d "$DIR" ] || fail "$DIR is not a directory — this script compares the installer against the program directory it packs"

# ABSOLUTE FROM HERE ON, and this is a measured failure rather than tidiness. The
# byte round trip at the end runs `msiextract` from INSIDE a temp directory, so a
# caller-relative path stops resolving the moment it `cd`s. Every call in
# `tests/e2e/ship-msi` passes absolute paths and the CI leg passes relative ones,
# so the whole class was invisible until `windows-dir-assemble` reported
#
#     app/app.node.mjs is in the program directory and not in the installer's cabinet
#
# on a perfectly good installer — a message about the ARTIFACT for a defect in the
# reader, which is the worst direction for a diagnostic to point.
MSI=$(cd "$(dirname "$MSI")" && pwd)/$(basename "$MSI")
DIR=$(cd "$DIR" && pwd)

APP=$(basename "$DIR")

# ── 0. WHO WROTE IT ──────────────────────────────────────────────────────────
echo "== msiinfo suminfo"
SUMINFO=$(msiinfo suminfo "$MSI")
printf '%s\n' "$SUMINFO"
APPLICATION=$(awk -F': ' '/^Application:/ { print $2 }' <<<"$SUMINFO")
[ -n "$APPLICATION" ] || fail "the summary information names no creating application, so nothing here can say which implementation wrote this file"
case "$PRODUCER" in
!*)
    WANT=${PRODUCER#!}
    case "$APPLICATION" in
    *"$WANT"*) fail "this file says it was written by \"$APPLICATION\", which contains \"$WANT\" — so the reader below is the package that wrote it. That is a self-oracle, which is exactly what the two-compiler design (ADR 0024 § A6) exists to avoid." ;;
    esac
    echo "producer \"$APPLICATION\" is NOT $WANT — this read is cross-family"
    ;;
*)
    case "$APPLICATION" in
    *"$PRODUCER"*) echo "producer \"$APPLICATION\" matches $PRODUCER" ;;
    *) fail "expected this file to have been written by $PRODUCER; its summary information says \"$APPLICATION\". Either the wrong artifact was downloaded or the backend is not the one this leg thinks it is." ;;
    esac
    ;;
esac

# The architecture lives in the summary `Template`, not in a table, and a wrong
# one is silent: an x86 package refuses to install a 64-bit component tree at
# RUNTIME, on the user's machine, with an error about the package rather than the
# arch.
case "$SUMINFO" in
*"Template: x64"*) : ;;
*) fail "the summary Template does not say x64. The windows layout has exactly one architecture (#1117), and an installer built for another one fails on the user's machine, not here." ;;
esac

# ── 1. THE TABLES AN INSTALLER NEEDS ─────────────────────────────────────────
echo "== msiinfo tables"
TABLES=$(msiinfo tables "$MSI")
printf '%s\n' "$TABLES"
for table in File Component Directory Feature FeatureComponents Media Property Shortcut; do
    grep -qx "$table" <<<"$TABLES" || fail "the database has no $table table"
done

# ── 2. ONE EMBEDDED CABINET, so the artifact is ONE file ─────────────────────
# A `.msi` with an external cab is an artifact a user separates from its payload
# on the way to the machine it installs on.
echo "== msiinfo streams"
STREAMS=$(msiinfo streams "$MSI")
printf '%s\n' "$STREAMS"
grep -qx 'app.cab' <<<"$STREAMS" ||
    fail "the cabinet is not embedded in the database — this artifact would need a sibling file to install"

# ── 3. THE FILES, ROW BY ROW AGAINST THE DIRECTORY ───────────────────────────
# `msiinfo export` prints the table with two header lines (names, then column
# types) and a `<table>\t<table>` line before the rows, so every reader below
# skips to the rows by column shape rather than by counting lines.
FILES=$(idt File)
ROWS=$(awk -F'\t' 'NR > 3 && NF >= 8 { print }' <<<"$FILES" | wc -l)
ON_DISK=$(cd "$DIR" && find . -type f | wc -l)
[ "$ROWS" = "$ON_DISK" ] ||
    fail "the installer carries $ROWS file row(s) and the program directory holds $ON_DISK file(s) — one of them is carrying something the other is not"
[ "$ROWS" -gt 0 ] || fail "the installer has no file rows at all"

# Every row's KeyPath component must exist, and every component must be in the
# feature — a component nothing references installs nothing, silently.
COMPONENTS=$(idt Component)
COMPONENT_ROWS=$(awk -F'\t' 'NR > 3 && NF >= 6 { print $1 }' <<<"$COMPONENTS" | sort)
FEATURE_ROWS=$(idt FeatureComponents | awk -F'\t' 'NR > 3 && NF >= 2 { print $2 }' | sort)
[ "$(wc -l <<<"$COMPONENT_ROWS")" = "$ROWS" ] ||
    fail "the installer has $(wc -l <<<"$COMPONENT_ROWS") component(s) for $ROWS file(s) — one component per file is what makes an uninstall able to remove exactly what was installed"
diff <(printf '%s\n' "$COMPONENT_ROWS") <(printf '%s\n' "$FEATURE_ROWS") >/dev/null ||
    fail "a component is not in the feature, or the feature names a component that does not exist. A component outside every feature is never installed, and the package still installs at exit 0."

# Distinct GUIDs. Windows Installer keys reference counting on the component id,
# so two components sharing one GUID make an uninstall of either leave the other's
# files behind.
GUIDS=$(awk -F'\t' 'NR > 3 && NF >= 6 { print $2 }' <<<"$COMPONENTS")
UNIQUE=$(sort -u <<<"$GUIDS" | wc -l)
[ "$UNIQUE" = "$ROWS" ] ||
    fail "$ROWS component(s) carry only $UNIQUE distinct GUID(s). Windows Installer reference-counts on the component id, so a shared GUID makes one uninstall strand another product's files."

# ── 4. WHERE IT LANDS ────────────────────────────────────────────────────────
DIRECTORY=$(idt Directory)
printf '%s\n' "$DIRECTORY" | grep -q "^INSTALLDIR	" ||
    fail "there is no INSTALLDIR row, so \`msiexec INSTALLDIR=…\` has nothing to override and the install location is not addressable"
INSTALL_ROW=$(grep "^INSTALLDIR	" <<<"$DIRECTORY")
INSTALL_PARENT=$(cut -f2 <<<"$INSTALL_ROW")
INSTALL_NAME=$(cut -f3 <<<"$INSTALL_ROW")
[ "$INSTALL_PARENT" = ProgramFiles64Folder ] ||
    fail "INSTALLDIR hangs off \"$INSTALL_PARENT\" and not ProgramFiles64Folder — a 64-bit payload under the 32-bit program files directory is the shape that installs and then cannot find its own DLLs"
# `DefaultDir` may be `short|long`; the long half is what a user sees.
[ "${INSTALL_NAME##*|}" = "$APP" ] ||
    fail "INSTALLDIR is named \"$INSTALL_NAME\" and the program directory is \"$APP\". The installed tree must be the tree the zip expands to, or the two artifacts of one payload are two different applications."

# ── 5. SOMETHING TO CLICK ────────────────────────────────────────────────────
# An installer that lays files down and gives a user no way to start them is a
# zip with extra steps.
SHORTCUTS=$(idt Shortcut | awk -F'\t' 'NR > 3 && NF >= 4 { print }')
SHORTCUT_COUNT=$(grep -c . <<<"${SHORTCUTS:-}" || true)
[ "$SHORTCUT_COUNT" = 1 ] ||
    fail "the installer defines $SHORTCUT_COUNT shortcut(s); it must define exactly one, or the user has nothing to start (or several things that look like copies)"
[ "$(cut -f2 <<<"$SHORTCUTS")" = ProgramMenuFolder ] ||
    fail "the shortcut is not in ProgramMenuFolder, so it is not in the Start Menu"
SHORTCUT_COMPONENT=$(cut -f4 <<<"$SHORTCUTS")
grep -q "^$SHORTCUT_COMPONENT	" <<<"$COMPONENTS" ||
    fail "the shortcut belongs to component \"$SHORTCUT_COMPONENT\", which has no row — the shortcut would never be created"

# ── 6. THE ENTRY A USER REMOVES IT BY ────────────────────────────────────────
# Add/Remove Programs is generated from these four properties. A missing one is an
# installer that installs and cannot be found again.
PROPERTIES=$(idt Property)
for key in ProductName ProductVersion ProductCode UpgradeCode Manufacturer; do
    grep -q "^$key	" <<<"$PROPERTIES" || fail "the database has no $key property — Add/Remove Programs would have no entry to offer"
done
printf '%s\n' "$PROPERTIES" | awk -F'\t' '$1 == "ProductName" || $1 == "ProductVersion" || $1 == "Manufacturer" || $1 == "UpgradeCode" { print "  " $1 " = " $2 }'

# ── 7. ROUND TRIP: unpack the cabinet and compare bytes ──────────────────────
# The end of the chain. Everything above reads the DATABASE; this reads the
# payload out of the embedded cab and compares it with the directory the
# installer was built from, which is the only assertion here that would catch a
# correct table over the wrong bytes.
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
(cd "$OUT" && msiextract "$MSI" >/dev/null)
# `msiextract` EXITS 0 HAVING EXTRACTED NOTHING when it cannot open the database.
# Measured: `msiextract does-not-exist.msi` prints `WARNING: open file failed`,
# writes no file, and returns 0 — so `set -e` does not catch it, and every `cmp`
# below then fails on the FIRST file with a message about the cabinet. A reader
# that silently reads nothing is the exact failure this family of scripts exists
# against, so its output is checked rather than its exit code.
[ -d "$OUT/$APP" ] ||
    fail "msiextract wrote no \"$APP\" directory. It exits 0 when it cannot open the database, so this is the READER failing and not the artifact — check that $MSI is readable."
EXTRACTED=$(find "$OUT" -type f | wc -l)
[ "$EXTRACTED" -gt 0 ] ||
    fail "msiextract wrote no files at all out of $MSI, at exit 0. See above: its exit code is not an answer."
COUNT=0
while read -r rel; do
    extracted="$OUT/$APP/$rel"
    [ -f "$extracted" ] || fail "$rel is in the program directory and not in the installer's cabinet"
    cmp -s "$DIR/$rel" "$extracted" || fail "$rel differs between the program directory and the installer's cabinet"
    COUNT=$((COUNT + 1))
done < <(cd "$DIR" && find . -type f -printf '%P\n' | sort)

# The two counts have to agree as well as the bytes: a cabinet holding files the
# directory does not is invisible to the loop above, which only walks the directory.
[ "$EXTRACTED" = "$COUNT" ] ||
    fail "the cabinet holds $EXTRACTED file(s) and the program directory $COUNT — the installer would lay down something the directory artifact does not have"

echo "verify-msi.sh: $COUNT file(s) round-tripped byte for byte out of the embedded cabinet, $ROWS component(s), 1 Start-Menu shortcut, INSTALLDIR = ProgramFiles64Folder\\$APP"
