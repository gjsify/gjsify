// SPDX-License-Identifier: MIT
// @gjsify/napi — threadsafe functions + napi_make_callback (Phase 1).
//
// Reference: refs/node/src/node_api.cc v8impl::ThreadSafeFunction (Node.js
// contributors, MIT) — Push/Release/DispatchOne/CloseHandlesAndMaybeDelete/
// EmptyQueueAndDelete are the normative semantics mirrored here. Node realizes
// the cross-thread wake as a uv_async on the event loop; this host realizes it
// as an idle GSource attached to the GJS main context.
//
// THE CRUX — foreign thread → single-threaded JSContext:
// napi_call_threadsafe_function is documented callable from ANY thread
// (GIO/GStreamer workers in node-gi's case), but the JSContext is owned by the
// GJS main thread and must never be entered from another thread. The safe
// bridge is GSource attachment:
//   - `g_source_attach` is explicitly thread-safe (it takes the GMainContext
//     lock and wakes the context's eventfd), and it runs NO JSAPI — so a
//     foreign thread may schedule a dispatch even while the main thread is
//     mid-GC or mid-dispatch; the source only ever DISPATCHES on the thread
//     iterating the context (the GJS main/JS thread).
//   - `g_main_context_invoke_full` is deliberately NOT used: when the calling
//     thread owns the context it invokes the callback SYNCHRONOUSLY — a
//     same-thread napi_call_threadsafe_function (e.g. from a napi finalizer
//     during the §5c drain) would re-enter JS in place instead of deferring
//     to a loop turn, breaking the tsfn's async contract (and node-gi's
//     "the finalizer only schedules" crash-mode-1 discipline).
//   - the tsfn's own GMutex guards all mutable state; it is NEVER held across
//     call_js (the callback may run arbitrary JS → GObject dispose → foreign-
//     thread toggles that need this same mutex — the node-gi drain-lock
//     lesson, toggle.cc DrainTsfnCb).
//
// Lifetime: the struct is freed on the JS thread only, either by the dispatch
// (closing decided: abort, or last claim released + queue drained — Node
// parity) or by env teardown (finalize_env_tsfns: the release(abort) issued
// by an env cleanup hook schedules a dispatch that would never run, because
// the main context stops iterating once GjsContext dispose began). ABI
// contract, as in Node: a thread must hold a claim (initial_thread_count /
// napi_acquire) while calling, and must make no call after its release —
// a claimless call racing the final free is UB in every host.

#include "common.h"

#include <deque>

// ---- the tsfn object ----
//
// Global scope: the struct tag is fixed by the vendored
// `typedef struct napi_threadsafe_function__* napi_threadsafe_function`.
struct napi_threadsafe_function__ {
    // Immutable after creation (JS thread):
    napi_env env = nullptr;
    GMainContext* main_context = nullptr;  // ref held; released in finalize
    void* context = nullptr;
    napi_threadsafe_function_call_js call_js = nullptr;  // never null
    napi_ref func_ref = nullptr;   // strong ref on the JS function (nullable)
    napi_finalize finalize_cb = nullptr;
    void* finalize_data = nullptr;
    size_t max_queue_size = 0;     // 0 = unbounded

    // Mutable state — guarded by mutex (any thread):
    GMutex mutex;
    GCond cond;                    // blocking-push space + waiter drain
    std::deque<void*> queue;
    size_t thread_count = 0;
    size_t waiters = 0;            // threads inside the blocking-push wait
    // No new pushes accepted: release(abort), the dispatch's natural-close
    // decision, or env teardown. Node's `is_closing`.
    bool closing = false;
    // A dispatch idle is attached and pending (owned ref); the coalescing
    // guard — at most ONE pending wake, exactly uv_async semantics.
    GSource* dispatch_source = nullptr;
    bool referenced = true;        // napi_unref bookkeeping (see note below)

    napi_threadsafe_function__() {
        g_mutex_init(&mutex);
        g_cond_init(&cond);
    }
    ~napi_threadsafe_function__() {
        g_cond_clear(&cond);
        g_mutex_clear(&mutex);
        if (main_context != nullptr) {
            g_main_context_unref(main_context);
        }
    }
};

