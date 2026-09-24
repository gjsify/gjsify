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
# the shortcut row emptied, a wrong producer claimed, the Icon row deleted, the
# shortcut's Icon_ blanked, ARPPRODUCTICON removed — and asserts exit 1. Without
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

# STDERR, not stdout, and it is load-bearing rather than tidy. Several readers
# here are called as `VAR=$(idt Directory)`, and a `fail` inside a command
# substitution writes into VAR: the message is captured instead of shown, and
# `exit 1` leaves only the subshell, so `set -e` aborts the script with nothing
# printed at all. On stderr the message survives the substitution, and it cannot
# contaminate the value a reader returns on stdout either.
#
# GitHub reads `::error` workflow commands from stderr the same as from stdout,
# and `tests/e2e/ship-msi`'s `oracleExpectingFailure` concatenates both streams,
# so nothing downstream can tell the difference except by working.
fail() {
    echo "::error title=Ship msi::$*" >&2
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
#
# THE READER IS HELD TO THE SAME STANDARD AS `msiextract` BELOW. An IDT export
# carries three header lines — columns, types, table+keys — before any row, which
# is the assumption every `NR > 3` in this file already makes, and an
# empty-but-present table still has all three. Fewer than three means the READER
# produced nothing usable, and that is not the same fact as a table without the
# row being looked for. EXACTLY three is not a pass either — see the next block.
#
# Measured 2026-09-08 on `E2E 1/4` and again 2026-09-13 on `E2E 2/4`: this script
# reported "there is no INSTALLDIR row, so `msiexec INSTALLDIR=…` has nothing to
# override" for an installer that HAS one — the first time about a file four other
# cases in `tests/e2e/ship-msi` read that row out of in the same run, one of them
# reaching the byte round trip beyond it. So a `msiinfo export` answered without
# the table it had just listed, and the accusation landed on the artifact, which
# the header of this file calls the worst direction for a diagnostic to point.
#
# WHAT THAT ANSWER LOOKS LIKE IS MEASURED, and it is not nothing. libmsi replies
# to a table whose STREAM it cannot open with an EMPTY TABLE at exit 0 — "if we
# can't read the table, just assume that it's empty", `libmsi/table.c`, whose
# return value the caller then ignores — and `save_table` writes no stream at all
# for a table it holds as empty, so one silent read fault survives into every file
# written after it. An empty table still exports all three header lines: measured,
# `msibuild x.msi -q 'DELETE FROM \`Directory\`'` leaves an export of exactly 3
# usable lines at exit 0. Three is the count the floor below was set to ALLOW, so
# the floor could never see the incident it was written for. The `-eq 3` branch is
# what closes it, and `may-be-empty` is how the two tables whose emptiness this
# script does JUDGE opt out.
# ONE scratch directory for everything this script writes: the IDT exports,
# the extracted icon stream, the cabinet round trip. `msiinfo export` of a table
# with a BINARY column — `Icon`, `Binary` — writes that column's data to
# `<Table>/<name>` in the current directory, because that is what the IDT format
# is (the cell holds a file name, the file sits beside the table). Measured:
# `msiinfo export x.msi Icon` in an empty directory leaves
# `Icon/Icon.i_ship_demo.exe_….exe` behind; `Shortcut`, `Property` and an empty
# `Binary` leave nothing. Run from the caller's directory, that is a 15 KiB
# launcher dropped into whatever the caller was standing in — the repository
# root, for the e2e suite. So every export runs from here, and here is removed.
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT
mkdir -p "$SCRATCH/export"

# `$2` is `may-be-empty` on the two tables whose emptiness this script REPORTS —
# `Icon` ("the installer names no icon") and `Shortcut` ("the user has nothing to
# start"). Everywhere else a zero-ROW export of a table § 1 has just seen listed
# is the reader, or whatever last wrote the file, losing that table's stream.
idt() {
    local out
    if ! out=$(cd "$SCRATCH/export" && msiinfo export "$MSI" "$1" | tr -d '\r'); then
        fail "msiinfo export $1 exited non-zero on $MSI. That is the reader failing, not a finding about the installer."
    fi
    local lines
    lines=$(grep -c . <<<"$out" || true)
    if [ "$lines" -lt 3 ]; then
        fail "msiinfo export $1 returned $lines usable line(s) for $MSI, and an IDT export carries three header lines before any row. The reader produced nothing, so nothing below is a claim about the installer — re-read the file before believing any row is missing."
    fi
    if [ "$lines" -eq 3 ] && [ "${2:-}" != may-be-empty ]; then
        fail "msiinfo export $1 returned the three IDT header lines and no rows for $MSI, and \`msiinfo tables\` lists $1 — an installer with an empty $1 table is not a thing that can be built. libmsi answers a table whose stream it cannot open with an empty table at exit 0 and writes no stream for a table it holds as empty, so this is the reader or the write that produced this file, not a finding about the installer. Re-read the file before believing any row is missing."
    fi
    printf '%s\n' "$out"
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
#
# COUNTED EXPLICITLY, not by `wc -l` on the possibly-empty variable: an empty
# COMPONENT_ROWS is still ONE line once it goes through `<<<` (a herestring always
# adds the trailing newline), so `wc -l <<<""` reads 1 — and every check below that
# compared it against `$ROWS` degraded into passing on a Component table the awk
# filter matched NOTHING in, provided `$ROWS` was also 1 (a single-file installer).
# `idt()`'s own three-line floor does not catch this shape: it counts TOTAL lines,
# and a table whose rows exist but no longer satisfy `NF >= 6` (a `msiinfo` output
# change, or corruption) is not three lines, only zero MATCHING ones. `grep -c .`
# counts non-empty lines, so it reads 0 for nothing — the same fix already applied
# to `SHORTCUT_COUNT`/`ICON_COUNT` below, for the identical reason.
COMPONENTS=$(idt Component)
COMPONENT_ROWS=$(awk -F'\t' 'NR > 3 && NF >= 6 { print $1 }' <<<"$COMPONENTS" | sort)
COMPONENT_COUNT=$(grep -c . <<<"${COMPONENT_ROWS:-}" || true)
[ "$COMPONENT_COUNT" -gt 0 ] ||
    fail "the installer has no component rows at all (\`msiinfo tables\` lists Component, but nothing in its export matched the expected row shape) — an installer with no components installs nothing"
FEATURE_ROWS=$(idt FeatureComponents | awk -F'\t' 'NR > 3 && NF >= 2 { print $2 }' | sort)
[ "$COMPONENT_COUNT" = "$ROWS" ] ||
    fail "the installer has $COMPONENT_COUNT component(s) for $ROWS file(s) — one component per file is what makes an uninstall able to remove exactly what was installed"
diff <(printf '%s\n' "$COMPONENT_ROWS") <(printf '%s\n' "$FEATURE_ROWS") >/dev/null ||
    fail "a component is not in the feature, or the feature names a component that does not exist. A component outside every feature is never installed, and the package still installs at exit 0."

# Distinct GUIDs. Windows Installer keys reference counting on the component id,
# so two components sharing one GUID make an uninstall of either leave the other's
# files behind.
GUIDS=$(awk -F'\t' 'NR > 3 && NF >= 6 { print $2 }' <<<"$COMPONENTS")
UNIQUE=$(sort -u <<<"${GUIDS:-}" | grep -c . || true)
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
SHORTCUT_TABLE=$(idt Shortcut may-be-empty)
SHORTCUTS=$(awk -F'\t' 'NR > 3 && NF >= 4 { print }' <<<"$SHORTCUT_TABLE")
SHORTCUT_COUNT=$(grep -c . <<<"${SHORTCUTS:-}" || true)
[ "$SHORTCUT_COUNT" = 1 ] ||
    fail "the installer defines $SHORTCUT_COUNT shortcut(s); it must define exactly one, or the user has nothing to start (or several things that look like copies)"
[ "$(cut -f2 <<<"$SHORTCUTS")" = ProgramMenuFolder ] ||
    fail "the shortcut is not in ProgramMenuFolder, so it is not in the Start Menu"
SHORTCUT_COMPONENT=$(cut -f4 <<<"$SHORTCUTS")
grep -q "^$SHORTCUT_COMPONENT	" <<<"$COMPONENTS" ||
    fail "the shortcut belongs to component \"$SHORTCUT_COMPONENT\", which has no row — the shortcut would never be created"

# ── 5b. THE ICON THE SHORTCUT AND ADD/REMOVE PROGRAMS SHOW ───────────────────
# An ADVERTISED shortcut shows the Icon table's icon, not its target's — the
# target is a descriptor until the feature resolves — and ARPPRODUCTICON is the
# only route to an icon in Add/Remove Programs at all. Both name ONE Icon row, and
# that row's binary is the launcher itself, whose resource directory already
# carries the pixels (`utils/ship/pe-launcher.ts`). So the floor here is a byte
# comparison against a real file, not a row count: the stream behind the row has
# to BE the launcher in the program directory.
ICONS=$(idt Icon may-be-empty)
ICON_ROWS=$(awk -F'\t' 'NR > 3 && NF >= 2 { print $1 }' <<<"$ICONS")
ICON_COUNT=$(grep -c . <<<"${ICON_ROWS:-}" || true)
[ "$ICON_COUNT" = 1 ] ||
    fail "the Icon table has $ICON_COUNT row(s); the installer names exactly one icon, the launcher, or the shortcut and Add/Remove Programs draw the generic one"
ICON_ID=$(head -n1 <<<"$ICON_ROWS")
case "$ICON_ID" in
*.exe) : ;;
*) fail "the Icon row is named \"$ICON_ID\"; Windows Installer types an icon by its name's extension, and this one is the launcher, so it must end in .exe" ;;
esac
# BY NAME out of the IDT header, not by position: `Icon_` is the NINTH column
# of the Shortcut table (Shortcut, Directory_, Name, Component_, Target,
# Arguments, Description, Hotkey, Icon_, …), and the first cut of this line read
# the fifth — the Target, which for an advertised shortcut is the feature name
# — and accused a correct installer of naming no icon.
ICON_COLUMN=$(head -n1 <<<"$SHORTCUT_TABLE" | tr '\t' '\n' | grep -nx 'Icon_' | cut -d: -f1)
[ -n "$ICON_COLUMN" ] || fail "the Shortcut table has no Icon_ column, which every Windows Installer database defines"
SHORTCUT_ICON=$(cut -f"$ICON_COLUMN" <<<"$SHORTCUTS")
[ "$SHORTCUT_ICON" = "$ICON_ID" ] ||
    fail "the shortcut's Icon_ column is \"$SHORTCUT_ICON\" and the Icon table's one row is \"$ICON_ID\" — an advertised shortcut with no icon of its own shows the generic one"
