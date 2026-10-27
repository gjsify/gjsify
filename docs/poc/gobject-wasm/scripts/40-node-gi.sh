#!/bin/bash
# SPDX-License-Identifier: MIT
# Compile node-gi for wasm32 and link it into one ES module.
#
# The point of this script is how little it has to do: 14 of node-gi's 16 .cc
# files are taken from packages/node-gi/node-gi/src/ unmodified. Only loop.cc
# (libuv) and cairo.cc (a native cairo we do not have) are swapped for the shims
# in ../src/. Everything else that wasm needed went into GLib, not here.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
poc_activate

EN="$POC_ROOT/emnapi"
BUILD="$POC_ROOT/build-node-gi"
mkdir -p "$BUILD" "$POC_OUT"

poc_log "node-gi -> $POC_OUT"

CFLAGS=$(poc_pkgconfig --cflags girepository-2.0 gobject-2.0 gio-2.0 gmodule-2.0)
LDFLAGS=$(poc_pkgconfig --libs --static girepository-2.0 gobject-2.0 gio-2.0 gmodule-2.0)

# NODE_GI_HAS_LIBUV=0 is the one define the shipping sources already understand;
# it is what makes the unmodified 14 compile.
COMMON=(-O1 -fPIC -std=c++17 -fexceptions
        -DNODE_GI_HAS_LIBUV=0 -DNAPI_VERSION=8 -DNAPI_DISABLE_CPP_EXCEPTIONS
        -I"$POC_NODE_GI/src" -I"$EN/emnapi/include/node" -I"$EN/node-addon-api")

cd "$BUILD"
for src in "$POC_NODE_GI"/src/*.cc; do
    base=$(basename "$src" .cc)
    case "$base" in
        loop|cairo) src="$POC_DIR/src/$base-wasm.cc"; base="$base-wasm" ;;
    esac
    em++ "${COMMON[@]}" $CFLAGS -c "$src" -o "$base.o"
done

# Why -sMAIN_MODULE=2 when nothing is dynamically loaded: girepository resolves a
# namespace's functions through g_module_symbol() on the shared library named in
# the typelib. There is no shared library here — everything is in the one wasm —
# so patch 0003 makes gi_typelib_do_dlopen() pass shlib_str = NULL, which means
# "look in the main module". For that lookup to find anything, the main module
# needs an exported symbol table, which is what MAIN_MODULE=2 gives us. It also
# forces ERROR_ON_UNDEFINED_SYMBOLS=0 (gio's unix backends stub out) and rules
# out WASM_ASYNC_COMPILATION=0, so instantiation is always async.
EXPORTS='_malloc,_free,_g_get_num_processors,_g_idle_add_full,_g_markup_escape_text'
EXPORTS="$EXPORTS,_g_main_context_default,_g_source_remove,_g_timeout_add_full,_g_object_new"
EXPORTS="$EXPORTS,_g_strdup,_g_get_real_time,_g_uuid_string_random,_g_file_new_for_path"
EXPORTS="$EXPORTS,_g_file_get_path,_g_get_monotonic_time"

em++ -O1 ${POC_EXTRA_LDFLAGS:-} ./*.o \
    "$EN/emnapi/build/libemnapi.a" $LDFLAGS "$POC_SYSROOT/lib/libffi.a" \
    --js-library="$EN/emnapi/dist/library_napi.js" \
    --embed-file "$POC_ROOT/typelibs@/typelibs" \
    -sMAIN_MODULE=2 -sERROR_ON_UNDEFINED_SYMBOLS=0 \
    -sMODULARIZE=1 -sEXPORT_NAME=createNodeGi -sEXPORT_ES6=1 \
    -sALLOW_TABLE_GROWTH -sALLOW_MEMORY_GROWTH -sSTACK_SIZE=4194304 \
    -sEXPORTED_FUNCTIONS="$EXPORTS" \
    -sEXPORTED_RUNTIME_METHODS=addFunction,removeFunction,emnapiInit \
    -o "$POC_OUT/node_gi.mjs"

# The harness imports the emnapi runtime next to the module.
cp "$EN/emnapi-runtime/dist/emnapi.mjs" "$POC_OUT/emnapi.mjs"

cd "$POC_OUT"
for f in node_gi.mjs node_gi.wasm; do
    printf '%-14s %10d raw  %10d gzip\n' "$f" "$(stat -c%s $f)" "$(gzip -9 -c $f | wc -c)"
done
