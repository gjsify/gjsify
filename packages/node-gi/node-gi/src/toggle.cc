// SPDX-License-Identifier: MIT
// Toggle-ref instance GC bridge (canonical GObject wrappers) + the TEST-ONLY cross-thread GC stress hooks.

#include "common.h"

namespace nodegi {

// ====================================================================
// ---- toggle-ref instance GC bridge ---------------------------------
// ====================================================================
//
// Derivation: refs/node-gtk src/gobject.cc (romgrk et al., MIT, the #446/#439
// ownership fixes) + refs/gjs gi/{object.cpp,toggle.{h,cpp}} (the thread-safe
// ToggleQueue gold standard), ported to N-API. See scratchpad design doc.
//
// One canonical, type-tagged External per live GObject, cached on the GObject as
// qdata. The binding owns a SINGLE g_object_add_toggle_ref; the toggle-notify
// flips the cached External's napi_ref between STRONG (C also holds the object →
// rooted, survives GC) and WEAK (JS is the sole owner → collectable). This gives:
//   (a) wrapper IDENTITY — same GObject ⇒ same External ⇒ `===` + Map-key stable;
//   (b) collectability of reference cycles;
//   (c) resurrection — a GObject handed back from C re-wraps to a fresh wrapper
//       after its old one was collected, without clobbering a pending teardown.
//
// Crash-mode discipline (the three the design calls out):
//   1. N-API finalizers run OUTSIDE GC, but g_object_remove_toggle_ref can drive
//      dispose → synchronous signal emission → re-entrant JS, which is unsafe
//      from a finalizer / non-main thread. So the finalizer ONLY schedules a
//      g_idle_add teardown; ALL GObject teardown runs from that main-loop idle.
//   2. Toggle-up on a maybe-collected wrapper probes napi_get_reference_value;
//      empty ⇒ skip (a later WrapGObject resurrects). No during-GC flag dance is
//      needed — N-API finalizers are post-GC.
//   3. Cross-thread toggles + double-free: off-thread toggles are marshalled to
//      the JS thread via a mutex-guarded queue drained on the GLib main context;
//      a g_object_weak_ref net DETACHES the record from the object the moment glib
//      says we may not touch it again (clearing qdata only if it still points at
//      THIS wrapper — resurrection-safe); a shutdown flag disables toggles at
//      teardown. The detach happens IN the weak notify, not in the teardown that
//      follows it — see OnGObjectFinalized for why, and for what it costs.

static GQuark NodeGiWrapperQuark() {
  static GQuark q = g_quark_from_static_string("node-gi::wrapper");
  return q;
}

// WHICH FIELDS g_queue_mutex PROTECTS, AND WHO TOUCHES THEM.
//   `env` is written once at construction and never again — read from any thread.
//   `handle_ref`, `rooted` and `teardown_queued`/`settled` are JS-THREAD ONLY by
//   construction: only ApplyToggle (always on the drain/JS thread), the External's
//   finalizer and the resurrection path write them.
//   `gobject` and `toggle_added` are the CROSS-THREAD pair and are guarded by
//   g_queue_mutex: OnGObjectFinalized clears them from whatever thread drops the
//   object's last ref (or calls g_object_run_dispose), while RunTeardown and
//   SettleCollectedInstance read them on the JS thread. The lock does more than
//   order those writes — see OnGObjectFinalized for why an atomic would not do.
struct NodeGiInstance {
  napi_env env;
  GObject* gobject;        // g_queue_mutex; cleared by the weak-ref net (see below)
  napi_ref handle_ref;     // ref to the canonical External; strong=rooted, weak=not
  bool rooted;             // true ⇒ handle_ref currently strong (mirrors node-gtk !dying)
  bool toggle_added;       // g_queue_mutex; a REMOVABLE toggle ref is installed
  bool teardown_queued;    // the External's finalizer HAS RUN (and queued the teardown)
  bool settled;            // resurrection detached this record; the pending finalizer frees it
};

// The single N-API env that OWNS the toggle machinery (qdata cache + global drain
// queues + drain async). Claimed by the FIRST env that wraps a GObject. A second
// env (a worker_threads Worker on another thread) must NOT touch this env's
// napi_refs (cross-env = UAF) nor its qdata cache / queues, so its wraps take the
// plain strong-ref path (no identity / GC-bridge, but safe). Atomic: read lock-free
// in MakeGObjectHandle, claimed once via compare_exchange there.
std::atomic<napi_env> g_owner_env{nullptr};

// JS/main thread id of the owner env (captured at first wrap in EnsureDrainAsync).
// napi_reference_ref/unref are only valid there; off-thread toggles are queued +
// drained on the main context.
static std::thread::id g_main_thread_id;
static bool g_main_thread_id_set = false;
static bool OnMainThread() {
  return g_main_thread_id_set && std::this_thread::get_id() == g_main_thread_id;
}

// Set at env cleanup: ToggleNotify early-returns so no toggle touches a
// torn-down env (GJS's gjs_object_shutdown_toggle_queue equivalent).
std::atomic<bool> g_toggle_shutdown{false};

// ---- env-teardown safety helpers --------------------------------------------

// See common.h. The probe is the load-bearing gate for the RunCleanup race: the
// drain TSFN can legally be dispatched by Environment::RunCleanup()'s FIRST
// CleanupHandles() (env.cc — it runs uv_run BEFORE cleanup_queue_.Drain(), i.e.
// BEFORE OnEnvShutdown flips g_toggle_shutdown), at a point where FreeEnvironment
// has already set can_call_into_js=false. The shutdown flag alone can therefore
// never close that window — only an env-liveness probe at dispatch time can.
bool NodeGiJsAvailable(napi_env env) {
  if (env == nullptr) return false;
  napi_value undef = nullptr;
  if (napi_get_undefined(env, &undef) != napi_ok) return false;
  bool eq = false;
  return napi_strict_equals(env, undef, undef, &eq) == napi_ok;
}

bool NodeGiToggleDebugEnabled() {
  static const bool enabled = [] {
    const char* v = g_getenv("NODE_GI_TOGGLE_DEBUG");
    return v != nullptr && *v != '\0' && g_strcmp0(v, "0") != 0;
  }();
  return enabled;
}

void NodeGiToggleDebugLog(const char* fmt, ...) {
  if (!NodeGiToggleDebugEnabled()) return;
  va_list args;
  va_start(args, fmt);
  gchar* msg = g_strdup_vprintf(fmt, args);
  va_end(args);
  g_printerr("(node-gi:toggle) [thread %p] %s\n", static_cast<void*>(g_thread_self()), msg);
  g_free(msg);
}

// TEST-ONLY latency seam (env NODE_GI_TOGGLE_TEARDOWN_DELAY_MS, parsed once,
// clamped to 10s, zero cost when unset): the drain does not process a queued
// teardown younger than this, re-waking itself instead. That deterministically
// reproduces the shutdown race the probe above fixes — a teardown queued within
// the window before loop exit stays queued WITH a pending TSFN wake, so
// RunCleanup's CleanupHandles() dispatches the drain against the dying env.
// Regression tool for test/gc-cross-thread.test.mjs; never set in production.
static int TeardownDelayMs() {
  static const int ms = [] {
    const char* v = g_getenv("NODE_GI_TOGGLE_TEARDOWN_DELAY_MS");
    if (v == nullptr || *v == '\0') return 0;
    long n = strtol(v, nullptr, 10);
    if (n < 0) n = 0;
    if (n > 10000) n = 10000;
    return static_cast<int>(n);
  }();
  return ms;
}

// Deferred-work queues, drained on the JS thread by a Node-API threadsafe function.
//
// Why a threadsafe function, not g_idle_add: a GLib idle only runs while the GLib
// default context is iterated, which in pure Node/Bun/Deno usage (a script that
// never runs a GLib loop) NEVER happens → idle teardowns pile up and the GObjects
// leak. napi_call_threadsafe_function schedules a drain on the JS event loop,
// which turns in ALL modes: plain Node/Bun/Deno (the runtime loop runs on its
// own) and, on Node, a blocking GLib loop (the uv_source bridge below pumps
// uv_run(NOWAIT), and Node implements the TSFN over a uv_async, so that pump
// dispatches the drain too). The TSFN is napi_unref'd so it never keeps the
// process alive on its own.
//
// Why NOT node-gtk's raw uv_async_t: uv_async_init / uv_async_send / uv_unref /
// uv_close are libuv-internal — Deno exports no libuv symbols (the addon dies with
// "undefined symbol: uv_unref") and Bun panics on uv_async_init (oven-sh/bun#18546).
// The threadsafe function is core Node-API, implemented by all three runtimes, so
// the GC bridge — the FIRST thing every GObject creation arms — is portable.
//
// Two queues share one mutex: TOGGLES (off-thread toggle-notifies marshalled to
// the JS thread — the rare GIO/GStreamer-worker path) and TEARDOWNS (wrappers
// whose External was finalized; the finalizer must not touch GObject directly).
struct ToggleItem {
  NodeGiInstance* inst;
  bool down;  // true = toggle-down (→ weak), false = toggle-up (→ strong)
};
// RECURSIVE (defensive, mirrors GJS's recursive ToggleQueue lock). The lock is held
// only across SHORT critical sections — never across RunTeardown's dispose → JS (the
// drain pops one item under the lock, RELEASES it, then processes; see DrainTsfnCb).
// So a reentrant SettleCollectedInstance / NodeGiToggleNotify fired from a dispose
// re-acquires the lock as a FRESH (non-nested) acquire today. Keeping it recursive
// guarantees that even if a future change widens a critical section a same-thread
// re-acquire can never self-deadlock; it does not weaken the no-lock-across-dispose
// invariant the liveness test enforces.
std::recursive_mutex g_queue_mutex;
static std::deque<ToggleItem> g_toggle_queue;
// Teardowns carry their enqueue time so the TEST-ONLY latency seam
// (NODE_GI_TOGGLE_TEARDOWN_DELAY_MS, see TeardownDelayMs) can defer young ones.
struct TeardownItem {
  NodeGiInstance* inst;
  gint64 enqueued_us;  // g_get_monotonic_time() at enqueue
};
static std::deque<TeardownItem> g_teardown_queue;
napi_threadsafe_function g_drain_tsfn = nullptr;
bool g_drain_async_inited = false;
static napi_env g_async_env = nullptr;  // captured for the drain callback's shutdown checks

static void DrainTsfnCb(napi_env env, napi_value js_callback, void* context, void* data);
static void NodeGiToggleNotify(gpointer, GObject*, gboolean);
static void OnGObjectFinalized(gpointer, GObject*);

// Lazily init the drain threadsafe function on the JS thread (the only legal
// thread for napi_create_threadsafe_function). Called only by the OWNER env's
// MakeGObjectHandle (the multi-env gate runs first), so it runs serially on one
// thread — hence before any object exists, and before any toggle or teardown can
// be queued. The flag + g_drain_tsfn are read off-thread (WakeDrain), so they are
// written under g_queue_mutex.
static void EnsureDrainAsync(napi_env env) {
  {
    std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
    if (g_drain_async_inited) return;
  }
  // A threadsafe function delivers the wake onto the JS thread. max_queue_size 1
  // coalesces bursts (a second wake while one is pending returns napi_queue_full,
  // which WakeDrain ignores — the pending drain empties the whole item queue
  // anyway); initial_thread_count 1 keeps it alive for the env lifetime so any
  // thread may call it without acquiring. js_func is null — DrainTsfnCb IS the
  // callback, and the TSFN infra invokes it inside a handle + callback scope, so
  // the JS re-entry during dispose (signal emission via napi_make_callback) runs
  // as a proper N-API callback with no manually-managed napi_async_context.
  napi_value name = nullptr;
  napi_create_string_utf8(env, "node-gi:toggle-drain", NAPI_AUTO_LENGTH, &name);
  napi_threadsafe_function tsfn = nullptr;
  napi_status st = napi_create_threadsafe_function(
      env, nullptr, nullptr, name, /*max_queue_size*/ 1, /*initial_thread_count*/ 1,
      nullptr, nullptr, nullptr, DrainTsfnCb, &tsfn);
  if (st != napi_ok || tsfn == nullptr) return;
  // Don't keep the event loop alive just because the drain machinery exists
  // (the uv_unref equivalent). Best-effort — harmless if a runtime no-ops it.
  napi_unref_threadsafe_function(env, tsfn);
  {
    std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
    g_async_env = env;
    g_drain_tsfn = tsfn;
    // This env owns the machinery; its thread is the JS/main thread for toggles.
    g_main_thread_id = std::this_thread::get_id();
    g_main_thread_id_set = true;
    g_drain_async_inited = true;
  }
  if (NodeGiToggleDebugEnabled())
    NodeGiToggleDebugLog("owner env %p claimed toggle machinery; drain TSFN %p created",
                         static_cast<void*>(static_cast<napi_env>(env)),
                         static_cast<void*>(tsfn));
}

// Wake the JS-thread drain. Holds g_queue_mutex and re-checks both the init flag
// and the shutdown flag immediately before the call, paired with OnEnvShutdown's
// locked flag-flip-before-release — so an off-thread toggle can never call a TSFN
// that is being / has been released (the shutdown TOCTOU that aborted libuv).
static void WakeDrain() {
  std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
  if (g_drain_async_inited && g_drain_tsfn != nullptr && !g_toggle_shutdown.load()) {
    // nonblocking + max_queue_size 1 ⇒ coalesces; napi_queue_full is the
    // "a drain is already pending" no-op (it will pick up this item too).
    napi_call_threadsafe_function(g_drain_tsfn, nullptr, napi_tsfn_nonblocking);
  } else if (NodeGiToggleDebugEnabled()) {
    NodeGiToggleDebugLog("wake skipped: inited=%d tsfn=%p shutdown=%d",
                         g_drain_async_inited ? 1 : 0, static_cast<void*>(g_drain_tsfn),
                         g_toggle_shutdown.load() ? 1 : 0);
  }
}

// Apply a toggle on the JS thread: flip the canonical napi_ref strong↔weak.
// Only flips on a real state transition (mirrors node-gtk's dying flag) and
// probes liveness before touching a possibly-collected handle (crash mode 2).
static void ApplyToggle(NodeGiInstance* inst, bool down) {
  if (down) {
    if (!inst->rooted) return;  // already weak
    napi_value v = nullptr;
    if (napi_get_reference_value(inst->env, inst->handle_ref, &v) == napi_ok && v != nullptr) {
      uint32_t r = 0;
      napi_reference_unref(inst->env, inst->handle_ref, &r);  // strong → weak
    }
    inst->rooted = false;
  } else {
    if (inst->rooted) return;  // already strong
    napi_value v = nullptr;
    if (napi_get_reference_value(inst->env, inst->handle_ref, &v) == napi_ok && v != nullptr) {
      uint32_t r = 0;
      napi_reference_ref(inst->env, inst->handle_ref, &r);  // weak → strong
      inst->rooted = true;
    }
    // empty ⇒ the wrapper was already collected; a later WrapGObject resurrects.
  }
}

// Sever every link between a GObject and a wrapper record: after this, nothing can
// reach `inst` from `obj` on any thread. Clearing qdata is what keeps a LIVE GObject
// from outliving its record with a dangling pointer in it (see OnGObjectFinalized).
//
// CALLER MUST HOLD g_queue_mutex, and `obj` must be valid FOR THE DURATION OF THE
// CALL. Each caller has its own warrant for that: the weak-ref net is handed the
// object while it is still addressable, RunTeardown reads inst->gobject under this
// lock, and SettleCollectedInstance is passed the caller's construction ref.
static void DetachInstanceLocked(NodeGiInstance* inst, GObject* obj) {
  if (obj != nullptr && g_object_get_qdata(obj, NodeGiWrapperQuark()) == inst) {
    g_object_set_qdata(obj, NodeGiWrapperQuark(), nullptr);
  }
  for (auto it = g_toggle_queue.begin(); it != g_toggle_queue.end();) {
    it = (it->inst == inst) ? g_toggle_queue.erase(it) : it + 1;
  }
}

// Run one wrapper's teardown on the JS thread: drop the toggle ref (may dispose →
// emit → re-enter JS — legal here, not in a finalizer/off-thread), resurrection-
// safely, then free the wrapper.
//
// ORDER MATTERS (node-gtk's GObjectTeardownIdle): remove_toggle_ref is LAST,
// because dropping the last ref can take refcount to 0 → dispose → finalize → the
// GObject is freed; any qdata/weak op after that would touch freed memory. So:
//   (1) under the queue lock: READ inst->gobject, DetachInstanceLocked, drop the
//       weak-ref net. The same lock the off-thread enqueue path and
//       OnGObjectFinalized take, so a racing toggle either enqueues and is
//       cancelled here, or sees the cleared qdata and never enqueues. The READ
//       belongs inside it: it used to sit outside, paired with an unlocked write in
//       OnGObjectFinalized, so a stale non-null pointer was reachable here BY
//       CONSTRUCTION and `obj` could name freed memory.
//   (2) g_object_remove_toggle_ref LAST and OUTSIDE the lock (it may dispose →
//       emit → re-enter arbitrary JS, which must never run under this lock; legal
//       here on the JS thread. The object may be freed afterwards). `obj` is still
//       ours to touch there: the toggle ref we are about to remove IS a reference.
static void RunTeardown(NodeGiInstance* inst) {
  GObject* obj = nullptr;
  bool remove_toggle = false;
  {
    std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
    obj = inst->gobject;  // null once the weak-ref net has detached this record
    DetachInstanceLocked(inst, obj);
    if (obj != nullptr) {
      g_object_weak_unref(obj, OnGObjectFinalized, inst);
      remove_toggle = inst->toggle_added;
      inst->toggle_added = false;
      inst->gobject = nullptr;
    }
  }
  if (remove_toggle) g_object_remove_toggle_ref(obj, NodeGiToggleNotify, nullptr);
  if (inst->handle_ref != nullptr) napi_delete_reference(inst->env, inst->handle_ref);
  delete inst;
}

// Drain both queues on the JS/main thread. Pop ONE item from the LIVE queue UNDER
// the lock, RELEASE the lock, then process it WITHOUT the lock; loop until empty.
//
// The lock must NOT be held across RunTeardown: it calls g_object_remove_toggle_ref
// → dispose → arbitrary JS (signal/vfunc). Holding a lock across reentrant user code
// (a) STALLS an off-thread NodeGiToggleNotify (which blocks acquiring g_queue_mutex)
// for the whole dispose — a priority inversion, not a "brief" block; and (b) risks an
// ABBA deadlock if a dispose vfunc synchronously waits on a worker thread that is
// itself blocked on g_queue_mutex. GJS likewise holds its ToggleQueue lock only
// across the rooting flip (== ApplyToggle), NEVER across remove_toggle_ref + dispose.
//
// The DEFECT-2 fix is preserved: the current item is removed from the LIVE queue
// UNDER the lock BEFORE release, so it is never double-processed; and a reentrant
// SettleCollectedInstance (same drain thread, fired from a dispose) re-acquires the
// lock and still sees + cancels the OTHER pending teardowns left in the live queue
// (a swap-then-process snapshot would hide them → double-free). Toggles drain first
// (FIFO); a toggle enqueued during a teardown's dispose is picked up on the next
// iteration. Terminates when both queues are empty.
static void DrainTsfnCb(napi_env raw_env, napi_value /*js_callback*/, void* /*context*/,
                        void* /*data*/) {
  if (g_async_env == nullptr || g_toggle_shutdown.load()) return;
  // ENV-TEARDOWN GATE (the RunCleanup race): Node legally dispatches a pending
  // TSFN wake from Environment::RunCleanup()'s FIRST CleanupHandles() uv_run —
  // AFTER FreeEnvironment/ExitEnv set can_call_into_js=false, but BEFORE the env
  // cleanup hooks (OnEnvShutdown) flip g_toggle_shutdown. Processing a teardown
  // then drops the last toggle ref -> dispose -> a JS vfunc_dispose / signal
  // closure re-enters N-API on the dead env -> node-addon-api's noexcept throw
  // path -> napi_fatal_error abort. Skip instead: queued items stay put and are
  // dropped by the shutdown flag moments later (the documented leak-at-exit).
  const bool jsAvailable = NodeGiJsAvailable(raw_env);
  if (!jsAvailable) {
    if (NodeGiToggleDebugEnabled()) {
      std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
      NodeGiToggleDebugLog("drain skipped: JS unavailable on env %p (teardown/terminate); "
                           "toggles=%zu teardowns=%zu left queued",
                           static_cast<void*>(raw_env), g_toggle_queue.size(),
                           g_teardown_queue.size());
    }
    return;
  }
  Napi::Env env(raw_env);
  // The TSFN infra already invokes us on the JS thread inside a callback scope
  // (its async context), so signal emission during dispose runs as a proper
  // N-API callback with no manually-managed CallbackScope. A HandleScope is still
  // opened defensively: ApplyToggle's napi_get_reference_value and the JS re-entry
  // during teardown both create V8 handles.
  Napi::HandleScope handleScope(env);

  while (true) {
    if (g_toggle_shutdown.load()) return;
    ToggleItem toggle{nullptr, false};
    NodeGiInstance* teardown = nullptr;
    bool deferred = false;
    {
      std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
      if (g_toggle_shutdown.load()) return;
      if (!g_toggle_queue.empty()) {            // toggles first (FIFO)
        toggle = g_toggle_queue.front();
        g_toggle_queue.pop_front();
      } else if (!g_teardown_queue.empty()) {
        const TeardownItem& front = g_teardown_queue.front();
        const int delayMs = TeardownDelayMs();
        // Latency seam: defer young teardowns ONLY while the env can still run
        // JS. On a dying env there is no "later" — a deferral would just carry
        // the teardown past OnEnvShutdown (suppressing, not widening, the race
        // this seam exists to reproduce); the gate above normally returns first,
        // so jsAvailable is only ever false here in a gate-disabled experiment.
        if (delayMs > 0 && jsAvailable &&
            g_get_monotonic_time() - front.enqueued_us < static_cast<gint64>(delayMs) * 1000) {
          deferred = true;  // latency seam: too young — re-wake and retry later
        } else {
          teardown = front.inst;
          g_teardown_queue.pop_front();         // removed from the LIVE queue under the lock
        }
      } else {
        return;                                  // both queues drained
      }
    }  // lock RELEASED before any processing — never held across dispose/JS
    if (deferred) {
      if (NodeGiToggleDebugEnabled())
        NodeGiToggleDebugLog("teardown deferred by latency seam (%d ms)", TeardownDelayMs());
      WakeDrain();  // outside the lock; respects the shutdown flag
      return;
    }
    if (toggle.inst != nullptr) {
      ApplyToggle(toggle.inst, toggle.down);     // napi-only, main-thread state, no reentry
    } else {
      if (NodeGiToggleDebugEnabled())
        NodeGiToggleDebugLog("drain: run teardown inst %p (env %p)",
                             static_cast<void*>(teardown), static_cast<void*>(teardown->env));
      RunTeardown(teardown);                      // dispose → JS, NO lock held
    }
  }
}

// Queue helpers — caller MUST hold g_queue_mutex. Mirror GJS ToggleQueue::is_queued
// + ToggleQueue::enqueue (refs/gjs gi/toggle.cpp): a main-thread toggle may apply
// directly ONLY when nothing is queued for the inst; otherwise it is enqueued, and
// an OPPOSITE-direction queued toggle CANCELS with the new one (both removed). That
// cancellation is what fixes the cross-thread wrong-flip / lost-toggle bug — a
// stale queued flip can never be applied after its inverse already happened.
static bool IsQueuedLocked(NodeGiInstance* inst) {
  for (const ToggleItem& item : g_toggle_queue)
    if (item.inst == inst) return true;
  return false;
}

// Returns true iff a toggle was actually left on the queue (→ caller wakes drain).
static bool EnqueueToggleLocked(NodeGiInstance* inst, bool down) {
  for (auto it = g_toggle_queue.begin(); it != g_toggle_queue.end(); ++it) {
    if (it->inst != inst) continue;
    if (it->down != down) {
      g_toggle_queue.erase(it);  // opposite direction queued → the two cancel
      return false;
    }
    return false;  // same direction already queued → dedupe (ApplyToggle is idempotent)
  }
  g_toggle_queue.push_back({inst, down});
  return true;
}

// The single toggle-notify for every node-gi GObject. Registered with data=NULL
// (fungible — node-gtk pattern): the live wrapper is found via qdata, so a stale
// teardown can remove ANY one toggle ref without orphaning a resurrected wrapper.
//
// ALL toggles route through the queue logic (GJS wrapped_gobj_toggle_notify): we
// apply directly ONLY on the main thread when NOTHING is queued for this inst;
// otherwise we enqueue (where opposite-direction toggles cancel). The qdata lookup
// + decision + direct-apply/enqueue are all done UNDER g_queue_mutex (GJS holds its
// ToggleQueue lock across the whole notify, including the direct apply) so an
// off-thread toggle cannot interleave between the is-queued check and the apply, and
// RunTeardown — which clears qdata under the SAME lock — can never be acted on after
// it has freed an inst.
static void NodeGiToggleNotify(gpointer /*data*/, GObject* obj, gboolean is_last_ref) {
  if (g_toggle_shutdown.load()) {
    // Post-shutdown toggles are dropped (GJS's enqueue-after-shutdown no-op). The
    // per-toggle debug log stays OUT of the hot churn path — dropped toggles at
    // teardown are the only interesting event and are rare.
    if (NodeGiToggleDebugEnabled())
      NodeGiToggleDebugLog("toggle %s DROPPED after shutdown (obj %p)",
                           is_last_ref != FALSE ? "DOWN" : "UP", static_cast<void*>(obj));
    return;
  }
  bool down = is_last_ref != FALSE;
  bool main_thread = OnMainThread();
  bool enqueued = false;
  {
    std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
    if (g_toggle_shutdown.load()) return;  // re-check under the lock
    NodeGiInstance* inst =
        static_cast<NodeGiInstance*>(g_object_get_qdata(obj, NodeGiWrapperQuark()));
    if (inst == nullptr) return;
    if (main_thread && !IsQueuedLocked(inst)) {
      ApplyToggle(inst, down);  // direct apply, under the lock (as GJS does)
    } else {
      enqueued = EnqueueToggleLocked(inst, down);
    }
  }
  if (enqueued) WakeDrain();  // outside the lock
}

// Weak-ref net: glib is telling us this record may never touch the object again.
// It DETACHES the record here, because this callback is the LAST moment the object
// pointer is guaranteed addressable — RunTeardown, which used to do the detaching,
// runs later and by then has only the nulled field.
//
// "The object was finalized" is NOT what this callback means, and reading it that
// way is what left a live GObject holding a freed record. `g_object_run_dispose`
// notifies every GWeakNotify (and clears every GWeakRef) on an object that stays
// ALIVE — measured on glib 2.88.3. Every `run_dispose()` a JS program makes lands
// here, and so does `gtk_native_dialog_destroy()`, whose own docs promise it keeps
// the object's references (measured, GTK 4.22.4: notify fires, dialog alive at
// rc=1). NOT `gtk_window_destroy()`, measured on the same GTK: it unrealizes and
// unrefs, it does not run_dispose — that was GTK3's `gtk_widget_destroy`. The old
// callback only nulled `inst->gobject`, so the teardown then skipped its
// `g_object_set_qdata(obj, quark, nullptr)` — and the surviving GObject kept a
// qdata pointer to the record the teardown went on to `delete`. The next thing to
// hand that GObject back to JS read the freed record (`napi_get_reference_value`
// on its `handle_ref`) or fed it to the drain, where `g_object_get_qdata` on the
// recycled record's `gobject` field is the documented SIGSEGV. Regression:
// gc-identity "run_dispose: a surviving object keeps no freed record in its qdata".
//
// WHY THE LOCK AND NOT AN ATOMIC. An atomic exchange on `gobject` would remove the
// data race and keep the bug: the reader would still be free to act on a pointer
// that this callback is about to invalidate. g_queue_mutex gives the property that
// is actually needed — the detach and the teardown's read-then-use of the same
// pointer are mutually exclusive, so the two can never be interleaved. It costs no
// deadlock risk: this callback runs with no glib lock held (a `g_object_weak_unref`
// from inside a weak notify returns — measured), it calls no user code, and the
// mutex is recursive, so a notify raised by a dispose already under the lock on
// this thread re-acquires it.
//
// THE PRICE when the object OUTLIVES the notify: its toggle ref stays installed —
// it cannot be removed from here (a dispose→JS re-entry inside a weak notify is
// exactly what the teardown queue exists to avoid) and glib offers no way to learn
// later that the object survived. Measured, glib 2.88.3: wrapper identity does not
// survive a `run_dispose` (C hands back a NEW wrapper), that re-wrap adds a SECOND
// toggle ref, and glib notifies only while there is exactly one — so the next 1↔2
// crossing prints `Unexpected number of toggle-refs` instead, the new wrapper never
// goes weak, and the GObject is immortal. The old code leaked the same toggle ref
// and took a use-after-free with it. Pinned by gc-identity "run_dispose costs
// wrapper identity"; the tombstone design that would retire this, and the
// ref_count discriminator rejected for it, are in status/open-todos.md.
static void OnGObjectFinalized(gpointer data, GObject* where_the_object_was) {
  NodeGiInstance* inst = static_cast<NodeGiInstance*>(data);
  bool enqueued = false;
  {
    std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
    DetachInstanceLocked(inst, where_the_object_was);
    inst->gobject = nullptr;
    inst->toggle_added = false;  // no removable toggle ref left: the object is out of reach
    // Let the husk record be COLLECTED. Detaching clears the qdata slot, so the
    // toggle-down that `g_object_run_dispose` fires from its own closing unref no
    // longer finds this record and can never flip it back to weak — a rooted
    // wrapper that nothing will ever root again is a leak of the wrapper AND the
    // object. Flip it here instead. napi_reference_unref is JS-thread-only, so an
    // off-thread notify queues it; DetachInstanceLocked just emptied the queue of
    // this inst, so the enqueue always lands (no opposite-direction cancel), and
    // RunTeardown/SettleCollectedInstance cancel it again if they get there first.
    //
    // Gated on the shutdown flag exactly as NodeGiToggleNotify's direct apply is:
    // glib notifies from whatever thread drops the ref, which can be long after the
    // owner env is gone, and a napi call there is the abort that flag exists to
    // stop. The DETACH above is pure glib and must run either way.
    if (!g_toggle_shutdown.load()) {
      if (OnMainThread()) ApplyToggle(inst, /*down=*/true);
      else enqueued = EnqueueToggleLocked(inst, /*down=*/true);
    }
  }
  if (enqueued) WakeDrain();  // outside the lock
}

// The canonical External's finalizer (napi_finalize, runs at a safe point post-GC
// but where re-entering GObject teardown is still unsafe). Do the MINIMUM: queue
// the teardown + wake the drain async (crash mode 1).
static void NodeGiInstanceFinalize(Napi::Env /*env*/, GObject* /*data*/, NodeGiInstance* inst) {
  if (inst == nullptr) return;
  if (inst->settled) {
    // Resurrection got here first: SettleCollectedInstance already detached and
    // disarmed this record and deliberately left it allocated for US to free
    // (see the ownership note there). Nothing left to tear down.
    if (NodeGiToggleDebugEnabled())
      NodeGiToggleDebugLog("finalizer: freeing settled inst %p (resurrected earlier)",
                           static_cast<void*>(inst));
    delete inst;
    return;
  }
  if (inst->teardown_queued) return;
  inst->teardown_queued = true;
  {
    std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
    // After shutdown nothing will drain, so don't grow the queue (the env is going
    // away; the inst leaks with it — same as a dropped pending teardown).
    if (g_toggle_shutdown.load()) {
      if (NodeGiToggleDebugEnabled())
        NodeGiToggleDebugLog("finalizer: teardown DROPPED after shutdown (inst %p env %p)",
                             static_cast<void*>(inst), static_cast<void*>(inst->env));
      return;
    }
    g_teardown_queue.push_back({inst, g_get_monotonic_time()});
    if (NodeGiToggleDebugEnabled())
      NodeGiToggleDebugLog("finalizer: teardown queued (inst %p env %p depth %zu)",
                           static_cast<void*>(inst), static_cast<void*>(inst->env),
                           g_teardown_queue.size());
  }
  WakeDrain();
}

// Synchronously dispose a COLLECTED wrapper's binding state so a fresh wrapper can
// be built for the same GObject without ever installing a SECOND toggle ref on it.
// GLib suppresses toggle-notify while >=2 toggle refs exist, so a refcount change in
// the two-toggle-ref window would be LOST → the wrapper pinned/leaked (GJS keeps ONE
// toggle ref per GObject). The caller holds a construction ref on obj, so dropping
// the old toggle ref here cannot drive refcount to 0 / dispose. Main-thread only (==
// the drain thread), so the pending idle teardown cannot be running concurrently.
//
// WHO FREES `old` (#1475): an EMPTY napi_ref proves the wrapper was COLLECTED, not
// that its finalizer has RUN. V8 resets the weak persistent inside the first-pass
// weak callback, during GC; Node then defers NodeGiInstanceFinalize to a SetImmediate
// (node_napi_env__::EnqueueFinalizer). Freeing `old` inside that window is a
// use-after-free with a reliable second act: the allocator hands the very same block
// straight back to the fresh `new NodeGiInstance()` below (measured: identical
// address every run), so the stale finalizer then reads the LIVE wrapper's record,
// sees teardown_queued == false, and queues a teardown that removes the LIVE toggle
// ref — dropping the GObject's last ref while JS still holds a wrapper for it. The
// wreckage surfaces one drain later as `g_object_weak_unref: couldn't find weak ref`
// plus a double napi_delete_reference / double free (STATUS_HEAP_CORRUPTION on
// Windows, SIGSEGV on Linux). So ownership of the free follows the finalizer:
// teardown_queued == true means it already ran and nobody else will free the record;
// otherwise it is still pending and IT frees the record, guided by `settled`.
static void SettleCollectedInstance(GObject* obj, NodeGiInstance* old) {
  bool finalizer_pending = false;
  bool remove_toggle = false;
  {
    std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
    // Cancel old's pending teardown, then DetachInstanceLocked for the rest, so the
    // drain never touches a freed inst (paired with the off-thread enqueue, which
    // re-reads qdata under this SAME lock).
    for (auto it = g_teardown_queue.begin(); it != g_teardown_queue.end();)
      it = (it->inst == old) ? g_teardown_queue.erase(it) : it + 1;
    DetachInstanceLocked(old, obj);
    finalizer_pending = !old->teardown_queued;
    old->settled = true;
    // `old->gobject` and `old->toggle_added` are read here, under the lock the
    // weak-ref net clears them with — a null pointer means the net already ran and
    // the object is out of reach, exactly as in RunTeardown.
    if (old->gobject != nullptr) {
      g_object_weak_unref(obj, OnGObjectFinalized, old);
      remove_toggle = old->toggle_added;
    }
    // Disarm every handle the record still carries, so a pending finalizer that
    // reaches it finds nothing to act on even if `settled` were ever missed.
    old->gobject = nullptr;
    old->toggle_added = false;
  }
  // Remove old's toggle ref BEFORE the fresh one is added by the caller — never two
  // at once. The caller holds a construction ref, so this cannot dispose obj; it is
  // still done outside the lock, because remove_toggle_ref is the one call in this
  // file that may re-enter JS and the lock is never held across that.
  if (remove_toggle) g_object_remove_toggle_ref(obj, NodeGiToggleNotify, nullptr);
  if (old->handle_ref != nullptr) {
    napi_delete_reference(old->env, old->handle_ref);
    old->handle_ref = nullptr;
  }
  if (NodeGiToggleDebugEnabled())
    NodeGiToggleDebugLog("settle: detached inst %p (obj %p); %s", static_cast<void*>(old),
                         static_cast<void*>(obj),
                         finalizer_pending ? "finalizer pending, it frees the record"
                                           : "finalizer already ran, freeing here");
  // Only free when the finalizer has already run; otherwise it owns the free. If a
  // process dies before draining its finalizer queue the record is not freed — the
  // same bounded leak-at-exit the shutdown-dropped teardowns already accept.
  if (!finalizer_pending) delete old;
}

// Cache-aware factory: the caller owns exactly ONE non-floating "construction"
// ref on obj. Returns the canonical External, establishing the toggle ref on a
// cache miss / resurrecting on a collected hit, or adopting + balancing the ref
// on a live hit.
Napi::Value MakeGObjectHandle(Napi::Env env, GObject* obj) {
  // Multi-env (worker_threads) safety: claim / honour the toggle-machinery owner.
  // The FIRST env to wrap a GObject wins (compare_exchange under a concurrent race);
  // every later env that is NOT the owner takes the plain strong-ref path.
  napi_env owner = g_owner_env.load();
  if (owner == nullptr) {
    napi_env expected = nullptr;
    owner = g_owner_env.compare_exchange_strong(expected, static_cast<napi_env>(env))
                ? static_cast<napi_env>(env)
                : expected;
  }
  if (owner != static_cast<napi_env>(env)) {
    // A non-owner env must not touch the owner's napi_refs / qdata cache / queues
    // (cross-env napi = UAF). Give it a plain strong-ref handle: it adopts the
    // single construction ref and drops it in its OWN finalizer (correct
    // refcounting; any toggle the ref churn triggers is handled by the OWNER on the
    // owner thread). Trade-off: no wrapper identity / GC-bridge for worker envs — a
    // documented limitation, but no cross-env UAF.
    Napi::External<GObject> plain = Napi::External<GObject>::New(
        env, obj, [](Napi::Env, GObject* p) { g_object_unref(p); });
    if (plain.IsEmpty()) {
      // napi_create_external failed and the throw was swallowed (the env can no
      // longer run JS — worker.terminate() mid-call — or an exception is
      // pending). Chaining TypeTag onto the empty External would funnel into
      // Error::New(nullptr)'s NAPI_FATAL_IF_FAILED sites and abort. The
      // finalizer was never registered, so balance the construction ref here
      // and bail with the empty value (the JS caller never observes it).
      g_object_unref(obj);
      return plain;
    }
    plain.TypeTag(&kGObjectHandleTag);
    return plain;
  }

  EnsureDrainAsync(env);  // wire the JS-thread drain before any toggle/teardown can queue
  NodeGiInstance* existing =
      static_cast<NodeGiInstance*>(g_object_get_qdata(obj, NodeGiWrapperQuark()));
  if (existing != nullptr) {
    napi_value cached = nullptr;
    if (napi_get_reference_value(env, existing->handle_ref, &cached) == napi_ok &&
        cached != nullptr) {
      g_object_unref(obj);  // drop the surplus construction ref; toggle ref owns obj
      return Napi::Value(env, cached);
    }
    // Collected hit (wrapper GC'd, idle teardown still PENDING — the drain runs on
    // THIS thread, so it cannot have run concurrently). Settle the dead wrapper
    // synchronously first (drops its toggle ref while we hold the construction ref),
    // then build a fresh wrapper below — never two toggle refs on obj at once.
    SettleCollectedInstance(obj, existing);
  }

  NodeGiInstance* inst = new NodeGiInstance();
  inst->env = env;
  inst->gobject = obj;
  inst->rooted = true;
  inst->toggle_added = false;
  inst->teardown_queued = false;
  inst->settled = false;

  Napi::External<GObject> ext =
      Napi::External<GObject>::New(env, obj, NodeGiInstanceFinalize, inst);
  if (ext.IsEmpty()) {
    // Same swallowed-failure degradation as the plain path above (the terminate-
    // mid-call class: the hot loop is inside g_object_new when the env dies, and
    // THIS is the next fallible napi call). Nothing was installed yet — no
    // finalizer, no qdata, no weak ref, no toggle ref — so free the record,
    // balance the construction ref, and return the empty value cleanly instead
    // of cascading into TypeTag → Error::New(nullptr) → abort. If the unref
    // disposes the object, the C→JS trampolines are entry-gated and no-op.
    delete inst;
    g_object_unref(obj);
    return ext;
  }
  ext.TypeTag(&kGObjectHandleTag);
  napi_create_reference(env, ext, 1, &inst->handle_ref);  // start STRONG (node-gtk invariant)

  // ARMING is done under the queue lock, so the record is never half-installed as
  // far as another thread is concerned: publishing it in qdata, arming the weak-ref
  // net and claiming `toggle_added` become one step. A toggle-notify raised from
  // INSIDE this block runs on this thread and re-acquires the recursive lock; the
  // notify does napi work only, never JS, so the no-lock-across-dispose invariant
  // still holds. Without it, a foreign-thread g_object_run_dispose landing between
  // g_object_weak_ref and `toggle_added = true` would have its detach overwritten.
  // The unref below cannot reach dispose either — add_toggle_ref took a ref of its
  // own, so the count is >= 2 going in — which is what makes it safe under a lock.
  {
    std::lock_guard<std::recursive_mutex> guard(g_queue_mutex);
    g_object_set_qdata(obj, NodeGiWrapperQuark(), inst);   // overwrite (resurrection-safe)
    g_object_weak_ref(obj, OnGObjectFinalized, inst);      // safety net
    g_object_add_toggle_ref(obj, NodeGiToggleNotify, nullptr);
    inst->toggle_added = true;
    // Drop the construction ref → only the toggle ref remains. If nothing else
    // holds obj (refcount 2→1) this fires toggle-down synchronously, flipping the
    // fresh wrapper to weak; if C holds another ref it stays strong (rooted).
    g_object_unref(obj);
  }
  return ext;
}

// Wrap a borrowed/owned GObject pointer as the canonical node-gi handle. The
// cache lookup happens BEFORE any refcount change so a live hit causes no
// spurious toggle churn; only the miss/resurrect path takes a construction ref.
Napi::Value WrapGObject(Napi::Env env, GObject* obj, GITransfer transfer) {
  if (obj == nullptr) return env.Null();

  NodeGiInstance* inst =
      static_cast<NodeGiInstance*>(g_object_get_qdata(obj, NodeGiWrapperQuark()));
  // Multi-env (worker_threads) safety: the qdata cache is process-global, but
  // inst->handle_ref is a napi_ref rooted in inst->env's isolate. ONLY that env may
  // dereference it — napi_get_reference_value with a FOREIGN env is a cross-env UAF /
  // V8 abort (e.g. a worker that obtains a process-shared singleton like
  // Gio.Vfs.get_default() that the owner env already wrapped). A non-owner env skips
  // the cache and takes the plain strong-ref path via MakeGObjectHandle (which gates
  // the same way). inst->env is immutable, so this guard is race-free regardless of
  // g_owner_env store ordering — MakeGObjectHandle's gate alone was NOT enough,
  // because this cache-hit fast path runs BEFORE MakeGObjectHandle.
  if (inst != nullptr && inst->env == static_cast<napi_env>(env)) {
    napi_value cached = nullptr;
    if (napi_get_reference_value(env, inst->handle_ref, &cached) == napi_ok && cached != nullptr) {
      // Identity hit: return the canonical External, balancing the transfer (we
      // already own obj via the toggle ref, so any ref the caller hands us is
      // surplus and must be dropped).
      if (g_object_is_floating(obj)) {
        g_object_ref_sink(obj);
        g_object_unref(obj);
      } else if (transfer == GI_TRANSFER_EVERYTHING) {
        g_object_unref(obj);
      }
      return Napi::Value(env, cached);
    }
    // collected hit (our env) → fall through and (re)build a fresh wrapper (resurrection).
  }

  // Miss / resurrect / cross-env share: own exactly one non-floating construction ref.
  if (g_object_is_floating(obj)) {
    g_object_ref_sink(obj);
  } else if (transfer == GI_TRANSFER_NOTHING) {
    g_object_ref(obj);
  }  // GI_TRANSFER_EVERYTHING (non-floating): the caller already gave us the ref.
  return MakeGObjectHandle(env, obj);
}

// ============================ TEST-ONLY ===============================
// __stressRefUnrefOffThread(handle, iterations) — the GLib-thread vehicle the
// cross-thread GC stress test needs (there is no headless JS way to make another
// OS thread ref/unref a wrapped GObject — GIO local-file async keeps its refcount
// ops on the main thread). A background GThread does g_object_ref/g_object_unref on
// the wrapped GObject `iterations` times, crossing the toggle 1<->2 boundary from a
// NON-main thread → driving NodeGiToggleNotify's OFF-THREAD branch + the
// opposite-direction enqueue cancel + WakeDrain + the JS-thread drain. The CALLER
// MUST keep the handle reachable (and take NO extra ref) for the churn's lifetime:
// the toggle ref + the JS-reachable wrapper keep the GObject alive at refcount 1
// between churn pairs, so the worker's 1<->2 crossings are real toggles, never a
// use-after-free. Poll __stressRefUnrefRunning() for completion. Not part of the
// public API surface — prefixed __ and only used by test/gc-cross-thread.test.mjs.
static std::atomic<int> g_stress_running{0};
// Monotonic count of completed off-thread ref/unref iterations — lets a test prove
// the off-thread churn makes progress WHILE a main-thread dispose vfunc is running
// (i.e. the drain lock is NOT held across dispose). If the lock were held across the
// dispose, the off-thread NodeGiToggleNotify would block on g_queue_mutex and this
// counter would freeze for the dispose's whole duration.
static std::atomic<long> g_stress_progress{0};
// Cooperative stop flag so a test can halt a long-running churn after asserting.
static std::atomic<bool> g_stress_stop{false};
struct StressArgs {
  GObject* obj;
  long iterations;
};
static gpointer StressThreadFunc(gpointer data) {
  StressArgs* a = static_cast<StressArgs*>(data);
  for (long i = 0; i < a->iterations; i++) {
    if (g_stress_stop.load()) break;
    g_object_ref(a->obj);    // 1 -> 2 : toggle UP (off-thread)
    g_object_unref(a->obj);  // 2 -> 1 : toggle DOWN (off-thread)
    g_stress_progress.fetch_add(1);
    if ((i & 0x3f) == 0) g_thread_yield();  // give the main thread the lock + loop
  }
  g_stress_running.fetch_sub(1);
  delete a;
  return nullptr;
}
Napi::Value StressRefUnrefOffThread(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Undefined();
  long iters = info.Length() >= 2 ? static_cast<long>(info[1].As<Napi::Number>().Int64Value()) : 10000;
  g_stress_stop.store(false);  // a fresh churn is not pre-stopped
  StressArgs* a = new StressArgs{obj, iters};
  g_stress_running.fetch_add(1);
  GThread* t = g_thread_new("node-gi-stress", StressThreadFunc, a);
  g_thread_unref(t);  // detached — completion is signalled via g_stress_running
  return env.Undefined();
}
Napi::Value StressRefUnrefRunning(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), g_stress_running.load() > 0);
}
Napi::Value StressRefUnrefProgress(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), static_cast<double>(g_stress_progress.load()));
}
Napi::Value StressRefUnrefStop(const Napi::CallbackInfo& info) {
  g_stress_stop.store(true);
  return info.Env().Undefined();
}
// ========================== END TEST-ONLY ============================

}  // namespace nodegi
