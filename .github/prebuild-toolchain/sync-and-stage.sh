#!/usr/bin/env bash
#
# Put the downloaded prebuilds onto the CURRENT `main` — without ever asking git
# to merge a binary.
#
# WHY THIS SCRIPT EXISTS
#
# `commit-prebuilds` used to COMMIT first and `git pull --rebase origin main`
# second. That ordering is fatal on darwin and it is not a race:
#
#     warning: Cannot merge binary files: …/prebuilds/darwin-x64/libgjsifytls.dylib
#     CONFLICT (content): Merge conflict in …/libgjsifytls.dylib
#     error: could not apply ba5ca42… chore: update native prebuilds [skip ci]
#     Process completed with exit code 1
#
# (run 30864276535, head f7b9c46d9, job "Commit prebuilds to repo"; nothing was
# pushed and 26848 insertions were discarded.)
#
# Mach-O output is not byte-reproducible. Measured on two consecutive bot
# commits of the SAME sources (7f4e81291 -> a03206649): all 16 committed darwin
# dylibs changed, every one at an identical size, and on darwin-x64 EVERY
# differing byte is build identity — the 16-byte `LC_UUID` payload plus the
# `n_value` of the `N_OSO` debug-map stabs, which is each object file's mtime.
# On darwin-arm64 the ad-hoc code signature hashes those bytes, so its
# `LC_CODE_SIGNATURE` blob differs too. Zero bytes of code or data differ.
#
# So every run produces new bytes for all 16 dylibs, git has no merge driver for
# a binary file, and a rebase of the prebuild commit onto a moved `main`
# conflicts on the first dylib EVERY TIME. The next run conflicts identically.
# The consequence was that no 0.27.x could receive a rebuilt darwin dylib at
# all.
#
# The fix is ordering, not merge cleverness: sync the worktree to `origin/main`
# FIRST, re-apply the downloaded artifacts over that tree, and only then stage
# and commit. A rebase never runs, so there is nothing for git to merge.
#
# IDEMPOTENT BY DESIGN — `main` can still move between this sync and the push,
# so the push step calls this again per attempt. Every call re-syncs and
# RE-STAGES; retrying the push alone would push a tree built on a stale base.
#
# Args: $1 = attempt number, for the log only.
# Env:  PREBUILD_SNAPSHOT = the tar archive written by the snapshot step.
set -euo pipefail

attempt="${1:-1}"
: "${PREBUILD_SNAPSHOT:?PREBUILD_SNAPSHOT must name the tar archive the snapshot step wrote}"

# The `git add` below uses a `packages/*/*/prebuilds/` glob, and the tar archive
# holds repository-relative paths. Both are only correct from the top level, and
# being wrong about it would stage a subset while exiting 0.
top="$(git rev-parse --show-toplevel)"
if [ "$(pwd -P)" != "$(cd "$top" && pwd -P)" ]; then
    echo "::error::sync-and-stage.sh must run from the repository root ($top), not $(pwd -P)"
    exit 1
fi

# The snapshot is taken ONCE, before the first sync, because the sync below
# restores every tracked file and would otherwise overwrite the very binaries
# this job downloaded. If it is missing, the artifacts are already gone.
if [ ! -f "$PREBUILD_SNAPSHOT" ]; then
    echo "::error::no artifact snapshot at $PREBUILD_SNAPSHOT — the snapshot step must run BEFORE any sync, or the sync discards the downloads"
    exit 1
fi

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

echo "::group::attempt ${attempt}: sync the worktree to origin/main"
was="$(git rev-parse HEAD)"
git fetch --quiet origin main
want="$(git rev-parse FETCH_HEAD)"
git reset --quiet --hard FETCH_HEAD
now="$(git rev-parse HEAD)"
# A positive fact about where the tree now stands, rather than three exit codes.
# "The base is origin/main" is the whole premise of everything after this line.
if [ "$now" != "$want" ]; then
    echo "::error::the worktree is at $now, not the origin/main tip $want — refusing to stage onto an unknown base"
    exit 1
fi
echo "HEAD ${was} -> ${now} (origin/main)"
echo "::endgroup::"

echo "::group::attempt ${attempt}: re-apply the downloaded artifacts over that tree"
# `tar`, not `cp -r`: it restores exactly the captured paths, creates the
# directories it needs without a line of directory logic here, and can be
# counted — which is what the assertion below is built on.
#
# The archive holds only what THIS RUN CHANGED (see the snapshot step), so this
# writes over the synced tree without touching a directory the run did not
# rebuild. An empty archive is legitimate — a linux-only run can reproduce every
# artifact byte for byte — and means there is simply nothing to commit.
tar -xf "$PREBUILD_SNAPSHOT"
expected=0
present=0
while IFS= read -r entry; do
    case "$entry" in
        */) continue ;;
    esac
    expected=$((expected + 1))
    # An explicit `if`, not `[ -f … ] && …`: under `set -e` an AND-list whose
    # first command fails is exempt from errexit, so the short form works — but
    # relying on that exemption to keep a MISSING file from killing the script
    # before its own error message is a subtlety a reader should not have to
    # check.
    if [ -f "$entry" ]; then
        present=$((present + 1))
    fi
