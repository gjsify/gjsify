// SPDX-License-Identifier: MIT
// @gjsify/napi P0.4 gate addon — raw C Node-API, no node-addon-api.
//
// Exercises the P0.4 surface: node::Buffer (create/copy/is/get_info) with THE
// §5f moving-GC pointer-stability proof (create a buffer, fill it native-side,
// force a full GC, read it back native-side AND from JS — the data pointer
// must be identical and the bytes intact), ArrayBuffer + typed array + DataView
// round-trips, Promise resolve AND reject, Date round-trip, and a uint64 BigInt
// round-trip. Built with stock node-gyp (NAPI_VERSION=10):
//
//   cd test/buffer-addon && npm exec -- node-gyp rebuild

#define NAPI_VERSION 10
#include <node_api.h>

#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>

#define OK_OR_NULL(call)                                                       \
  do {                                                                         \
    if ((call) != napi_ok) return NULL;                                        \
  } while (0)

// Deterministic byte pattern used by the §5f stability proof.
static unsigned char pat(size_t i) {
  return (unsigned char)((i * 7u + 3u) & 0xffu);
}

// The data pointer captured at napi_create_buffer time, and the one captured
// from a napi_get_buffer_info call — both re-checked after a forced GC.
static void* g_created_ptr = NULL;
static size_t g_created_len = 0;
static void* g_captured_ptr = NULL;

static napi_value bool_result(napi_env env, bool value) {
  napi_value r;
  OK_OR_NULL(napi_get_boolean(env, value, &r));
  return r;
}

static napi_value u32_result(napi_env env, uint32_t value) {
  napi_value r;
  OK_OR_NULL(napi_create_uint32(env, value, &r));
  return r;
}

// ---- node::Buffer + §5f pointer-stability proof ----

// Create a Buffer of `len` bytes, fill it native-side with the pattern, and
// stash its (stable, out-of-line) data pointer for the post-GC checks.
static napi_value CreatePattern(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  uint32_t len32 = 0;
  OK_OR_NULL(napi_get_value_uint32(env, argv[0], &len32));
  size_t len = (size_t)len32;
  void* data = NULL;
  napi_value buf;
  OK_OR_NULL(napi_create_buffer(env, len, &data, &buf));
  unsigned char* p = (unsigned char*)data;
  for (size_t i = 0; i < len; i++) p[i] = pat(i);
  g_created_ptr = data;
  g_created_len = len;
  return buf;
}

// §5f: the pointer napi_get_buffer_info returns after GC must equal the one
// napi_create_buffer handed out (out-of-line contents never move).
static napi_value CreatedPtrStable(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  void* data = NULL;
  size_t len = 0;
  OK_OR_NULL(napi_get_buffer_info(env, argv[0], &data, &len));
  return bool_result(env, data == g_created_ptr && len == g_created_len);
}

// §5f: the bytes are intact when read native-side after GC.
static napi_value PatternIntact(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  void* data = NULL;
  size_t len = 0;
  OK_OR_NULL(napi_get_buffer_info(env, argv[0], &data, &len));
  unsigned char* p = (unsigned char*)data;
  bool ok = true;
  for (size_t i = 0; i < len; i++) {
    if (p[i] != pat(i)) {
      ok = false;
      break;
    }
  }
  return bool_result(env, ok);
}

static napi_value NativeByteAt(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  void* data = NULL;
  size_t len = 0;
  OK_OR_NULL(napi_get_buffer_info(env, argv[0], &data, &len));
  uint32_t idx = 0;
  OK_OR_NULL(napi_get_value_uint32(env, argv[1], &idx));
  unsigned char* p = (unsigned char*)data;
  return u32_result(env, idx < len ? p[idx] : 0u);
}

static napi_value NativeSetByte(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  void* data = NULL;
  size_t len = 0;
  OK_OR_NULL(napi_get_buffer_info(env, argv[0], &data, &len));
  uint32_t idx = 0, val = 0;
  OK_OR_NULL(napi_get_value_uint32(env, argv[1], &idx));
  OK_OR_NULL(napi_get_value_uint32(env, argv[2], &val));
  if (idx < len) ((unsigned char*)data)[idx] = (unsigned char)val;
  return NULL;
}

static napi_value BufLen(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  void* data = NULL;
  size_t len = 0;
  OK_OR_NULL(napi_get_buffer_info(env, argv[0], &data, &len));
  return u32_result(env, (uint32_t)len);
}

// napi_create_buffer_copy: an INDEPENDENT copy of the source bytes.
static napi_value CopyOf(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  void* src = NULL;
  size_t len = 0;
  OK_OR_NULL(napi_get_buffer_info(env, argv[0], &src, &len));
  void* dst = NULL;
  napi_value out;
  OK_OR_NULL(napi_create_buffer_copy(env, len, src, &dst, &out));
  return out;
}

static napi_value IsBuf(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  bool b = false;
  OK_OR_NULL(napi_is_buffer(env, argv[0], &b));
  return bool_result(env, b);
}