PROPERTIES=$(idt Property)
ARP_ICON=$(awk -F'\t' '$1 == "ARPPRODUCTICON" { print $2 }' <<<"$PROPERTIES")
[ "$ARP_ICON" = "$ICON_ID" ] ||
    fail "ARPPRODUCTICON is \"$ARP_ICON\" and the Icon row is \"$ICON_ID\" — Add/Remove Programs would show no icon"
# The launcher the shortcut hangs on, by its File row, then the bytes.
LAUNCHER_NAME=$(awk -F'\t' -v c="$SHORTCUT_COMPONENT" 'NR > 3 && $2 == c { print $3 }' <<<"$FILES")
LAUNCHER_NAME=${LAUNCHER_NAME##*|}
[ -n "$LAUNCHER_NAME" ] || fail "the shortcut's component \"$SHORTCUT_COMPONENT\" has no File row to name the launcher by"
[ -f "$DIR/$LAUNCHER_NAME" ] || fail "the shortcut targets $LAUNCHER_NAME, which is not at the root of the program directory"
ICON_STREAM=$SCRATCH/icon-stream.bin
# `msiinfo extract` writes the stream to STDOUT and nothing to disk — measured,
# unlike `export` above — so the redirect is the whole transfer.
msiinfo extract "$MSI" "Icon.$ICON_ID" >"$ICON_STREAM" ||
    fail "msiinfo extract found no stream Icon.$ICON_ID — the Icon row names a binary the database does not carry"
[ -s "$ICON_STREAM" ] || fail "the stream Icon.$ICON_ID is empty"
cmp -s "$ICON_STREAM" "$DIR/$LAUNCHER_NAME" ||
    fail "the Icon table's binary differs from $LAUNCHER_NAME in the program directory — the shortcut would show one icon and the running app another"
ICON_BYTES=$(wc -c <"$ICON_STREAM")

# ── 6. THE ENTRY A USER REMOVES IT BY ────────────────────────────────────────
# Add/Remove Programs is generated from these four properties. A missing one is an
# installer that installs and cannot be found again.
for key in ProductName ProductVersion ProductCode UpgradeCode Manufacturer; do
    grep -q "^$key	" <<<"$PROPERTIES" || fail "the database has no $key property — Add/Remove Programs would have no entry to offer"
done
printf '%s\n' "$PROPERTIES" | awk -F'\t' '$1 == "ProductName" || $1 == "ProductVersion" || $1 == "Manufacturer" || $1 == "UpgradeCode" { print "  " $1 " = " $2 }'

# ── 7. ROUND TRIP: unpack the cabinet and compare bytes ──────────────────────
# The end of the chain. Everything above reads the DATABASE; this reads the
# payload out of the embedded cab and compares it with the directory the
# installer was built from, which is the only assertion here that would catch a
# correct table over the wrong bytes.
OUT=$SCRATCH/out
mkdir -p "$OUT"
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

echo "verify-msi.sh: $COUNT file(s) round-tripped byte for byte out of the embedded cabinet, $ROWS component(s), 1 Start-Menu shortcut with icon $ICON_ID ($ICON_BYTES bytes, the launcher), INSTALLDIR = ProgramFiles64Folder\\$APP"
