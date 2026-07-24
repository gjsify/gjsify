#!/bin/sh
# SPDX-License-Identifier: MIT
# @gjsify/napi — P0.3 memory legs (valgrind memcheck).
#
#   cd packages/napi/napi && sh test/p03-mem.sh
#
# Focus: memory ERRORS (invalid read/write/UAF — the node-gi SIGSEGV crash
# class), especially through env teardown at process exit. Leak checking is
# OFF: the GJS runtime itself holds still-reachable state at exit, and
# kUserland references never deleted by the addon leak by Node-parity
# design — leak signal would be all noise. --error-exitcode makes any
# invalid access fail the leg. GJS_DISABLE_JIT avoids JIT false positives
# under valgrind.
set -eu
cd "$(dirname "$0")/.."

VG="valgrind --tool=memcheck --leak-check=no --error-exitcode=42 --errors-for-leak-kinds=none"
ENV_SETUP="GJS_DISABLE_JIT=1 GI_TYPELIB_PATH=build LD_LIBRARY_PATH=build"

echo "== leg 1: load -> exercise -> exit loop =="
env GJS_DISABLE_JIT=1 GI_TYPELIB_PATH=build LD_LIBRARY_PATH=build \
    $VG --log-file=/tmp/p03-mem-loop.vg.log \
    gjs test/p03-mem-loop.js
grep -E "ERROR SUMMARY" /tmp/p03-mem-loop.vg.log
grep -q "ERROR SUMMARY: 0 errors" /tmp/p03-mem-loop.vg.log || {
    echo "P03-MEM FAIL: leg 1 reported memory errors (see /tmp/p03-mem-loop.vg.log)" >&2
    exit 1
}

echo "== leg 2: teardown-while-instances-alive stress =="
env GJS_DISABLE_JIT=1 GI_TYPELIB_PATH=build LD_LIBRARY_PATH=build \
    $VG --log-file=/tmp/p03-teardown.vg.log \
    gjs test/p03-teardown-stress.js
grep -E "ERROR SUMMARY" /tmp/p03-teardown.vg.log
grep -q "ERROR SUMMARY: 0 errors" /tmp/p03-teardown.vg.log || {
    echo "P03-MEM FAIL: leg 2 reported memory errors (see /tmp/p03-teardown.vg.log)" >&2
    exit 1
}

echo "P0.3 MEM LEGS: CLEAN (0 memcheck errors in both legs)"