// §5f for a FOREIGN (JS-created) view: the first napi_get_buffer_info pins its
// contents out-of-line (JS::EnsureNonInlineArrayBufferOrView), so the pointer
// is stable across a later GC. Capture returns the length.
static napi_value CaptureInfoPtr(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  void* data = NULL;
  size_t len = 0;
  OK_OR_NULL(napi_get_buffer_info(env, argv[0], &data, &len));
  g_captured_ptr = data;
  return u32_result(env, (uint32_t)len);
}

static napi_value InfoPtrStable(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  void* data = NULL;
  size_t len = 0;
  OK_OR_NULL(napi_get_buffer_info(env, argv[0], &data, &len));
  return bool_result(env, data == g_captured_ptr);
}

// ---- external (zero-copy) buffer: the user finalizer owns the data ----
//
// napi_create_external_buffer wraps the user's malloc'd data without copying;
// the SM contents deleter frees nothing, and the user's napi_finalize (below)
// runs on the loop when the buffer dies, freeing the data exactly once. The
// valgrind leg (test/p04-mem.sh) drives this create -> GC -> free loop.

static int g_ext_freed = 0;

static void FreeExternalData(napi_env env, void* data, void* hint) {
  (void)env;
  (void)hint;
  free(data);
  g_ext_freed++;
}

static napi_value MakeExternal(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  uint32_t len32 = 0;
  OK_OR_NULL(napi_get_value_uint32(env, argv[0], &len32));
  size_t len = (size_t)len32;
  unsigned char* data = (unsigned char*)malloc(len ? len : 1);
  for (size_t i = 0; i < len; i++) data[i] = pat(i);
  napi_value buf;
  OK_OR_NULL(napi_create_external_buffer(env, len, data, FreeExternalData, NULL,
                                         &buf));
  return buf;
}

static napi_value ExternalFreedCount(napi_env env, napi_callback_info info) {
  (void)info;
  return u32_result(env, (uint32_t)g_ext_freed);
}

// ---- ArrayBuffer + typed array + DataView ----

// Create an ArrayBuffer, fill it native-side, and return a Uint8Array view
// over bytes [4, 12) (offset 4, length 8, element 0 == byte 4 == 8).
static napi_value CreateTA(napi_env env, napi_callback_info info) {
  (void)info;
  void* data = NULL;
  napi_value ab;
  OK_OR_NULL(napi_create_arraybuffer(env, 16, &data, &ab));
  unsigned char* p = (unsigned char*)data;
  for (int i = 0; i < 16; i++) p[i] = (unsigned char)((i * 2) & 0xff);
  napi_value ta;
  OK_OR_NULL(napi_create_typedarray(env, napi_uint8_array, 8, ab, 4, &ta));
  return ta;
}

// [type, length, byteOffset, data[0], underlying-is-arraybuffer].
static napi_value TAInfo(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  napi_typedarray_type type;
  size_t length = 0, byte_offset = 0;
  void* data = NULL;
  napi_value ab;
  OK_OR_NULL(napi_get_typedarray_info(env, argv[0], &type, &length, &data, &ab,
                                      &byte_offset));
  napi_value arr, v;
  OK_OR_NULL(napi_create_array_with_length(env, 5, &arr));
  OK_OR_NULL(napi_create_uint32(env, (uint32_t)type, &v));
  OK_OR_NULL(napi_set_element(env, arr, 0, v));
  OK_OR_NULL(napi_create_uint32(env, (uint32_t)length, &v));
  OK_OR_NULL(napi_set_element(env, arr, 1, v));
  OK_OR_NULL(napi_create_uint32(env, (uint32_t)byte_offset, &v));
  OK_OR_NULL(napi_set_element(env, arr, 2, v));
  OK_OR_NULL(napi_create_uint32(env, ((unsigned char*)data)[0], &v));
  OK_OR_NULL(napi_set_element(env, arr, 3, v));
  bool isab = false;
  OK_OR_NULL(napi_is_arraybuffer(env, ab, &isab));
  OK_OR_NULL(napi_get_boolean(env, isab, &v));
  OK_OR_NULL(napi_set_element(env, arr, 4, v));
  return arr;
}

static napi_value IsTA(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  bool b = false;
  OK_OR_NULL(napi_is_typedarray(env, argv[0], &b));
  return bool_result(env, b);
}

// Create an ArrayBuffer filled data[i]=i, return a DataView over [2, 8).
static napi_value CreateDV(napi_env env, napi_callback_info info) {
  (void)info;
  void* data = NULL;
  napi_value ab;
  OK_OR_NULL(napi_create_arraybuffer(env, 16, &data, &ab));
  unsigned char* p = (unsigned char*)data;
  for (int i = 0; i < 16; i++) p[i] = (unsigned char)i;
  napi_value dv;
  OK_OR_NULL(napi_create_dataview(env, 6, ab, 2, &dv));
  return dv;
}

