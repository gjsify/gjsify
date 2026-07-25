// SPDX-License-Identifier: MIT
// @gjsify/napi — references, weak machinery, finalizer pipeline (§5b/§5c).
// THE CRASH CLASS: everything here mirrors the V8 reference implementation's
// semantics (refs/node/src/js_native_api_v8.{h,cc}, Node.js contributors,
// MIT) realized with the SpiderMonkey mechanisms GJS itself uses in
// production (refs/gjs/gjs/jsapi-util-root.h GjsMaybeOwned rooted/weak flip;
// refs/gjs/gi/object.cpp:2450-2507 weak-pointer sweep; GNOME contributors,
// MIT/LGPLv2+).
//
// Verified mozjs-140 contracts this file is built on:
//  - JS_UpdateWeakPointerAfterGC(JSTracer*, JS::Heap<JSObject*>*)
//    (js/GCAPI.h): in-out param — MOVED referent ⇒ pointer updated in
//    place; DEAD (about to be finalized) ⇒ pointer set to null; return
//    value = "still alive". Update-vs-death discrimination is built into
//    the API (GJS: update_after_gc, jsapi-util-root.h).
//  - Weak-pointer callbacks fire while SWEEPING (major GC). A JS::Heap
//    post-write barrier puts nursery referents into the store buffer, so
//    MINOR GC tenures (and relocates) weakly-Heap-held objects instead of
//    collecting them — death is only observable at major-GC sweep, which is
//    exactly when the callback runs (js/RootingAPI.h Heap<T> barrier
//    contract: pre-write, post-write, read barriers). Consequence: a
//    weakly-held object's death may be delayed to the next full GC
//    (conservative, never unsafe; imports.system.gc() is deterministic).
//  - The strong↔weak flips stack-root the object across the transition so
//    it is never in neither slot (GJS switch_to_rooted/switch_to_unrooted,
//    jsapi-util-root.h:178-201); JS::Heap assignment runs the write
//    barriers, JS::Heap::get() runs the read barrier (gray-unmark on
//    resurrection).

#include "common.h"

#include <algorithm>
#include <cstdio>

