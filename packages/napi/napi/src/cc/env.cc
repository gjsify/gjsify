// SPDX-License-Identifier: MIT
// @gjsify/napi — env lifecycle, handle arena, GC tracer, handle scopes.
//
// Reference: refs/node/src/js_native_api_v8.{h,cc} (Node.js contributors,
// MIT) for the napi_env/handle-scope semantics; tracer pattern adapted from
// GJS's own context tracer (refs/gjs/gjs/context.cpp:343-353,689 —
// JS_AddExtraGCRootsTracer + JS::TraceEdge; GNOME contributors, MIT/LGPLv2+).

#include "common.h"

namespace gjsify_napi {

// ---- HandleArena ----

JS::Heap<JS::Value>* HandleArena::slotAt(size_t index) {
    return &chunks_[index / kArenaChunkSlots]->slots[index % kArenaChunkSlots];
}

JS::Heap<JS::Value>* HandleArena::push(const JS::Value& value) {
    if (top_ == chunks_.size() * kArenaChunkSlots) {
        chunks_.push_back(std::make_unique<ArenaChunk>());
    }
    JS::Heap<JS::Value>* slot = slotAt(top_);
    *slot = value;  // JS::Heap assignment runs the post barrier
    top_++;
    return slot;
}

void HandleArena::popTo(size_t mark) {
    for (size_t i = mark; i < top_; i++) {
        // Immediate release, matching V8 handle-scope close semantics; the
        // JS::Heap assignment runs the pre barrier for the vacated value.
        *slotAt(i) = JS::UndefinedValue();
    }
    top_ = mark;
}

void HandleArena::trace(JSTracer* trc) {
    for (size_t i = 0; i < top_; i++) {
        // Marks AND relocates: a moving GC updates the slot in place, so
        // every outstanding napi_value pointer stays valid.
        JS::TraceEdge(trc, slotAt(i), "gjsify-napi arena slot");
    }
}

void HandleArena::clearAll() {
    popTo(0);
    chunks_.clear();
}

// ---- env tracer ----

void trace_env(JSTracer* trc, void* data) {
    auto* env = static_cast<napi_env>(data);
    env->arena.trace(trc);
}

napi_value arena_push(napi_env env, const JS::Value& value) {
    return reinterpret_cast<napi_value>(env->arena.push(value));
}

}  // namespace gjsify_napi

// ---- napi_env lifecycle ----

napi_env__::napi_env__(JSContext* cx_in, GjsContext* gjs, int32_t api_version,
                       void* handle, std::string file)
    : cx(cx_in),
      gjs_context(gjs),
      module_api_version(api_version),
      dl_handle(handle),
      filename(std::move(file)),
      exports(cx_in) {
    JS_AddExtraGCRootsTracer(cx, gjsify_napi::trace_env, this);
}

napi_env__::~napi_env__() {
    teardown();
}

void napi_env__::teardown() {
    if (torn_down) {
        return;
    }
    torn_down = true;
    // §5e order (P0.0 slice — cleanup hooks / finalizer drain / ref lists /
    // instance data join in P0.3):
    // 1. block further calls into JS through this env
    can_call_into_js = false;
    // 2. unregister the extra-roots tracer (GJS removes its own the same
    //    way before JS_DestroyContext, refs/gjs/gjs/context.cpp:457)
    JS_RemoveExtraGCRootsTracer(cx, gjsify_napi::trace_env, this);
    // 3. drop every root this env owns — all before JS_DestroyContext;
    //    a live PersistentRooted/JS::Heap past that point is the UAF class
    exports.reset();
    arena.clearAll();
    scopes.clear();
    // 4. free callback bundles. Functions created by this env still hold
    //    the (now dangling) bundle pointer in their reserved slot, but the
    //    env only tears down when the GjsContext itself is disposing — no
    //    JS runs afterwards. P0.3 revisits bundle lifetime for early env
    //    teardown.
    for (gjsify_napi::CallbackBundle* bundle : bundles) {
        delete bundle;
    }
    bundles.clear();
}

// ---- handle scopes (js_native_api_v8.cc:2927-2953 semantics) ----

napi_status NAPI_CDECL napi_open_handle_scope(napi_env env,
                                              napi_handle_scope* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    env->scopes.push_back({env->arena.top()});
    // Encode the 1-based depth: no allocation, close validates LIFO order.
    *result = reinterpret_cast<napi_handle_scope>(
        static_cast<uintptr_t>(env->scopes.size()));
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_close_handle_scope(napi_env env,
                                               napi_handle_scope scope) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, scope);
    const size_t depth = reinterpret_cast<uintptr_t>(scope);
    if (env->scopes.empty() || depth != env->scopes.size()) {
        return gjsify_napi::set_last_error(env, napi_handle_scope_mismatch);
    }
    env->arena.popTo(env->scopes.back().mark);
    env->scopes.pop_back();
    return gjsify_napi::clear_last_error(env);
}