// [byteLength, byteOffset, data[0], underlying-is-arraybuffer].
static napi_value DVInfo(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  size_t byte_length = 0, byte_offset = 0;
  void* data = NULL;
  napi_value ab;
  OK_OR_NULL(napi_get_dataview_info(env, argv[0], &byte_length, &data, &ab,
                                    &byte_offset));
  napi_value arr, v;
  OK_OR_NULL(napi_create_array_with_length(env, 4, &arr));
  OK_OR_NULL(napi_create_uint32(env, (uint32_t)byte_length, &v));
  OK_OR_NULL(napi_set_element(env, arr, 0, v));
  OK_OR_NULL(napi_create_uint32(env, (uint32_t)byte_offset, &v));
  OK_OR_NULL(napi_set_element(env, arr, 1, v));
  OK_OR_NULL(napi_create_uint32(env, ((unsigned char*)data)[0], &v));
  OK_OR_NULL(napi_set_element(env, arr, 2, v));
  bool isab = false;
  OK_OR_NULL(napi_is_arraybuffer(env, ab, &isab));
  OK_OR_NULL(napi_get_boolean(env, isab, &v));
  OK_OR_NULL(napi_set_element(env, arr, 3, v));
  return arr;
}

static napi_value IsDV(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  bool b = false;
  OK_OR_NULL(napi_is_dataview(env, argv[0], &b));
  return bool_result(env, b);
}

// ---- Promises ----
//
// The settle is NOT observable synchronously in this native call — the
// reaction jobs run on GJS's microtask queue, which the driver drains (a
// GLib main-context turn) before it reads the settled value/reason.

static napi_value MakeResolved(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  napi_deferred deferred;
  napi_value promise;
  OK_OR_NULL(napi_create_promise(env, &deferred, &promise));
  OK_OR_NULL(napi_resolve_deferred(env, deferred, argv[0]));
  return promise;
}

static napi_value MakeRejected(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  napi_deferred deferred;
  napi_value promise;
  OK_OR_NULL(napi_create_promise(env, &deferred, &promise));
  OK_OR_NULL(napi_reject_deferred(env, deferred, argv[0]));
  return promise;
}

static napi_value IsProm(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  bool b = false;
  OK_OR_NULL(napi_is_promise(env, argv[0], &b));
  return bool_result(env, b);
}

// ---- Dates ----

static napi_value MakeDate(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  double ms = 0;
  OK_OR_NULL(napi_get_value_double(env, argv[0], &ms));
  napi_value d;
  OK_OR_NULL(napi_create_date(env, ms, &d));
  return d;
}

static napi_value DateVal(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  double ms = 0;
  OK_OR_NULL(napi_get_date_value(env, argv[0], &ms));
  napi_value r;
  OK_OR_NULL(napi_create_double(env, ms, &r));
  return r;
}

static napi_value IsDate(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  bool b = false;
  OK_OR_NULL(napi_is_date(env, argv[0], &b));
  return bool_result(env, b);
}

// ---- BigInt (uint64) ----

static napi_value BigRoundTrip(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  uint64_t u = 0;
  bool lossless = false;
  OK_OR_NULL(napi_get_value_bigint_uint64(env, argv[0], &u, &lossless));
  napi_value r;
  OK_OR_NULL(napi_create_bigint_uint64(env, u, &r));
  return r;
}

static napi_value BigLossless(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  uint64_t u = 0;
  bool lossless = false;
  OK_OR_NULL(napi_get_value_bigint_uint64(env, argv[0], &u, &lossless));
  return bool_result(env, lossless);
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
  EXPORT_FN("createPattern", CreatePattern);
  EXPORT_FN("createdPtrStable", CreatedPtrStable);
  EXPORT_FN("patternIntact", PatternIntact);
  EXPORT_FN("nativeByteAt", NativeByteAt);
  EXPORT_FN("nativeSetByte", NativeSetByte);
  EXPORT_FN("bufLen", BufLen);
  EXPORT_FN("copyOf", CopyOf);
  EXPORT_FN("isBuf", IsBuf);
  EXPORT_FN("captureInfoPtr", CaptureInfoPtr);
  EXPORT_FN("infoPtrStable", InfoPtrStable);
  EXPORT_FN("makeExternal", MakeExternal);
  EXPORT_FN("externalFreedCount", ExternalFreedCount);
  EXPORT_FN("createTA", CreateTA);
  EXPORT_FN("taInfo", TAInfo);
  EXPORT_FN("isTA", IsTA);
  EXPORT_FN("createDV", CreateDV);
  EXPORT_FN("dvInfo", DVInfo);
  EXPORT_FN("isDV", IsDV);
  EXPORT_FN("makeResolved", MakeResolved);
  EXPORT_FN("makeRejected", MakeRejected);
  EXPORT_FN("isProm", IsProm);
  EXPORT_FN("makeDate", MakeDate);
  EXPORT_FN("dateVal", DateVal);
  EXPORT_FN("isDate", IsDate);
  EXPORT_FN("bigRoundTrip", BigRoundTrip);
  EXPORT_FN("bigLossless", BigLossless);
#undef EXPORT_FN
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
