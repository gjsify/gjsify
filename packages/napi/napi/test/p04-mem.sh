#!/bin/sh
# SPDX-License-Identifier: MIT
# @gjsify/napi — P0.4 memory leg (valgrind memcheck).
#
#   cd packages/napi/napi && sh test/p04-mem.sh
#
# Focus: memory ERRORS (invalid read/write/UAF/double-free) on the P0.4
# native-memory paths — the malloc'd stable buffer contents (freed by SM at
# collection), the external-buffer free path (SM no-op deleter + user finalizer
# free on the drain), and the §5f EnsureNonInline out-of-line pinning — through
# repeated GC/drain cycles and env teardown at process exit. Leak checking is
# OFF (the GJS runtime holds still-reachable state at exit; kUserland refs leak
# by Node-parity design), matching test/p03-mem.sh. --error-exitcode makes any
# invalid access fail the leg. GJS_DISABLE_JIT avoids JIT false positives.
set -eu
cd "$(dirname "$0")/.."

VG="valgrind --tool=memcheck --leak-check=no --error-exitcode=42 --errors-for-leak-kinds=none"

echo "== leg: buffer create -> GC -> free loop (incl. external free path) =="
env GJS_DISABLE_JIT=1 GI_TYPELIB_PATH=build LD_LIBRARY_PATH=build \
    $VG --log-file=/tmp/p04-mem-loop.vg.log \
    gjs test/p04-mem-loop.js
grep -E "ERROR SUMMARY" /tmp/p04-mem-loop.vg.log
grep -q "ERROR SUMMARY: 0 errors" /tmp/p04-mem-loop.vg.log || {
    echo "P04-MEM FAIL: leg reported memory errors (see /tmp/p04-mem-loop.vg.log)" >&2
    exit 1
}

echo "P0.4 MEM LEG: CLEAN (0 memcheck errors)"
