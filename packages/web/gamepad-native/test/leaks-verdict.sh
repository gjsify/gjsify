#!/bin/sh
# Read `leaks`' REPORT, not its exit status.
#
# Why: on the macOS 15 Intel runner, `leaks` from Xcode 16.4 finishes its
# analysis and then never returns. That run's own log is the evidence — the
# report carries `Date/Time` about 1.2 s after the test starts, the full target
# report, and `0 leaks for 0 total leaked bytes`, and then ~119 s of silence
# until meson's timeout. The target itself had already printed `ok 1/2/3` for all
# three lifecycle paths. So the verdict is the report's line, and whether the
# tool leaves afterwards is a fact about the tool, not about this shim. Measured
# the other way round too, to rule out slowness: `leaks` costs ~1.0 s over a
# 0.07 s program here, and the runner is ~8x slower than that, which is seconds,
# not the 120 it actually took. It hangs; it is not slow.
#
# What this must NOT become is a check that passes without having checked
# anything: with no `0 leaks for 0 total leaked bytes` line in the report the
# result is a FAILURE. A missing report is a thing to investigate, never a skip
# and never a green tick.

set -eu

leaks_bin=$1
prog=$2
wait_seconds=${GJSIFY_LEAKS_WAIT_SECONDS:-60}

report=$(mktemp "${TMPDIR:-/tmp}/gjsify-leaks-report.XXXXXX")
trap 'rm -f "$report"' EXIT INT TERM

# MallocStackLogging=1 arrives from meson's `env:` above; without it `leaks`
# cannot name the allocation site of a leak.
"$leaks_bin" --atExit -- "$prog" >"$report" 2>&1 &
leaks_pid=$!

# Whether the tool is still WORKING. Signalling a process that has exited but
# not yet been reaped still succeeds, so `kill -0` alone would spin for the full
# wait on every fast, successful run; `ps` tells a zombie from a live process.
still_working() {
    kill -0 "$1" 2>/dev/null || return 1
    state=$(ps -o stat= -p "$1" 2>/dev/null | tr -d ' ' || true)
    case "$state" in
        '' | Z*) return 1 ;;
    esac
    return 0
}

waited=0
while [ "$waited" -lt "$wait_seconds" ] && still_working "$leaks_pid"; do
    sleep 1
    waited=$((waited + 1))
done

if still_working "$leaks_pid"; then
    echo "leaks did not exit within ${wait_seconds}s; asking it to, and reading the report it already wrote." >&2
    kill -TERM "$leaks_pid" 2>/dev/null || true
    sleep 1
    kill -KILL "$leaks_pid" 2>/dev/null || true
fi
wait "$leaks_pid" 2>/dev/null || true

cat "$report"

if grep -q '0 leaks for 0 total leaked bytes' "$report"; then
    exit 0
fi

echo "leaks: no '0 leaks for 0 total leaked bytes' line in the report — failing, not skipping." >&2
exit 1