namespace gjsify_napi {
namespace {

// Node's Dispatch() iteration cap (event-loop starvation guard).
constexpr unsigned kMaxDispatchIterations = 1000;

gboolean dispatch_cb(gpointer data);

// Arm the JS-thread dispatch. Caller holds tsfn->mutex. Safe from any thread
// and from within GC sweeps: pure GLib, no JSAPI (see file header).
void schedule_dispatch_locked(napi_threadsafe_function tsfn) {
    if (tsfn->dispatch_source != nullptr) {
        return;  // a wake is already pending — coalesce
    }
    GSource* src = g_idle_source_new();
    // uv_async parity: process the wake promptly (an async is checked every
    // loop iteration in Node), not at idle-starvation priority.
    g_source_set_priority(src, G_PRIORITY_DEFAULT);
    g_source_set_name(src, "gjsify-napi tsfn dispatch");
    g_source_set_callback(src, dispatch_cb, tsfn, nullptr);
    tsfn->dispatch_source = src;  // keep our creation ref until dispatch/teardown
    g_source_attach(src, tsfn->main_context);
}

// Node CallJs (node_api.cc): the default call_js when the creator passed none.
void default_call_js(napi_env env, napi_value cb, void* /* context */,
                     void* /* data */) {
    if (env == nullptr || cb == nullptr) {
        return;
    }
    napi_value recv = nullptr;
    if (napi_get_undefined(env, &recv) != napi_ok) {
        return;
    }
    napi_call_function(env, recv, cb, 0, nullptr, nullptr);
}

// Run call_js for one queue item on the JS thread. NO tsfn lock held. A fresh
// handle scope wraps the call (Node invokes call_js inside a HandleScope +
// CallbackScope); a pending exception left by the callback is logged and
// cleared — there is no JS frame below a loop-dispatched invocation, and a
// lingering pending exception would poison unrelated later JSAPI calls (the
// finalizer-pipeline posture, ref.cc).
void invoke_call_js(napi_threadsafe_function tsfn, void* item) {
    napi_env env = tsfn->env;
    const bool can_call =
        env != nullptr && env->can_call_into_js && !env->torn_down;
    if (!can_call) {
        // Node EmptyQueueAndDelete posture: env == NULL tells the callback
        // "free `data`, run no JS".
        tsfn->call_js(nullptr, nullptr, tsfn->context, item);
        return;
    }
    napi_handle_scope scope = nullptr;
    napi_open_handle_scope(env, &scope);
    napi_value js_cb = nullptr;
    if (tsfn->func_ref != nullptr) {
        napi_get_reference_value(env, tsfn->func_ref, &js_cb);
    }
    tsfn->call_js(env, js_cb, tsfn->context, item);
    log_and_clear_pending_exception(env, "threadsafe-function callback");
    napi_close_handle_scope(env, scope);
}

// JS-thread finalization (Node CloseHandlesAndMaybeDelete → Finalize →
// EmptyQueueAndDelete): run the thread finalizer with JS available, drain
// leftover queue items with env == NULL so their data can be freed, drop the
// function ref, unregister from the env, free the struct. Caller must have
// set `closing` and destroyed any pending dispatch source under the lock.
void finalize_tsfn(napi_threadsafe_function tsfn) {
    napi_env env = tsfn->env;
    const bool can_call =
        env != nullptr && env->can_call_into_js && !env->torn_down;

    // Wait out blocking pushers still inside g_cond_wait: they hold no claim
    // on the memory beyond the wait itself, and freeing the cond under a
    // waiter is UB. `closing` is already set, so awakened waiters exit fast.
    g_mutex_lock(&tsfn->mutex);
    g_cond_broadcast(&tsfn->cond);
    while (tsfn->waiters > 0) {
        g_cond_wait(&tsfn->cond, &tsfn->mutex);
    }
    g_mutex_unlock(&tsfn->mutex);

    if (tsfn->finalize_cb != nullptr && can_call) {
        napi_handle_scope scope = nullptr;
        napi_open_handle_scope(env, &scope);
        tsfn->finalize_cb(env, tsfn->finalize_data, tsfn->context);
        log_and_clear_pending_exception(env, "threadsafe-function finalizer");
        napi_close_handle_scope(env, scope);
    }
    // Leftover items (abort path): give the callback its free-data-only call.
    while (!tsfn->queue.empty()) {
        void* item = tsfn->queue.front();
        tsfn->queue.pop_front();
        tsfn->call_js(nullptr, nullptr, tsfn->context, item);
    }
    if (tsfn->func_ref != nullptr && env != nullptr && !env->torn_down) {
        napi_delete_reference(env, tsfn->func_ref);
        tsfn->func_ref = nullptr;
    }
    if (env != nullptr) {
        auto& list = env->tsfns;
        for (auto it = list.begin(); it != list.end(); ++it) {
            if (*it == tsfn) {
                list.erase(it);
                break;
            }
        }
    }
    delete tsfn;
}

// The JS-thread dispatch (Node AsyncCb → Dispatch → DispatchOne loop). Pops
// ONE item under the lock, RELEASES the lock, invokes call_js, re-checks —
// the lock is never held across JS (see file header). Decides + performs
// finalization when closing (abort) or when the last claim is gone and the
// queue drained (Node's natural close).
gboolean dispatch_cb(gpointer data) {
    auto tsfn = static_cast<napi_threadsafe_function>(data);
    g_mutex_lock(&tsfn->mutex);
    if (tsfn->dispatch_source != nullptr) {
        // Drop our creation ref; the context's ref dies with SOURCE_REMOVE.
        g_source_unref(tsfn->dispatch_source);
        tsfn->dispatch_source = nullptr;
    }
    unsigned iterations_left = kMaxDispatchIterations;
    for (;;) {
        if (tsfn->closing ||
            (tsfn->thread_count == 0 && tsfn->queue.empty())) {
            tsfn->closing = true;
            // A same-thread release() from inside call_js may have re-armed a
            // wake meanwhile — destroy it, or it would fire into freed memory.
            if (tsfn->dispatch_source != nullptr) {
                g_source_destroy(tsfn->dispatch_source);
                g_source_unref(tsfn->dispatch_source);
                tsfn->dispatch_source = nullptr;
            }
            g_mutex_unlock(&tsfn->mutex);
            finalize_tsfn(tsfn);
            return G_SOURCE_REMOVE;
        }
        if (tsfn->queue.empty()) {
            break;  // idle: claims alive, nothing queued
        }
        if (iterations_left-- == 0) {
            // Starvation guard (Node kMaxIterationCount): yield to the loop,
            // re-arm for the remainder.
            schedule_dispatch_locked(tsfn);
            break;
        }
        void* item = tsfn->queue.front();
        tsfn->queue.pop_front();
        g_cond_broadcast(&tsfn->cond);  // space freed for blocking pushers
        g_mutex_unlock(&tsfn->mutex);
        invoke_call_js(tsfn, item);     // arbitrary JS — no lock held
        g_mutex_lock(&tsfn->mutex);
    }
    g_mutex_unlock(&tsfn->mutex);
    return G_SOURCE_REMOVE;
}

}  // namespace

// Env teardown step 1b (env.cc): finalize every tsfn still registered. The
// release(abort) node-gi issues from its env cleanup hook schedules a
// dispatch that can never run — GjsContext dispose has begun, the main
// context will not be iterated again — so the deferred finalize is executed
// HERE, synchronously, while JS is still fully callable (§5e steps 1-4
// discipline). A tsfn whose claims were never released is force-closed the
// same way (foreign threads calling past this point violate the claim
// contract — UB in Node too, see file header).
void finalize_env_tsfns(napi_env env) {
    while (!env->tsfns.empty()) {
        napi_threadsafe_function tsfn = env->tsfns.back();
        g_mutex_lock(&tsfn->mutex);
        tsfn->closing = true;
        g_cond_broadcast(&tsfn->cond);
        if (tsfn->dispatch_source != nullptr) {
            g_source_destroy(tsfn->dispatch_source);
            g_source_unref(tsfn->dispatch_source);
            tsfn->dispatch_source = nullptr;
        }
        g_mutex_unlock(&tsfn->mutex);
        finalize_tsfn(tsfn);  // removes it from env->tsfns
    }
}

}  // namespace gjsify_napi