namespace gjsify_napi {

// ---- RefTracker ----

void RefTracker::Link(RefTracker* list_head) {
    prev_ = list_head;
    next_ = list_head->next_;
    if (next_ != nullptr) {
        next_->prev_ = this;
    }
    list_head->next_ = this;
}

void RefTracker::Unlink() {
    if (prev_ != nullptr) {
        prev_->next_ = next_;
    }
    if (next_ != nullptr) {
        next_->prev_ = prev_;
    }
    prev_ = nullptr;
    next_ = nullptr;
}

void RefTracker::FinalizeAll(RefTracker* list_head) {
    // Each Finalize() unlinks itself first, so this terminates even when a
    // finalizer links new trackers (they land at the head and get seen).
    while (list_head->next_ != nullptr) {
        list_head->next_->Finalize();
    }
}

// Log + clear a pending exception (shared with tsfn.cc — declared in
// common.h): the "no JS frame below us" posture for finalizers and loop-
// dispatched tsfn callbacks alike (Bun's clearExceptionsBetweenFinalizers
// lesson).
void log_and_clear_pending_exception(napi_env env, const char* where) {
    if (!JS_IsExceptionPending(env->cx)) {
        return;
    }
    JS::RootedValue exc(env->cx);
    JS_GetPendingException(env->cx, &exc);
    JS_ClearPendingException(env->cx);
    JSString* str = JS::ToString(env->cx, exc);
    if (str == nullptr) {
        JS_ClearPendingException(env->cx);
    }
    JS::UniqueChars utf8 =
        str ? JS_EncodeStringToUTF8(env->cx, JS::RootedString(env->cx, str))
            : nullptr;
    fprintf(stderr, "[gjsify-napi] unhandled exception in %s: %s\n", where,
            utf8 ? utf8.get() : "<unprintable>");
}

// Shared "run a user napi_finalize with JS callable" helper (§5c drain
// semantics): fresh handle scope per finalizer, exceptions logged and
// cleared between finalizers.
static void run_user_finalizer(napi_env env, napi_finalize cb, void* data,
                               void* hint) {
    if (cb == nullptr) {
        return;
    }
    napi_handle_scope scope = nullptr;
    napi_open_handle_scope(env, &scope);
    cb(env, data, hint);
    log_and_clear_pending_exception(env, "native finalizer");
    napi_close_handle_scope(env, scope);
}

// ---- TrackedFinalizer ----

TrackedFinalizer::TrackedFinalizer(napi_env env, napi_finalize cb, void* data,
                                   void* hint)
    : env_(env), cb_(cb), data_(data), hint_(hint) {
    Link(&env->finalizing_reflist);
}

TrackedFinalizer::~TrackedFinalizer() {
    dequeue_finalizer(env_, this);
}

void TrackedFinalizer::Finalize() {
    Unlink();
    dequeue_finalizer(env_, this);
    // Instance data finalizes via FinalizeAll(finalizing_reflist) like Node
    // (TrackedFinalizer links there); clear the env pointer so the zombie
    // env shell never dangles into freed memory.
    if (env_->instance_data == this) {
        env_->instance_data = nullptr;
    }
    run_user_finalizer(env_, cb_, data_, hint_);
    delete this;
}

// ---- Reference ----

Reference* Reference::New(napi_env env, JS::HandleValue value,
                          uint32_t initial_refcount,
                          ReferenceOwnership ownership, napi_finalize cb,
                          void* data, void* hint) {
    return new Reference(env, value, initial_refcount, ownership, cb, data,
                         hint);
}

Reference::Reference(napi_env env, JS::HandleValue value,
                     uint32_t initial_refcount, ReferenceOwnership ownership,
                     napi_finalize cb, void* data, void* hint)
    : env_(env),
      state_(State::kStrong),
      refcount_(initial_refcount),
      ownership_(ownership),
      can_be_weak_(value.isObject()),
      cb_(cb),
      data_(data),
      hint_(hint) {
    // Two-list membership: refs with a user finalizer are finalized FIRST
    // at teardown (js_native_api_v8.h:121-130).
    Link(cb_ != nullptr ? &env->finalizing_reflist : &env->reflist);
    strong_ = value;  // Heap assignment: post-write barrier
    if (refcount_ == 0) {
        SetWeakOrRelease();
    }
}

Reference::~Reference() {
    // Deleting a ref whose finalizer is still queued skips the finalizer
    // (Node RefTracker semantics); ~RefTracker unlinks from the ref list.
    dequeue_finalizer(env_, this);
    RemoveFromWeakSet();
    // Release the GC edges: JS::Heap destructor runs the pre-write barrier.
    // Must never run after JS_DestroyContext — guaranteed by the teardown
    // order (all references die in teardown step 3 or earlier).
}

void Reference::RemoveFromWeakSet() {
    auto& set = env_->weak_refs;
    set.erase(std::remove(set.begin(), set.end(), this), set.end());
}

// refcount 1→0 (or construction at 0): objects go weak, primitives (and
// symbols, §5b ledger deviation) release immediately — the exact
// SetWeak-on-non-weakable reset of js_native_api_v8.cc:751-757.
void Reference::SetWeakOrRelease() {
    if (state_ != State::kStrong) {
        return;
    }
    if (can_be_weak_) {
        // Flip strong→weak. Stack-root across the transition (the thing
        // must never be in neither slot — GJS switch_to_unrooted).
        JS::RootedObject obj(env_->cx, &strong_.get().toObject());
        strong_ = JS::UndefinedValue();  // pre-write barrier on overwrite
        weak_obj_ = obj.get();           // post-write barrier
        state_ = State::kWeak;
        env_->weak_refs.push_back(this);
    } else {
        strong_ = JS::UndefinedValue();
        state_ = State::kReleased;
    }
}

uint32_t Reference::Ref() {
    if (++refcount_ == 1) {
        if (state_ == State::kWeak) {
            // Flip weak→strong (resurrection). JS::Heap::get() runs the
            // read barrier (exposes/unmarks gray — required when making a
            // weakly-held object strongly reachable mid-incremental-GC).
            JS::RootedObject obj(env_->cx, weak_obj_.get());
            RemoveFromWeakSet();
            weak_obj_ = nullptr;
            if (obj) {
                strong_ = JS::ObjectValue(*obj);
                state_ = State::kStrong;
            } else {
                state_ = State::kReleased;
            }
        }
        // kReleased stays released (a dead weak ref cannot resurrect —
        // matches Node: Ref() on an emptied Persistent).
    }
    return refcount_;
}

uint32_t Reference::Unref() {
    if (refcount_ == 0) {
        return 0;
    }
    if (--refcount_ == 0) {
        SetWeakOrRelease();
    }
    return refcount_;
}

bool Reference::GetValue(JS::MutableHandleValue out) {
    switch (state_) {
        case State::kStrong:
            out.set(strong_.get());
            return true;
        case State::kWeak: {
            JSObject* obj = weak_obj_.get();  // read barrier
            if (obj == nullptr) {
                return false;
            }
            out.set(JS::ObjectValue(*obj));
            return true;
        }
        case State::kReleased:
            return false;
    }
    return false;
}

void Reference::Trace(JSTracer* trc) {
    if (state_ == State::kStrong) {
        // Marks AND relocates — outstanding pointers stay valid.
        JS::TraceEdge(trc, &strong_, "gjsify-napi reference (strong)");
    }
    // kWeak edges are deliberately NOT traced — the weak sweep callback
    // updates them (tracing would make the reference immortal).
}

bool Reference::UpdateAfterGC(JSTracer* trc) {
    // GCAPI.h contract: moved ⇒ updated in place (returns true),
    // about-to-be-finalized ⇒ nulled (returns false).
    const bool died = !JS_UpdateWeakPointerAfterGC(trc, &weak_obj_);
    if (died) {
        state_ = State::kReleased;  // reads back empty from now on
    }
    return died;
}

void Reference::Finalize() {
    Unlink();
    dequeue_finalizer(env_, this);
    // Drop the GC edges BEFORE running the callback: the value must not be
    // resurrectable from its own finalizer, and teardown finalization of
    // still-alive objects must release the root either way.
    RemoveFromWeakSet();
    state_ = State::kReleased;
    strong_ = JS::UndefinedValue();
    weak_obj_ = nullptr;

    const ReferenceOwnership ownership = ownership_;
    const napi_finalize cb = cb_;
    void* data = data_;
    void* hint = hint_;
    cb_ = nullptr;
    run_user_finalizer(env_, cb, data, hint);
    // kRuntime: the runtime owns the reference — delete after the
    // finalizer. kUserland: userland deletes via napi_delete_reference
    // (js_native_api_v8 Reference ownership contract).
    if (ownership == ReferenceOwnership::kRuntime) {
        delete this;
    }
}

// ---- finalizer queue (§5c) ----

void enqueue_finalizer(napi_env env, RefTracker* tracker) {
    auto& q = env->pending_finalizers;
    if (std::find(q.begin(), q.end(), tracker) == q.end()) {
        q.push_back(tracker);
    }
    schedule_finalizer_drain();
}

void dequeue_finalizer(napi_env env, RefTracker* tracker) {
    auto& q = env->pending_finalizers;
    q.erase(std::remove(q.begin(), q.end(), tracker), q.end());
}

void drain_finalizer_queue(napi_env env) {
    if (env->draining_finalizers) {
        return;
    }
    env->draining_finalizers = true;
    while (!env->pending_finalizers.empty()) {
        RefTracker* tracker = env->pending_finalizers.front();
        env->pending_finalizers.erase(env->pending_finalizers.begin());
        tracker->Finalize();
    }
    env->draining_finalizers = false;
}

// ---- weak sweep (§5b) ----
//
// ONE JSWeakPointerZonesCallback per process (module.cc registers it at
// install). NO JSAPI beyond JS_UpdateWeakPointerAfterGC may run here — this
// executes during GC sweeping. Deaths are queued; the drain runs later on
// the main loop (or at teardown).
void weak_sweep_callback(JSTracer* trc, void* /* data */) {
    for (napi_env env : env_registry()) {
        // Collect first: UpdateAfterGC survivors keep their slot; the dead
        // are detached outside the iteration (mutation-safe).
        std::vector<Reference*> died;
        for (Reference* ref : env->weak_refs) {
            if (ref->UpdateAfterGC(trc)) {
                died.push_back(ref);
            }
        }
        for (Reference* ref : died) {
            ref->RemoveFromWeakSet();
            if (ref->HasFinalizer()) {
                enqueue_finalizer(env, ref);
            }
            // Plain refs (kUserland by construction via
            // napi_create_reference) just read back empty from now on —
            // UpdateAfterGC already flipped them to kReleased.
        }
    }
}

}  // namespace gjsify_napi

