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
// THE HOST REALIZATION — GThreadPool worker + GMainContext dispatch:
// GJS owns exactly one JSContext on one thread, but a napi worker phase enters
// no JS, so it can run on a real pooled thread. This shim gives each env a
// GThreadPool (libuv-thread-pool analog, sized after UV_THREADPOOL_SIZE):
//   - `napi_queue_async_work` pushes the work onto the pool and RETURNS (true
//     concurrency — the loop no longer blocks during `execute`, the one
//     divergence the earlier inline model documented). A pooled WORKER thread
//     runs `execute(env, data)`; it enters no JSAPI and touches no GObject (the
//     ABI contract), so it races nothing on the JS thread.
//   - on completion the worker marshals `complete` back to the JS thread via a
//     g_idle GSource attached to the env's GMainContext — EXACTLY the machinery
//     tsfn.cc's cross-thread dispatch uses. `g_source_attach` is thread-safe
//     (takes the context lock, wakes its eventfd, runs no JSAPI), and the source
//     only ever DISPATCHES on the thread iterating the context (the JS thread).
//     `complete` runs there under a fresh handle scope, guarded by
//     can_call_into_js, pending exception logged-and-cleared — the "no JS frame
//     below a loop-dispatched callback" posture shared with the finalizer
//     pipeline and tsfn. The completion fires ASYNCHRONOUSLY, a loop turn after
//     queue returns, exactly as callers depend on.
//
// THE MUTEX: `state` + `complete_source` + `complete_status` are touched by the
// JS thread (create/queue/cancel/dispatch/teardown) AND a pool worker, so a
// per-work GMutex serializes them. It is NEVER held across `execute` (long,
// unbounded) nor across `complete`/any JS call (may run arbitrary JS →
// self-delete) — the tsfn "lock never spans call_js" discipline. The
// JS↔worker race that decides cancel lives entirely inside that lock: whoever
// claims the work first (worker → kExecuting, cancel → kCancelled) wins, so
// cancel is EBUSY iff the worker already started (Node's uv_cancel semantics).
//
// An AsyncWork holds NO JS values (execute/complete/data are plain C pointers;
// any napi_ref the addon needs lives on the env's ref list, traced there), so —
// unlike tsfn/Reference — it needs no GC root and no weak-sweep interaction.
// Its only lifetime hazards are the pending GSource and the worker; both are
// handled the tsfn way (source owned until dispatch/teardown; worker joined at
// teardown before any root drops).
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
// Teardown (§5e crash-class boundary): at env teardown the pool is drained
// deterministically — g_thread_pool_free(pool, immediate=FALSE, wait=TRUE) lets
// every in-flight/queued execute finish and JOINS every worker (a happens-before
// barrier: the worker's writes are then visible on the JS thread, and no worker
// can touch a work or the env again). Only THEN are the still-pending completions
// run synchronously, JS still callable (drain_env_async_works) — the same
// discipline finalize_env_tsfns uses, because the deferred g_idle can no longer
// fire once GjsContext dispose began. An async_work must not outlive the env; a
// worker must not touch a torn-down env.

#include "common.h"

#include <algorithm>

// Global scope: the struct tag is fixed by the vendored
// `typedef struct napi_async_work__* napi_async_work`.
struct napi_async_work__ {
    // Lifecycle state. Transitions cross the JS thread ↔ pool worker boundary,
    // so all reads/writes are under `mutex` (except at teardown, after the pool
    // join has re-established single-threadedness).
    enum class State : uint8_t {
        kCreated,          // created, not yet queued (no uv request → cancel EINVAL)
        kQueued,           // pushed to the pool; no worker has started execute
        kExecuting,        // a worker is running execute (cancel now → EBUSY)
        kCancelled,        // cancelled while queued; the worker will skip execute
        kCompletePending,  // execute ran (or was skipped); a complete dispatch is armed
        kComplete,         // complete has been dispatched (may already be freed)
    };

