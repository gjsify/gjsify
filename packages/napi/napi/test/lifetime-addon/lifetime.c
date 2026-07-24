// SPDX-License-Identifier: MIT
// @gjsify/napi P0.3 gate addon — raw C Node-API, no node-addon-api.
//
// THE CRASH CLASS, empirically: strong/weak refs (death under forced GC,
// resurrection), v10 primitive refs, wrap + finalizer (exactly-once on GC
// death OR teardown, never both), externals, napi_add_finalizer, type tags,
// instance data (overwrite un-finalized), env cleanup hooks (LIFO). Finalizer
// invocations are logged into a static ring the driver reads back; teardown-
// time finalizers additionally print to stdout so the runner script can
// assert post-exit ordering. Built with stock node-gyp (NAPI_VERSION=10).

#define NAPI_VERSION 10
#include <node_api.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define OK_OR_NULL(call)                                                       \
  do {                                                                         \
    if ((call) != napi_ok) return NULL;                                        \
  } while (0)

// ---- finalizer log ----

#define MAX_LOG 128
static int32_t g_log[MAX_LOG];
static int g_log_len = 0;

static void log_event(int32_t id) {
  if (g_log_len < MAX_LOG) g_log[g_log_len++] = id;
}

// The shared logging finalizer: data = (intptr_t)id. Also prints so the
// teardown-time drain (after the driver script ended) is observable.
static void LoggingFinalizer(napi_env env, void* data, void* hint) {
  (void)env;
  (void)hint;
  int32_t id = (int32_t)(intptr_t)data;
  log_event(id);
  printf("FINALIZE %d\n", (int)id);
  fflush(stdout);
}

static napi_value FinalizeLog(napi_env env, napi_callback_info info) {
  napi_value arr;
  OK_OR_NULL(napi_create_array_with_length(env, (size_t)g_log_len, &arr));
  for (int i = 0; i < g_log_len; i++) {
    napi_value v;
    OK_OR_NULL(napi_create_int32(env, g_log[i], &v));
    OK_OR_NULL(napi_set_element(env, arr, (uint32_t)i, v));
  }
  return arr;
}

static napi_value ResetLog(napi_env env, napi_callback_info info) {
  g_log_len = 0;
  return NULL;
}

// ---- reference registry ----

#define MAX_REFS 64
static napi_ref g_refs[MAX_REFS];
static int g_ref_count = 0;

static napi_value get_arg(napi_env env, napi_callback_info info,
                          napi_value* second) {
  size_t argc = 2;
  napi_value args[2] = {NULL, NULL};
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok)
    return NULL;
  if (second != NULL) *second = args[1];
  return args[0];
}

// makeRef(value, initialRefcount) -> id
static napi_value MakeRef(napi_env env, napi_callback_info info) {
  napi_value count_v = NULL;
  napi_value value = get_arg(env, info, &count_v);
  uint32_t initial = 0;
  if (count_v != NULL) napi_get_value_uint32(env, count_v, &initial);
  if (g_ref_count >= MAX_REFS) return NULL;
  napi_ref ref = NULL;
  OK_OR_NULL(napi_create_reference(env, value, initial, &ref));
  g_refs[g_ref_count] = ref;
  napi_value out;
  OK_OR_NULL(napi_create_int32(env, g_ref_count, &out));
  g_ref_count++;
  return out;
}

// makeRefStatus(value, initialRefcount) -> status int (for <10 gate)
static napi_value MakeRefStatus(napi_env env, napi_callback_info info) {
  napi_value count_v = NULL;
  napi_value value = get_arg(env, info, &count_v);
  uint32_t initial = 0;
  if (count_v != NULL) napi_get_value_uint32(env, count_v, &initial);
  napi_ref ref = NULL;
  napi_status s = napi_create_reference(env, value, initial, &ref);
  if (s == napi_ok && ref != NULL) napi_delete_reference(env, ref);
  napi_value out;
  OK_OR_NULL(napi_create_int32(env, (int32_t)s, &out));
  return out;
}

