// SPDX-License-Identifier: MIT
// @gjsify/napi P0.0 load-gate addon — raw C Node-API, no node-addon-api.
//
// Built as a completely NORMAL addon with node-gyp against Node's own
// headers (this is the whole leverage of the design, §3b): the resulting
// hello.node has undefined napi_* symbols that bind against whichever host
// exports the ABI — Node's executable there, the @gjsify/napi shim here.

#include <node_api.h>

static napi_value Hello(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_status status =
      napi_create_string_utf8(env, "hi", NAPI_AUTO_LENGTH, &result);
  if (status != napi_ok) {
    return NULL;
  }
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  if (napi_create_function(env, "hello", NAPI_AUTO_LENGTH, Hello, NULL, &fn) !=
      napi_ok) {
    return NULL;
  }
  if (napi_set_named_property(env, exports, "hello", fn) != napi_ok) {
    return NULL;
  }
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
