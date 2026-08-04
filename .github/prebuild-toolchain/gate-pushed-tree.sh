#!/usr/bin/env bash
#
# Gate the tree `commit-prebuilds` is about to push, and STAMP the tree it read.
#
# WHY A GATE HERE AT ALL
#
# The push carries `[skip ci]`, which suppresses BOTH required checks on the
# resulting commit — `CI gate (GJS)` and `Detect runtime-triplet drift`. So
# everything that reads what this job writes otherwise ran nowhere. Not
# hypothetical: on 2026-08-03 f5d250b32 cleared `gjsify.platformsUncommitted`
# from the darwin manifests and broke `tests/e2e/platform-exemption-clearing`,
# whose fixture had seeded itself from one of them. `main` was red for every open
# PR for hours, each one blaming its own diff, and the commit that caused it had
# no CI to blame. That fixture is hermetic now — but hermetic fixtures are not
# the general answer, because several of these suites measure the REAL committed
# artifact on purpose: `prebuild-loader-path` asserts exact glibc floors, exact
# DT_NEEDED sets and a `=== null`; `prebuild-declaration-invariant` hard-codes
# measured floors. Those are properties of bytes THIS JOB REWRITES.
#
# `--strict` and not plain `--check`, because `audit-runtimes.yml` already runs
# `--check --strict` on this very runner (plain `ubuntu-latest`). Leaving the
# bot's command weaker than the branch's is a standing exemption for every future
# strict-only rule.
#
# The suite list is explicit rather than a glob: it is exactly the set whose
# fixtures read the state this job mutates. A glob would drag in suites that need
# a built workspace or a GJS runtime, which this runner has not got. Every entry
# imports nothing but `node:*` and repo-local paths, so this needs no install and
# no container — measured on main: 110 tests, seconds.
#
# WHY IT STAMPS
#
# "The gate runs before the push" used to be a property of STEP ORDER, which is a
# property of a file a human reads. It is now a fact the push checks: this writes
# the tree hash it audited, and the push refuses any tree that does not match.
# That is what makes the previous ordering defect — a `git pull --rebase` between
# the gate and the push, which is exactly what this job used to do — unable to
# come back silently. It also makes the gate unskippable in the direction that
# matters: no stamp file, no push.
#
# WHAT THIS DOES NOT COVER, so a green verdict is not misread: the two assertions
# that actually LOAD a committed prebuild live in main.yml's `test` job under GJS
# and are unreachable from here, and `prebuild-artifacts`' dlopen probe degrades
# to a note on a runner without libsoup/GStreamer/GTK4/libepoxy. This gate proves
# declarations and file shape, not that every artifact loads.
#
# Env: PREBUILD_GATED_TREE = where to write the audited tree hash.
set -euo pipefail

: "${PREBUILD_GATED_TREE:?PREBUILD_GATED_TREE must name the file to stamp the audited tree hash into}"

# The audit reads the WORKING TREE; the push ships the commit. They are the same
# bytes only because this runs after the commit, with nothing unstaged (which
# `sync-and-stage.sh` asserts). Refuse to certify anything else rather than
# stamping a hash for a tree the checks below did not read.
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "::error::the worktree or index differs from HEAD — the checks below read the worktree and the push ships HEAD, so they would certify different bytes"
    git status --porcelain -uall
    exit 1
fi

node scripts/audit-runtimes.mjs --check --strict
node scripts/audit-test-scripts.mjs
node --test --test-concurrency=4 \
    tests/e2e/platform-exemption-clearing/run.mjs \
    tests/e2e/prebuild-declaration-invariant/run.mjs \
    tests/e2e/prebuild-loader-path/run.mjs \
    tests/e2e/prebuild-change-gate/run.mjs \
    tests/e2e/stage-prebuild/run.mjs

git rev-parse 'HEAD^{tree}' > "$PREBUILD_GATED_TREE"
echo "gated tree $(cat "$PREBUILD_GATED_TREE") (commit $(git rev-parse HEAD))"