// ---- ABI ----

napi_status NAPI_CDECL napi_create_threadsafe_function(
    napi_env env, napi_value func, napi_value async_resource,
    napi_value async_resource_name, size_t max_queue_size,
    size_t initial_thread_count, void* thread_finalize_data,
    napi_finalize thread_finalize_cb, void* context,
    napi_threadsafe_function_call_js call_js_cb,
    napi_threadsafe_function* result) {
    (void)async_resource;  // no async-hooks under GJS
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, async_resource_name);
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(env, initial_thread_count > 0,
                                       napi_invalid_arg);
    GJSIFY_NAPI_CHECK_ARG(env, result);

    napi_ref func_ref = nullptr;
    if (func == nullptr) {
        // js_callback-less tsfn: call_js_cb IS the callback (node_api.cc).
        GJSIFY_NAPI_CHECK_ARG(env, call_js_cb);
    } else {
        JS::Value fn_v = gjsify_napi::napi_value_to_js(func);
        GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
            env, fn_v.isObject() && JS::IsCallable(&fn_v.toObject()),
            napi_function_expected);
        napi_status st = napi_create_reference(env, func, 1, &func_ref);
        if (st != napi_ok) {
            return st;
        }
    }

    auto tsfn = new napi_threadsafe_function__();
    tsfn->env = env;
    // The GJS host loop iterates the GLOBAL default main context (the same
    // context the §5c finalizer drain targets via g_idle_add) — that context
    // is the JS thread's dispatch surface.
    tsfn->main_context = g_main_context_ref(g_main_context_default());
    tsfn->context = context;
    tsfn->call_js = call_js_cb != nullptr ? call_js_cb
                                          : gjsify_napi::default_call_js;
    tsfn->func_ref = func_ref;
    tsfn->finalize_cb = thread_finalize_cb;
    tsfn->finalize_data = thread_finalize_data;
    tsfn->max_queue_size = max_queue_size;
    tsfn->thread_count = initial_thread_count;
    env->tsfns.push_back(tsfn);

    *result = tsfn;
    return gjsify_napi::clear_last_error(env);
}

