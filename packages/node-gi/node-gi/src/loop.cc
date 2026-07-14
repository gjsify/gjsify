// SPDX-License-Identifier: MIT
// libuv <-> GLib main loop bridge: startMainLoop (uv-in-GLib GSource) + iterateMainContext.

#include "common.h"

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
  gpointer fd_tag;
  gboolean fd_polled;
};

static napi_env g_loop_env = nullptr;       // captured at startMainLoop (main thread)
static gboolean g_loop_started = FALSE;
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

static gboolean uv_source_prepare(GSource* base, gint* timeout) {
  UvLoopSource* s = reinterpret_cast<UvLoopSource*>(base);
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
  UvLoopSource* s = reinterpret_cast<UvLoopSource*>(base);
  uv_run(s->loop, UV_RUN_NOWAIT);
  DrainMicrotasks();
  return G_SOURCE_CONTINUE;
}

static GSourceFuncs uv_source_funcs = {
    uv_source_prepare, nullptr, uv_source_dispatch, nullptr, nullptr, nullptr,
};

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

// startMainLoop() -> void
// Attach the libuv-backed GSource to the default GLib main context (idempotent).
// Harmless until a GLib main loop actually runs — it adds no uv handle, so it
// neither keeps Node alive nor runs uv on its own; it only pumps uv while a GLib
// loop is iterating. The L1 layer calls this once when a namespace is required.
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

  GSource* source = g_source_new(&uv_source_funcs, sizeof(UvLoopSource));
  UvLoopSource* s = reinterpret_cast<UvLoopSource*>(source);
  s->loop = loop;
  s->fd_polled = TRUE;
  // uv_backend_fd is the epoll/kqueue fd on POSIX. (Windows uses a different
  // wake mechanism — node-gtk guards it; this milestone targets Linux/Fedora.)
  s->fd_tag = g_source_add_unix_fd(source, uv_backend_fd(loop),
                                   static_cast<GIOCondition>(G_IO_IN | G_IO_OUT | G_IO_ERR));
  g_source_attach(source, nullptr);  // default GLib main context
  g_source_unref(source);            // the context holds the surviving ref

  g_loop_started = TRUE;
  return env.Undefined();
}

}  // namespace nodegi