    napi_env env = nullptr;               // owning env (outlives the work)
    napi_async_execute_callback execute = nullptr;  // worker-phase, NO JS
    napi_async_complete_callback complete = nullptr;  // main-phase, may run JS
    void* data = nullptr;                 // addon-owned payload

    // Guards state + complete_source + complete_status across JS thread/worker.
    GMutex mutex;
    State state = State::kCreated;
    // Set by the worker (napi_ok) or by the worker for a cancelled item
    // (napi_cancelled); read by the JS-thread dispatch. Guarded by mutex.
    napi_status complete_status = napi_ok;
    // The env's dispatch surface (default GMainContext, ref held) — captured on
    // the JS thread at create so the worker never calls g_main_context_default().
    GMainContext* main_context = nullptr;
    // The pending main-loop complete dispatch (creation ref held until the
    // dispatch runs or teardown/free destroys it — tsfn dispatch_source
    // discipline). Armed by the worker, dropped on the JS thread.
    GSource* complete_source = nullptr;

    napi_async_work__() { g_mutex_init(&mutex); }

    ~napi_async_work__() {
        // Defensive: a live source here would fire into freed memory. In every
        // normal path complete_source is already null (the dispatch, free or
        // teardown cleared it) — this only bites a pathological free. By the
        // time a work is freed, its worker is done (joined at teardown, or the
        // work reached kComplete), so no thread races this.
        if (complete_source != nullptr) {
            g_source_destroy(complete_source);
            g_source_unref(complete_source);
            complete_source = nullptr;
        }
        if (main_context != nullptr) {
            g_main_context_unref(main_context);
        }
        g_mutex_clear(&mutex);
    }
};

