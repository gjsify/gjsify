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
//
// It also exports three ENV-TEARDOWN shapes (holdSelf / holdForeign /
// holdDraining) that deliberately leave claims outstanding at env teardown, one
// per claim-owner class — the fixtures for test/tsfn-teardown-gate.mjs.

#include <node_api.h>
#include <pthread.h>
#include <sched.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>

static atomic_long g_delivered = 0;  // call_js with a live env
static atomic_long g_dropped = 0;    // call_js with env == NULL (abort drain)
static atomic_int g_finalized = 0;   // thread finalizer ran (flood tsfn)
static atomic_int g_spin_finalized = 0;
// DrainWorkers whose FIRST push has RETURNED — i.e. the number of DISTINCT
// threads the shim has credited one of holdDraining's initial claims to (it
// attributes under its own mutex before the call can return). g_delivered
// cannot stand in for this: it counts DELIVERIES, so N of them can come from
// one thread that pushed N times while the other N-1 have not run once, which
// leaves those claims unattributed and makes the teardown warn — correctly —
// against a shape that promised silence.
static atomic_long g_drain_pushers = 0;

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

// Returns false if the worker could not be started. Callers MUST report that:
// a thread that never runs holds its initial claim forever, which at env
// teardown is byte-identical to a thread that has merely not been scheduled
// yet. Discarding pthread_create's status turns a hard failure into the exact
// intermittent teardown warning this fixture's readiness gates exist to rule
// out, with nothing in the output to tell the two apart.
static bool SpawnDetached(void* (*fn)(void*), napi_threadsafe_function tsfn,
                          long calls) {
  WorkerArgs* w = malloc(sizeof(WorkerArgs));
  if (w == NULL) {
    return false;
  }
  w->tsfn = tsfn;
  w->calls = calls;
  pthread_t t;
  if (pthread_create(&t, NULL, fn, w) != 0) {
    free(w);
    return false;
  }
  pthread_detach(t);
  return true;
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
  for (long i = 0; i < threads; i++) {
    if (!SpawnDetached(PushWorker, tsfn, calls)) {
      napi_throw_error(env, NULL, "pthread_create failed");
      return NULL;
    }
  }
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
  for (long i = 0; i < threads; i++) {
    if (!SpawnDetached(BlockingWorker, tsfn, calls)) {
      napi_throw_error(env, NULL, "pthread_create failed");
      return NULL;
    }
  }
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
  for (long i = 0; i < threads; i++) {
    if (!SpawnDetached(SpinWorker, g_spin_tsfn, 0)) {
      napi_throw_error(env, NULL, "pthread_create failed");
      return NULL;
    }
  }
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

// ---- teardown-shape entry points (test/tsfn-teardown-gate.mjs) ----
//
// Three tsfns that are STILL ALIVE when the env tears down, one per claim-owner
// shape. They deliberately violate the "release every claim before teardown"
// rule — that is the whole point: the shim has to tell the shapes apart.

// A worker that proves it owns a claim (one push) and then parks forever
// without ever releasing it: a foreign claim that can never be handed back.
static void* ParkWorker(void* arg) {
  WorkerArgs* w = arg;
  int* item = malloc(sizeof(int));
  *item = 0;
  if (napi_call_threadsafe_function(w->tsfn, item, napi_tsfn_nonblocking) !=
      napi_ok) {
    free(item);
  }
  free(w);
  for (;;) sleep(3600);
  return NULL;
}

// A worker in the canonical Node shutdown shape (refs/node/test/node-api/
// test_threadsafe_function_shutdown): push in a loop until the env closes the
// tsfn under it — the napi_closing return consumes the claim, so it drains.
static void* DrainWorker(void* arg) {
  WorkerArgs* w = arg;
  int counted = 0;
  for (;;) {
    int* item = malloc(sizeof(int));
    *item = 0;
    napi_status st =
        napi_call_threadsafe_function(w->tsfn, item, napi_tsfn_nonblocking);
    // Count this thread ONCE, on the first push to RETURN — whatever the
    // status. The shim attributes the calling thread's claim under its own
    // mutex before either the queue-full or the napi_closing early-return, so
    // a returned push means this worker's initial claim is attributed;
    // gating on napi_ok would under-count and reintroduce the race.
    if (!counted) {
      counted = 1;
      atomic_fetch_add(&g_drain_pushers, 1);
    }
    if (st != napi_ok) {
      free(item);
      if (st == napi_closing) break;
    }
    struct timespec ts = {0, 1000000};  // 1 ms
    nanosleep(&ts, NULL);
  }
  free(w);
  return NULL;
}

// holdSelf(cb, push) — ONE initial claim that stays on the JS thread and is
// never released. `push` makes the JS thread call once first, which PROVES it
// owns the claim (js_claims); without it the claim stays unattributed. Neither
// can ever be handed back from inside the env-teardown join.
static napi_value HoldSelf(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  bool push = false;
  if (argc > 1) napi_get_value_bool(env, argv[1], &push);
  napi_threadsafe_function tsfn = MakeTsfn(env, argv[0], 0, 1, NULL);
  if (tsfn == NULL) {
    napi_throw_error(env, NULL, "create_threadsafe_function failed");
    return NULL;
  }
  if (push) {
    int* item = malloc(sizeof(int));
    *item = 0;
    if (napi_call_threadsafe_function(tsfn, item, napi_tsfn_nonblocking) !=
        napi_ok) {
      free(item);
    }
  }
  return NULL;
}

// holdForeign(cb) — ONE initial claim handed to a worker that pushes once and
// then parks forever: an ATTRIBUTED foreign claim that never comes back.
static napi_value HoldForeign(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  napi_threadsafe_function tsfn = MakeTsfn(env, argv[0], 0, 1, NULL);
  if (tsfn == NULL) {
    napi_throw_error(env, NULL, "create_threadsafe_function failed");
    return NULL;
  }
  if (!SpawnDetached(ParkWorker, tsfn, 0)) {
    napi_throw_error(env, NULL, "pthread_create failed");
    return NULL;
  }
  return NULL;
}

// holdDraining(cb, nThreads) — nThreads initial claims, one per worker, each
// pushing until the teardown close hands its claim back.
static napi_value HoldDraining(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  long threads = GetLongArg(env, argv[1]);
  // Reset HERE, not in resetStats(): this is the one point at which no
  // DrainWorker exists yet. Each worker counts itself exactly once and never
  // again, so zeroing the counter under a live fan-out would strand it below
  // `threads` forever and hang the readiness wait. A second holdDraining call
  // in one process must keep this reset-before-spawn ordering.
  atomic_store(&g_drain_pushers, 0);
  napi_threadsafe_function tsfn =
      MakeTsfn(env, argv[0], 0, (size_t)threads, NULL);
  if (tsfn == NULL) {
    napi_throw_error(env, NULL, "create_threadsafe_function failed");
    return NULL;
  }
  for (long i = 0; i < threads; i++) {
    if (!SpawnDetached(DrainWorker, tsfn, 0)) {
      napi_throw_error(env, NULL, "pthread_create failed");
      return NULL;
    }
  }
  return NULL;
}

// stats() → [delivered, dropped, floodFinalized, spinFinalized, drainPushers]
// [4] is the only PER-THREAD figure here; [0] counts deliveries, which is not
// the same question and must not be used as a stand-in for it (see
// g_drain_pushers).
static napi_value Stats(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result, v;
  napi_create_array_with_length(env, 5, &result);
  napi_create_int64(env, atomic_load(&g_delivered), &v);
  napi_set_element(env, result, 0, v);
  napi_create_int64(env, atomic_load(&g_dropped), &v);
  napi_set_element(env, result, 1, v);
  napi_create_int64(env, atomic_load(&g_finalized), &v);
  napi_set_element(env, result, 2, v);
  napi_create_int64(env, atomic_load(&g_spin_finalized), &v);
  napi_set_element(env, result, 3, v);
  napi_create_int64(env, atomic_load(&g_drain_pushers), &v);
  napi_set_element(env, result, 4, v);
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
  EXPORT("holdSelf", HoldSelf);
  EXPORT("holdForeign", HoldForeign);
  EXPORT("holdDraining", HoldDraining);
  EXPORT("stats", Stats);
  EXPORT("resetStats", ResetStats);
#undef EXPORT
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
