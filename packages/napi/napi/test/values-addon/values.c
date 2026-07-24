// SPDX-License-Identifier: MIT
// @gjsify/napi P0.1 gate addon — raw C Node-API, no node-addon-api.
//
// Round-trips create<->extract for double/int32/uint32/int64/bool/bigint and
// utf8/utf16/latin1 strings, the four coercions, singletons, a typeof sweep,
// escapable handle scopes, scope-mismatch detection, the loud-stub surface,
// and node_api_get_module_file_name. Built with stock node-gyp against
// Node's own headers (NAPI_VERSION=10).

#define NAPI_VERSION 10
#include <node_api.h>

#include <stdlib.h>
#include <string.h>

#define OK_OR_NULL(call)                                                       \
  do {                                                                         \
    if ((call) != napi_ok) return NULL;                                        \
  } while (0)

static napi_value get_arg(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  if (napi_get_cb_info(env, info, &argc, &arg, NULL, NULL) != napi_ok)
    return NULL;
  return arg;
}

// ---- numbers ----

static napi_value RtDouble(napi_env env, napi_callback_info info) {
  double v;
  napi_value out;
  OK_OR_NULL(napi_get_value_double(env, get_arg(env, info), &v));
  OK_OR_NULL(napi_create_double(env, v, &out));
  return out;
}

static napi_value Int32Of(napi_env env, napi_callback_info info) {
  int32_t v;
  napi_value out;
  OK_OR_NULL(napi_get_value_int32(env, get_arg(env, info), &v));
  OK_OR_NULL(napi_create_int32(env, v, &out));
  return out;
}

static napi_value Uint32Of(napi_env env, napi_callback_info info) {
  uint32_t v;
  napi_value out;
  OK_OR_NULL(napi_get_value_uint32(env, get_arg(env, info), &v));
  OK_OR_NULL(napi_create_uint32(env, v, &out));
  return out;
}

static napi_value Int64Of(napi_env env, napi_callback_info info) {
  int64_t v;
  napi_value out;
  OK_OR_NULL(napi_get_value_int64(env, get_arg(env, info), &v));
  OK_OR_NULL(napi_create_int64(env, v, &out));
  return out;
}

static napi_value RtBool(napi_env env, napi_callback_info info) {
  bool v;
  napi_value out;
  OK_OR_NULL(napi_get_value_bool(env, get_arg(env, info), &v));
  OK_OR_NULL(napi_get_boolean(env, v, &out));
  return out;
}

// ---- bigint ----

static napi_value RtBigint(napi_env env, napi_callback_info info) {
  int64_t v;
  bool lossless;
  napi_value out;
  OK_OR_NULL(
      napi_get_value_bigint_int64(env, get_arg(env, info), &v, &lossless));
  OK_OR_NULL(napi_create_bigint_int64(env, v, &out));
  return out;
}

static napi_value BigintLossless(napi_env env, napi_callback_info info) {
  int64_t v;
  bool lossless;
  napi_value out;
  OK_OR_NULL(
      napi_get_value_bigint_int64(env, get_arg(env, info), &v, &lossless));
  OK_OR_NULL(napi_get_boolean(env, lossless, &out));
  return out;
}

// ---- strings ----

static napi_value RtUtf8(napi_env env, napi_callback_info info) {
  napi_value arg = get_arg(env, info);
  size_t len;
  OK_OR_NULL(napi_get_value_string_utf8(env, arg, NULL, 0, &len));
  char* buf = malloc(len + 1);
  if (buf == NULL) return NULL;
  size_t written;
  if (napi_get_value_string_utf8(env, arg, buf, len + 1, &written) !=
      napi_ok) {
    free(buf);
    return NULL;
  }
  napi_value out = NULL;
  napi_create_string_utf8(env, buf, written, &out);
  free(buf);
  return out;
}

static napi_value RtUtf16(napi_env env, napi_callback_info info) {
  napi_value arg = get_arg(env, info);
  size_t len;
  OK_OR_NULL(napi_get_value_string_utf16(env, arg, NULL, 0, &len));
  char16_t* buf = malloc((len + 1) * sizeof(char16_t));
  if (buf == NULL) return NULL;
  size_t written;
  if (napi_get_value_string_utf16(env, arg, buf, len + 1, &written) !=
      napi_ok) {
    free(buf);
    return NULL;
  }
  napi_value out = NULL;
  napi_create_string_utf16(env, buf, written, &out);
  free(buf);
  return out;
}

// Latin1 extraction: UTF-16 units truncated to the low byte (WriteOneByteV2).
static napi_value Latin1Of(napi_env env, napi_callback_info info) {
  napi_value arg = get_arg(env, info);
  size_t len;
  OK_OR_NULL(napi_get_value_string_latin1(env, arg, NULL, 0, &len));
  char* buf = malloc(len + 1);
  if (buf == NULL) return NULL;
  size_t written;
  if (napi_get_value_string_latin1(env, arg, buf, len + 1, &written) !=
      napi_ok) {
    free(buf);
    return NULL;
  }
  napi_value out = NULL;
  napi_create_string_latin1(env, buf, written, &out);
  free(buf);
  return out;
}