done < <(tar -tf "$PREBUILD_SNAPSHOT")
# Again a positive fact: EVERY file the snapshot holds is back on disk. Not
# "extraction exited 0" — an extraction that wrote nothing is indistinguishable
# from a run with no changes, and "no changes" is an outcome this job reports as
# success. The count may legitimately be zero (nothing changed); what may never
# happen is a shortfall.
if [ "$present" -ne "$expected" ]; then
    echo "::error::restored ${present} of ${expected} snapshot file(s) — the downloaded artifacts are not on disk, so anything committed below would be main's own bytes"
    exit 1
fi
echo "restored ${present} of ${expected} artifact file(s) from the snapshot."
echo "::endgroup::"

echo "::group::attempt ${attempt}: clear the markers the downloads satisfied, then stage"
# TWO markers, one rule. A `gjsify.platformsUncommitted` entry says "declared and
# CI-built, but no artifact in this repo yet"; a missing-`.gir` ledger entry says
# "committed, but without the `.gir` the stager would have staged". Both are
# turned into a FAILURE by their conformance rule the moment the file appears —
# deliberately, so a deferral cannot outlive its cause. THIS job is what ends
# both causes, which makes it the job that has to end both markers: without this,
# the first run that lands one pushes a self-contradictory tree under `[skip ci]`
# and `main` goes red for every open PR until a human sends a follow-up. That is
# not hypothetical — it is what kept this job red from 2026-08-01 with every
# build leg green. An entry whose file did NOT arrive (a skipped package, a leg
# that did not run) is left alone: it still describes reality.
#
# They run AFTER the sync, on every attempt, because their input is the tree as it
# stands on `origin/main`: a moved `main` may have added or dropped an entry.
#
# The file list goes to $RUNNER_TEMP, never into the worktree. `git status`
# reports an untracked file, so a leftover list inside the repository is
# something the "nothing unstaged" assertion below would have to be taught to
# ignore — and an assertion with an exception list is the thing that later hides
# a real write.
regenerated="${RUNNER_TEMP:-/tmp}/regenerated-files-${attempt}.txt"
node scripts/clear-committed-platform-exemptions.mjs > "$regenerated"
node scripts/clear-satisfied-gir-gaps.mjs >> "$regenerated"
cat "$regenerated"
# stdout is the list of every FILE it wrote, so this stages exactly those (a
# `packages/*/*/package.json` glob in a job that pushes to `main` would sweep in
# whatever else happened to be dirty). More than the manifest, because the field
# is an input to TWO generated files of a platform package: the manifest block
# and a deferred-artifact paragraph in the generated `README.md`. Writing only
# the manifest left a README the generator disagreed with, and the gate then
# failed on a byte comparison — that is what kept this job red from 2026-08-01
# with every build leg green.
xargs -r git add < "$regenerated"

# A GLOB, not a hand-written list, and that is now the only shape that can be
# right. ADR 0017 moved every prebuild out of its bridge and into a per-target
# package, so the ten paths this used to name stopped existing — `fatal: pathspec
# 'packages/framework/webgl/prebuilds/' did not match any files`, exit 128, on the
# first run after the split, with all eight build legs green and every artifact
# downloaded.
#
# Spelling them out again would mean SIXTY entries that grow by one with every
# target anyone adds, in a job whose failure mode is a silently unshipped binary.
# The glob matches exactly the packages that own a committed prebuild directory —
# which since the split is the per-target packages and nothing else, because a
# bridge no longer has one and this job (unlike a build leg) never creates a
# scratch copy.
#
# An unmatched glob stays literal and `git add` fails, which is the right
# failure: it means the tree carries no prebuild directory at all, and staging
# nothing while reporting success is precisely how a binary goes missing
# unnoticed.
git add packages/*/*/prebuilds/
git diff --cached --stat | cat

# THE guard. A package this run skipped contributed no artifact, so its committed
# prebuild must come through untouched — and "untouched" has to be asserted, not
# assumed, because the one way this job can destroy a binary is by staging its
# REMOVAL (`git add <dir>` stages deletions). Nothing here should ever delete a
# prebuild: this job only downloads into those directories, and the snapshot is
# re-applied over every sync. If something did, that is a bug whose symptom is a
# silently unshipped binary — the exact class of failure the OS axis exists to
# prevent — so it stops the run instead.
#
# It lives HERE rather than in a step of its own so that it holds on EVERY
# attempt. As a step it would have run once, against the first staging, and a
# retry would have re-staged behind its back.
deleted="$(git diff --cached --diff-filter=D --name-only -- '*prebuilds/*')"
if [ -n "$deleted" ]; then
    echo "::error::this run would DELETE committed prebuild file(s); refusing to commit:"
    printf '::error::  %s\n' $deleted
    exit 1
fi
echo "no committed prebuild would be deleted."

# Nothing this script wrote may stay UNSTAGED. The gate on the pushed tree audits
# the working tree, but what gets pushed is the INDEX — so an unstaged write means
# the gate blessed a tree that is not the one that lands. That gap is how a
# half-written generated package shipped: the clear step rewrote a manifest and
# left its generated README behind, and nothing noticed until the gate compared
# bytes. Now the clear step reports every file it wrote, and this asserts it did.
unstaged="$(git status --porcelain -uall | grep -v '^[ACDMRT] ' || true)"
if [ -n "$unstaged" ]; then
    echo "::error::this job changed files it did not stage — the gate would audit a tree that is not the one being pushed:"
    printf '::error::  %s\n' $unstaged
    exit 1
fi
echo "no unstaged change left behind."
echo "::endgroup::"