static napi_ref ref_by_id(napi_env env, napi_callback_info info) {
  napi_value arg = get_arg(env, info, NULL);
  int32_t id = -1;
  if (arg == NULL || napi_get_value_int32(env, arg, &id) != napi_ok)
    return NULL;
  if (id < 0 || id >= g_ref_count) return NULL;
  return g_refs[id];
}

static napi_value RefGet(napi_env env, napi_callback_info info) {
  napi_ref ref = ref_by_id(env, info);
  if (ref == NULL) return NULL;
  napi_value out = NULL;
  OK_OR_NULL(napi_get_reference_value(env, ref, &out));
  return out;  // NULL (undefined to JS) when dead/released
}

static napi_value RefIsEmpty(napi_env env, napi_callback_info info) {
  napi_ref ref = ref_by_id(env, info);
  if (ref == NULL) return NULL;
  napi_value value = NULL;
  OK_OR_NULL(napi_get_reference_value(env, ref, &value));
  napi_value out;
  OK_OR_NULL(napi_get_boolean(env, value == NULL, &out));
  return out;
}

static napi_value RefRef(napi_env env, napi_callback_info info) {
  napi_ref ref = ref_by_id(env, info);
  if (ref == NULL) return NULL;
  uint32_t count = 0;
  OK_OR_NULL(napi_reference_ref(env, ref, &count));
  napi_value out;
  OK_OR_NULL(napi_create_uint32(env, count, &out));
  return out;
}

static napi_value RefUnref(napi_env env, napi_callback_info info) {
  napi_ref ref = ref_by_id(env, info);
  if (ref == NULL) return NULL;
  uint32_t count = 0;
  OK_OR_NULL(napi_reference_unref(env, ref, &count));
  napi_value out;
  OK_OR_NULL(napi_create_uint32(env, count, &out));
  return out;
}

static napi_value RefUnrefStatus(napi_env env, napi_callback_info info) {
  napi_ref ref = ref_by_id(env, info);
  if (ref == NULL) return NULL;
  napi_status s = napi_reference_unref(env, ref, NULL);
  napi_value out;
  OK_OR_NULL(napi_create_int32(env, (int32_t)s, &out));
  return out;
}

static napi_value RefDelete(napi_env env, napi_callback_info info) {
  napi_value arg = get_arg(env, info, NULL);
  int32_t id = -1;
  if (arg == NULL || napi_get_value_int32(env, arg, &id) != napi_ok)
    return NULL;
  if (id < 0 || id >= g_ref_count || g_refs[id] == NULL) return NULL;
  OK_OR_NULL(napi_delete_reference(env, g_refs[id]));
  g_refs[id] = NULL;  // double napi_delete_reference is UB (Node parity)
  return NULL;
}

// Delete every still-registered ref (used by the teardown-stress cleanup
// hook path and the mem loop to stay valgrind-clean).
static napi_value DeleteAllRefs(napi_env env, napi_callback_info info) {
  for (int i = 0; i < g_ref_count; i++) {
    if (g_refs[i] != NULL) {
      napi_delete_reference(env, g_refs[i]);
      g_refs[i] = NULL;
    }
  }
  g_ref_count = 0;
  return NULL;
}

// ---- wrap ----

// wrapFinalize(obj, id): kRuntime wrap with the logging finalizer.
static napi_value WrapFinalize(napi_env env, napi_callback_info info) {
  napi_value id_v = NULL;
  napi_value obj = get_arg(env, info, &id_v);
  int32_t id = 0;
  OK_OR_NULL(napi_get_value_int32(env, id_v, &id));
  OK_OR_NULL(napi_wrap(env, obj, (void*)(intptr_t)id, LoggingFinalizer, NULL,
                       NULL));
  return obj;
}