// Extract utf8 into a fixed 3-byte buffer (2 payload bytes + NUL): truncation
// must respect code-point boundaries (never split a multi-byte sequence).
static napi_value Utf8Truncated(napi_env env, napi_callback_info info) {
  char buf[3];
  size_t written;
  OK_OR_NULL(napi_get_value_string_utf8(env, get_arg(env, info), buf,
                                        sizeof(buf), &written));
  napi_value out;
  OK_OR_NULL(napi_create_string_utf8(env, buf, written, &out));
  return out;
}

static napi_value Utf8Len(napi_env env, napi_callback_info info) {
  size_t len;
  napi_value out;
  OK_OR_NULL(napi_get_value_string_utf8(env, get_arg(env, info), NULL, 0,
                                        &len));
  OK_OR_NULL(napi_create_int64(env, (int64_t)len, &out));
  return out;
}

static napi_value Utf16Len(napi_env env, napi_callback_info info) {
  size_t len;
  napi_value out;
  OK_OR_NULL(napi_get_value_string_utf16(env, get_arg(env, info), NULL, 0,
                                         &len));
  OK_OR_NULL(napi_create_int64(env, (int64_t)len, &out));
  return out;
}

// ---- singletons ----

static napi_value Singletons(napi_env env, napi_callback_info info) {
  napi_value obj, undef, nul, t, f, glob;
  OK_OR_NULL(napi_create_object(env, &obj));
  OK_OR_NULL(napi_get_undefined(env, &undef));
  OK_OR_NULL(napi_get_null(env, &nul));
  OK_OR_NULL(napi_get_boolean(env, true, &t));
  OK_OR_NULL(napi_get_boolean(env, false, &f));
  OK_OR_NULL(napi_get_global(env, &glob));
  OK_OR_NULL(napi_set_named_property(env, obj, "undef", undef));
  OK_OR_NULL(napi_set_named_property(env, obj, "nul", nul));
  OK_OR_NULL(napi_set_named_property(env, obj, "t", t));
  OK_OR_NULL(napi_set_named_property(env, obj, "f", f));
  OK_OR_NULL(napi_set_named_property(env, obj, "glob", glob));
  return obj;
}

// ---- coercions (a thrown coercion propagates: NULL + pending exception) ----

static napi_value CoerceBool(napi_env env, napi_callback_info info) {
  napi_value out;
  OK_OR_NULL(napi_coerce_to_bool(env, get_arg(env, info), &out));
  return out;
}

static napi_value CoerceNumber(napi_env env, napi_callback_info info) {
  napi_value out;
  OK_OR_NULL(napi_coerce_to_number(env, get_arg(env, info), &out));
  return out;
}

static napi_value CoerceString(napi_env env, napi_callback_info info) {
  napi_value out;
  OK_OR_NULL(napi_coerce_to_string(env, get_arg(env, info), &out));
  return out;
}

static napi_value CoerceObject(napi_env env, napi_callback_info info) {
  napi_value out;
  OK_OR_NULL(napi_coerce_to_object(env, get_arg(env, info), &out));
  return out;
}

// ---- typeof sweep ----

static napi_value TypeofName(napi_env env, napi_callback_info info) {
  napi_valuetype t;
  OK_OR_NULL(napi_typeof(env, get_arg(env, info), &t));
  const char* name = "unknown";
  switch (t) {
    case napi_undefined: name = "undefined"; break;
    case napi_null: name = "null"; break;
    case napi_boolean: name = "boolean"; break;
    case napi_number: name = "number"; break;
    case napi_string: name = "string"; break;
    case napi_symbol: name = "symbol"; break;
    case napi_object: name = "object"; break;
    case napi_function: name = "function"; break;
    case napi_external: name = "external"; break;
    case napi_bigint: name = "bigint"; break;
  }
  napi_value out;
  OK_OR_NULL(napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &out));
  return out;
}

static napi_value MakeSymbol(napi_env env, napi_callback_info info) {
  napi_value out;
  OK_OR_NULL(napi_create_symbol(env, get_arg(env, info), &out));
  return out;
}

// ---- escapable handle scopes ----

