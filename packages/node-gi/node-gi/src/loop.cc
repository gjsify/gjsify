// SPDX-License-Identifier: MIT
// libuv <-> GLib main loop bridge: startMainLoop (uv-in-GLib GSource) +
// iterateMainContext + the uv-driven GLib auto-pump (GLib-in-libuv, the
// non-blocking case). Where there is no libuv (Android/NativeScript,
// NODE_GI_HAS_LIBUV off) the auto-pump rides the thread's ALooper instead; both
// halves implement the same Pump* interface and only one is compiled in.

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

#if !NODE_GI_HAS_LIBUV && defined(__ANDROID__)
// The libuv-less half of the auto-pump rides the thread's ALooper instead of a
// uv loop, with a timerfd carrying GLib's next deadline. ALooper_* comes from
// libandroid, so this build needs -landroid — the NativeScript runtime links it
// already; the standalone cross-build passes it explicitly.
#include <algorithm>

#include <android/looper.h>
#include <sys/timerfd.h>
#include <unistd.h>
#endif

namespace nodegi {

static napi_env g_loop_env = nullptr;  // captured at startMainLoop (main thread)
static gboolean g_loop_started = FALSE;

// TRUE while THIS addon's auto-pump is inside its own GLib work — draining the
// context or running the prepare/query hint pass. On Node the UvLoopSource
// consults it to PARK itself (mask the backend fd, report not-ready, skip
// uv_run): a pump-driven context iteration must never dispatch the uv-in-GLib
// source, or it would nest uv_run inside the very uv callback that drives the
// pump (uv_run is not reentrant) — and recursively re-enter the pump itself. On
// every host it additionally keeps the drain and the hint pass out of each
// other, which is all it does on the libuv-less Android pump (no co-pump there,
// so nothing to park). Name kept for the incident trail in common.h.
static gboolean g_in_uv_pump = FALSE;

#if NODE_GI_HAS_LIBUV

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

static napi_ref g_process_ref = nullptr;        // process
static napi_ref g_tick_callback_ref = nullptr;  // process._tickCallback

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

#endif  // NODE_GI_HAS_LIBUV (UvLoopSource + the Node nextTick/microtask drain)

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
// JSC's VM drain, callable mid-stack by design, and Bun's process.nextTick
// rides that same queue; Deno: core.runNextTicks — node's task_queues.js
// runNextTicks shape, draining the node-compat process.nextTick queue AND the
// V8 microtask checkpoint. core.runMicrotasks alone is NOT enough on Deno:
// its nextTick queue is separate from V8's microtasks, and node:stream's
// 'end' is nextTick-delivered (endReadableNT), so a microtask-only drain hung
// every fetch/XHR body consumption at readyState 3 during a blocking run —
// see test/blocking-run-checkpoint.test.mjs). index.js registers
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

#if NODE_GI_HAS_LIBUV
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
#endif  // NODE_GI_HAS_LIBUV

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

// ---- the GLib auto-pump (the non-blocking case) -----------------------------
//
// With NO blocking GLib loop running, a plain `node bundle.mjs` (or a
// NativeScript Android app) still needs pending GLib sources (Gio async
// completions, GLib timeouts/idles, DBus) to dispatch — under GJS the GLib loop
// IS the process loop, so they always do. The HOST's own event loop drives the
// default GLib main context instead, and the two halves of that are the same on
// every host:
//
//   • DRAIN — dispatch everything the context has ready right now
//     (PumpDrainContext), run from the host loop with a valid napi scope;
//   • WAKE — ask the context when its earliest timer is due and which fds it
//     polls (PumpQueryWakeups), then mirror both into whatever primitive the
//     host wakes on (PumpArmWakeups, the one host-specific half: libuv
//     timer/poll watchers on Node, a timerfd + ALooper_addFd on Android).
//
// Both of those must never run while a blocking GLib loop owns the context
// (g_main_depth() > 0) or re-entrantly from our own GLib work (g_in_uv_pump).

static gboolean g_pump_inited = FALSE;
static gboolean g_pump_context_acquired = FALSE;
static std::vector<GPollFD>* g_pump_fds = nullptr;  // query scratch (reused)
static int g_pump_async_pending = 0;  // in-flight scope=async GI callbacks

// Host-specific: mirror the queried deadline + fds into the host's wake-up
// primitives. Defined once per host below.
static void PumpArmWakeups();

// Drain every currently-ready GLib source (bounded). Each iteration is a full,
// self-contained GLib cycle, so readiness (fds, timers, idles) is re-evaluated
// natively — the host's watchers are pure wake-ups. No-op while a blocking GLib
// loop is dispatching (g_main_depth() > 0) or when re-entered from a nested
// host-loop turn inside our own dispatch (g_in_uv_pump).
static void PumpDrainContext() {
  if (g_main_depth() > 0 || g_in_uv_pump) return;
  GMainContext* ctx = g_main_context_default();
  // The drain runs from a bare host-loop C callback — there is NO ambient V8
  // HandleScope (unlike a blocking run(), which is entered through a
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

// The prepare+query+check HINT pass: learn GLib's earliest-timer deadline and
// which fds it polls, leaving the queried set in g_pump_fds[0..n). Returns the
// fd count, or -1 when the pass must not run. `*timeout` is GLib's
// milliseconds-to-next-deadline: 0 = work due now, -1 = no deadline. The
// g_in_uv_pump flag is held across it so UvLoopSource stays parked (masking
// uv's backend fd out of the queried set — it must not be watched, and uv's own
// backend timeout must not feed back into the deadline hint).
//
// The CHECK is not cosmetic and must never be dropped again: a GSource may hold
// a LOCK between its prepare() and its check(), and leaving the context prepared
// deadlocks the process on the next call into that library. GDK's Wayland event
// source is exactly that shape — its prepare() takes libwayland's designated-reader
// slot (`wl_display_prepare_read_queue`) and only its check() releases it
// (`wl_display_read_events` / `wl_display_cancel_read`). Measured (gjsify #1145,
// gtk 4.22 / Fedora 44 / Mesa Vulkan): with the hint pass ending at query, the very
// next `gtk_window_present()` blocked forever inside `wl_display_roundtrip_queue`
// under `gsk_renderer_new_for_surface_full`, so the app never finished showing its
// window while its GDBus worker thread kept answering Peer.Ping and Introspect —
// a live process at ~0.5 % CPU that read as "devtools hangs". Only Wayland shows
// it (GdkX11's source holds nothing across the pair), only node (bun/deno pump
// through complete `g_main_context_iteration`s), and only once GTK was initialised
// at g_main_depth() == 0 — `Gio.Application.register()` before `runAsync()` does
// exactly that, which is why an app that only ever calls `run()` never saw it.
// Passing revents = 0 is the right reading: this pass did NOT poll, so no fd is
// reported ready and every source that took something in prepare() gives it back.
//
// No dispatch pairs with the check: g_main_context_prepare() clears
// pending_dispatches on entry (glib gmain.c), and PumpDrainContext() runs on the
// same host-loop turn, so anything this marks ready is dispatched there rather
// than being stranded.
static int PumpQueryWakeups(gint* timeout) {
  if (!g_pump_inited || g_main_depth() > 0 || g_in_uv_pump) return -1;
  GMainContext* ctx = g_main_context_default();
  gint prio = 0;
  *timeout = -1;
  g_in_uv_pump = TRUE;
  g_main_context_prepare(ctx, &prio);
  int nfds = g_main_context_query(ctx, prio, timeout, g_pump_fds->data(),
                                  static_cast<gint>(g_pump_fds->size()));
  while (nfds > static_cast<int>(g_pump_fds->size())) {
    g_pump_fds->resize(nfds);
    nfds = g_main_context_query(ctx, prio, timeout, g_pump_fds->data(),
                                static_cast<gint>(g_pump_fds->size()));
  }
  // g_main_context_query fills fd + events and leaves revents untouched, so the
  // previous pass's values would otherwise be replayed as fresh readiness.
  for (int i = 0; i < nfds; i++) (*g_pump_fds)[i].revents = 0;
  g_main_context_check(ctx, prio, g_pump_fds->data(), nfds);
  g_in_uv_pump = FALSE;
  return nfds;
}

// Own the default context on this (the JS) thread. Required so a cross-thread
// g_source_attach (a completing GTask worker) signals the context's wakeup
// eventfd — which the host's fd watcher turns into a host-loop wake. Same-thread
// recursive acquisition by a later blocking g_main_loop_run() still works.
static void PumpAcquireContext() {
  g_pump_fds = new std::vector<GPollFD>(16);
  g_pump_context_acquired = g_main_context_acquire(g_main_context_default());
  if (!g_pump_context_acquired) {
    g_printerr("(node-gi) warning: default GMainContext is owned by another thread; "
               "cross-thread wakeups may be delayed\n");
  }
}

static void PumpReleaseContext() {
  delete g_pump_fds;
  g_pump_fds = nullptr;
  if (g_pump_context_acquired) {
    g_main_context_release(g_main_context_default());
    g_pump_context_acquired = FALSE;
  }
}

#if NODE_GI_HAS_LIBUV

// ---- the libuv-driven half (Node) -------------------------------------------
//
// The inverse co-pump of UvLoopSource: Node's libuv loop drives the default GLib
// main context.
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
  int events;        // currently-subscribed uv event mask
  gboolean seen;     // mark/sweep flag for SyncPumpPolls
  gboolean started;  // whether the watcher is currently armed (see PumpPollCb)
};

static uv_prepare_t g_pump_prepare;
static uv_check_t g_pump_check;
static uv_timer_t g_pump_timer;
static gboolean g_pump_timer_reffed = FALSE;
static std::unordered_map<int, PumpPoll*>* g_pump_polls = nullptr;
static gboolean g_pump_prepare_reffed = FALSE;
static gboolean g_pump_poll_warned = FALSE;

// Wake-only callbacks: readiness/expiry just ends libuv's poll sleep; the actual
// GLib dispatch happens in the check phase of the same loop turn (PumpCheckCb).
static void PumpTimerCb(uv_timer_t* /*t*/) {}

// A wake-up is an EDGE, so the watcher DISARMS itself on the first fire and
// PumpArmWakeups re-arms it on the next libuv turn. uv_poll is level-triggered
// and this callback reads nothing, so a GLib fd that stays ready — a dead D-Bus
// socket stuck at POLLHUP, or the context's own wakeup eventfd, which
// `block_source()` re-signals on every dispatch — leaves uv's backend fd
// PERPETUALLY readable. That fd is embedded in UvLoopSource, so GLib then reads
// "Node has work" on every prepare, and any foreign drain loop of the shape
// `while (g_main_context_iteration(ctx, FALSE));` never terminates: measured in
// `e_source_registry_new_sync`'s failure path (no D-Bus reachable), 6.9 M
// dispatches in 20 s at 100 % CPU with `uv_backend_timeout()` sitting at ~4.6 s,
// i.e. never once because Node actually had work. The pump's own drain would
// have cleared the GLib side, but it no-ops at `g_main_depth() > 0` — exactly
// where a foreign nested iteration runs. Regression
// `test/foreign-context-drain.test.mjs`.
static void PumpPollCb(uv_poll_t* p, int /*status*/, int /*events*/) {
  PumpPoll* pp = reinterpret_cast<PumpPoll*>(p->data);
  uv_poll_stop(p);
  pp->started = FALSE;
}

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
      // Re-arm a watcher that disarmed itself on its last fire, as well as one
      // whose event mask changed.
      if (pp->events != ev || !pp->started) {
        if (uv_poll_start(&pp->handle, ev, PumpPollCb) == 0) {
          pp->events = ev;
          pp->started = TRUE;
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
    pp->started = TRUE;
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

// Mirror GLib's queried deadline + fds into the uv timer / uv_poll watchers, so
// libuv's poll sleep ends exactly when GLib next has work.
static void PumpArmWakeups() {
  gint timeout = -1;
  const int nfds = PumpQueryWakeups(&timeout);
  if (nfds < 0) return;

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

static void PumpInit(uv_loop_t* loop) {
  if (g_pump_inited) return;
  g_pump_polls = new std::unordered_map<int, PumpPoll*>();
  PumpAcquireContext();

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

// Close the pump's uv handles so the loop can wind down cleanly.
static void PumpShutdownPlatform() {
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
}

#elif defined(__ANDROID__)

// ---- the ALooper-driven half (Android / NativeScript) -----------------------
//
// NativeScript's V8 runtime is a Node-API host with NO libuv of its own, so the
// whole uv half above is compiled out (NODE_GI_HAS_LIBUV 0 — common.h explains
// why a mere REFERENCE to a uv symbol is fatal there, not just a call). The
// host's event loop is Android's own ALooper on the thread that runs JS, and the
// pump mirrors GLib onto it with the two halves named at the top of this
// section:
//
//   • WAKE — every fd GLib queries is registered with ALooper_addFd, and GLib's
//     next deadline is armed on a timerfd registered the same way. The looper
//     then wakes for GLib I/O, for a cross-thread wakeup (the context's own
//     eventfd, signalled by a completing GTask worker) and for GLib timers
//     alike, instead of for a uv_poll/uv_timer.
//   • DRAIN — a looper callback runs from the host's poll, OUTSIDE any JS frame
//     or handle scope, so it must not touch napi or JS at all. It only posts a
//     threadsafe function; the TSFN's call_js runs on the JS thread inside a
//     proper handle + callback scope and does the drain plus the re-arm.
//
// No keep-alive half: Android's looper belongs to the app and outlives every
// pump, so there is nothing to ref or unref. g_pump_async_pending is still
// maintained (calls.cc does it unconditionally) and still answers
// mainContextHasPending(); it just holds nothing open here.
//
// NOT supported on this host: a BLOCKING GLib.MainLoop.run() / Gio.Application
// .run() on the UI thread. It would park Android's own looper — no input, no
// frames, an ANR — and there is no co-pump to borrow (UvLoopSource embeds uv's
// backend fd in a GSource; a looper exposes no such fd). Nothing refuses it at
// build or link time, since the boxed GLib.MainLoop surface is host-independent;
// it simply freezes the thread it is called on. An app drives GLib through this
// pump instead.

static ALooper* g_looper = nullptr;
static napi_threadsafe_function g_pump_tsfn = nullptr;
static int g_pump_timerfd = -1;
// The GLib poll fds currently registered with the looper (not the timerfd, which
// is added once and stays). Small by nature — a linear sweep beats a hash map.
static std::vector<int>* g_looper_fds = nullptr;
// A drain post is already in flight: one looper poll can report several fds
// ready for a single GLib cycle, and one drain answers all of them. Written only
// on the JS thread (every poster runs there), so no atomic.
static gboolean g_pump_posted = FALSE;

// Ask for a drain on the JS thread. Callable from a looper callback: the only
// napi function it touches is the non-blocking TSFN post, which is the one
// documented to be legal from any thread at any time.
static void PumpPostTsfn() {
  if (g_pump_tsfn == nullptr || g_pump_posted) return;
  if (napi_call_threadsafe_function(g_pump_tsfn, nullptr, napi_tsfn_nonblocking) == napi_ok) {
    g_pump_posted = TRUE;
  }
}

// A GLib poll fd became ready. Wake-only, and the wake is an EDGE for the same
// reason as on libuv (#1912): ALooper is level-triggered and this callback reads
// nothing, so an fd that STAYS ready — the context's wakeup eventfd, which
// block_source() re-signals on every dispatch, or a dead socket at POLLHUP —
// would spin the host loop at 100 % CPU. Returning 0 removes the registration;
// PumpArmWakeups re-adds whatever GLib still queries.
static int PumpLooperFdCb(int /*fd*/, int /*events*/, void* /*data*/) {
  PumpPostTsfn();
  return 0;
}

// The timerfd expired. This one KEEPS its registration (returns 1): read() is
// what clears the expiry, so it cannot stay spuriously ready, and an
// armed-again timer needs only a new itimerspec, not a new watcher.
static int PumpTimerFdCb(int fd, int /*events*/, void* /*data*/) {
  uint64_t expirations = 0;
  while (read(fd, &expirations, sizeof(expirations)) == sizeof(expirations)) {
  }
  PumpPostTsfn();
  return 1;
}

// Register every fd GLib queries, and drop the ones it no longer does.
// ALooper_addFd REPLACES an existing registration for the same fd, which is how
// a self-removed watcher (PumpLooperFdCb returning 0) comes back.
static void SyncLooperFds(int nfds) {
  std::vector<int> wanted;
  wanted.reserve(static_cast<size_t>(nfds));
  for (int i = 0; i < nfds; i++) {
    const GPollFD& pfd = (*g_pump_fds)[i];
    int events = 0;
    if (pfd.events & (G_IO_IN | G_IO_HUP | G_IO_ERR)) events |= ALOOPER_EVENT_INPUT;
    if (pfd.events & G_IO_OUT) events |= ALOOPER_EVENT_OUTPUT;
    if (events == 0) continue;
    if (ALooper_addFd(g_looper, pfd.fd, ALOOPER_POLL_CALLBACK, events, PumpLooperFdCb,
                      nullptr) == 1) {
      wanted.push_back(pfd.fd);
    }
  }
  for (int fd : *g_looper_fds) {
    if (std::find(wanted.begin(), wanted.end(), fd) == wanted.end()) {
      ALooper_removeFd(g_looper, fd);
    }
  }
  *g_looper_fds = std::move(wanted);
}

// Mirror GLib's deadline onto the timerfd. An all-zero it_value DISARMS a
// timerfd rather than firing immediately, so a 0 ms deadline ("work is due now")
// has to be answered by posting the drain directly; that drain re-arms.
static void ArmTimerfd(gint timeout) {
  if (g_pump_timerfd < 0) return;
  if (timeout == 0) {
    PumpPostTsfn();
    timeout = -1;
  }
  struct itimerspec its = {};
  if (timeout > 0) {
    its.it_value.tv_sec = timeout / 1000;
    its.it_value.tv_nsec = static_cast<long>(timeout % 1000) * 1000000L;
  }
  timerfd_settime(g_pump_timerfd, 0, &its, nullptr);
}

static void PumpArmWakeups() {
  gint timeout = -1;
  const int nfds = PumpQueryWakeups(&timeout);
  if (nfds < 0) return;
  SyncLooperFds(nfds);
  ArmTimerfd(timeout);
}

// The drain, on the JS thread, inside the scopes the TSFN infra provides.
static void PumpTsfnCb(napi_env /*env*/, napi_value /*js_cb*/, void* /*context*/,
                       void* /*data*/) {
  g_pump_posted = FALSE;
  if (!g_pump_inited) return;
  PumpDrainContext();
  PumpArmWakeups();
}

static void PumpInit(napi_env env, ALooper* looper) {
  if (g_pump_inited) return;
  g_looper = looper;
  g_looper_fds = new std::vector<int>();
  PumpAcquireContext();

  // js_func null — PumpTsfnCb IS the callback, and the TSFN infra invokes it
  // inside a handle + callback scope, so a dispatched GLib source re-entering JS
  // runs as a proper N-API callback. max_queue_size 1 coalesces bursts;
  // initial_thread_count 1 keeps it alive for the env's lifetime, so a looper
  // callback may post without acquiring first. Same shape as toggle.cc's drain.
  napi_value name = nullptr;
  napi_create_string_utf8(env, "node-gi:glib-pump", NAPI_AUTO_LENGTH, &name);
  if (napi_create_threadsafe_function(env, nullptr, nullptr, name, /*max_queue_size*/ 1,
                                      /*initial_thread_count*/ 1, nullptr, nullptr, nullptr,
                                      PumpTsfnCb, &g_pump_tsfn) != napi_ok) {
    g_pump_tsfn = nullptr;
  } else {
    // The pump must not hold the host loop open by itself (the uv_unref
    // equivalent). Best-effort: NativeScript no-ops TSFN ref/unref, and its
    // looper does not end anyway.
    napi_unref_threadsafe_function(env, g_pump_tsfn);
  }

  // NONBLOCK because PumpTimerFdCb read()s until EAGAIN; CLOEXEC so no
  // Gio.Subprocess child inherits it.
  g_pump_timerfd = timerfd_create(CLOCK_MONOTONIC, TFD_NONBLOCK | TFD_CLOEXEC);
  if (g_pump_timerfd >= 0) {
    ALooper_addFd(g_looper, g_pump_timerfd, ALOOPER_POLL_CALLBACK, ALOOPER_EVENT_INPUT,
                  PumpTimerFdCb, nullptr);
  }

  g_pump_inited = TRUE;
  // Arm the first wake-ups now. The uv half gets this for free from its
  // always-active prepare handle, which runs on the very next loop turn; here
  // nothing would ever ask until something already woke the looper.
  PumpArmWakeups();
}

// Unregister everything the pump put on the looper. Reached only through an env
// cleanup hook, which NativeScript never runs for the main env — so on the live
// host this is dead code, kept because the pump must not leak a watcher into a
// looper that outlives it on any host that DOES tear an env down.
static void PumpShutdownPlatform() {
  if (g_pump_tsfn != nullptr) {
    napi_release_threadsafe_function(g_pump_tsfn, napi_tsfn_release);
    g_pump_tsfn = nullptr;
  }
  if (g_looper_fds != nullptr) {
    for (int fd : *g_looper_fds) ALooper_removeFd(g_looper, fd);
    delete g_looper_fds;
    g_looper_fds = nullptr;
  }
  if (g_pump_timerfd >= 0) {
    ALooper_removeFd(g_looper, g_pump_timerfd);
    close(g_pump_timerfd);
    g_pump_timerfd = -1;
  }
  g_looper = nullptr;
}

#else
#error "no GLib auto-pump for this host: it has neither libuv nor an ALooper"
#endif  // NODE_GI_HAS_LIBUV / __ANDROID__ (the host-specific pump half)

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
#if !NODE_GI_HAS_LIBUV && defined(__ANDROID__)
    // Both calls above no-op while a blocking GLib loop owns the context or we
    // are re-entered from our own dispatch, and on this host nothing else will
    // come back for the work: the uv half has an always-active prepare handle
    // that retries every loop turn, the looper only wakes for something it
    // watches. The post defers the kick to a later JS-thread turn instead.
    PumpPostTsfn();
#endif
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

// makePumpPendingCount() -> Int32Array(1) OVER g_pump_async_pending (external,
// zero copy). The JS pump's beat reads this view instead of calling
// MainContextHasPending(): on Deno, merely ENTERING the addon from the pump's
// timer tick during the between-test-files GC window reproduces the #47
// boxed-handle teardown SIGSEGV — measured on the gtk-smoke leg, a query-only
// tick (one napi call, no dispatch) crashed 3/3 while a tick that never touches
// the addon exited 0. A typed-array read is a plain JS memory access, so the
// beat's idle path stays native-silent. No atomics: the counter is written only
// from the JS thread (Begin/End are main-thread only) and read from JS.
//
// A FACTORY, deliberately not created at addon Init: the @gjsify/napi shim
// (the gjs-napi conformance oracle runs node-gi under it) loud-stubs
// napi_create_external_arraybuffer, and the gjs host never arms the portable
// pump — L1 calls this lazily on the first Bun/Deno pump arm, so the stub is
// never reached where the view is never needed.
Napi::Value MakePumpPendingCount(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  static_assert(sizeof(g_pump_async_pending) == sizeof(int32_t),
                "the JS Int32Array view requires a 32-bit counter");
  // External buffer over static storage — no finalizer needed, the counter
  // outlives every env.
  Napi::ArrayBuffer buf =
      Napi::ArrayBuffer::New(env, &g_pump_async_pending, sizeof(g_pump_async_pending));
  return Napi::TypedArrayOf<int32_t>::New(env, 1, buf, 0, napi_int32_array);
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
#if NODE_GI_HAS_LIBUV
  if (g_pump_inited && g_pump_async_pending == 1 && !g_pump_prepare_reffed) {
    uv_ref(reinterpret_cast<uv_handle_t*>(&g_pump_prepare));
    g_pump_prepare_reffed = TRUE;
  }
#else
  // Nothing to hold open here (§ the ALooper half), but the work just armed may
  // be a SAME-THREAD source — a GLib idle or timeout added from JS — which does
  // not signal the context's wakeup eventfd, so no fd the looper watches
  // changed and the looper would sleep straight past it. Ask for a drain, which
  // re-arms the timerfd to the new deadline. (The uv half needs no equivalent:
  // its prepare handle re-queries on the very next loop turn.)
  //
  // This covers same-thread sources armed FROM JS only. One armed inside a C
  // library on this thread — GDK's repeating timeout is the known case, and only
  // track C of ADR 0104 reaches it — still waits for the next drain, because
  // nothing re-queries the context per looper turn the way uv's prepare does.
  if (g_pump_inited) PumpPostTsfn();
#endif
  return true;
}

void NodeGiPumpAsyncEnd() {
  if (g_pump_async_pending == 0) return;
  --g_pump_async_pending;
#if NODE_GI_HAS_LIBUV
  if (g_pump_inited && g_pump_async_pending == 0 && g_pump_prepare_reffed) {
    uv_unref(reinterpret_cast<uv_handle_t*>(&g_pump_prepare));
    g_pump_prepare_reffed = FALSE;
  }
#endif
}

// Env-teardown: release the pump's host handles so the host loop can wind down
// cleanly, then give the context back. Only the env that armed the pump (the
// main env) tears it down.
void NodeGiPumpShutdown(napi_env env) {
  if (!g_pump_inited || env != g_loop_env) return;
  g_pump_inited = FALSE;
  PumpShutdownPlatform();
  PumpReleaseContext();
}

#if NODE_GI_HAS_LIBUV

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

#elif defined(__ANDROID__)

// startMainLoop() -> void
// Arm the ALooper-driven GLib pump on the calling thread (idempotent). There is
// no uv-in-GLib bridge to attach alongside it: NativeScript's V8 host has no
// libuv loop to co-pump, so the pump is the whole bridge here — which also means
// a blocking GLib.MainLoop.run() has no co-pump to keep the host alive (see the
// ALooper half above).
Napi::Value StartMainLoop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_loop_started) return env.Undefined();

  // The looper of the thread that called in — the JS thread. NativeScript runs
  // JS on Android's UI thread, which always has one; a null answer means the
  // host called from a bare pthread that never prepared a looper, and there is
  // then nothing for GLib to be pumped by.
  ALooper* looper = ALooper_forThread();
  if (looper == nullptr) {
    Napi::Error::New(env,
                     "no ALooper on this thread: the GLib pump needs a looper-backed "
                     "thread (call startMainLoop from the JS thread)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  g_loop_env = env;
  PumpInit(env, looper);

  g_loop_started = TRUE;
  return env.Undefined();
}

#endif  // NODE_GI_HAS_LIBUV / __ANDROID__ (startMainLoop)

}  // namespace nodegi
