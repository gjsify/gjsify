// SPDX-License-Identifier: MIT
// @gjsify/napi — Node-API (N-API) host over GJS's SpiderMonkey (mozjs-140).
//
// Reference: refs/node/src/js_native_api_v8.{h,cc} + node_api.cc (Node.js
// contributors, MIT) — the normative Node-API reference implementation whose
// observable semantics this shim mirrors over JSAPI. GJS's own production
// patterns are the mechanism reference: extra-GC-roots tracer
// (refs/gjs/gjs/context.cpp), natives-with-reserved-slots
// (refs/gjs/gjs/jsapi-dynamic-class.cpp), public context accessors
// (refs/gjs/gjs/context.h). GNOME contributors, MIT/LGPLv2+.
//
// Cross-TU layout (node-gi common.h idiom): this header owns every
// cross-TU declaration in `namespace gjsify_napi` plus the `napi_env__`
// definition (global scope — the tag is declared by the vendored
// js_native_api_types.h). Functional slices:
//   env.cc      — arena, tracer, handle scopes, env lifecycle/teardown
//   value.cc    — minimal value surface (undefined/null/object/string/typeof)
//   function.cc — JSNative trampoline, napi_create_function, napi_get_cb_info
//   error.cc    — status bookkeeping, throw/pending mapping, stubs
//   module.cc   — gjsify_napi_install, loadAddon, dlopen + registration,
//                 napi_get_version, napi_fatal_error, teardown seam

#ifndef GJSIFY_NAPI_SRC_CC_COMMON_H_
#define GJSIFY_NAPI_SRC_CC_COMMON_H_

// Surface every declaration up to the max version this host reports
// (napi_get_version = 10) when compiling the shim itself.
#define NAPI_VERSION 10

#include "js_native_api.h"  // vendored, src/napi-headers/
#include "node_api.h"       // vendored, src/napi-headers/

#include <glib-object.h>
#include <glib.h>

#include <gjs/gjs.h>  // umbrella: gjs/context.h forbids direct inclusion

#include <jsapi.h>
#include <jsfriendapi.h>

#include <js/CallAndConstruct.h>
#include <js/CallArgs.h>
#include <js/CharacterEncoding.h>
#include <js/Context.h>
#include <js/ErrorReport.h>
#include <js/Exception.h>
#include <js/GCAPI.h>
#include <js/GlobalObject.h>
#include <js/PropertyAndElement.h>
#include <js/RootingAPI.h>
#include <js/String.h>
#include <js/TracingAPI.h>
#include <js/Value.h>

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace gjsify_napi {

// NODE_API_SUPPORTED_VERSION_MAX / NODE_API_DEFAULT_MODULE_API_VERSION
// (refs/node/src/node_version.h:103-108).
constexpr int32_t kNapiVersionMax = 10;
constexpr int32_t kNapiDefaultModuleApiVersion = 8;

// ---- handle arena (§5a) ----
//
// `napi_value` = pointer to a `JS::Heap<JS::Value>` slot in a per-env chunked
// arena. Chunks are fixed-size heap blocks that never move or realloc, so a
// slot address stays stable for the lifetime of its handle scope — the
// property V8's handle blocks give Node's `napi_value`. `JS::Heap` provides
// the pre/post barriers a heap-stored GC pointer needs under SpiderMonkey's
// generational GC; the per-env extra-GC-roots tracer (env.cc) marks *and
// relocates* live slots, so outstanding `napi_value` pointers survive moving
// GC. NOT `JS::Rooted` (stack-only, LIFO) and NOT a raw `JS::Value` (goes
// stale across nursery evacuation) — those cannot back a C ABI.

constexpr size_t kArenaChunkSlots = 256;

struct ArenaChunk {
    JS::Heap<JS::Value> slots[kArenaChunkSlots];
};

class HandleArena {
  public:
    // Store `value` in the next slot; returns the stable slot address.
    JS::Heap<JS::Value>* push(const JS::Value& value);
    size_t top() const { return top_; }
    // Release slots [mark, top): clear them (write barrier via JS::Heap
    // assignment) and rewind. Chunk storage is retained for reuse.
    void popTo(size_t mark);
    // Trace live slots [0, top) — called from the env's extra-roots tracer.
    void trace(JSTracer* trc);
    // Env teardown: clear every live slot and free the chunks. Must run
    // before JS_DestroyContext (a live JS::Heap past that point is UAF).
    void clearAll();

  private:
    JS::Heap<JS::Value>* slotAt(size_t index);
    std::vector<std::unique_ptr<ArenaChunk>> chunks_;
    size_t top_ = 0;
};

// A handle scope is a saved arena top; scopes close LIFO
// (napi_handle_scope_mismatch otherwise), matching
// js_native_api_v8.cc:2927-2953. The napi_handle_scope pointer encodes the
// 1-based scope-stack depth (no heap allocation, trivially validated).
struct HandleScopeRec {
    size_t mark;
};

// ---- callbacks (§8) ----

// Heap bundle behind every napi-created function; owned by the env, freed at
// teardown (Phase-0 simplification of V8-Node's weak-ref-on-function early
// free, js_native_api_v8.cc:398-402). Stored in reserved slot 0 of the
// js::NewFunctionWithReserved native as a JS::PrivateValue.
struct CallbackBundle {
    napi_env env;
    napi_callback cb;
    void* data;
};

// Stack-allocated per trampoline invocation; napi_callback_info points here.
struct CallbackInfo {
    napi_value* argv;       // arena slots, one per provided argument
    size_t argc;
    napi_value this_arg;    // arena slot
    napi_value new_target;  // nullptr when not constructing (P0.2)
    void* data;             // bundle->data
};

// The shared JSNative all napi-created functions dispatch through.
bool function_trampoline(JSContext* cx, unsigned argc, JS::Value* vp);

// ---- status bookkeeping (§6, error.cc) ----

napi_status set_last_error(napi_env env, napi_status status,
                           uint32_t engine_error_code = 0,
                           void* engine_reserved = nullptr);
napi_status clear_last_error(napi_env env);

// ---- value boxing (env.cc) ----

// The single choke point boxing a JSAPI value into an env arena slot.
napi_value arena_push(napi_env env, const JS::Value& value);

// Deref a napi_value back to the engine value.
inline JS::Value napi_value_to_js(napi_value value) {
    return reinterpret_cast<JS::Heap<JS::Value>*>(value)->get();
}

// The env's extra-GC-roots trace hook (env.cc).
void trace_env(JSTracer* trc, void* data);

}  // namespace gjsify_napi