// ---- napi_ref ABI ----

napi_status NAPI_CDECL napi_create_reference(napi_env env, napi_value value,
                                             uint32_t initial_refcount,
                                             napi_ref* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, value);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::RootedValue v(env->cx, gjsify_napi::napi_value_to_js(value));
    if (env->module_api_version < 10) {
        // <10 modules may only reference object/function/symbol
        // (js_native_api_v8.cc:2829-2834).
        GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
            env, v.isObject() || v.isSymbol(), napi_invalid_arg);
    }
    gjsify_napi::Reference* ref = gjsify_napi::Reference::New(
        env, v, initial_refcount, gjsify_napi::ReferenceOwnership::kUserland);
    *result = reinterpret_cast<napi_ref>(ref);
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_delete_reference(napi_env env, napi_ref ref) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, ref);
    delete reinterpret_cast<gjsify_napi::Reference*>(ref);
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_reference_ref(napi_env env, napi_ref ref,
                                          uint32_t* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, ref);
    uint32_t count = reinterpret_cast<gjsify_napi::Reference*>(ref)->Ref();
    if (result != nullptr) {
        *result = count;
    }
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_reference_unref(napi_env env, napi_ref ref,
                                            uint32_t* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, ref);
    auto* reference = reinterpret_cast<gjsify_napi::Reference*>(ref);
    // Unref below zero = napi_generic_failure (cc:2884-2900).
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, reference->RefCount() > 0,
                                       napi_generic_failure);
    uint32_t count = reference->Unref();
    if (result != nullptr) {
        *result = count;
    }
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_reference_value(napi_env env, napi_ref ref,
                                                napi_value* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, ref);
    GJSIFY_NAPI_CHECK_ARG(env, result);
    JS::RootedValue v(env->cx);
    if (reinterpret_cast<gjsify_napi::Reference*>(ref)->GetValue(&v)) {
        *result = gjsify_napi::arena_push(env, v);
    } else {
        *result = nullptr;  // released/dead — Node returns NULL
    }
    return gjsify_napi::clear_last_error(env);
}