// Callable from ANY thread — env-less, touches no last_error. Mirrors Node's
// ThreadSafeFunction::Push byte-for-byte, including the auto-release on a
// closing push (a napi_closing return CONSUMES the caller's claim).
napi_status NAPI_CDECL napi_call_threadsafe_function(
    napi_threadsafe_function func, void* data,
    napi_threadsafe_function_call_mode is_blocking) {
    if (func == nullptr) {
        return napi_invalid_arg;
    }
    g_mutex_lock(&func->mutex);
    while (func->max_queue_size > 0 &&
           func->queue.size() >= func->max_queue_size && !func->closing) {
        if (is_blocking == napi_tsfn_nonblocking) {
            g_mutex_unlock(&func->mutex);
            return napi_queue_full;
        }
        func->waiters++;
        g_cond_wait(&func->cond, &func->mutex);
        func->waiters--;
        if (func->waiters == 0) {
            // A finalizer may be waiting for the waiter set to drain.
            g_cond_broadcast(&func->cond);
        }
    }
    if (func->closing) {
        if (func->thread_count == 0) {
            g_mutex_unlock(&func->mutex);
            return napi_invalid_arg;
        }
        func->thread_count--;
        g_mutex_unlock(&func->mutex);
        return napi_closing;
    }
    func->queue.push_back(data);
    gjsify_napi::schedule_dispatch_locked(func);
    g_mutex_unlock(&func->mutex);
    return napi_ok;
}

// Callable from ANY thread (Node Release): drop one claim; abort flips
// `closing` (no further pushes; queued items get the env-NULL drain). The
// finalize itself always runs deferred on the JS thread via the dispatch.
napi_status NAPI_CDECL napi_release_threadsafe_function(
    napi_threadsafe_function func, napi_threadsafe_function_release_mode mode) {
    if (func == nullptr) {
        return napi_invalid_arg;
    }
    g_mutex_lock(&func->mutex);
    if (func->thread_count == 0) {
        g_mutex_unlock(&func->mutex);
        return napi_invalid_arg;
    }
    func->thread_count--;
    if ((func->thread_count == 0 || mode == napi_tsfn_abort) &&
        !func->closing) {
        if (mode == napi_tsfn_abort) {
            func->closing = true;
            g_cond_broadcast(&func->cond);  // wake blocking pushers
        }
        gjsify_napi::schedule_dispatch_locked(func);
    }
    g_mutex_unlock(&func->mutex);
    return napi_ok;
}

// Keep-event-loop-alive bookkeeping. Under the GJS host there is nothing to
// unref: an attached idle GSource does not keep gjs alive (process lifetime
// is the module evaluation + whatever main loop the app itself runs), which
// is already the semantic an UNREF'D Node tsfn has — so this records the
// flag and succeeds. JS-thread-only API, like Node.
napi_status NAPI_CDECL napi_unref_threadsafe_function(
    node_api_basic_env basic_env, napi_threadsafe_function func) {
    napi_env env = const_cast<napi_env>(basic_env);
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, func);
    g_mutex_lock(&func->mutex);
    func->referenced = false;
    g_mutex_unlock(&func->mutex);
    return gjsify_napi::clear_last_error(env);
}

// The async-context parameter is an async-hooks concept with no GJS
// equivalent; the call itself is a plain call. Microtask parity holds the
// GJS way: promise jobs queued by the callback drain from GJS's own
// promise-job source as soon as this stack unwinds to the main loop — the
// same boundary semantics GJS gives its own C→JS closures (and the posture
// node-gi already codes against, src/loop.cc "cross-runtime microtask
// checkpoint": SpiderMonkey/GJS drains when the last JS frame exits).
napi_status NAPI_CDECL napi_make_callback(napi_env env,
                                          napi_async_context async_context,
                                          napi_value recv, napi_value func,
                                          size_t argc, const napi_value* argv,
                                          napi_value* result) {
    (void)async_context;
    GJSIFY_NAPI_PREAMBLE(env);
    GJSIFY_NAPI_CHECK_ARG(env, recv);
    // Node coerces the receiver via CHECK_TO_OBJECT → napi_object_expected.
    GJSIFY_NAPI_RETURN_STATUS_IF_FALSE(
        env, gjsify_napi::napi_value_to_js(recv).isObject(),
        napi_object_expected);
    return napi_call_function(env, recv, func, argc, argv, result);
}
