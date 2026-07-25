// SPDX-License-Identifier: MIT
// @gjsify/napi P1 tsfn stress addon — raw C Node-API, pthreads.
//
// Exercises the threadsafe-function family from REAL foreign threads against
// the GJS host: nonblocking floods (unbounded queue, exact-delivery
// accounting), blocking pushes against a tiny bounded queue (cond wait +
// waiter drain), same-thread coalescing (max_queue_size=1 →
// napi_queue_full), and a release(abort) racing producers that are actively
// pushing (the closing push consumes the caller's claim — Node semantics).
// Every queued item is malloc'd and freed in call_js (including the
// env==NULL teardown drain), so valgrind proves the queue never leaks.

#include <node_api.h>
#include <pthread.h>
#include <sched.h>
#include <stdatomic.h>
#include <stdlib.h>

static atomic_long g_delivered = 0;  // call_js with a live env
static atomic_long g_dropped = 0;    // call_js with env == NULL (abort drain)
static atomic_int g_finalized = 0;   // thread finalizer ran (flood tsfn)
static atomic_int g_spin_finalized = 0;

static napi_threadsafe_function g_spin_tsfn = NULL;

typedef struct {
  napi_threadsafe_function tsfn;
  long calls;
} WorkerArgs;

static void CallJs(napi_env env, napi_value cb, void* ctx, void* data) {
  (void)ctx;
  free(data);
  if (env == NULL) {
    atomic_fetch_add(&g_dropped, 1);
    return;
  }
  atomic_fetch_add(&g_delivered, 1);
  if (cb != NULL) {
    napi_value undef;
    if (napi_get_undefined(env, &undef) == napi_ok) {
      napi_call_function(env, undef, cb, 0, NULL, NULL);
    }
  }
}

static void FinalizeCb(napi_env env, void* data, void* hint) {
  (void)env;
  (void)data;
  (void)hint;
  atomic_store(&g_finalized, 1);
}

static void SpinFinalizeCb(napi_env env, void* data, void* hint) {
  (void)env;
  (void)data;
  (void)hint;
  atomic_store(&g_spin_finalized, 1);
}

// Nonblocking flood: `calls` pushes, then release. Unbounded queue → every
// push must return napi_ok and be delivered exactly once.
static void* PushWorker(void* arg) {
  WorkerArgs* w = arg;
  for (long i = 0; i < w->calls; i++) {
    int* item = malloc(sizeof(int));
    *item = (int)i;
    napi_status st =
        napi_call_threadsafe_function(w->tsfn, item, napi_tsfn_nonblocking);
    if (st != napi_ok) {
      free(item);
      if (st == napi_closing) {
        free(w);
        return NULL;  // the closing push consumed our claim
      }
    }
    if ((i & 0xff) == 0) sched_yield();
  }
  napi_release_threadsafe_function(w->tsfn, napi_tsfn_release);
  free(w);
  return NULL;
}

// Blocking pushes against a bounded queue: the worker parks in the
// cond-wait until the JS thread drains space.
static void* BlockingWorker(void* arg) {
  WorkerArgs* w = arg;
  for (long i = 0; i < w->calls; i++) {
    int* item = malloc(sizeof(int));
    *item = (int)i;
    napi_status st =
        napi_call_threadsafe_function(w->tsfn, item, napi_tsfn_blocking);
    if (st != napi_ok) {
      free(item);
      if (st == napi_closing) {
        free(w);
        return NULL;
      }
    }
  }
  napi_release_threadsafe_function(w->tsfn, napi_tsfn_release);
  free(w);
  return NULL;
}

// Abort race: hammer nonblocking pushes until the JS thread aborts —
// napi_closing consumes the claim, ending the worker.
static void* SpinWorker(void* arg) {
  WorkerArgs* w = arg;
  for (;;) {
    napi_status st =
        napi_call_threadsafe_function(w->tsfn, NULL, napi_tsfn_nonblocking);
    if (st == napi_closing) break;
    if (st != napi_ok && st != napi_queue_full) break;  // unexpected — bail
    sched_yield();
  }
  free(w);
  return NULL;
}

static long GetLongArg(napi_env env, napi_value v) {
  int64_t out = 0;
  napi_get_value_int64(env, v, &out);
  return (long)out;
}

static napi_threadsafe_function MakeTsfn(napi_env env, napi_value cb,
                                         size_t max_queue, size_t threads,
                                         napi_finalize fin) {
  napi_value name;
  napi_create_string_utf8(env, "gjsify-napi:tsfn-stress", NAPI_AUTO_LENGTH,
                          &name);
  napi_threadsafe_function tsfn = NULL;
  napi_status st = napi_create_threadsafe_function(
      env, cb, NULL, name, max_queue, threads, NULL, fin, NULL, CallJs,
      &tsfn);
  return st == napi_ok ? tsfn : NULL;
}

static void SpawnDetached(void* (*fn)(void*), napi_threadsafe_function tsfn,
                          long calls) {
  WorkerArgs* w = malloc(sizeof(WorkerArgs));
  w->tsfn = tsfn;
  w->calls = calls;
  pthread_t t;
  pthread_create(&t, NULL, fn, w);
  pthread_detach(t);
}