// ---- finalizer-adjacent ABI ----

napi_status NAPI_CDECL napi_add_finalizer(napi_env env, napi_value js_object,
                                          void* finalize_data,
                                          napi_finalize finalize_cb,
                                          void* finalize_hint,
                                          napi_ref* result) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, js_object);
    GJSIFY_NAPI_CHECK_ARG(env, finalize_cb);
    JS::RootedValue v(env->cx, gjsify_napi::napi_value_to_js(js_object));
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, v.isObject(),
                                       napi_object_expected);
    // Weak refcount-0 ReferenceWithFinalizer; ownership by whether the
    // caller wants the ref back (js_native_api_v8.cc:3625+).
    gjsify_napi::Reference* ref = gjsify_napi::Reference::New(
        env, v, 0,
        result != nullptr ? gjsify_napi::ReferenceOwnership::kUserland
                          : gjsify_napi::ReferenceOwnership::kRuntime,
        finalize_cb, finalize_data, finalize_hint);
    if (result != nullptr) {
        *result = reinterpret_cast<napi_ref>(ref);
    }
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL node_api_post_finalizer(node_api_basic_env basic_env,
                                               napi_finalize finalize_cb,
                                               void* finalize_data,
                                               void* finalize_hint) {
    napi_env env = const_cast<napi_env>(basic_env);
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, finalize_cb);
    auto* task = new gjsify_napi::TrackedFinalizer(env, finalize_cb,
                                                   finalize_data,
                                                   finalize_hint);
    gjsify_napi::enqueue_finalizer(env, task);
    return gjsify_napi::clear_last_error(env);
}

// ---- instance data (§5d) ----

napi_status NAPI_CDECL napi_set_instance_data(node_api_basic_env basic_env,
                                              void* data,
                                              napi_finalize finalize_cb,
                                              void* finalize_hint) {
    napi_env env = const_cast<napi_env>(basic_env);
    GJSIFY_NAPI_CHECK_ENV(env);
    if (env->instance_data != nullptr) {
        // Overwrite deletes the old data holder UN-finalized (cc:3683-3702).
        delete env->instance_data;
        env->instance_data = nullptr;
    }
    env->instance_data = new gjsify_napi::TrackedFinalizer(
        env, finalize_cb, data, finalize_hint);
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_get_instance_data(node_api_basic_env basic_env,
                                              void** data) {
    napi_env env = const_cast<napi_env>(basic_env);
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, data);
    *data = env->instance_data != nullptr ? env->instance_data->data()
                                          : nullptr;
    return gjsify_napi::clear_last_error(env);
}

// ---- env cleanup hooks ----

napi_status NAPI_CDECL napi_add_env_cleanup_hook(node_api_basic_env basic_env,
                                                 napi_cleanup_hook fun,
                                                 void* arg) {
    napi_env env = const_cast<napi_env>(basic_env);
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, fun);
    env->cleanup_hooks.push_back({fun, arg});
    return gjsify_napi::clear_last_error(env);
}

napi_status NAPI_CDECL napi_remove_env_cleanup_hook(
    node_api_basic_env basic_env, napi_cleanup_hook fun, void* arg) {
    napi_env env = const_cast<napi_env>(basic_env);
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, fun);
    auto& hooks = env->cleanup_hooks;
    // Remove the LAST matching registration (Node removes one entry).
    for (auto it = hooks.rbegin(); it != hooks.rend(); ++it) {
        if (it->fn == fun && it->arg == arg) {
            hooks.erase(std::next(it).base());
            return gjsify_napi::clear_last_error(env);
        }
    }
    return gjsify_napi::clear_last_error(env);
}
