// SPDX-License-Identifier: MIT
// PoC shim: the loop.cc surface for a single-threaded WebAssembly host.
//
// loop.cc has two halves — a libuv-driven pump (Node/Bun/Deno) and an ALooper
// pump (Android/NativeScript) — and `#error`s when the host has neither. A
// browser has neither: there is no OS event loop to co-pump, only the JS task
// queue, and nothing may ever block (a blocking g_main_loop_run would freeze
// the tab). So the whole AUTO-pump half is absent here on purpose; the host
// drives GLib explicitly by calling `iterateMainContext(false)` once per tick
// (requestAnimationFrame / setTimeout / queueMicrotask), which is exactly the
// non-blocking path loop.cc's uv pump takes internally.
//
// This file replaces loop.cc in the Wasm link. It is NOT a candidate for the
// product tree as-is: a real third host would get a third `#if` branch inside
// loop.cc beside NODE_GI_HAS_LIBUV and __ANDROID__. Keeping it separate here
// keeps the PoC out of the shipping source.

#include "common.h"

namespace nodegi {

// Mirrors loop.cc's counter: how many GI scope=async callbacks the program has
// handed to GLib and not yet got back. The host pump reads it — through the
// Int32Array view below on its idle path, via mainContextHasPending otherwise —
// to decide whether to keep ticking.
static int32_t g_pump_async_pending_storage = 0;
static int32_t* g_pump_async_pending = &g_pump_async_pending_storage;
static Napi::Reference<Napi::Int32Array> g_pump_pending_view;

// loop.cc's flag. Nothing here ever sets it (no auto-pump re-entrancy to
// guard), but the dispatch scope below still has to compile and behave.
static gboolean g_in_uv_pump = FALSE;

Napi::Value StartMainLoop(const Napi::CallbackInfo& info) {
  // No auto-pump on this host: arming one would mean blocking, and a browser
  // main thread may not block. The L1 layer ticks iterateMainContext instead.
  return info.Env().Undefined();
}

Napi::Value IterateMainContext(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // may_block is accepted for signature parity and deliberately ignored: a
  // blocking iteration cannot return control to the JS event loop.
  gboolean dispatched = g_main_context_iteration(g_main_context_default(), FALSE);
  return Napi::Boolean::New(env, dispatched == TRUE);
}

Napi::Value MainContextHasPending(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), *g_pump_async_pending > 0);
}

Napi::Value MakePumpPendingCount(const Napi::CallbackInfo& info) {
  // The zero-N-API view the L1 pump reads on its idle beat. Backed by an engine
  // -allocated ArrayBuffer rather than an external one over the counter's own
  // storage: emnapi's external arraybuffers are a copy, not a window onto the
  // Wasm heap, so the counter MOVES here instead of being aliased.
  Napi::Env env = info.Env();
  if (!g_pump_pending_view.IsEmpty()) return g_pump_pending_view.Value();
  Napi::Int32Array view = Napi::Int32Array::New(env, 1);
  view[0] = *g_pump_async_pending;
  g_pump_async_pending = reinterpret_cast<int32_t*>(view.ArrayBuffer().Data());
  g_pump_pending_view = Napi::Persistent(view);
  return view;
}

Napi::Value PumpKick(const Napi::CallbackInfo& info) {
  g_main_context_iteration(g_main_context_default(), FALSE);
  return info.Env().Undefined();
}

Napi::Value SetMicrotaskDrain(const Napi::CallbackInfo& info) {
  return info.Env().Undefined();
}

void NodeGiMaybeDrainMicrotasks(napi_env env) {
  // The host engine drains its own microtask queue at the callback boundary;
  // there is no napi_make_callback checkpoint to force here.
}

bool NodeGiPumpAsyncBegin(napi_env env) {
  (*g_pump_async_pending)++;
  return true;
}

void NodeGiPumpAsyncEnd() {
  if (*g_pump_async_pending > 0) (*g_pump_async_pending)--;
}

void NodeGiPumpShutdown(napi_env env) {}

NodeGiPumpJsDispatchScope::NodeGiPumpJsDispatchScope() : saved_(g_in_uv_pump) {
  g_in_uv_pump = FALSE;
}
NodeGiPumpJsDispatchScope::~NodeGiPumpJsDispatchScope() { g_in_uv_pump = saved_; }

}  // namespace nodegi