static napi_value UnwrapId(napi_env env, napi_callback_info info) {
  napi_value obj = get_arg(env, info, NULL);
  void* data = NULL;
  OK_OR_NULL(napi_unwrap(env, obj, &data));
  napi_value out;
  OK_OR_NULL(napi_create_int32(env, (int32_t)(intptr_t)data, &out));
  return out;
}

static napi_value RemoveWrapId(napi_env env, napi_callback_info info) {
  napi_value obj = get_arg(env, info, NULL);
  void* data = NULL;
  OK_OR_NULL(napi_remove_wrap(env, obj, &data));
  napi_value out;
  OK_OR_NULL(napi_create_int32(env, (int32_t)(intptr_t)data, &out));
  return out;
}

static napi_value WrapStatus(napi_env env, napi_callback_info info) {
  napi_value id_v = NULL;
  napi_value obj = get_arg(env, info, &id_v);
  int32_t id = 0;
  napi_get_value_int32(env, id_v, &id);
  napi_status s =
      napi_wrap(env, obj, (void*)(intptr_t)id, LoggingFinalizer, NULL, NULL);
  napi_value out;
  OK_OR_NULL(napi_create_int32(env, (int32_t)s, &out));
  return out;
}

// ---- externals ----

static napi_value MakeExternal(napi_env env, napi_callback_info info) {
  napi_value id_v = get_arg(env, info, NULL);
  int32_t id = 0;
  OK_OR_NULL(napi_get_value_int32(env, id_v, &id));
  napi_value out = NULL;
  OK_OR_NULL(napi_create_external(env, (void*)(intptr_t)id, LoggingFinalizer,
                                  NULL, &out));
  return out;
}

static napi_value ExternalId(napi_env env, napi_callback_info info) {
  napi_value ext = get_arg(env, info, NULL);
  void* data = NULL;
  OK_OR_NULL(napi_get_value_external(env, ext, &data));
  napi_value out;
  OK_OR_NULL(napi_create_int32(env, (int32_t)(intptr_t)data, &out));
  return out;
}

static napi_value TypeofName(napi_env env, napi_callback_info info) {
  napi_valuetype t;
  OK_OR_NULL(napi_typeof(env, get_arg(env, info, NULL), &t));
  const char* name = t == napi_external ? "external" : "other";
  napi_value out;
  OK_OR_NULL(napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &out));
  return out;
}

// ---- napi_add_finalizer ----

static napi_value AddFinalizer(napi_env env, napi_callback_info info) {
  napi_value id_v = NULL;
  napi_value obj = get_arg(env, info, &id_v);
  int32_t id = 0;
  OK_OR_NULL(napi_get_value_int32(env, id_v, &id));
  OK_OR_NULL(napi_add_finalizer(env, obj, (void*)(intptr_t)id,
                                LoggingFinalizer, NULL, NULL));
  return obj;
}

// ---- type tags ----

static napi_value TagObject(napi_env env, napi_callback_info info) {
  napi_value tag_v = NULL;
  napi_value obj = get_arg(env, info, &tag_v);
  uint32_t seed = 0;
  OK_OR_NULL(napi_get_value_uint32(env, tag_v, &seed));
  napi_type_tag tag = {0x1000 + seed, 0x2000 + seed};
  napi_status s = napi_type_tag_object(env, obj, &tag);
  napi_value out;
  OK_OR_NULL(napi_create_int32(env, (int32_t)s, &out));
  return out;
}

static napi_value CheckTag(napi_env env, napi_callback_info info) {
  napi_value tag_v = NULL;
  napi_value obj = get_arg(env, info, &tag_v);
  uint32_t seed = 0;
  OK_OR_NULL(napi_get_value_uint32(env, tag_v, &seed));
  napi_type_tag tag = {0x1000 + seed, 0x2000 + seed};
  bool matches = false;
  OK_OR_NULL(napi_check_object_type_tag(env, obj, &tag, &matches));
  napi_value out;
  OK_OR_NULL(napi_get_boolean(env, matches, &out));
  return out;
}

// ---- instance data ----