// ---- napi_env (§5e, minimal P0.0 shape) ----
//
// Global scope: the struct tag is fixed by the vendored
// `typedef struct napi_env__* napi_env`.
struct napi_env__ {
    JSContext* cx;
    GjsContext* gjs_context;
    // Per-addon Node-API version (§3c discovery + clamp); gates §5b/§6
    // behavior from P0.1 on.
    int32_t module_api_version;
    gjsify_napi::HandleArena arena;
    std::vector<gjsify_napi::HandleScopeRec> scopes;
    napi_extended_error_info last_error = {nullptr, nullptr, 0, napi_ok};
    // dlopen handle of the addon; kept for the process lifetime (Node never
    // dlcloses registered addons either).
    void* dl_handle = nullptr;
    // file:// URL of the addon (node_api_get_module_file_name, P0.5).
    std::string filename;
    // false during/after teardown — NAPI_PREAMBLE gate.
    bool can_call_into_js = true;
    bool torn_down = false;
    // Bundle ownership (§8): freed at teardown.
    std::vector<gjsify_napi::CallbackBundle*> bundles;
    // The addon's exports object, rooted for the exports cache. Reset in
    // teardown() — a live PersistentRooted past JS_DestroyContext is UAF.
    JS::PersistentRooted<JSObject*> exports;

    napi_env__(JSContext* cx, GjsContext* gjs, int32_t api_version,
               void* handle, std::string file);
    ~napi_env__();

    // §5e teardown order (P0.0 slice): flip can_call_into_js, remove the
    // extra-roots tracer, reset roots, release arena/scopes/bundles — all
    // BEFORE JS_DestroyContext runs.
    void teardown();
};

namespace gjsify_napi {

// ---- status check macros (mirroring js_native_api_v8.h:233-243) ----

#define GJSIFY_NAPI_CHECK_ENV(env)      \
    do {                                \
        if ((env) == nullptr) {         \
            return napi_invalid_arg;    \
        }                               \
    } while (0)

#define GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, condition, status)     \
    do {                                                               \
        if (!(condition)) {                                            \
            return gjsify_napi::set_last_error((env), (status));       \
        }                                                              \
    } while (0)

#define GJSIFY_NAPI_CHECK_ARG(env, arg) \
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE((env), ((arg) != nullptr), napi_invalid_arg)

// The NAPI_PREAMBLE partition (§6): only for functions that can run JS.
// Pending exception ⇒ napi_pending_exception immediately; torn-down env ⇒
// napi_cannot_run_js (module_api_version >= 10) / napi_pending_exception
// (< 10); then clear last_error. Pure value/scope ops must NOT use this —
// they keep working while an exception is pending.
#define GJSIFY_NAPI_PREAMBLE(env)                                             \
    GJSIFY_NAPI_CHECK_ENV(env);                                               \
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(                                       \
        (env), !JS_IsExceptionPending((env)->cx), napi_pending_exception);    \
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(                                       \
        (env), (env)->can_call_into_js,                                       \
        ((env)->module_api_version >= 10 ? napi_cannot_run_js                 \
                                         : napi_pending_exception));          \
    gjsify_napi::clear_last_error(env)

}  // namespace gjsify_napi

// The C bridge the Vala `GjsifyNapi.init()` body calls (module.cc).
extern "C" gboolean gjsify_napi_install(void);

#endif  // GJSIFY_NAPI_SRC_CC_COMMON_H_
