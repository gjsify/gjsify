// SPDX-License-Identifier: MIT
// @gjsify/napi — asynchronous work items (napi_create/queue/cancel/delete_
// async_work). This is what unblocks the whole node-addon-api async ecosystem
// (node-sqlite3, bcrypt, …): every Napi::AsyncWorker is these four functions.
//
// Reference: refs/node/src/node_api.cc uvimpl::Work (Node.js contributors,
// MIT) — the normative execute-on-worker / complete-on-loop semantics mirrored
// here. Node realizes the two phases as node::ThreadPoolWork on libuv: a WORKER
// thread runs `execute(env, data)` (NO JS access — the ABI contract), then the
// event loop runs `complete(env, status, data)` on the main/JS thread under a
// HandleScope + CallbackScope.
//
// THE HOST DIFFERENCE — single-threaded GJS, no libuv thread pool:
// GJS owns exactly one JSContext on one thread, so this shim realizes the two
// phases WITHOUT a worker thread:
//   - `execute` runs INLINE on the main thread during napi_queue_async_work.
//     It is legal precisely because the ABI forbids `execute` from touching JS
//     (only `complete` may), so running it in-line enters no JSAPI and races
//     nothing. The one observable divergence from Node is that queue BLOCKS the
//     main thread for the duration of `execute` instead of offloading it — an
//     accepted, documented tradeoff for a GJS host (a real GThreadPool worker
//     is a possible follow-up; see async_work create→queue→complete valgrind
//     leg). For the addons in scope (sqlite ops, hashing) `execute` is a short
//     C routine, so the block is invisible.
//   - `complete` is dispatched on the next main-loop turn via a g_idle GSource
//     attached to the default GMainContext — EXACTLY the machinery
//     schedule_finalizer_drain() (module.cc) and the tsfn dispatch (tsfn.cc)
//     use. It runs under a fresh handle scope, guarded by can_call_into_js,
//     with a pending exception logged-and-cleared (the "no JS frame below a
//     loop-dispatched callback" posture shared with the finalizer pipeline and
//     tsfn). This preserves the invariant callers depend on: the completion
//     callback fires ASYNCHRONOUSLY, a loop turn after queue returns.
//
// An AsyncWork holds NO JS values (execute/complete/data are plain C pointers;
// any napi_ref the addon needs lives on the env's ref list, traced there), so —
// unlike tsfn/Reference — it needs no GC root and no weak-sweep interaction.
// Its only lifetime hazard is the pending GSource, handled the tsfn way.
//
// Lifetime / ownership (Node parity — addons commonly delete the work INSIDE
// complete, js_native_api "Don't access work after complete" rule):
//   - create registers the work on env->async_works (teardown reaches it);
//   - the complete dispatch marks the work kComplete, drops the source, then
//     runs complete — which MAY call napi_delete_async_work(work) (self-delete,
//     unlinks + frees) so the struct is NEVER touched afterwards;
//   - a work the addon never deletes stays linked and is freed at env
//     destruction (destroy_env_async_works) — Node leaks that same struct (its
//     Work is addon-owned), so the mem leg runs leak-check=no.
//
// Teardown (§5e crash-class boundary): a work queued-but-complete-not-yet-run
// when the env tears down is drained HERE (drain_env_async_works), synchronously
// while JS is still callable — the same discipline finalize_env_tsfns uses,
// because the deferred g_idle can no longer fire once GjsContext dispose began.
// An async_work must not outlive the env.

#include "common.h"

#include <algorithm>

// Global scope: the struct tag is fixed by the vendored
// `typedef struct napi_async_work__* napi_async_work`.
struct napi_async_work__ {
    // Lifecycle state (single-threaded — all transitions on the JS thread).
    enum class State : uint8_t {
        kCreated,          // created, not yet queued
        kQueued,           // execute ran inline; a complete dispatch is pending
        kCancelledPending, // cancelled before queue; complete will run cancelled
        kComplete,         // complete has been dispatched (may already be freed)
    };

    napi_env env = nullptr;               // owning env (outlives the work)
    napi_async_execute_callback execute = nullptr;  // worker-phase, NO JS
    napi_async_complete_callback complete = nullptr;  // main-phase, may run JS
    void* data = nullptr;                 // addon-owned payload
    State state = State::kCreated;
    // The pending main-loop complete dispatch (owned creation ref held until
    // the dispatch runs or teardown/cancel destroys it — tsfn dispatch_source
    // discipline).
    GSource* complete_source = nullptr;