static napi_value SetInstanceData(napi_env env, napi_callback_info info) {
  napi_value id_v = get_arg(env, info, NULL);
  int32_t id = 0;
  OK_OR_NULL(napi_get_value_int32(env, id_v, &id));
  OK_OR_NULL(napi_set_instance_data(env, (void*)(intptr_t)id,
                                    LoggingFinalizer, NULL));
  return NULL;
}

static napi_value GetInstanceData(napi_env env, napi_callback_info info) {
  void* data = NULL;
  OK_OR_NULL(napi_get_instance_data(env, &data));
  napi_value out;
  OK_OR_NULL(napi_create_int32(env, (int32_t)(intptr_t)data, &out));
  return out;
}

// ---- env cleanup hooks (LIFO; print so post-exit ordering is assertable) --

static void CleanupHook(void* arg) {
  int32_t id = (int32_t)(intptr_t)arg;
  log_event(id);
  printf("CLEANUP %d\n", (int)id);
  fflush(stdout);
}

static napi_value RegisterCleanupHooks(napi_env env, napi_callback_info info) {
  // Register 100, 101, 102 (must run 102, 101, 100), plus 103 which is
  // removed again and must NOT run.
  OK_OR_NULL(napi_add_env_cleanup_hook(env, CleanupHook, (void*)(intptr_t)100));
  OK_OR_NULL(napi_add_env_cleanup_hook(env, CleanupHook, (void*)(intptr_t)101));
  OK_OR_NULL(napi_add_env_cleanup_hook(env, CleanupHook, (void*)(intptr_t)102));
  OK_OR_NULL(napi_add_env_cleanup_hook(env, CleanupHook, (void*)(intptr_t)103));
  OK_OR_NULL(
      napi_remove_env_cleanup_hook(env, CleanupHook, (void*)(intptr_t)103));
  return NULL;
}

// ---- registration ----

static napi_status set_fn(napi_env env, napi_value exports, const char* name,
                          napi_callback cb) {
  napi_value fn;
  napi_status s =
      napi_create_function(env, name, NAPI_AUTO_LENGTH, cb, NULL, &fn);
  if (s != napi_ok) return s;
  return napi_set_named_property(env, exports, name, fn);
}

static napi_value Init(napi_env env, napi_value exports) {
#define EXPORT_FN(js_name, fn)                                                 \
  do {                                                                         \
    if (set_fn(env, exports, js_name, fn) != napi_ok) return NULL;             \
  } while (0)
  EXPORT_FN("finalizeLog", FinalizeLog);
  EXPORT_FN("resetLog", ResetLog);
  EXPORT_FN("makeRef", MakeRef);
  EXPORT_FN("makeRefStatus", MakeRefStatus);
  EXPORT_FN("refGet", RefGet);
  EXPORT_FN("refIsEmpty", RefIsEmpty);
  EXPORT_FN("refRef", RefRef);
  EXPORT_FN("refUnref", RefUnref);
  EXPORT_FN("refUnrefStatus", RefUnrefStatus);
  EXPORT_FN("refDelete", RefDelete);
  EXPORT_FN("deleteAllRefs", DeleteAllRefs);
  EXPORT_FN("wrapFinalize", WrapFinalize);
  EXPORT_FN("unwrapId", UnwrapId);
  EXPORT_FN("removeWrapId", RemoveWrapId);
  EXPORT_FN("wrapStatus", WrapStatus);
  EXPORT_FN("makeExternal", MakeExternal);
  EXPORT_FN("externalId", ExternalId);
  EXPORT_FN("typeofName", TypeofName);
  EXPORT_FN("addFinalizer", AddFinalizer);
  EXPORT_FN("tagObject", TagObject);
  EXPORT_FN("checkTag", CheckTag);
  EXPORT_FN("setInstanceData", SetInstanceData);
  EXPORT_FN("getInstanceData", GetInstanceData);
  EXPORT_FN("registerCleanupHooks", RegisterCleanupHooks);
#undef EXPORT_FN
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
