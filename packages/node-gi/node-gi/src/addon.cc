// SPDX-License-Identifier: MIT
// @gjsify/node-gi — GObject-Introspection runtime for Node.js.
//
// Reference: refs/node-gtk (romgrk and node-gtk contributors, MIT). The design
// of this binding derives from node-gtk; this file is an original N-API
// implementation retargeted to the modern girepository-2.0 API (the
// GLib-integrated `gi_*` GIRepository merged into GLib >= 2.80; the standalone
// libgirepository-1.0 node-gtk linked no longer ships). GJS's gi/repo.cpp is
// the reference for the girepository-2.0 API surface.
//
// Milestone 1 (headless core, scaffold step): prove the toolchain + the modern
// GIRepository API end to end — resolve the default repository, require a
// namespace, read back its resolved version + introspection-info count, and
// enumerate the top-level info names. Marshalling, GObject/signals, the
// toggle-ref GC dance, and the mainloop bridge land in subsequent steps.

#include <napi.h>

#include <girepository/girepository.h>
#include <glib-object.h>
#include <glib.h>

#include <string>
#include <vector>

namespace {

// gi_repository_dup_default() returns a new owning ref to the process-default
// GIRepository (lazily created). Callers must g_object_unref() it.
GIRepository* DupDefaultRepository() { return gi_repository_dup_default(); }

// requireNamespace(namespace: string, version?: string)
//   -> { namespace: string, version: string, infoCount: number }
//
// Mirrors the load step every GJS gi:// / imports.gi access performs:
// gi_repository_require() with an optional pinned version (null = let
// GIRepository resolve the system default), then read back the resolved
// version and the top-level info count.
Napi::Value RequireNamespace(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "requireNamespace(namespace: string, version?: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string ns = info[0].As<Napi::String>().Utf8Value();
  bool has_version = info.Length() >= 2 && info[1].IsString();
  std::string version = has_version ? info[1].As<Napi::String>().Utf8Value() : std::string();

  GIRepository* repo = DupDefaultRepository();
  GError* error = nullptr;
  GITypelib* typelib = gi_repository_require(
      repo, ns.c_str(), has_version ? version.c_str() : nullptr,
      GI_REPOSITORY_LOAD_FLAG_NONE, &error);

  if (typelib == nullptr) {
    std::string message = error != nullptr ? error->message : "unknown error";
    if (error != nullptr) g_error_free(error);
    g_object_unref(repo);
    Napi::Error::New(env, "Failed to require " + ns +
                              (has_version ? (" " + version) : "") + ": " + message)
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  const char* resolved = gi_repository_get_version(repo, ns.c_str());
  unsigned int n_infos = gi_repository_get_n_infos(repo, ns.c_str());

  Napi::Object result = Napi::Object::New(env);
  result.Set("namespace", Napi::String::New(env, ns));
  result.Set("version", Napi::String::New(env, resolved != nullptr ? resolved : ""));
  result.Set("infoCount", Napi::Number::New(env, static_cast<double>(n_infos)));

  g_object_unref(repo);
  return result;
}

// listInfoNames(namespace: string) -> string[]
// Enumerates the top-level introspection infos of an already-required
// namespace. Proves gi_repository_get_info() + gi_base_info_get_name()/unref().
Napi::Value ListInfoNames(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "listInfoNames(namespace: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string ns = info[0].As<Napi::String>().Utf8Value();
  GIRepository* repo = DupDefaultRepository();
  unsigned int n_infos = gi_repository_get_n_infos(repo, ns.c_str());

  Napi::Array names = Napi::Array::New(env, n_infos);
  for (unsigned int i = 0; i < n_infos; i++) {
    GIBaseInfo* base = gi_repository_get_info(repo, ns.c_str(), i);
    const char* name = gi_base_info_get_name(base);
    names.Set(i, Napi::String::New(env, name != nullptr ? name : ""));
    gi_base_info_unref(base);
  }

  g_object_unref(repo);
  return names;
}

// prependSearchPath(path: string) -> void
// Lets a caller add a typelib search directory before requiring (the Node twin
// of GIRepository.prepend_search_path(); needed for non-system typelibs).
Napi::Value PrependSearchPath(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "prependSearchPath(path: string)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string path = info[0].As<Napi::String>().Utf8Value();
  GIRepository* repo = DupDefaultRepository();
  gi_repository_prepend_search_path(repo, path.c_str());
  g_object_unref(repo);
  return env.Undefined();
}

// ---- value marshalling (milestone 1: primitives + strings) ----
//
// The minimal GIArgument <-> JS boundary. This is the seam node-gtk's value.cc
// fills out exhaustively; here it covers the numeric + string + boolean tags so
// real GI function calls work end to end. Compound tags (ARRAY/INTERFACE/GLIST/
// GHASH/…) and OUT/INOUT directions land with the GObject + full-marshalling
// drops.

// Marshal a JS value into a GIArgument for an IN argument of `type`.
// `heldString` keeps UTF-8 storage alive for the duration of the call.
static bool JsToGIArgument(Napi::Env env, Napi::Value v, GITypeInfo* type, GIArgument* out,
                           std::string* heldString) {
  GITypeTag tag = gi_type_info_get_tag(type);
  switch (tag) {
    case GI_TYPE_TAG_BOOLEAN: out->v_boolean = v.ToBoolean().Value(); return true;
    case GI_TYPE_TAG_INT8: out->v_int8 = static_cast<int8_t>(v.ToNumber().Int32Value()); return true;
    case GI_TYPE_TAG_UINT8: out->v_uint8 = static_cast<uint8_t>(v.ToNumber().Uint32Value()); return true;
    case GI_TYPE_TAG_INT16: out->v_int16 = static_cast<int16_t>(v.ToNumber().Int32Value()); return true;
    case GI_TYPE_TAG_UINT16: out->v_uint16 = static_cast<uint16_t>(v.ToNumber().Uint32Value()); return true;
    case GI_TYPE_TAG_INT32: out->v_int32 = v.ToNumber().Int32Value(); return true;
    case GI_TYPE_TAG_UINT32: out->v_uint32 = v.ToNumber().Uint32Value(); return true;
    case GI_TYPE_TAG_INT64: out->v_int64 = v.ToNumber().Int64Value(); return true;
    case GI_TYPE_TAG_UINT64: out->v_uint64 = static_cast<uint64_t>(v.ToNumber().Int64Value()); return true;
    case GI_TYPE_TAG_FLOAT: out->v_float = static_cast<float>(v.ToNumber().DoubleValue()); return true;
    case GI_TYPE_TAG_DOUBLE: out->v_double = v.ToNumber().DoubleValue(); return true;
    case GI_TYPE_TAG_UTF8:
    case GI_TYPE_TAG_FILENAME:
      if (v.IsNull() || v.IsUndefined()) {
        out->v_string = nullptr;
        return true;
      }
      *heldString = v.ToString().Utf8Value();
      out->v_string = const_cast<char*>(heldString->c_str());
      return true;
    default:
      Napi::TypeError::New(
          env, "Unsupported IN argument type tag " + std::to_string(static_cast<int>(tag)) +
                   " (milestone 1 supports numbers, booleans and strings)")
          .ThrowAsJavaScriptException();
      return false;
  }
}

// Marshal a return-value GIArgument into a JS value, honouring transfer.
static Napi::Value GIArgumentToJs(Napi::Env env, GITypeInfo* type, GIArgument* arg,
                                  GITransfer transfer) {
  GITypeTag tag = gi_type_info_get_tag(type);
  switch (tag) {
    case GI_TYPE_TAG_VOID: return env.Undefined();
    case GI_TYPE_TAG_BOOLEAN: return Napi::Boolean::New(env, arg->v_boolean);
    case GI_TYPE_TAG_INT8: return Napi::Number::New(env, arg->v_int8);
    case GI_TYPE_TAG_UINT8: return Napi::Number::New(env, arg->v_uint8);
    case GI_TYPE_TAG_INT16: return Napi::Number::New(env, arg->v_int16);
    case GI_TYPE_TAG_UINT16: return Napi::Number::New(env, arg->v_uint16);
    case GI_TYPE_TAG_INT32: return Napi::Number::New(env, arg->v_int32);
    case GI_TYPE_TAG_UINT32: return Napi::Number::New(env, arg->v_uint32);
    case GI_TYPE_TAG_INT64: return Napi::Number::New(env, static_cast<double>(arg->v_int64));
    case GI_TYPE_TAG_UINT64: return Napi::Number::New(env, static_cast<double>(arg->v_uint64));
    case GI_TYPE_TAG_FLOAT: return Napi::Number::New(env, arg->v_float);
    case GI_TYPE_TAG_DOUBLE: return Napi::Number::New(env, arg->v_double);
    case GI_TYPE_TAG_UTF8:
    case GI_TYPE_TAG_FILENAME: {
      if (arg->v_string == nullptr) return env.Null();
      Napi::Value str = Napi::String::New(env, arg->v_string);
      if (transfer == GI_TRANSFER_EVERYTHING) g_free(arg->v_string);
      return str;
    }
    default:
      Napi::TypeError::New(env, "Unsupported return type tag " +
                                    std::to_string(static_cast<int>(tag)) + " (milestone 1)")
          .ThrowAsJavaScriptException();
      return env.Undefined();
  }
}

// callFunction(namespace, functionName, args?: unknown[]) -> unknown
// Invokes a namespace-level GI function (not an instance method) with IN-only
// primitive/string args. The first proof of the marshalling + invocation path;
// instance methods, OUT/INOUT params, and compound types follow.
Napi::Value CallFunction(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "callFunction(namespace: string, functionName: string, args?: unknown[])")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string ns = info[0].As<Napi::String>().Utf8Value();
  std::string fn = info[1].As<Napi::String>().Utf8Value();
  Napi::Array args = (info.Length() >= 3 && info[2].IsArray()) ? info[2].As<Napi::Array>()
                                                              : Napi::Array::New(env, 0);

  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* base = gi_repository_find_by_name(repo, ns.c_str(), fn.c_str());
  if (base == nullptr) {
    g_object_unref(repo);
    Napi::Error::New(env, "No such symbol: " + ns + "." + fn).ThrowAsJavaScriptException();
    return env.Null();
  }
  if (!GI_IS_FUNCTION_INFO(base)) {
    gi_base_info_unref(base);
    g_object_unref(repo);
    Napi::TypeError::New(env, ns + "." + fn + " is not a function").ThrowAsJavaScriptException();
    return env.Null();
  }
  GIFunctionInfo* func = reinterpret_cast<GIFunctionInfo*>(base);
  GICallableInfo* callable = reinterpret_cast<GICallableInfo*>(base);

  if (gi_callable_info_is_method(callable)) {
    gi_base_info_unref(base);
    g_object_unref(repo);
    Napi::TypeError::New(env, fn + ": instance methods are not yet supported (milestone 1: namespace functions only)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  unsigned int n_args = gi_callable_info_get_n_args(callable);
  std::vector<GIArgument> in_args(n_args);
  std::vector<std::string> held(n_args);
  bool ok = true;
  for (unsigned int i = 0; i < n_args; i++) {
    GIArgInfo* ai = gi_callable_info_get_arg(callable, i);
    GIDirection dir = gi_arg_info_get_direction(ai);
    if (dir != GI_DIRECTION_IN) {
      gi_base_info_unref(ai);
      Napi::TypeError::New(env, fn + ": OUT/INOUT parameters are not yet supported (milestone 1)")
          .ThrowAsJavaScriptException();
      ok = false;
      break;
    }
    GITypeInfo* ti = gi_arg_info_get_type_info(ai);
    Napi::Value v = i < args.Length() ? args.Get(i) : env.Undefined();
    ok = JsToGIArgument(env, v, ti, &in_args[i], &held[i]);
    gi_base_info_unref(ti);
    gi_base_info_unref(ai);
    if (!ok) break;
  }
  if (!ok) {
    gi_base_info_unref(base);
    g_object_unref(repo);
    return env.Null();
  }

  GIArgument retval;
  GError* error = nullptr;
  gboolean success = gi_function_info_invoke(func, in_args.data(), n_args, nullptr, 0, &retval, &error);
  if (!success) {
    std::string message = error != nullptr ? error->message : "invocation failed";
    if (error != nullptr) g_error_free(error);
    gi_base_info_unref(base);
    g_object_unref(repo);
    Napi::Error::New(env, "Calling " + ns + "." + fn + ": " + message).ThrowAsJavaScriptException();
    return env.Null();
  }

  GITypeInfo* return_type = gi_callable_info_get_return_type(callable);
  GITransfer return_transfer = gi_callable_info_get_caller_owns(callable);
  Napi::Value result = GIArgumentToJs(env, return_type, &retval, return_transfer);
  gi_base_info_unref(return_type);
  gi_base_info_unref(base);
  g_object_unref(repo);
  return result;
}

}  // namespace

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("requireNamespace", Napi::Function::New(env, RequireNamespace));
  exports.Set("listInfoNames", Napi::Function::New(env, ListInfoNames));
  exports.Set("prependSearchPath", Napi::Function::New(env, PrependSearchPath));
  exports.Set("callFunction", Napi::Function::New(env, CallFunction));
  return exports;
}

NODE_API_MODULE(node_gi, Init)
