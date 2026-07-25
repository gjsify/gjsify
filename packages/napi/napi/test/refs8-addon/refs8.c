// SPDX-License-Identifier: MIT
// @gjsify/napi P0.3 gate addon — NAPI_VERSION=8 module (module_api_version
// gate): a <10 module may only reference object/function/symbol —
// napi_create_reference on a primitive must return napi_invalid_arg
// (js_native_api_v8.cc:2829-2834), while the SAME call succeeds in the
// version-10 lifetime addon (per-env gating across two envs in one process).

#define NAPI_VERSION 8
#include <node_api.h>

#define OK_OR_NULL(call)                                                       \
  do {                                                                         \
    if ((call) != napi_ok) return NULL;                                        \
  } while (0)

// refStatus(value) -> napi_status int of napi_create_reference(value, 0).
static napi_value RefStatus(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  OK_OR_NULL(napi_get_cb_info(env, info, &argc, &arg, NULL, NULL));
  napi_ref ref = NULL;
  napi_status s = napi_create_reference(env, arg, 0, &ref);
  if (s == napi_ok && ref != NULL) napi_delete_reference(env, ref);
  napi_value out;
  OK_OR_NULL(napi_create_int32(env, (int32_t)s, &out));
  return out;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  if (napi_create_function(env, "refStatus", NAPI_AUTO_LENGTH, RefStatus, NULL,
                           &fn) != napi_ok)
    return NULL;
  if (napi_set_named_property(env, exports, "refStatus", fn) != napi_ok)
    return NULL;
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
