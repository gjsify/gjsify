// SPDX-License-Identifier: MIT
// libuv <-> GLib main loop bridge: startMainLoop (uv-in-GLib GSource) +
// iterateMainContext + the uv-driven GLib auto-pump (GLib-in-libuv, the
// non-blocking case).

#include "common.h"

#include <unordered_map>

#ifndef _WIN32
// g_source_add_unix_fd / g_source_modify_unix_fd embed libuv's backend fd into a
// GLib GSource — POSIX-only (declared in glib-unix.h; absent on Windows, where
// GLib splits platform APIs into -Unix/-Win32 namespaces and libuv uses IOCP, not
// an fd-polling backend). ONLY the UvLoopSource path (the BLOCKING-GLib-main-loop
// co-pump) is guarded out on Windows; the uv-driven pump below (prepare/check/timer
// → g_main_context_iteration) has no unix_fd dependency and stays active, so async
// Gio/timers/DBus still work on Windows (degraded to timed polling — see SyncPumpPolls).
#include <glib-unix.h>
#endif

namespace nodegi {

// ---- libuv <-> GLib main loop bridge (milestone: mainloop) ----
//
// Port of node-gtk's src/loop.cc (romgrk and contributors, MIT) to N-API. Nests
// Node's libuv loop inside GLib's main loop: a GSource polls libuv's backend fd
// and runs uv_run(UV_RUN_NOWAIT) on dispatch, so a blocking GLib main loop
// (GLib.MainLoop.run / GApplication.run) keeps Node timers/promises/IO alive —
// matching GJS, where the GLib loop IS the process loop. Nesting GLib inside uv
// is impractical (uv exposes no external prepare/check hook), so we nest the
// other way, exactly as node-gtk does.
//
// Main-thread only (worker_threads would need a per-context source); the GLib
// default context is iterated on the same thread Node runs on.
struct UvLoopSource {
  GSource source;
  uv_loop_t* loop;
  gpointer fd_tag;      // POSIX: the uv_backend_fd poll tag (unused on Windows)
  gboolean fd_polled;   // POSIX: whether the backend fd is currently polled
#ifdef _WIN32
  gint64 win_next_wake_us;  // Windows: monotonic time of the next mandatory uv co-pump
                            // (G_MAXINT64 = parked: uv is idle, sleep until a GLib source wakes us)
#endif
};

static napi_env g_loop_env = nullptr;       // captured at startMainLoop (main thread)
static gboolean g_loop_started = FALSE;
static napi_ref g_process_ref = nullptr;        // process
static napi_ref g_tick_callback_ref = nullptr;  // process._tickCallback

// TRUE while the uv-driven auto-pump (below) is inside its own GLib work —
// draining the context or running the prepare/query hint pass. The UvLoopSource
// consults it to PARK itself (mask the backend fd, report not-ready, skip
// uv_run): a pump-driven context iteration must never dispatch the uv-in-GLib
// source, or it would nest uv_run inside the very uv callback that drives the
// pump (uv_run is not reentrant) — and recursively re-enter the pump itself.
static gboolean g_in_uv_pump = FALSE;

// Drain Node's nextTick queue + run a microtask checkpoint. process._tickCallback
// invoked through napi_make_callback runs the tick queue, and the surrounding
// callback scope's close performs the microtask checkpoint — the N-API analogue
// of node-gtk's CallMicrotaskHandlers (process._tickCallback +
// Isolate::PerformMicrotaskCheckpoint). Best-effort: skipped if a JS exception is
// already pending (it will surface when the blocking run() returns).
//
// Limitation (node-gtk #442/#121): when the blocking run() is nested inside an
// outer async callback scope (node:test, an await, a signal handler), V8 defers
// the checkpoint to that outer scope, so promise continuations queued before the
// run() do not drain until run() returns. nextTick still drains; timers/I/O the
// loop dispatches are unaffected. The robust fix lives in L1 (defer the run() to
// a macrotask when a microtask checkpoint is in progress).
//
// Cross-platform: process._tickCallback drains BOTH the nextTick queue AND the
// microtask checkpoint explicitly (node's task_queues.js calls runMicrotasks() at
// its end), so this settles an async DBus reply / GLib-timeout-resolved await
// continuation regardless of callback-scope depth. On Windows it is the timer-driven
// UvLoopSource (below) that calls this during a blocking GLib loop.
static void DrainMicrotasks() {
  if (g_loop_env == nullptr || g_tick_callback_ref == nullptr || g_process_ref == nullptr) return;
  napi_env env = g_loop_env;
  bool pending = false;
  if (napi_is_exception_pending(env, &pending) != napi_ok || pending) return;

  napi_handle_scope scope;
  if (napi_open_handle_scope(env, &scope) != napi_ok) return;
  napi_value process_v = nullptr, tick = nullptr, result = nullptr;
  if (napi_get_reference_value(env, g_process_ref, &process_v) == napi_ok &&
      napi_get_reference_value(env, g_tick_callback_ref, &tick) == napi_ok &&
      process_v != nullptr && tick != nullptr) {
    napi_make_callback(env, nullptr, process_v, tick, 0, nullptr, &result);
  }
  napi_close_handle_scope(env, scope);
}

// ---- cross-runtime microtask checkpoint (Bun/Deno) --------------------------
//
// Node's napi_make_callback performs the nextTick + microtask checkpoint when
// its callback scope closes, so promise continuations queued by a
// loop-dispatched GLib→JS callback drain at the callback boundary even while a
// blocking GLib loop owns the thread. Bun's and Deno's N-API implementations do
// NOT (Deno's napi_make_callback is a plain Function::Call — refs/deno
// ext/napi/node_api.rs; Deno's own FFI trampoline drains explicitly for exactly
// this reason, refs/deno ext/ffi/callback.rs), and with the runtime's event
// loop paused for the lifetime of a blocking run() the queue never drains — an
// async (Promise-returning) DBus method handler never sent its reply
// (client-side "Timeout was reached"), while GJS drains the promise-job queue
// whenever the last JS frame exits.
//
// Portable fix: N-API exposes no engine microtask checkpoint, but both runtimes
// expose their OWN drain primitive to JS (Bun: `bun:jsc` drainMicrotasks —
// JSC's VM drain, callable mid-stack by design; Deno: core.runMicrotasks →
// Isolate::PerformMicrotaskCheckpoint via a reentrant op). index.js registers
// it here on non-Node runtimes only; the loop-dispatched trampolines
// (signals.cc / calls.cc / class.cc) invoke NodeGiMaybeDrainMicrotasks at their
// OUTERMOST boundary (g_loopDispatchDepth == 0). Node never registers — its
// checkpoint already runs natively — so this is a guaranteed no-op there.
//
// NOT drained from a GSource prepare phase: running JS mid-iteration from
// prepare broke the GDK frame clock (the Excalibur stall — see signals.cc);
// the drain runs strictly AFTER the dispatched handler returned.

// TRUE while the registered drain runs: a drained microtask that re-enters the
// loop (a nested blocking run dispatching further callbacks) must not recurse
// into another drain — the engines' own checkpoints refuse re-entry anyway
// (V8 no-ops while IsRunningMicrotasks; matches Node, where a checkpoint
// cannot re-enter itself).
static bool g_in_microtask_drain = false;

// setMicrotaskDrain(drain) — register the runtime-native microtask drain for
// this env. Called by index.js on Bun/Deno only (never on Node).
Napi::Value SetMicrotaskDrain(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "setMicrotaskDrain(drain: function)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  NodeGiEnvData* d = EnvData(env);
  if (d == nullptr) return env.Undefined();
  if (d->microtaskDrain != nullptr) {
    napi_delete_reference(env, d->microtaskDrain);
    d->microtaskDrain = nullptr;
  }
  napi_create_reference(env, info[0], 1, &d->microtaskDrain);
  return env.Undefined();
}

void NodeGiMaybeDrainMicrotasks(napi_env env) {
  NodeGiEnvData* d = EnvData(env);
  if (d == nullptr || d->microtaskDrain == nullptr) return;  // Node: never registered
  if (g_in_microtask_drain) return;
  // A failed callback skips the queues (Node parity: an InternalCallbackScope
  // marked failed skips its task-queue processing) — and NodeGiJsAvailable also
  // covers env teardown, where JS must not be entered at all.
  if (!NodeGiJsAvailable(env)) return;
  napi_handle_scope scope = nullptr;
  if (napi_open_handle_scope(env, &scope) != napi_ok) return;
  napi_value fn = nullptr;
  if (napi_get_reference_value(env, d->microtaskDrain, &fn) == napi_ok && fn != nullptr) {
    napi_value undef = nullptr;
    napi_get_undefined(env, &undef);
    napi_value result = nullptr;
    g_in_microtask_drain = true;
    napi_status st = napi_call_function(env, undef, fn, 0, nullptr, &result);
    g_in_microtask_drain = false;
    // The drain primitive itself must never wedge the loop on a pending
    // exception (microtask exceptions are reported inside the engines' own
    // checkpoints, so this only fires on a broken registration).
    if (st != napi_ok) SurfacePendingException(env, "microtask drain");
  }
  napi_close_handle_scope(env, scope);
}

#ifndef _WIN32
static gboolean uv_source_prepare(GSource* base, gint* timeout) {
  UvLoopSource* s = reinterpret_cast<UvLoopSource*>(base);

  // Parked while the uv-driven auto-pump iterates the context: report not-ready
  // with an infinite timeout and mask the backend fd (the `alive == FALSE` shape
  // below), so a pump-driven iteration never dispatches this source — libuv is
  // already live and running us; co-pumping it from inside itself would nest
  // uv_run reentrantly. Also: while parked the uv backend timeout must not leak
  // into the pump's g_main_context_query() timeout hint (a feedback loop).
  if (g_in_uv_pump) {
    if (s->fd_tag != nullptr && s->fd_polled) {
      g_source_modify_unix_fd(&s->source, s->fd_tag, static_cast<GIOCondition>(0));
      s->fd_polled = FALSE;
    }
    *timeout = -1;
    return FALSE;
  }

  uv_update_time(s->loop);
  DrainMicrotasks();

  gboolean alive = uv_loop_alive(s->loop);
  // Toggle whether GLib polls uv's backend fd: an unref'd-but-active uv handle
  // keeps the backend fd perpetually ready, which would busy-spin GLib at 100%
  // CPU when the loop is otherwise dead. Mask the fd while dead so GLib actually
  // blocks until a GLib source wakes us; restore it the moment uv is alive again.
  if (s->fd_tag != nullptr && alive != s->fd_polled) {
    g_source_modify_unix_fd(
        &s->source, s->fd_tag,
        alive ? static_cast<GIOCondition>(G_IO_IN | G_IO_OUT | G_IO_ERR) : static_cast<GIOCondition>(0));
    s->fd_polled = alive;
  }

  if (!alive) {
    *timeout = -1;  // sleep until a GLib source wakes us
    return FALSE;
  }
  int t = uv_backend_timeout(s->loop);
  *timeout = t;
  return t == 0;  // ready immediately when uv has work due now
}

static gboolean uv_source_dispatch(GSource* base, GSourceFunc /*callback*/, gpointer /*user_data*/) {
  // Belt-and-braces for the pump parking above: a stale unmasked-fd readiness
  // from an earlier blocking-loop epoch could still dispatch us once — never
  // nest uv_run inside a pump-driven iteration.
  if (g_in_uv_pump) return G_SOURCE_CONTINUE;
  UvLoopSource* s = reinterpret_cast<UvLoopSource*>(base);
  uv_run(s->loop, UV_RUN_NOWAIT);
  DrainMicrotasks();
  return G_SOURCE_CONTINUE;
}

static GSourceFuncs uv_source_funcs = {
    uv_source_prepare, nullptr, uv_source_dispatch, nullptr, nullptr, nullptr,
};
#else  // _WIN32 — the UvLoopSource, readiness-bounded timer instead of uv-backend-fd-driven.
//
// Windows/IOCP has no uv backend fd to embed in a GLib GSource, so the co-pump of
// Node's loop during a BLOCKING GLib main loop can't wake on backend-fd readiness the
// way POSIX does. Instead the source schedules its next dispatch off uv's OWN state,
// using only PUBLIC libuv API (uv_loop_alive + uv_backend_timeout — the same two calls
// the POSIX prepare uses):
//   • uv idle (no active handles/reqs) → PARK: win_next_wake_us = G_MAXINT64, sleep -1
//     until a GLib source wakes us. The Windows twin of the POSIX backend-fd mask, so a
//     blocking GLib loop with an otherwise-quiet Node loop no longer spins every 5 ms.
//   • uv alive → dispatch after min(uv_backend_timeout, cap): a Node timer due in < cap
//     ms wakes at its actual deadline (not rounded up to a fixed 5 ms), while the CAP
//     bounds the wait so IOCP I/O completions — which arrive on a HANDLE we can NOT embed
//     in GLib's poll (uv_backend_fd() == -1, and loop->iocp is a private libuv struct
//     field we must not depend on) — are still serviced by an unconditional uv_run within
//     cap ms. Full zero-latency IOCP readiness would need that private HANDLE, so the cap
//     stays as the I/O-completion poll (see the honesty note in StartMainLoop).
// Each dispatch runs uv_run(UV_RUN_NOWAIT) (Node timers/I/O) + DrainMicrotasks() (nextTick
// + microtask checkpoint via process._tickCallback); the DRAIN settles an async DBus reply
// (or any GLib-timeout-resolved `await`) posted through a Promise `.then`, exactly as the
// POSIX fd-driven source does. Parked while the uv-driven pump owns the context (g_in_uv_pump).
static const gint NODE_GI_WIN_UV_POLL_CAP_MS = 5;

// Next mandatory-poll deadline from uv's own next-due time, capped so unwatchable IOCP I/O
// completions are still serviced within the cap. G_MAXINT64 when uv is idle (park the
// metronome — sleep until a GLib source wakes us). Public libuv API only.
static gint64 WinNextUvWake(UvLoopSource* s, gint64 now) {
  if (!uv_loop_alive(s->loop)) return G_MAXINT64;
  int t = uv_backend_timeout(s->loop);  // ms to uv's next due work: 0 = now, > 0 = timer, < 0 = I/O-wait
  gint interval = (t >= 0 && t < NODE_GI_WIN_UV_POLL_CAP_MS) ? t : NODE_GI_WIN_UV_POLL_CAP_MS;
  return now + static_cast<gint64>(interval) * 1000;
}

static gboolean uv_source_prepare(GSource* base, gint* timeout) {
  UvLoopSource* s = reinterpret_cast<UvLoopSource*>(base);
  if (g_in_uv_pump) {
    *timeout = -1;
    return FALSE;
  }
  uv_update_time(s->loop);
  DrainMicrotasks();  // drain before we (maybe) sleep — settles a pending async reply
  const gint64 now = g_source_get_time(base);
  // Un-park if uv became live again since the last dispatch (a GLib-dispatched callback
  // may have armed a Node timer / started Node I/O). While parked, sleep until a GLib
  // source wakes us instead of spinning on a fixed cadence.
  if (s->win_next_wake_us == G_MAXINT64) {
    s->win_next_wake_us = WinNextUvWake(s, now);
    if (s->win_next_wake_us == G_MAXINT64) {
      *timeout = -1;
      return FALSE;
    }
  }
  if (now >= s->win_next_wake_us) {
    *timeout = 0;
    return TRUE;  // due now — dispatch runs uv_run + drain
  }
  gint64 remaining_ms = (s->win_next_wake_us - now + 999) / 1000;
  *timeout = remaining_ms > NODE_GI_WIN_UV_POLL_CAP_MS ? NODE_GI_WIN_UV_POLL_CAP_MS
                                                       : static_cast<gint>(remaining_ms);
  return FALSE;
}

static gboolean uv_source_check(GSource* base) {
  UvLoopSource* s = reinterpret_cast<UvLoopSource*>(base);
  if (g_in_uv_pump) return FALSE;
  return g_source_get_time(base) >= s->win_next_wake_us;  // never ready while parked (G_MAXINT64)
}

static gboolean uv_source_dispatch(GSource* base, GSourceFunc /*callback*/, gpointer /*user_data*/) {
  if (g_in_uv_pump) return G_SOURCE_CONTINUE;  // never nest uv_run under a pump iteration
  UvLoopSource* s = reinterpret_cast<UvLoopSource*>(base);
  uv_run(s->loop, UV_RUN_NOWAIT);
  DrainMicrotasks();
  // Re-schedule off uv's post-run state (idle → park; else min(next-due, cap)).
  uv_update_time(s->loop);
  s->win_next_wake_us = WinNextUvWake(s, g_source_get_time(base));
  return G_SOURCE_CONTINUE;
}

static GSourceFuncs uv_source_funcs = {
    uv_source_prepare, uv_source_check, uv_source_dispatch, nullptr, nullptr, nullptr,
};
#endif  // _WIN32 (UvLoopSource: POSIX fd-driven / Windows readiness-bounded co-pump)

// iterateMainContext(mayBlock?) -> boolean
//
// Iterate the default GLib main context once, dispatching any ready sources (GIO
// async callbacks, GLib timeouts/idles, DBus). Pure GLib — touches NO libuv — so
// it is the PORTABLE main-loop primitive on Bun/Deno, where the uv-nesting bridge
// (startMainLoop) can't run: Deno exports no libuv symbols and Bun panics on
// uv_backend_fd. The L1 layer drives it from a JS timer (pumpMainContext), so GLib
// co-pumps while the runtime's own event loop stays in control — GJS's non-blocking
// main loop reached the other way around. Returns true if a source was dispatched.
Napi::Value IterateMainContext(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool may_block = info.Length() > 0 && info[0].ToBoolean().Value();
  gboolean dispatched =
      g_main_context_iteration(g_main_context_default(), may_block ? TRUE : FALSE);
  return Napi::Boolean::New(env, dispatched == TRUE);
}

// ---- uv-driven GLib auto-pump (the non-blocking case) -----------------------
//
// The inverse co-pump of UvLoopSource: with NO blocking GLib loop running, a
// plain `node bundle.mjs` still needs pending GLib sources (Gio async
// completions, GLib timeouts/idles, DBus) to dispatch — under GJS the GLib loop
// IS the process loop, so they always do. Here Node's libuv loop drives the
// default GLib main context instead:
//
//   • a uv_prepare + uv_check handle pair drains every READY GLib source once
//     per libuv loop turn (a bounded `g_main_context_iteration(ctx, FALSE)`
//     loop — self-contained prepare/query/poll(0)/check/dispatch cycles, so no
//     cross-phase GLib protocol state is held), then
//   • runs a prepare+query HINT pass to learn (a) when GLib's earliest timer is
//     due — mirrored into a uv_timer so libuv wakes for it — and (b) which fds
//     GLib polls (including the context's cross-thread wakeup eventfd, which a
//     completing GTask worker signals) — mirrored into uv_poll watchers so I/O
//     readiness and cross-thread wakeups end libuv's poll sleep.
//
// Keep-alive policy (what keeps the Node process alive, matching what a Node
// developer expects from in-flight work):
//   • the mirrored uv_timer is REF'd while armed — a due GLib timeout behaves
//     like a due `setTimeout` (a REPEATING GLib timeout therefore keeps Node
//     alive like `setInterval`; under `gjs -m` the process would instead exit
//     once the module settles — the one deliberate lifetime divergence);
//   • one-shot in-flight async operations (a GI scope=async callback such as a
//     GAsyncReadyCallback, counted via NodeGiPumpAsyncBegin/End) REF the pump
//     while pending — an in-flight `read_async` behaves like in-flight Node I/O;
//   • everything else (the prepare/check pair, the fd watchers) stays UNREF'd —
//     the pump alone never keeps a finished program alive, so a purely-sync
//     node-gi program still exits immediately. Consequence: a *passive* GLib fd
//     source with no pending async op (e.g. only a listening Gio.SocketService)
//     does not keep the process alive on its own.
//
// Guards: the pump only touches the context at g_main_depth() == 0 — during a
// blocking GLib.MainLoop.run()/Application.run() (which iterates the context
// itself, with UvLoopSource co-pumping libuv) every pump callback is a no-op, so
// there is no double-dispatch. g_in_uv_pump parks UvLoopSource during pump-driven
// iterations (see uv_source_prepare) so the two co-pumps never nest uv_run.
//
// Main-thread only, armed once by StartMainLoop (Node only — Bun/Deno have no
// usable libuv; they keep the L1 startMainContextPump timer pump).

struct PumpPoll {
  uv_poll_t handle;
  int fd;
  int events;     // currently-subscribed uv event mask
  gboolean seen;  // mark/sweep flag for SyncPumpPolls
};

static gboolean g_pump_inited = FALSE;
static gboolean g_pump_context_acquired = FALSE;
static uv_prepare_t g_pump_prepare;
static uv_check_t g_pump_check;
static uv_timer_t g_pump_timer;
static gboolean g_pump_timer_reffed = FALSE;
static std::unordered_map<int, PumpPoll*>* g_pump_polls = nullptr;
static std::vector<GPollFD>* g_pump_fds = nullptr;  // query scratch (reused)
static int g_pump_async_pending = 0;  // in-flight scope=async GI callbacks
static gboolean g_pump_prepare_reffed = FALSE;
static gboolean g_pump_poll_warned = FALSE;

// Wake-only callbacks: readiness/expiry just ends libuv's poll sleep; the actual
// GLib dispatch happens in the check phase of the same loop turn (PumpCheckCb).
static void PumpTimerCb(uv_timer_t* /*t*/) {}
static void PumpPollCb(uv_poll_t* /*p*/, int /*status*/, int /*events*/) {}

static void PumpPollCloseCb(uv_handle_t* h) {
  delete reinterpret_cast<PumpPoll*>(h->data);
}

// Mirror the queried GLib poll fds into uv_poll watchers (mark/sweep diff — the
// set rarely changes). Duplicate fds are merged; fds with no events (e.g. uv's
// own backend fd, masked by the parked UvLoopSource) are skipped. On a watcher
// failure (fd not pollable / already watched elsewhere in this loop) fall back
// to a short timer so readiness is still discovered, just later.
static gboolean SyncPumpPolls(int nfds) {
#ifdef _WIN32
  // uv_poll requires a SOCKET on Windows, but GLib's queried poll fds are HANDLEs
  // (g_poll uses MsgWaitForMultipleObjects), not pollable via libuv. Report "not
  // fully watched" so PumpArmWakeups falls back to timed main-context polling — the
  // pump still drains ready GLib sources each loop turn (async Gio/timers/DBus
  // work), just discovering readiness on a short cadence instead of on the fd. A
  // HANDLE/IOCP fd-watch integration via the Win32 GLib surface is a follow-up.
  (void)nfds;
  return FALSE;
#else
  gboolean all_ok = TRUE;
  for (auto& it : *g_pump_polls) it.second->seen = FALSE;

  // Merge events per fd first (a context can poll one fd from several sources).
  std::unordered_map<int, int> wanted;
  for (int i = 0; i < nfds; i++) {
    const GPollFD& p = (*g_pump_fds)[i];
    if (p.fd < 0 || p.events == 0) continue;
    int ev = 0;
    if (p.events & (G_IO_IN | G_IO_HUP | G_IO_ERR)) ev |= UV_READABLE;
    if (p.events & G_IO_OUT) ev |= UV_WRITABLE;
    if (p.events & G_IO_PRI) ev |= UV_PRIORITIZED;
    if (ev != 0) wanted[p.fd] |= ev;
  }

  for (const auto& [fd, ev] : wanted) {
    auto it = g_pump_polls->find(fd);
    if (it != g_pump_polls->end()) {
      PumpPoll* pp = it->second;
      pp->seen = TRUE;
      if (pp->events != ev) {
        if (uv_poll_start(&pp->handle, ev, PumpPollCb) == 0) {
          pp->events = ev;
          uv_unref(reinterpret_cast<uv_handle_t*>(&pp->handle));
        } else {
          all_ok = FALSE;
        }
      }
      continue;
    }
    PumpPoll* pp = new PumpPoll();
    pp->fd = fd;
    pp->events = ev;
    pp->seen = TRUE;
    pp->handle.data = pp;
    uv_loop_t* loop = g_pump_prepare.loop;
    if (uv_poll_init(loop, &pp->handle, fd) != 0) {
      delete pp;
      all_ok = FALSE;
      continue;
    }
    if (uv_poll_start(&pp->handle, ev, PumpPollCb) != 0) {
      uv_close(reinterpret_cast<uv_handle_t*>(&pp->handle), PumpPollCloseCb);
      all_ok = FALSE;
      continue;
    }
    uv_unref(reinterpret_cast<uv_handle_t*>(&pp->handle));
    (*g_pump_polls)[fd] = pp;
  }

  for (auto it = g_pump_polls->begin(); it != g_pump_polls->end();) {
    if (it->second->seen) {
      ++it;
      continue;
    }
    PumpPoll* pp = it->second;
    uv_poll_stop(&pp->handle);
    uv_close(reinterpret_cast<uv_handle_t*>(&pp->handle), PumpPollCloseCb);
    it = g_pump_polls->erase(it);
  }
  return all_ok;
#endif  // _WIN32
}

// Drain every currently-ready GLib source (bounded). Each iteration is a full,
// self-contained GLib cycle, so readiness (fds, timers, idles) is re-evaluated
// natively — the uv watchers are pure wake-ups. No-op while a blocking GLib
// loop is dispatching (g_main_depth() > 0) or when re-entered from a nested
// uv_run inside our own dispatch (g_in_uv_pump).
static void PumpDrainContext() {
  if (g_main_depth() > 0 || g_in_uv_pump) return;
  GMainContext* ctx = g_main_context_default();
  // The drain runs from a bare uv_prepare/uv_check C callback — there is NO
  // ambient V8 HandleScope (unlike a blocking run(), which is entered through a
  // JS-initiated N-API frame). Anything the dispatched sources do that creates
  // JS handles outside its own scope (the toggle-ref bridge's
  // napi_get_reference_value on a GTask teardown unref, most prominently) would
  // abort with "Cannot create a handle without a HandleScope" — so provide one
  // for the whole drain.
  napi_handle_scope scope = nullptr;
  if (g_loop_env != nullptr) napi_open_handle_scope(g_loop_env, &scope);
  g_in_uv_pump = TRUE;
  int guard = 0;
  while (g_main_context_iteration(ctx, FALSE) && ++guard < 1000) {
  }
  g_in_uv_pump = FALSE;
  if (scope != nullptr) napi_close_handle_scope(g_loop_env, scope);
}

// The prepare+query HINT pass: learn GLib's earliest-timer deadline + poll fds
// and mirror them into the uv timer / uv_poll watchers, so libuv's poll sleep
// ends exactly when GLib next has work. The context is left "prepared" without a
// matching check/dispatch — safe: the next g_main_context_iteration() (ours or a
// blocking loop's) simply re-prepares. Runs only at g_main_depth() == 0; the
// g_in_uv_pump flag is held across it so UvLoopSource stays parked (masking uv's
// backend fd out of the queried set — it must not be uv_poll'd, and uv's own
// backend timeout must not feed back into the timer hint).
static void PumpArmWakeups() {
  if (!g_pump_inited || g_main_depth() > 0 || g_in_uv_pump) return;
  GMainContext* ctx = g_main_context_default();
  gint prio = 0;
  gint timeout = -1;
  g_in_uv_pump = TRUE;
  g_main_context_prepare(ctx, &prio);
  int nfds = g_main_context_query(ctx, prio, &timeout, g_pump_fds->data(),
                                  static_cast<gint>(g_pump_fds->size()));
  while (nfds > static_cast<int>(g_pump_fds->size())) {
    g_pump_fds->resize(nfds);
    nfds = g_main_context_query(ctx, prio, &timeout, g_pump_fds->data(),
                                static_cast<gint>(g_pump_fds->size()));
  }
  g_in_uv_pump = FALSE;

  if (!SyncPumpPolls(nfds)) {
    // Degraded wake path: poll at a short cadence instead of on readiness. This is
    // the ALWAYS case on Windows (GLib's poll fds are HANDLEs, not uv_poll-able) and
    // an occasional one on Linux (an fd that isn't uv_poll-able). Force the cadence
    // ONLY while async work is in-flight — its completion arrives on an fd we can't
    // watch, so we must poll to catch it. When nothing is pending, keep the query's
    // own timeout (-1 when GLib is idle) so the loop goes to sleep / the process
    // exits instead of a ref'd timer spinning forever — otherwise a purely-sync
    // program (and every finished conformance test) would never exit on Windows.
    if (!g_pump_poll_warned) {
      g_pump_poll_warned = TRUE;
      g_printerr("(node-gi) warning: could not watch a GLib poll fd from libuv; "
                 "falling back to timed main-context polling\n");
    }
    if (g_pump_async_pending > 0 && (timeout < 0 || timeout > 32)) timeout = 32;
  }

  // WAKE-UP and HOLD are separate decisions.
  //
  // Wake-up: whenever GLib has a deadline, arm the mirrored uv timer for it, so
  // libuv's poll sleep ends exactly when GLib next has work.
  //
  // Hold (uv_ref): ONLY while JS-armed GLib work is outstanding — the
  // scope=async/notified counter. Ref'ing whenever a deadline exists (what this
  // used to do) makes any C-armed toolkit timer immortalize the process: GDK
  // keeps a ~1 s repeating timeout armed for the process's whole life, so
  // `node --test test/gtk-smoke.test.mjs` never exited once the GTK stack had
  // been initialized. `gjs -m` exits when the module settles regardless of what
  // GLib still has scheduled; keying the hold on the program's OWN outstanding
  // GLib work is as close to that as a libuv-driven process can get, and it is
  // what keeps a top-level `await` on a GLib timeout alive (the timeout's
  // GSourceFunc is a scope=notified callback, counted until GLib drops it).
  if (timeout >= 0) {
    uv_timer_start(&g_pump_timer, PumpTimerCb, static_cast<uint64_t>(timeout), 0);
  } else {
    uv_timer_stop(&g_pump_timer);
  }
  const gboolean hold = g_pump_async_pending > 0 && timeout >= 0;
  if (hold && !g_pump_timer_reffed) {
    uv_ref(reinterpret_cast<uv_handle_t*>(&g_pump_timer));
    g_pump_timer_reffed = TRUE;
  } else if (!hold && g_pump_timer_reffed) {
    uv_unref(reinterpret_cast<uv_handle_t*>(&g_pump_timer));
    g_pump_timer_reffed = FALSE;
  }
}

static void PumpPrepareCb(uv_prepare_t* /*h*/) {
  PumpDrainContext();
  PumpArmWakeups();
}

static void PumpCheckCb(uv_check_t* /*h*/) {
  PumpDrainContext();
  // Re-arm after the drain: the dispatched callbacks may have added/removed
  // sources, and a due-now source must schedule another loop turn (the 0-ms
  // ref'd timer) even when Node itself has nothing left pending.
  PumpArmWakeups();
}

// pumpKick() -> void — drain ready GLib sources + re-arm the wake hints NOW.
// The L1 layer calls this from a `process.on('beforeExit')` hook: with only
// UNREF'd handles active, uv_run(UV_RUN_DEFAULT) returns without ever running
// the prepare/check callbacks (uv__loop_alive is false at entry), so an
// otherwise-empty loop would never arm the GLib timer/fd wake-ups and a pending
// top-level await on, say, a GLib timeout would exit with an unsettled-TLA error
// before the timeout could fire. beforeExit is emitted exactly at that point;
// the kick dispatches what is ready and — when GLib still has scheduled work —
// arms the REF'd uv timer, reviving the loop.
Napi::Value PumpKick(const Napi::CallbackInfo& info) {
  // Owner env only: a worker's beforeExit must not drive the MAIN loop's GLib
  // context or its uv handles from the worker thread.
  if (g_pump_inited && static_cast<napi_env>(info.Env()) == g_loop_env) {
    PumpDrainContext();
    PumpArmWakeups();
  }
  return info.Env().Undefined();
}

// The C→JS dispatch window (see common.h): JS run from a pump-driven iteration
// must not observe g_in_uv_pump, or a blocking loop it starts would keep the
// UvLoopSource co-pump parked (frozen Node timers for the whole run).
NodeGiPumpJsDispatchScope::NodeGiPumpJsDispatchScope() : saved_(g_in_uv_pump) {
  g_in_uv_pump = FALSE;
}
NodeGiPumpJsDispatchScope::~NodeGiPumpJsDispatchScope() { g_in_uv_pump = saved_; }

static void PumpInit(uv_loop_t* loop) {
  if (g_pump_inited) return;
  g_pump_polls = new std::unordered_map<int, PumpPoll*>();
  g_pump_fds = new std::vector<GPollFD>(16);

  // Own the default context on this (the JS) thread. Required so a cross-thread
  // g_source_attach (a completing GTask worker) signals the context's wakeup
  // eventfd — which our uv_poll watcher turns into a libuv wake. Same-thread
  // recursive acquisition by a later blocking g_main_loop_run() still works.
  g_pump_context_acquired = g_main_context_acquire(g_main_context_default());
  if (!g_pump_context_acquired) {
    g_printerr("(node-gi) warning: default GMainContext is owned by another thread; "
               "cross-thread wakeups may be delayed\n");
  }

  uv_prepare_init(loop, &g_pump_prepare);
  uv_prepare_start(&g_pump_prepare, PumpPrepareCb);
  uv_unref(reinterpret_cast<uv_handle_t*>(&g_pump_prepare));

  uv_check_init(loop, &g_pump_check);
  uv_check_start(&g_pump_check, PumpCheckCb);
  uv_unref(reinterpret_cast<uv_handle_t*>(&g_pump_check));

  uv_timer_init(loop, &g_pump_timer);
  uv_unref(reinterpret_cast<uv_handle_t*>(&g_pump_timer));

  g_pump_inited = TRUE;
}

// mainContextHasPending() -> boolean
//
// Is there JS-armed GLib work a *pumping* runtime must stay alive for? True
// while a GI callback the program handed to GLib is outstanding — a scope=async
// completion (a GAsyncReadyCallback) or a scope=notified source
// (`GLib.timeout_add`/`idle_add`), counted in calls.cc and released when GLib
// drops it. The query half of the keep-alive contract for the Bun/Deno pump
// (L1 `startMainContextPump`); Node reads the same counter inline in
// PumpArmWakeups and never calls this.
//
// It deliberately does NOT ask whether the context has any scheduled source.
// That probe (`g_main_context_prepare` + `_query`, timeout >= 0) reports the
// timers a TOOLKIT arms in C as well, and GDK keeps a ~1 s repeating timeout
// armed for the process's whole life: a finished GTK program then answers
// "pending" forever while nothing is ever ready to dispatch, and never exits.
// `gjs -m` would not stay alive for those either — it exits once the module
// settles. A `false` answer is also what lets a sync-only program exit
// immediately: the pump alone must never keep a finished program alive.
Napi::Value MainContextHasPending(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  return Napi::Boolean::New(env, g_pump_async_pending > 0);
}

// In-flight scope=async keep-alive: while any GI scope=async callback (a
// GAsyncReadyCallback) is pending, REF the (always-active) prepare handle so the
// libuv loop stays alive until the completion arrives — the exact analogue of
// Node's own in-flight I/O keeping the process alive, and the reason a plain
// top-level `await` on a Gio async op settles instead of exiting with an
// unsettled-TLA error.
//
// The COUNTER is maintained on every runtime, not just Node: it is the
// "in-flight async work" half of the keep-alive contract, and Bun/Deno's
// portable pump reads it through MainContextHasPending() to decide whether its
// timer holds the runtime's event loop open. Only the uv ref/unref half is
// Node-only (it needs the uv handles the uv pump owns). Main-thread only —
// where a pump env is known (Node), a foreign env is not counted.
bool NodeGiPumpAsyncBegin(napi_env env) {
  if (g_loop_env != nullptr && env != g_loop_env) return false;
  ++g_pump_async_pending;
  if (g_pump_inited && g_pump_async_pending == 1 && !g_pump_prepare_reffed) {
    uv_ref(reinterpret_cast<uv_handle_t*>(&g_pump_prepare));
    g_pump_prepare_reffed = TRUE;
  }
  return true;
}

void NodeGiPumpAsyncEnd() {
  if (g_pump_async_pending == 0) return;
  --g_pump_async_pending;
  if (g_pump_inited && g_pump_async_pending == 0 && g_pump_prepare_reffed) {
    uv_unref(reinterpret_cast<uv_handle_t*>(&g_pump_prepare));
    g_pump_prepare_reffed = FALSE;
  }
}

// Env-teardown: close the pump's uv handles so the loop can wind down cleanly.
// Only the env that armed the pump (the main env) tears it down.
void NodeGiPumpShutdown(napi_env env) {
  if (!g_pump_inited || env != g_loop_env) return;
  g_pump_inited = FALSE;
  uv_prepare_stop(&g_pump_prepare);
  uv_check_stop(&g_pump_check);
  uv_timer_stop(&g_pump_timer);
  uv_close(reinterpret_cast<uv_handle_t*>(&g_pump_prepare), nullptr);
  uv_close(reinterpret_cast<uv_handle_t*>(&g_pump_check), nullptr);
  uv_close(reinterpret_cast<uv_handle_t*>(&g_pump_timer), nullptr);
  if (g_pump_polls != nullptr) {
    for (auto& it : *g_pump_polls) {
      uv_poll_stop(&it.second->handle);
      uv_close(reinterpret_cast<uv_handle_t*>(&it.second->handle), PumpPollCloseCb);
    }
    delete g_pump_polls;
    g_pump_polls = nullptr;
  }
  delete g_pump_fds;
  g_pump_fds = nullptr;
  if (g_pump_context_acquired) {
    g_main_context_release(g_main_context_default());
    g_pump_context_acquired = FALSE;
  }
}

// startMainLoop() -> void
// Attach the libuv-backed GSource to the default GLib main context (idempotent).
// Harmless until a GLib main loop actually runs — it adds no uv handle, so it
// neither keeps Node alive nor runs uv on its own; it only pumps uv while a GLib
// loop is iterating. The L1 layer calls this once when a namespace is required.
// Also arms the uv-driven GLib auto-pump (above), so pending GLib sources keep
// dispatching WITHOUT a blocking GLib loop — the plain `node bundle.mjs` case.
Napi::Value StartMainLoop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_loop_started) return env.Undefined();

  uv_loop_t* loop = nullptr;
  if (napi_get_uv_event_loop(env, &loop) != napi_ok || loop == nullptr) {
    Napi::Error::New(env, "failed to obtain the libuv event loop").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Capture env + process._tickCallback for nextTick/microtask draining.
  g_loop_env = env;
  napi_value global = nullptr, process_v = nullptr, tick = nullptr;
  if (napi_get_global(env, &global) == napi_ok &&
      napi_get_named_property(env, global, "process", &process_v) == napi_ok &&
      process_v != nullptr) {
    napi_create_reference(env, process_v, 1, &g_process_ref);
    if (napi_get_named_property(env, process_v, "_tickCallback", &tick) == napi_ok) {
      napi_valuetype vt;
      if (napi_typeof(env, tick, &vt) == napi_ok && vt == napi_function) {
        napi_create_reference(env, tick, 1, &g_tick_callback_ref);
      }
    }
  }

  // UvLoopSource co-pumps Node's timers/I/O + drains its microtasks during a
  // BLOCKING GLib main loop (GLib.MainLoop.run / Gio.Application.run). POSIX embeds
  // uv's backend fd into the GSource (readiness-driven); Windows/IOCP has no backend
  // fd, so the Windows variant schedules off uv_loop_alive + uv_backend_timeout (see
  // uv_source_funcs above) — same dispatch (uv_run + DrainMicrotasks), woken at uv's
  // next-due time bounded by a 5 ms IOCP-completion poll cap instead of on the fd.
  // PumpInit below is the separate NON-blocking case (bare `node bundle.mjs` async).
#ifndef _WIN32
  GSource* source = g_source_new(&uv_source_funcs, sizeof(UvLoopSource));
  UvLoopSource* s = reinterpret_cast<UvLoopSource*>(source);
  s->loop = loop;
  s->fd_polled = TRUE;
  // uv_backend_fd is the epoll/kqueue fd on POSIX.
  s->fd_tag = g_source_add_unix_fd(source, uv_backend_fd(loop),
                                   static_cast<GIOCondition>(G_IO_IN | G_IO_OUT | G_IO_ERR));
  // PRIORITY — below GDK_PRIORITY_REDRAW (G_PRIORITY_HIGH_IDLE + 20), above
  // G_PRIORITY_DEFAULT_IDLE. At the g_source_new default (G_PRIORITY_DEFAULT, 0)
  // a busy Node loop STARVES GTK painting: GLib dispatches only the
  // highest-priority READY band per iteration, so a libuv timer that is due on
  // every prepare — a 1 ms metronome like Excalibur's requestIdleCallback
  // polyfill (`setTimeout(cb, 1)` re-armed from its own callback, run
  // perpetually by its GarbageCollector) — keeps this source ready at priority
  // 0 forever and GDK's frame-clock paint/update sources (GDK_PRIORITY_REDRAW,
  // G_PRIORITY_HIGH_IDLE + 20) never run again: ticks, GLArea renders and rAF
  // all freeze while plain GLib timeouts (priority 0) keep firing — the
  // Excalibur-on-node-gi stall. Under GJS there is no extra source competing
  // with GTK at default priority; the co-pump must not introduce one. Redraw
  // wins over Node work (browser-like: rendering outranks timers); Node I/O
  // still runs in every frame gap.
  g_source_set_priority(source, G_PRIORITY_HIGH_IDLE + 30);
  g_source_attach(source, nullptr);  // default GLib main context
  g_source_unref(source);            // the context holds the surviving ref
#else  // _WIN32 — readiness-bounded UvLoopSource (no uv backend fd on IOCP).
  GSource* source = g_source_new(&uv_source_funcs, sizeof(UvLoopSource));
  UvLoopSource* s = reinterpret_cast<UvLoopSource*>(source);
  s->loop = loop;
  s->fd_tag = nullptr;
  s->fd_polled = FALSE;
  s->win_next_wake_us = 0;  // due immediately on the first iteration (dispatch re-schedules)
  // Same priority rationale as POSIX (below GDK redraw, above default idle) so a
  // future GTK-on-Windows paint is not starved by the co-pump.
  g_source_set_priority(source, G_PRIORITY_HIGH_IDLE + 30);
  g_source_attach(source, nullptr);  // default GLib main context
  g_source_unref(source);            // the context holds the surviving ref
#endif  // _WIN32 (UvLoopSource blocking-loop co-pump)

  // Cross-platform: the uv-driven GLib pump (prepare/check/timer → g_main_context_
  // iteration) drains async Gio/timers/DBus without uv's backend fd — active on
  // Windows too (degraded to timed polling; see SyncPumpPolls).
  PumpInit(loop);

  g_loop_started = TRUE;
  return env.Undefined();
}

}  // namespace nodegi