    ~napi_async_work__() {
        // Defensive: a live source here would fire into freed memory. In every
        // normal path complete_source is already null (the dispatch, cancel or
        // teardown cleared it) — this only bites a pathological free.
        if (complete_source != nullptr) {
            g_source_destroy(complete_source);
            g_source_unref(complete_source);
            complete_source = nullptr;
        }
    }
};

namespace gjsify_napi {
namespace {

gboolean complete_dispatch_cb(gpointer data);

// Arm the JS-thread complete dispatch. Pure GLib, no JSAPI (see file header) —
// safe even were it reached mid-sweep. The default main context is the GJS host
// loop's dispatch surface (same context schedule_finalizer_drain / tsfn use).
void schedule_complete(napi_async_work work) {
    if (work->complete_source != nullptr) {
        return;  // already armed — never double-schedule a single work
    }
    GSource* src = g_idle_source_new();
    // uv_async parity: the loop checks its event queue every turn, so run the
    // completion promptly rather than at idle-starvation priority.
    g_source_set_priority(src, G_PRIORITY_DEFAULT);
    g_source_set_name(src, "gjsify-napi async_work complete");
    g_source_set_callback(src, complete_dispatch_cb, work, nullptr);
    work->complete_source = src;  // keep the creation ref until dispatch/teardown
    g_source_attach(src, g_main_context_default());
}

// Run the completion callback with JS callable (Node AfterThreadPoolWork:
// HandleScope + CallbackScope + CallbackIntoModule<true>). A null complete is a
// no-op (Node returns early). The env==torn-down path still calls complete so
// the addon can free `data`, but opens no handle scope and enters no JS — the
// EmptyQueueAndDelete posture shared with tsfn. WARNING: complete may delete the
// work; the caller must not touch it afterwards.
void run_complete(napi_async_work work, napi_status status) {
    napi_env env = work->env;
    napi_async_complete_callback complete = work->complete;
    void* payload = work->data;
    if (complete == nullptr) {
        return;
    }
    const bool can_call =
        env != nullptr && env->can_call_into_js && !env->torn_down;
    if (!can_call) {
        complete(env, status, payload);
        return;
    }
    napi_handle_scope scope = nullptr;
    napi_open_handle_scope(env, &scope);
    complete(env, status, payload);
    log_and_clear_pending_exception(env, "async-work complete callback");
    napi_close_handle_scope(env, scope);
}

// The JS-thread complete dispatch (Node's AfterThreadPoolWork on the loop).
// Drops the source, marks the work complete, then runs the callback exactly
// once — after which the work may be gone (self-deleted), so it is never
// touched again.
gboolean complete_dispatch_cb(gpointer data) {
    auto work = static_cast<napi_async_work>(data);
    const napi_status status =
        work->state == napi_async_work__::State::kCancelledPending
            ? napi_cancelled
            : napi_ok;
    // Drop our creation ref; the context's ref dies with SOURCE_REMOVE. Null it
    // first so a self-delete inside complete does not re-free the source.
    if (work->complete_source != nullptr) {
        g_source_unref(work->complete_source);
        work->complete_source = nullptr;
    }
    work->state = napi_async_work__::State::kComplete;
    run_complete(work, status);  // may delete `work` — do not touch it after
    return G_SOURCE_REMOVE;
}

// Unlink a work from its env's registry (no-op if absent).
void unregister_async_work(napi_env env, napi_async_work work) {
    auto& list = env->async_works;
    list.erase(std::remove(list.begin(), list.end(), work), list.end());
}

}  // namespace

// Env teardown step 1c (env.cc): run every still-pending completion
// synchronously, JS callable — the deferred g_idle can no longer fire once
// GjsContext dispose began (mirror finalize_env_tsfns). Each pass picks the
// next work whose complete is still pending; marking kComplete before running
// it (and completes self-deleting) makes the scan terminate. Works whose
// complete already ran, or that were created-but-never-queued, are freed by
// destroy_env_async_works at env destruction.
void drain_env_async_works(napi_env env) {
    for (;;) {
        napi_async_work work = nullptr;
        for (napi_async_work w : env->async_works) {
            if (w->state == napi_async_work__::State::kQueued ||
                w->state == napi_async_work__::State::kCancelledPending) {
                work = w;
                break;
            }
        }
        if (work == nullptr) {
            break;
        }
        const napi_status status =
            work->state == napi_async_work__::State::kCancelledPending
                ? napi_cancelled
                : napi_ok;
        if (work->complete_source != nullptr) {
            g_source_destroy(work->complete_source);
            g_source_unref(work->complete_source);
            work->complete_source = nullptr;
        }
        // Mark BEFORE running: complete may self-delete (unlinks + frees), and a
        // work it does NOT delete must not be revisited by the next scan.
        work->state = napi_async_work__::State::kComplete;
        run_complete(work, status);  // may delete `work` — do not touch after
    }
}

// Env destruction (~napi_env__, after teardown, no JS runs anymore): free every
// remaining work. Self-deleted works were already unlinked, so nothing here can
// double-free; a work the addon never deleted is freed now (Node leaks its
// equivalent — the struct is addon-owned there).
void destroy_env_async_works(napi_env env) {
    for (napi_async_work work : env->async_works) {
        delete work;
    }
    env->async_works.clear();
}

}  // namespace gjsify_napi