// Create a string INSIDE an escapable scope, escape it, close the scope —
// the escaped value must survive (it lives in the parent region).
static napi_value EscapeTest(napi_env env, napi_callback_info info) {
  napi_escapable_handle_scope scope;
  OK_OR_NULL(napi_open_escapable_handle_scope(env, &scope));
  napi_value inner;
  if (napi_create_string_utf8(env, "escaped", NAPI_AUTO_LENGTH, &inner) !=
      napi_ok) {
    napi_close_escapable_handle_scope(env, scope);
    return NULL;
  }
  napi_value escaped;
  if (napi_escape_handle(env, scope, inner, &escaped) != napi_ok) {
    napi_close_escapable_handle_scope(env, scope);
    return NULL;
  }
  // Second escape must fail with napi_escape_called_twice.
  napi_value again;
  napi_status twice = napi_escape_handle(env, scope, inner, &again);
  OK_OR_NULL(napi_close_escapable_handle_scope(env, scope));
  if (twice != napi_escape_called_twice) return NULL;
  return escaped;
}

// LIFO discipline: closing a non-top scope must report
// napi_handle_scope_mismatch; matched closes succeed.
static napi_value ScopeMismatchDetected(napi_env env,
                                        napi_callback_info info) {
  napi_handle_scope outer, inner;
  OK_OR_NULL(napi_open_handle_scope(env, &outer));
  if (napi_open_handle_scope(env, &inner) != napi_ok) {
    napi_close_handle_scope(env, outer);
    return NULL;
  }
  napi_status wrong = napi_close_handle_scope(env, outer);  // not the top
  napi_status ok_inner = napi_close_handle_scope(env, inner);
  napi_status ok_outer = napi_close_handle_scope(env, outer);
  napi_value out;
  OK_OR_NULL(napi_get_boolean(env,
                              wrong == napi_handle_scope_mismatch &&
                                  ok_inner == napi_ok && ok_outer == napi_ok,
                              &out));
  return out;
}

// ---- loud-stub surface + last_error ----

static napi_value StubCheck(napi_env env, napi_callback_info info) {
  napi_value arr;
  napi_status s = napi_create_array(env, &arr);  // P0.1 stub
  const napi_extended_error_info* err = NULL;
  if (napi_get_last_error_info(env, &err) != napi_ok || err == NULL)
    return NULL;
  bool ok = s == napi_generic_failure &&
            err->error_code == napi_generic_failure &&
            err->error_message != NULL &&
            strcmp(err->error_message, "Unknown failure") == 0;
  napi_value out;
  OK_OR_NULL(napi_get_boolean(env, ok, &out));
  return out;
}

// ---- module surface ----

static napi_value FileName(napi_env env, napi_callback_info info) {
  const char* name = NULL;
  napi_value out;
  OK_OR_NULL(node_api_get_module_file_name(env, &name));
  OK_OR_NULL(napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &out));
  return out;
}

static napi_value Version(napi_env env, napi_callback_info info) {
  uint32_t v;
  napi_value out;
  OK_OR_NULL(napi_get_version(env, &v));
  OK_OR_NULL(napi_create_uint32(env, v, &out));
  return out;
}

// ---- registration ----

static napi_status set_fn(napi_env env, napi_value exports, const char* name,
                          napi_callback cb) {
  napi_value fn;
  napi_status s = napi_create_function(env, name, NAPI_AUTO_LENGTH, cb, NULL,
                                       &fn);
  if (s != napi_ok) return s;
  return napi_set_named_property(env, exports, name, fn);
}

static napi_value Init(napi_env env, napi_value exports) {
#define EXPORT_FN(js_name, fn)                                                 \
  do {                                                                         \
    if (set_fn(env, exports, js_name, fn) != napi_ok) return NULL;             \
  } while (0)
  EXPORT_FN("rtDouble", RtDouble);
  EXPORT_FN("int32Of", Int32Of);
  EXPORT_FN("uint32Of", Uint32Of);
  EXPORT_FN("int64Of", Int64Of);
  EXPORT_FN("rtBool", RtBool);
  EXPORT_FN("rtBigint", RtBigint);
  EXPORT_FN("bigintLossless", BigintLossless);
  EXPORT_FN("rtUtf8", RtUtf8);
  EXPORT_FN("rtUtf16", RtUtf16);
  EXPORT_FN("latin1Of", Latin1Of);
  EXPORT_FN("utf8Truncated", Utf8Truncated);
  EXPORT_FN("utf8Len", Utf8Len);
  EXPORT_FN("utf16Len", Utf16Len);
  EXPORT_FN("singletons", Singletons);
  EXPORT_FN("coerceBool", CoerceBool);
  EXPORT_FN("coerceNumber", CoerceNumber);
  EXPORT_FN("coerceString", CoerceString);
  EXPORT_FN("coerceObject", CoerceObject);
  EXPORT_FN("typeofName", TypeofName);
  EXPORT_FN("makeSymbol", MakeSymbol);
  EXPORT_FN("escapeTest", EscapeTest);
  EXPORT_FN("scopeMismatchDetected", ScopeMismatchDetected);
  EXPORT_FN("stubCheck", StubCheck);
  EXPORT_FN("fileName", FileName);
  EXPORT_FN("version", Version);
#undef EXPORT_FN
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