// start(cb, nThreads, callsPerThread) — nonblocking flood, unbounded queue.
static napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  long threads = GetLongArg(env, argv[1]);
  long calls = GetLongArg(env, argv[2]);
  atomic_store(&g_finalized, 0);
  napi_threadsafe_function tsfn =
      MakeTsfn(env, argv[0], 0, (size_t)threads, FinalizeCb);
  if (tsfn == NULL) {
    napi_throw_error(env, NULL, "create_threadsafe_function failed");
    return NULL;
  }
  for (long i = 0; i < threads; i++) SpawnDetached(PushWorker, tsfn, calls);
  return NULL;
}

// startBlocking(cb, nThreads, callsPerThread) — blocking pushes, queue cap 2.
static napi_value StartBlocking(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  long threads = GetLongArg(env, argv[1]);
  long calls = GetLongArg(env, argv[2]);
  atomic_store(&g_finalized, 0);
  napi_threadsafe_function tsfn =
      MakeTsfn(env, argv[0], 2, (size_t)threads, FinalizeCb);
  if (tsfn == NULL) {
    napi_throw_error(env, NULL, "create_threadsafe_function failed");
    return NULL;
  }
  for (long i = 0; i < threads; i++)
    SpawnDetached(BlockingWorker, tsfn, calls);
  return NULL;
}

// startSpin(cb, nThreads) — abort race: workers hammer a size-1 queue until
// abortSpin() closes the tsfn under them. +1 claim belongs to the JS thread.
static napi_value StartSpin(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  long threads = GetLongArg(env, argv[1]);
  atomic_store(&g_spin_finalized, 0);
  g_spin_tsfn = MakeTsfn(env, argv[0], 1, (size_t)threads + 1, SpinFinalizeCb);
  if (g_spin_tsfn == NULL) {
    napi_throw_error(env, NULL, "create_threadsafe_function failed");
    return NULL;
  }
  for (long i = 0; i < threads; i++)
    SpawnDetached(SpinWorker, g_spin_tsfn, 0);
  return NULL;
}

// abortSpin() — release(abort) the JS thread's claim while workers push.
static napi_value AbortSpin(napi_env env, napi_callback_info info) {
  (void)info;
  if (g_spin_tsfn != NULL) {
    napi_status st =
        napi_release_threadsafe_function(g_spin_tsfn, napi_tsfn_abort);
    g_spin_tsfn = NULL;
    if (st != napi_ok) {
      napi_throw_error(env, NULL, "release(abort) failed");
    }
  }
  return NULL;
}

// callPair(cb) — same-thread coalescing on a size-1 queue: [first==napi_ok,
// second==napi_queue_full]. The single claim is then released; the queued
// item still gets delivered before the natural-close finalize (Node parity).
static napi_value CallPair(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  napi_threadsafe_function tsfn = MakeTsfn(env, argv[0], 1, 1, NULL);
  if (tsfn == NULL) {
    napi_throw_error(env, NULL, "create_threadsafe_function failed");
    return NULL;
  }
  napi_status st1 =
      napi_call_threadsafe_function(tsfn, malloc(sizeof(int)), napi_tsfn_nonblocking);
  napi_status st2 =
      napi_call_threadsafe_function(tsfn, NULL, napi_tsfn_nonblocking);
  napi_release_threadsafe_function(tsfn, napi_tsfn_release);
  napi_value result, ok1, ok2;
  napi_create_array_with_length(env, 2, &result);
  napi_get_boolean(env, st1 == napi_ok, &ok1);
  napi_get_boolean(env, st2 == napi_queue_full, &ok2);
  napi_set_element(env, result, 0, ok1);
  napi_set_element(env, result, 1, ok2);
  return result;
}

// stats() → [delivered, dropped, floodFinalized, spinFinalized]
static napi_value Stats(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result, v;
  napi_create_array_with_length(env, 4, &result);
  napi_create_int64(env, atomic_load(&g_delivered), &v);
  napi_set_element(env, result, 0, v);
  napi_create_int64(env, atomic_load(&g_dropped), &v);
  napi_set_element(env, result, 1, v);
  napi_create_int64(env, atomic_load(&g_finalized), &v);
  napi_set_element(env, result, 2, v);
  napi_create_int64(env, atomic_load(&g_spin_finalized), &v);
  napi_set_element(env, result, 3, v);
  return result;
}

// resetStats()
static napi_value ResetStats(napi_env env, napi_callback_info info) {
  (void)env;
  (void)info;
  atomic_store(&g_delivered, 0);
  atomic_store(&g_dropped, 0);
  return NULL;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
#define EXPORT(name, impl)                                                \
  do {                                                                    \
    if (napi_create_function(env, name, NAPI_AUTO_LENGTH, impl, NULL,     \
                             &fn) != napi_ok ||                           \
        napi_set_named_property(env, exports, name, fn) != napi_ok) {     \
      return NULL;                                                        \
    }                                                                     \
  } while (0)
  EXPORT("start", Start);
  EXPORT("startBlocking", StartBlocking);
  EXPORT("startSpin", StartSpin);
  EXPORT("abortSpin", AbortSpin);
  EXPORT("callPair", CallPair);
  EXPORT("stats", Stats);
  EXPORT("resetStats", ResetStats);
#undef EXPORT
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