// ---- ABI ----

// Node napi_create_async_work: allocate the work, capture the callbacks + data,
// register it on the env. async_resource / async_resource_name are async-hooks
// naming with no GJS equivalent (as with tsfn's async_resource) — validated,
// then ignored.
napi_status NAPI_CDECL napi_create_async_work(
    napi_env env, napi_value async_resource, napi_value async_resource_name,
    napi_async_execute_callback execute, napi_async_complete_callback complete,
    void* data, napi_async_work* result) {
    (void)async_resource;
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, async_resource_name);
    GJSIFY_NAPI_CHECK_ARG(env, execute);
    GJSIFY_NAPI_CHECK_ARG(env, result);

    auto work = new napi_async_work__();
    work->env = env;
    work->execute = execute;
    work->complete = complete;
    work->data = data;
    env->async_works.push_back(work);

    *result = work;
    return gjsify_napi::clear_last_error(env);
}

// Node napi_delete_async_work: free the work. Node parity — addons delete inside
// complete, so this must tolerate a still-registered OR already-unlinked work.
// Unregister (no-op if the complete dispatch already removed it) then free.
napi_status NAPI_CDECL napi_delete_async_work(napi_env env,
                                              napi_async_work work) {
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, work);
    gjsify_napi::unregister_async_work(env, work);
    delete work;  // ~napi_async_work__ destroys any lingering source
    return gjsify_napi::clear_last_error(env);
}

// Node napi_queue_async_work: run the worker phase, then schedule completion.
// Under the GJS host `execute` runs INLINE (it enters no JS — the ABI contract),
// then `complete` is dispatched on the next main-loop turn (see file header). A
// work cancelled before it was queued runs complete with napi_cancelled and
// skips execute entirely.
napi_status NAPI_CDECL napi_queue_async_work(node_api_basic_env basic_env,
                                             napi_async_work work) {
    napi_env env = const_cast<napi_env>(basic_env);
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, work);

    if (work->state == napi_async_work__::State::kCancelledPending) {
        // Cancelled before queue: no execute; the dispatch reads the state and
        // completes with napi_cancelled.
        gjsify_napi::schedule_complete(work);
        return gjsify_napi::clear_last_error(env);
    }
    if (work->state != napi_async_work__::State::kCreated) {
        // Already queued / completed — re-queuing a work is a caller error.
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }

    // Worker phase, inline on the main thread. `execute` enters no JS, so this
    // races nothing; it is the one call that blocks the loop (documented).
    if (work->execute != nullptr) {
        work->execute(env, work->data);
    }
    work->state = napi_async_work__::State::kQueued;
    gjsify_napi::schedule_complete(work);
    return gjsify_napi::clear_last_error(env);
}

// Node napi_cancel_async_work: cancel a not-yet-started work. Under inline
// execute the only window in which a work has NOT started is BEFORE queue, so a
// created work is marked cancelled (its eventual completion reports
// napi_cancelled); a work already queued (execute has run) or completed cannot
// be cancelled → napi_generic_failure, exactly Node's uv_cancel-on-a-running-
// item (UV_EBUSY) result.
napi_status NAPI_CDECL napi_cancel_async_work(node_api_basic_env basic_env,
                                              napi_async_work work) {
    napi_env env = const_cast<napi_env>(basic_env);
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, work);
    if (work->state != napi_async_work__::State::kCreated) {
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    work->state = napi_async_work__::State::kCancelledPending;
    return gjsify_napi::clear_last_error(env);
}