namespace gjsify_napi {
namespace {

gboolean complete_dispatch_cb(gpointer data);

// libuv's UV_THREADPOOL_SIZE (default 4, clamped [1, 1024]). TestCancel relies
// on the pool being SMALLER than MAX_CANCEL_THREADS (6): it saturates the pool
// with sleeping works so the cancel target stays queued. Reading the same env
// var libuv reads keeps the Node reference and the shim in lockstep.
int async_pool_max_threads() {
    int n = 4;
    const char* size = g_getenv("UV_THREADPOOL_SIZE");
    if (size != nullptr) {
        const gint64 parsed = g_ascii_strtoll(size, nullptr, 10);
        if (parsed > 0) {
            n = static_cast<int>(parsed);
        }
    }
    if (n < 1) n = 1;
    if (n > 1024) n = 1024;
    return n;
}

// Arm the JS-thread complete dispatch. Caller holds work->mutex. Safe from the
// worker thread: pure GLib, no JSAPI (see file header) — g_source_attach takes
// the context lock and wakes it; the source dispatches only on the JS thread.
void schedule_complete_locked(napi_async_work work) {
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
    g_source_attach(src, work->main_context);
}

// The pool worker phase (Node's uvimpl::Work::ExecuteCallback on a libuv worker
// thread). Runs OFF the JS thread; enters no JSAPI, touches no GObject. Claims
// the work under the lock (kQueued → kExecuting, so a concurrent cancel now
// returns EBUSY) or, if cancel won the race (kCancelled), skips execute. The
// lock is released across `execute` (unbounded) and re-taken only to record the
// status + arm the JS-thread completion.
void pool_worker(gpointer data, gpointer /* user_data */) {
    auto work = static_cast<napi_async_work>(data);
    napi_env env = work->env;

    g_mutex_lock(&work->mutex);
    if (work->state == napi_async_work__::State::kCancelled) {
        // Cancel won the race before any worker started this item (Node's
        // uv_cancel-on-a-queued-work → the after-cb runs with UV_ECANCELED).
        work->complete_status = napi_cancelled;
        work->state = napi_async_work__::State::kCompletePending;
        schedule_complete_locked(work);
        g_mutex_unlock(&work->mutex);
        return;
    }
    work->state = napi_async_work__::State::kExecuting;
    napi_async_execute_callback execute = work->execute;
    void* payload = work->data;
    g_mutex_unlock(&work->mutex);  // execute must run with NO lock held

    if (execute != nullptr) {
        execute(env, payload);  // worker phase — NO JS, NO GObject (ABI contract)
    }

    g_mutex_lock(&work->mutex);
    work->complete_status = napi_ok;
    work->state = napi_async_work__::State::kCompletePending;
    schedule_complete_locked(work);
    g_mutex_unlock(&work->mutex);
    // Do NOT touch `work` after unlock: the JS-thread dispatch may already have
    // run complete and self-deleted it.
}

// Run the completion callback with JS callable (Node AfterThreadPoolWork:
// HandleScope + CallbackScope + CallbackIntoModule<true>). NO lock held. A null
// complete is a no-op (Node returns early). The env==torn-down path still calls
// complete so the addon can free `data`, but opens no handle scope and enters no
// JS — the EmptyQueueAndDelete posture shared with tsfn. WARNING: complete may
// delete the work; the caller must not touch it afterwards.
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
// Under the lock: drop the source, snapshot the status, mark kComplete. Then
// RELEASE the lock and run the callback exactly once — the lock is never held
// across JS (self-delete would clear a held mutex), and after complete the work
// may be gone, so it is never touched again.
gboolean complete_dispatch_cb(gpointer data) {
    auto work = static_cast<napi_async_work>(data);
    g_mutex_lock(&work->mutex);
    // Drop our creation ref; the context's ref dies with SOURCE_REMOVE. Null it
    // first so a self-delete inside complete does not re-free the source.
    if (work->complete_source != nullptr) {
        g_source_unref(work->complete_source);
        work->complete_source = nullptr;
    }
    const napi_status status = work->complete_status;
    work->state = napi_async_work__::State::kComplete;
    g_mutex_unlock(&work->mutex);
    run_complete(work, status);  // may delete `work` — do not touch it after
    return G_SOURCE_REMOVE;
}

// Unlink a work from its env's registry (no-op if absent).
void unregister_async_work(napi_env env, napi_async_work work) {
    auto& list = env->async_works;
    list.erase(std::remove(list.begin(), list.end(), work), list.end());
}

// Lazily create the env's worker pool. Refuses once teardown has begun so an
// async_work can never outlive the env (a pool recreated after the teardown
// drain would run a worker into a disposing context). Exclusive pool: threads
// are dedicated + created eagerly, so g_thread_pool_free joins them
// deterministically (clean valgrind, no lingering shared idle threads).
GThreadPool* ensure_env_pool(napi_env env) {
    if (env->tearing_down || env->torn_down) {
        return nullptr;
    }
    if (env->async_pool == nullptr) {
        env->async_pool = g_thread_pool_new(pool_worker, nullptr,
                                            async_pool_max_threads(),
                                            /* exclusive = */ TRUE, nullptr);
    }
    return env->async_pool;
}

}  // namespace

// Env teardown step 1c (env.cc), the §5e crash-class boundary. FIRST join the
// pool: g_thread_pool_free(immediate=FALSE, wait=TRUE) runs every queued/in-
// flight execute to completion and joins all workers — after it returns the
// process is single-threaded again, every worker's writes are visible here, and
// nothing off-thread can touch a work or the (tearing-down) env. THEN run each
// still-pending completion synchronously, JS callable, because the deferred
// g_idle can no longer fire once GjsContext dispose began (mirror
// finalize_env_tsfns). No lock is needed below the join.
void drain_env_async_works(napi_env env) {
    if (env->async_pool != nullptr) {
        // wait=TRUE: block here until in-flight execute finishes + workers join.
        // This is what keeps a worker from touching a torn-down env.
        g_thread_pool_free(env->async_pool, /* immediate = */ FALSE,
                           /* wait = */ TRUE);
        env->async_pool = nullptr;
    }
    for (;;) {
        napi_async_work work = nullptr;
        for (napi_async_work w : env->async_works) {
            // Post-join: workers are all gone, so plain reads are safe. Every
            // work is now kCompletePending, kComplete (dispatch already ran) or
            // kCreated (never queued); only the first still needs completing.
            if (w->state == napi_async_work__::State::kCompletePending) {
                work = w;
                break;
            }
        }
        if (work == nullptr) {
            break;
        }
        const napi_status status = work->complete_status;
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
// equivalent — the struct is addon-owned there). The pool is already gone
// (drained at teardown); the guard is defensive for a partial-init env.
void destroy_env_async_works(napi_env env) {
    if (env->async_pool != nullptr) {
        g_thread_pool_free(env->async_pool, /* immediate = */ TRUE,
                           /* wait = */ TRUE);
        env->async_pool = nullptr;
    }
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
    // The GJS host loop iterates the GLOBAL default main context (the same
    // surface the §5c finalizer drain + tsfn dispatch target). Ref it on the JS
    // thread so the worker reads a stable, owned pointer.
    work->main_context = g_main_context_ref(g_main_context_default());
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

// Node napi_queue_async_work: hand the work to the env's worker pool. A pooled
// thread runs `execute` (NO JS — the ABI contract), then marshals `complete`
// back to the JS thread on the next loop turn (see file header). Re-queuing a
// work, or queuing after teardown began, is a caller error → generic_failure.
napi_status NAPI_CDECL napi_queue_async_work(node_api_basic_env basic_env,
                                             napi_async_work work) {
    napi_env env = const_cast<napi_env>(basic_env);
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, work);

    GThreadPool* pool = gjsify_napi::ensure_env_pool(env);
    if (pool == nullptr) {
        // Teardown began (or the pool failed to allocate) — cannot accept work.
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }

    g_mutex_lock(&work->mutex);
    if (work->state != napi_async_work__::State::kCreated) {
        // Already queued / completed — re-queuing a work is a caller error.
        g_mutex_unlock(&work->mutex);
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    work->state = napi_async_work__::State::kQueued;
    g_mutex_unlock(&work->mutex);

    // Enqueue onto the pool. For an exclusive pool the worker threads already
    // exist, so this only appends to the async queue (never spawns) — the GError
    // out-param would only report a thread-create failure, which cannot occur
    // here; the host owns thread provisioning (as Node owns libuv's).
    g_thread_pool_push(pool, work, nullptr);
    return gjsify_napi::clear_last_error(env);
}

// Node napi_cancel_async_work: cancel a not-yet-STARTED work. Semantics mirror
// Node's uv_cancel exactly:
//   - kQueued (in the pool, no worker has claimed it) → napi_ok; the worker will
//     later dequeue it, skip execute, and complete with napi_cancelled (uv's
//     queued-work-removed → UV_ECANCELED after-callback);
//   - kCreated (never queued → no uv request) → generic_failure (uv EINVAL);
//   - kExecuting / kCompletePending / kComplete (already running or done) →
//     generic_failure (uv EBUSY).
// The JS-thread cancel races the worker's claim under the SAME lock, so exactly
// one of them transitions kQueued: cancel loses (EBUSY) iff the worker already
// flipped kExecuting.
napi_status NAPI_CDECL napi_cancel_async_work(node_api_basic_env basic_env,
                                              napi_async_work work) {
    napi_env env = const_cast<napi_env>(basic_env);
    GJSIFY_NAPI_CHECK_ENV(env);
    GJSIFY_NAPI_CHECK_ARG(env, work);
    g_mutex_lock(&work->mutex);
    if (work->state != napi_async_work__::State::kQueued) {
        g_mutex_unlock(&work->mutex);
        return gjsify_napi::set_last_error(env, napi_generic_failure);
    }
    work->state = napi_async_work__::State::kCancelled;
    g_mutex_unlock(&work->mutex);
    return gjsify_napi::clear_last_error(env);
}
