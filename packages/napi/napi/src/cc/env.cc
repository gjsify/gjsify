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

// Walk a RefTracker list, invoking the virtual Trace (Reference traces its
// strong slot; weak slots are deliberately NOT traced — the sweep callback
// owns them).
static void trace_ref_list(JSTracer* trc, const RefTracker* head) {
    for (RefTracker* t = head->next(); t != nullptr; t = t->next()) {
        t->Trace(trc);
    }
}

void trace_env(JSTracer* trc, void* data) {
    auto* env = static_cast<napi_env>(data);
    env->arena.trace(trc);
    trace_ref_list(trc, &env->reflist);
    trace_ref_list(trc, &env->finalizing_reflist);
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
      exports(cx_in),
      global(cx_in, JS::CurrentGlobalOrNull(cx_in)),
      // MUST be ctor-initialized with the context: a default-constructed
      // PersistentRooted is NOT registered with the runtime — assigning to
      // it later stores the pointer UNROOTED and the map dies at the next
      // GC (found by the P0.3 gate: SetWeakMapEntry crashed in the dead
      // map's zone-tracked allocator).
      wrap_map(cx_in) {
    JS_AddExtraGCRootsTracer(cx, gjsify_napi::trace_env, this);
}

napi_env__::~napi_env__() {
    teardown();
    // Free any async_work the addon never deleted (its completion already ran,
    // or it was created-but-never-queued). Self-deleted works are already
    // unlinked, so this cannot double-free. Runs at context dispose, no JS.
    gjsify_napi::destroy_env_async_works(this);
    // Bundle memory is freed HERE, not in teardown(): function objects
    // created by this env keep the bundle pointer in their reserved slot,
    // and JS may still call them after an early teardown — the trampoline
    // bails on env->torn_down, dereferencing only the still-live bundle.
    // The destructor runs at context dispose, when no JS runs anymore.
    for (gjsify_napi::CallbackBundle* bundle : bundles) {
        delete bundle;
    }
    bundles.clear();
}

void napi_env__::teardown() {
    // §5e order — the node-gi SIGSEGV lesson. Steps 1-4 run with JS fully
    // callable (finalizers may call napi and create values, so the arena,
    // tracer and can_call_into_js MUST stay live until step 5).
    if (tearing_down || torn_down) {
        return;
    }
    tearing_down = true;

    // 1. env cleanup hooks, LIFO (napi_add_env_cleanup_hook — the
    //    better-sqlite3 Addon::Cleanup slot).
    while (!cleanup_hooks.empty()) {
        CleanupHook hook = cleanup_hooks.back();
        cleanup_hooks.pop_back();
        hook.fn(hook.arg);
    }

    // 1b. finalize threadsafe functions (§7): a release/abort issued by a
    //     cleanup hook above scheduled a JS-thread finalize dispatch that can
    //     never run — the main context stops iterating once GjsContext
    //     dispose began — so it is executed synchronously here, while JS is
    //     still fully callable. Never-released tsfns are force-closed too.
    gjsify_napi::finalize_env_tsfns(this);

    // 1c. drain pending async_work completions (§?): a work queued in the last
    //     tick before dispose has a g_idle completion that can no longer fire —
    //     run it here, JS still callable, exactly like the tsfn finalize above.
    gjsify_napi::drain_env_async_works(this);

    // 2. drain finalizers already queued by earlier GC deaths.
    gjsify_napi::drain_finalizer_queue(this);

    // 3. finalize the ref lists: finalizing refs FIRST (their finalizers
    //    may still delete plain refs — js_native_api_v8.h:121-130), then
    //    plain refs. Instance data is linked in finalizing_reflist like
    //    Node's TrackedFinalizer, so it finalizes here too. Deaths queued
    //    by GC during these callbacks are drained afterwards.
    gjsify_napi::RefTracker::FinalizeAll(&finalizing_reflist);
    gjsify_napi::RefTracker::FinalizeAll(&reflist);
    gjsify_napi::drain_finalizer_queue(this);

    // 4. (instance data handled in step 3 — see TrackedFinalizer::Finalize.)

    // 5. block further calls into JS through this env.
    can_call_into_js = false;
    torn_down = true;

    // 6. drop every root this env owns — all before JS_DestroyContext;
    //    a live PersistentRooted/JS::Heap past that point is the UAF class.
    //    (GJS removes its own tracer the same way before destroying the
    //    context, refs/gjs/gjs/context.cpp:457.)
    JS_RemoveExtraGCRootsTracer(cx, gjsify_napi::trace_env, this);
    exports.reset();
    global.reset();
    wrap_map.reset();
    arena.clearAll();
    scopes.clear();
    weak_refs.clear();
    pending_finalizers.clear();
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

namespace gjsify_napi {

// Shared close path: LIFO validation + escapable-type matching (stricter
// than Node's count-only check — a type-confused close is caught, correct
// matched-pair usage is unaffected).
static napi_status close_scope(napi_env env, uintptr_t depth,
                               bool expect_escapable) {
    if (env->scopes.empty() || depth != env->scopes.size() ||
        env->scopes.back().escapable != expect_escapable) {
        return set_last_error(env, napi_handle_scope_mismatch);
    }
    env->arena.popTo(env->scopes.back().mark);
    env->scopes.pop_back();
    return clear_last_error(env);
}

}  // namespace gjsify_napi

napi_status NAPI_CDECL napi_close_handle_scope(napi_env env,
                                               napi_handle_scope scope) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, scope);
    return gjsify_napi::close_scope(env, reinterpret_cast<uintptr_t>(scope),
                                    /* expect_escapable = */ false);
}

// ---- escapable handle scopes (js_native_api_v8.cc:2955-3002 semantics) ----

napi_status NAPI_CDECL napi_open_escapable_handle_scope(
    napi_env env, napi_escapable_handle_scope* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    // Reserve the escape slot in the PARENT region first; the scope's mark
    // then sits ABOVE it, so closing releases everything but the slot.
    JS::Heap<JS::Value>* escape_slot = env->arena.push(JS::UndefinedValue());
    gjsify_napi::HandleScopeRec rec;
    rec.mark = env->arena.top();
    rec.escapable = true;
    rec.escape_slot = escape_slot;
    env->scopes.push_back(rec);
    *result = reinterpret_cast<napi_escapable_handle_scope>(
        static_cast<uintptr_t>(env->scopes.size()));
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_close_escapable_handle_scope(
    napi_env env, napi_escapable_handle_scope scope) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, scope);
    return gjsify_napi::close_scope(env, reinterpret_cast<uintptr_t>(scope),
                                    /* expect_escapable = */ true);
}

napi_status NAPI_CDECL napi_escape_handle(napi_env env,
                                          napi_escapable_handle_scope scope,
                                          napi_value escapee,
                                          napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, scope);
    GJSIFY_NAPI_CHECK_ARG(env, escapee);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    const size_t depth = reinterpret_cast<uintptr_t>(scope);
    if (depth == 0 || depth > env->scopes.size()) {
        return gjsify_napi::set_last_error(env, napi_handle_scope_mismatch);
    }
    gjsify_napi::HandleScopeRec& rec = env->scopes[depth - 1];
    if (!rec.escapable) {
        return gjsify_napi::set_last_error(env, napi_handle_scope_mismatch);
    }
    if (rec.escape_called) {
        return gjsify_napi::set_last_error(env, napi_escape_called_twice);
    }
    *rec.escape_slot = gjsify_napi::napi_value_to_js(escapee);
    rec.escape_called = true;
    *result = reinterpret_cast<napi_value>(rec.escape_slot);
    return gjsify_napi::clear_last_error(env);
}
