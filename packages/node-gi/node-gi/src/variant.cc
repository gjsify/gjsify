// SPDX-License-Identifier: MIT
// GVariant build / unpack (the GLib.Variant ergonomics).

#include "common.h"

namespace nodegi {

// ====================================================================
// ---- GVariant build / unpack (the GLib.Variant ergonomics) ---------
// ====================================================================
//
// The native half of GJS's `GLib.Variant` override (gjs/modules/core/overrides/
// GLib.js): a recursive packer `new GLib.Variant(signature, value)` and an
// unpacker driving `.unpack()` / `.deepUnpack()` / `.recursiveUnpack()`. The L1
// layer (gi.js) wires the GJS-shaped surface on top of these primitives.
//
// SCOPE — the common signatures real GAction/GSettings/DBus code hits: the
// basics `b y n q i u x t h d s o g`, `v` (variant), `m*` (maybe), `a*` arrays
// (with the `as` strv + `ay` bytestring fast-paths and `a{..}` dictionaries via
// dict-entries), `(...)` tuples, and `{kv}` dict-entries. Genuinely exotic
// element types fall out of the type grammar with a clear "Invalid GVariant
// signature" error.
//
// OWNERSHIP (the leak/UAF surface — scrutinise here): every `g_variant_new_*`
// and `g_variant_builder_end` returns a FLOATING ref. A child handed to
// g_variant_builder_add_value / g_variant_new_maybe / g_variant_new_dict_entry
// is CONSUMED (its floating ref is taken), so the success path never leaks. The
// single top-level result is g_variant_ref_sink'd exactly once and owned by the
// boxed handle (g_variant_unref on GC). On the UNPACK side g_variant_get_child_
// value / get_variant / get_maybe each return a NEW ref (transfer full): a child
// that "stays a Variant" hands that ref straight to the boxed handle (no extra
// ref), and a child we recurse into is unref'd after the read.

static bool VariantIsSimpleType(char c) {
  switch (c) {
    case 'b': case 'y': case 'n': case 'q': case 'i': case 'u':
    case 'x': case 't': case 'h': case 'd': case 's': case 'o': case 'g':
      return true;
    default:
      return false;
  }
}

// Consume one complete type from `sig` starting at *pos, advancing *pos past it,
// and return that type's string (mirrors GJS `_readSingleType`). `forceSimple`
// rejects a non-basic type (dict keys must be basic). Throws + sets *ok=false on
// a malformed signature.
static std::string VariantReadSingleType(Napi::Env env, const std::string& sig, size_t* pos,
                                         bool forceSimple, bool* ok) {
  if (*pos >= sig.size()) {
    Napi::TypeError::New(env, "Invalid GVariant signature (reached end while expecting a type)")
        .ThrowAsJavaScriptException();
    *ok = false;
    return "";
  }
  char c = sig[(*pos)++];
  bool simple = VariantIsSimpleType(c);
  if (!simple && forceSimple) {
    Napi::TypeError::New(env, "Invalid GVariant signature (a simple type was expected)")
        .ThrowAsJavaScriptException();
    *ok = false;
    return "";
  }
  if (c == 'm' || c == 'a') {
    std::string inner = VariantReadSingleType(env, sig, pos, false, ok);
    if (!*ok) return "";
    return std::string(1, c) + inner;
  }
  if (c == '{') {
    std::string key = VariantReadSingleType(env, sig, pos, true, ok);
    if (!*ok) return "";
    std::string val = VariantReadSingleType(env, sig, pos, false, ok);
    if (!*ok) return "";
    if (*pos >= sig.size() || sig[*pos] != '}') {
      Napi::TypeError::New(env, "Invalid GVariant signature for type DICT_ENTRY (expected \"}\")")
          .ThrowAsJavaScriptException();
      *ok = false;
      return "";
    }
    (*pos)++;
    return std::string("{") + key + val + "}";
  }
  if (c == '(') {
    std::string res = "(";
    while (true) {
      if (*pos >= sig.size()) {
        Napi::TypeError::New(env, "Invalid GVariant signature for type TUPLE (expected \")\")")
            .ThrowAsJavaScriptException();
        *ok = false;
        return "";
      }
      if (sig[*pos] == ')') {
        (*pos)++;
        res += ")";
        return res;
      }
      std::string el = VariantReadSingleType(env, sig, pos, false, ok);
      if (!*ok) return "";
      res += el;
    }
  }
  if (!simple && c != 'v') {
    Napi::TypeError::New(env, std::string("Invalid GVariant signature (") + c + " is not a valid type)")
        .ThrowAsJavaScriptException();
    *ok = false;
    return "";
  }
  return std::string(1, c);
}

// Read a JS value into a byte vector for an `ay` array (Uint8Array/Buffer/
// number[]; a string is UTF-8 encoded with a trailing NUL, matching GJS).
static bool VariantExtractBytes(Napi::Env env, Napi::Value v, std::vector<guint8>* out) {
  if (v.IsBuffer()) {
    Napi::Buffer<uint8_t> b = v.As<Napi::Buffer<uint8_t>>();
    out->assign(b.Data(), b.Data() + b.Length());
    return true;
  }
  if (v.IsTypedArray()) {
    Napi::TypedArray ta = v.As<Napi::TypedArray>();
    const uint8_t* base = static_cast<uint8_t*>(ta.ArrayBuffer().Data()) + ta.ByteOffset();
    out->assign(base, base + ta.ByteLength());
    return true;
  }
  if (v.IsArray()) {
    Napi::Array a = v.As<Napi::Array>();
    uint32_t n = a.Length();
    out->resize(n);
    for (uint32_t i = 0; i < n; i++)
      (*out)[i] = static_cast<guint8>(a.Get(i).ToNumber().Uint32Value());
    return true;
  }
  if (v.IsString()) {
    std::string s = v.As<Napi::String>().Utf8Value();
    out->assign(s.begin(), s.end());
    out->push_back(0);
    return true;
  }
  Napi::TypeError::New(env, "GVariant 'ay' expects a Uint8Array, Buffer, number[] or string")
      .ThrowAsJavaScriptException();
  return false;
}

// Recursively build a (floating) GVariant from `sig` (starting at *pos) + `value`
// — the C twin of GJS `_packVariant`. Returns a FLOATING ref (or nullptr with a
// pending exception + *ok=false). The caller consumes the float.
static GVariant* VariantPack(Napi::Env env, const std::string& sig, size_t* pos,
                             Napi::Value value, bool* ok) {
  if (*pos >= sig.size()) {
    Napi::TypeError::New(env, "GVariant signature cannot be empty").ThrowAsJavaScriptException();
    *ok = false;
    return nullptr;
  }
  char c = sig[(*pos)++];
  switch (c) {
    case 'b': return g_variant_new_boolean(value.ToBoolean().Value());
    case 'y': return g_variant_new_byte(static_cast<guint8>(value.ToNumber().Uint32Value()));
    case 'n': return g_variant_new_int16(static_cast<gint16>(value.ToNumber().Int32Value()));
    case 'q': return g_variant_new_uint16(static_cast<guint16>(value.ToNumber().Uint32Value()));
    case 'i': return g_variant_new_int32(value.ToNumber().Int32Value());
    case 'u': return g_variant_new_uint32(value.ToNumber().Uint32Value());
    // GJS accepts a BigInt for 64-bit types (js_value_to_c<int64_t> branches on
    // isBigInt before ToInt64); a BigInt must never reach ToNumber() (fatal abort).
    // Shared with the GI/GValue marshallers via JsValueTo{Int,Uint}64 (common.h).
    case 'x': return g_variant_new_int64(JsValueToInt64(value));
    case 't': return g_variant_new_uint64(JsValueToUint64(value));
    case 'h': return g_variant_new_handle(value.ToNumber().Int32Value());
    case 'd': return g_variant_new_double(value.ToNumber().DoubleValue());
    case 's': {
      // GJS marshals 's' via new_string, whose UTF8 arg is type-strict (isString
      // or null), so `new GLib.Variant('s', 42)` throws rather than packing "42".
      if (!value.IsString()) {
        Napi::TypeError::New(env, "GVariant 's' expects a string")
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      std::string s = value.ToString().Utf8Value();
      return g_variant_new_string(s.c_str());
    }
    case 'o': {
      if (!value.IsString()) {
        Napi::TypeError::New(env, "GVariant 'o' expects an object-path string")
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      std::string s = value.ToString().Utf8Value();
      if (!g_variant_is_object_path(s.c_str())) {
        Napi::TypeError::New(env, std::string("Invalid GVariant object path: ") + s)
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      return g_variant_new_object_path(s.c_str());
    }
    case 'g': {
      if (!value.IsString()) {
        Napi::TypeError::New(env, "GVariant 'g' expects a signature string")
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      std::string s = value.ToString().Utf8Value();
      if (!g_variant_is_signature(s.c_str())) {
        Napi::TypeError::New(env, std::string("Invalid GVariant signature string: ") + s)
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      return g_variant_new_signature(s.c_str());
    }
    case 'v': {
      gpointer p = nullptr;
      if (!TryGetBoxedPtr(value, &p) || p == nullptr) {
        Napi::TypeError::New(env, "GVariant 'v' expects a GLib.Variant value")
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      return g_variant_new_variant(static_cast<GVariant*>(p));
    }
    case 'm': {
      if (!value.IsNull() && !value.IsUndefined()) {
        GVariant* child = VariantPack(env, sig, pos, value, ok);
        if (!*ok) return nullptr;
        return g_variant_new_maybe(nullptr, child);  // consumes the floating child
      }
      std::string elem = VariantReadSingleType(env, sig, pos, false, ok);
      if (!*ok) return nullptr;
      GVariantType* t = g_variant_type_new(elem.c_str());
      GVariant* r = g_variant_new_maybe(t, nullptr);
      g_variant_type_free(t);
      return r;
    }
    case 'a': {
      std::string elemType = VariantReadSingleType(env, sig, pos, false, ok);
      if (!*ok) return nullptr;
      char e0 = elemType.empty() ? '\0' : elemType[0];
      if (e0 == 's') {  // array of strings → g_variant_new_strv
        if (!value.IsArray()) {
          Napi::TypeError::New(env, "GVariant 'as' expects an array of strings")
              .ThrowAsJavaScriptException();
          *ok = false;
          return nullptr;
        }
        Napi::Array a = value.As<Napi::Array>();
        uint32_t n = a.Length();
        std::vector<std::string> store(n);
        std::vector<const gchar*> ptrs(n + 1, nullptr);
        for (uint32_t i = 0; i < n; i++) {
          store[i] = a.Get(i).ToString().Utf8Value();
          ptrs[i] = store[i].c_str();
        }
        return g_variant_new_strv(ptrs.data(), static_cast<gssize>(n));  // copies
      }
      if (e0 == 'y') {  // byte array
        std::vector<guint8> bytes;
        if (!VariantExtractBytes(env, value, &bytes)) {
          *ok = false;
          return nullptr;
        }
        return g_variant_new_fixed_array(G_VARIANT_TYPE_BYTE, bytes.data(), bytes.size(),
                                         sizeof(guint8));  // copies
      }
      std::string fullType = "a" + elemType;
      GVariantType* at = g_variant_type_new(fullType.c_str());
      GVariantBuilder builder;
      g_variant_builder_init(&builder, at);
      if (e0 == '{') {  // dictionary: a plain object keyed by the entry's key type
        if (!value.IsObject()) {
          g_variant_builder_clear(&builder);
          g_variant_type_free(at);
          Napi::TypeError::New(env, "GVariant dictionary expects a plain object")
              .ThrowAsJavaScriptException();
          *ok = false;
          return nullptr;
        }
        Napi::Object obj = value.As<Napi::Object>();
        Napi::Array keys = obj.GetPropertyNames();
        uint32_t n = keys.Length();
        for (uint32_t i = 0; i < n; i++) {
          Napi::Value k = keys.Get(i);
          Napi::Array pair = Napi::Array::New(env, 2);
          pair.Set(static_cast<uint32_t>(0), k);
          pair.Set(static_cast<uint32_t>(1), obj.Get(k));
          size_t p2 = 0;
          GVariant* child = VariantPack(env, elemType, &p2, pair, ok);  // packs the {kv} entry
          if (!*ok) {
            g_variant_builder_clear(&builder);
            g_variant_type_free(at);
            return nullptr;
          }
          g_variant_builder_add_value(&builder, child);  // consumes the floating entry
        }
      } else {  // generic array: re-parse elemType per element
        if (!value.IsArray()) {
          g_variant_builder_clear(&builder);
          g_variant_type_free(at);
          Napi::TypeError::New(env, "GVariant array expects an array value")
              .ThrowAsJavaScriptException();
          *ok = false;
          return nullptr;
        }
        Napi::Array a = value.As<Napi::Array>();
        uint32_t n = a.Length();
        for (uint32_t i = 0; i < n; i++) {
          size_t p2 = 0;
          GVariant* child = VariantPack(env, elemType, &p2, a.Get(i), ok);
          if (!*ok) {
            g_variant_builder_clear(&builder);
            g_variant_type_free(at);
            return nullptr;
          }
          g_variant_builder_add_value(&builder, child);
        }
      }
      GVariant* r = g_variant_builder_end(&builder);
      g_variant_type_free(at);
      return r;
    }
    case '(': {  // tuple: drive children off the signature until ')'
      if (!value.IsArray()) {
        Napi::TypeError::New(env, "GVariant tuple expects an array value")
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      Napi::Array a = value.As<Napi::Array>();
      uint32_t n = a.Length();
      GVariantBuilder builder;
      g_variant_builder_init(&builder, G_VARIANT_TYPE_TUPLE);
      // Drive children off the JS array length (GJS: `for i < value.length`), not
      // the signature — a missing position must NOT coerce undefined→garbage.
      for (uint32_t i = 0; i < n; i++) {
        if (*pos < sig.size() && sig[*pos] == ')') break;  // more values than types: stop
        GVariant* child = VariantPack(env, sig, pos, a.Get(i), ok);
        if (!*ok) {
          g_variant_builder_clear(&builder);
          return nullptr;
        }
        g_variant_builder_add_value(&builder, child);
      }
      // Every value consumed: the signature must now close the tuple. If types
      // remain (too few values) this throws, exactly as GJS does.
      if (*pos >= sig.size() || sig[*pos] != ')') {
        g_variant_builder_clear(&builder);
        Napi::TypeError::New(env, "Invalid GVariant signature for type TUPLE (expected \")\")")
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      (*pos)++;  // consume ')'
      return g_variant_builder_end(&builder);
    }
    case '{': {  // dict-entry: value is [key, val]
      if (!value.IsArray()) {
        Napi::TypeError::New(env, "GVariant dict-entry expects a [key, value] array")
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      Napi::Array a = value.As<Napi::Array>();
      GVariant* key = VariantPack(env, sig, pos, a.Get(static_cast<uint32_t>(0)), ok);
      if (!*ok) return nullptr;
      GVariant* val = VariantPack(env, sig, pos, a.Get(static_cast<uint32_t>(1)), ok);
      if (!*ok) {
        g_variant_unref(g_variant_take_ref(key));
        return nullptr;
      }
      if (*pos >= sig.size() || sig[*pos] != '}') {
        g_variant_unref(g_variant_take_ref(key));
        g_variant_unref(g_variant_take_ref(val));
        Napi::TypeError::New(env, "Invalid GVariant signature for type DICT_ENTRY (expected \"}\")")
            .ThrowAsJavaScriptException();
        *ok = false;
        return nullptr;
      }
      (*pos)++;
      return g_variant_new_dict_entry(key, val);  // consumes both floating children
    }
    default:
      Napi::TypeError::New(
          env, std::string("Invalid GVariant signature (unexpected character ") + c + ")")
          .ThrowAsJavaScriptException();
      *ok = false;
      return nullptr;
  }
}

static Napi::Value VariantToJs(Napi::Env env, GVariant* v, bool deep, bool recursive);

// Shared array/tuple/dict-entry reader: each child either fully unpacks (deep) or
// stays a Variant handle (shallow). The shallow handle adopts the new ref from
// g_variant_get_child_value; the deep path unrefs after the recursive read.
static Napi::Array VariantContainerToArray(Napi::Env env, GVariant* v, bool deep, bool recursive) {
  gsize n = g_variant_n_children(v);
  Napi::Array out = Napi::Array::New(env, n);
  for (gsize i = 0; i < n; i++) {
    GVariant* child = g_variant_get_child_value(v, i);  // transfer full
    if (deep) {
      Napi::Value cj = VariantToJs(env, child, deep, recursive);
      g_variant_unref(child);
      out.Set(static_cast<uint32_t>(i), cj);
    } else {
      out.Set(static_cast<uint32_t>(i), MakeBoxedHandle(env, child, G_TYPE_VARIANT, true));
    }
  }
  return out;
}

// The C twin of GJS `_unpackVariant(variant, deep, recursive)`. `deep` controls
// whether container children are unpacked at all; `recursive` ONLY affects `v`
// (variant) values — deep keeps a nested `v` as a Variant, recursive unwraps it.
// This is the exact distinction behind unpack() / deepUnpack() / recursiveUnpack.
static Napi::Value VariantToJs(Napi::Env env, GVariant* v, bool deep, bool recursive) {
  switch (g_variant_classify(v)) {
    case G_VARIANT_CLASS_BOOLEAN: return Napi::Boolean::New(env, g_variant_get_boolean(v));
    case G_VARIANT_CLASS_BYTE: return Napi::Number::New(env, g_variant_get_byte(v));
    case G_VARIANT_CLASS_INT16: return Napi::Number::New(env, g_variant_get_int16(v));
    case G_VARIANT_CLASS_UINT16: return Napi::Number::New(env, g_variant_get_uint16(v));
    case G_VARIANT_CLASS_INT32: return Napi::Number::New(env, g_variant_get_int32(v));
    case G_VARIANT_CLASS_UINT32: return Napi::Number::New(env, g_variant_get_uint32(v));
    // GJS unpacks a 64-bit variant to a Number, warning when it can't be stored
    // exactly (|v| > 2^53-1) — same as every other 64-bit OUT path.
    case G_VARIANT_CLASS_INT64: {
      gint64 x = g_variant_get_int64(v);
      WarnIfUnsafeInt64(x);
      return Napi::Number::New(env, static_cast<double>(x));
    }
    case G_VARIANT_CLASS_UINT64: {
      guint64 x = g_variant_get_uint64(v);
      WarnIfUnsafeUint64(x);
      return Napi::Number::New(env, static_cast<double>(x));
    }
    case G_VARIANT_CLASS_HANDLE: return Napi::Number::New(env, g_variant_get_handle(v));
    case G_VARIANT_CLASS_DOUBLE: return Napi::Number::New(env, g_variant_get_double(v));
    case G_VARIANT_CLASS_STRING:
    case G_VARIANT_CLASS_OBJECT_PATH:
    case G_VARIANT_CLASS_SIGNATURE:
      return Napi::String::New(env, g_variant_get_string(v, nullptr));
    case G_VARIANT_CLASS_VARIANT: {
      GVariant* inner = g_variant_get_variant(v);  // transfer full
      if (deep && recursive) {
        Napi::Value r = VariantToJs(env, inner, deep, recursive);
        g_variant_unref(inner);
        return r;
      }
      return MakeBoxedHandle(env, inner, G_TYPE_VARIANT, true);  // stays a Variant
    }
    case G_VARIANT_CLASS_MAYBE: {
      GVariant* inner = g_variant_get_maybe(v);  // transfer full, or NULL
      if (inner == nullptr) return env.Null();
      if (deep) {
        Napi::Value r = VariantToJs(env, inner, deep, recursive);
        g_variant_unref(inner);
        return r;
      }
      return MakeBoxedHandle(env, inner, G_TYPE_VARIANT, true);
    }
    case G_VARIANT_CLASS_ARRAY: {
      if (g_variant_is_of_type(v, G_VARIANT_TYPE_DICTIONARY)) {  // a{?*}
        Napi::Object out = Napi::Object::New(env);
        gsize n = g_variant_n_children(v);
        for (gsize i = 0; i < n; i++) {
          GVariant* entry = g_variant_get_child_value(v, i);
          GVariant* keyv = g_variant_get_child_value(entry, 0);
          GVariant* valv = g_variant_get_child_value(entry, 1);
          // The key is always fully unpacked (it must be usable as an object
          // key); the value follows the deep/recursive rule.
          Napi::Value keyJs = VariantToJs(env, keyv, true, recursive);
          Napi::Value valJs = deep
              ? VariantToJs(env, valv, deep, recursive)
              : MakeBoxedHandle(env, g_variant_ref(valv), G_TYPE_VARIANT, true);
          out.Set(keyJs, valJs);
          g_variant_unref(keyv);
          g_variant_unref(valv);
          g_variant_unref(entry);
        }
        return out;
      }
      if (g_variant_is_of_type(v, G_VARIANT_TYPE_BYTESTRING)) {  // ay
        gsize n = 0;
        const void* data = g_variant_get_fixed_array(v, &n, sizeof(guint8));
        Napi::Uint8Array arr = Napi::Uint8Array::New(env, n);
        if (n > 0 && data != nullptr) memcpy(arr.Data(), data, n);
        return arr;
      }
      return VariantContainerToArray(env, v, deep, recursive);
    }
    case G_VARIANT_CLASS_TUPLE:
    case G_VARIANT_CLASS_DICT_ENTRY:
      return VariantContainerToArray(env, v, deep, recursive);
    default:
      Napi::Error::New(env, "Unsupported GVariant type in unpack").ThrowAsJavaScriptException();
      return env.Undefined();
  }
}

// Read a GVariant pointer from a node-gi GLib.Variant handle (a boxed handle
// tagged with G_TYPE_VARIANT). Throws + returns nullptr otherwise.
static GVariant* UnwrapVariant(Napi::Env env, Napi::Value handle) {
  if (!handle.IsExternal() ||
      !handle.As<Napi::External<BoxedHandle>>().CheckTypeTag(&kBoxedHandleTag)) {
    Napi::TypeError::New(env, "expected a node-gi GLib.Variant handle").ThrowAsJavaScriptException();
    return nullptr;
  }
  BoxedHandle* h = handle.As<Napi::External<BoxedHandle>>().Data();
  if (h == nullptr || h->ptr == nullptr || h->gtype != G_TYPE_VARIANT) {
    Napi::TypeError::New(env, "expected a node-gi GLib.Variant handle").ThrowAsJavaScriptException();
    return nullptr;
  }
  return static_cast<GVariant*>(h->ptr);
}

// variantNew(signature, value?) -> boxed GLib.Variant handle
Napi::Value VariantNew(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "variantNew(signature: string, value?: unknown)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string sig = info[0].As<Napi::String>().Utf8Value();
  if (sig.empty()) {
    Napi::TypeError::New(env, "GVariant signature cannot be empty").ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Value value = info.Length() >= 2 ? info[1] : env.Undefined();
  size_t pos = 0;
  bool ok = true;
  GVariant* v = VariantPack(env, sig, &pos, value, &ok);
  if (!ok) return env.Null();  // exception already pending
  if (pos != sig.size()) {
    if (v != nullptr) g_variant_unref(g_variant_take_ref(v));
    Napi::TypeError::New(env, "Invalid GVariant signature (more than one single complete type)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  g_variant_ref_sink(v);  // sink the floating ref → own exactly one
  return MakeBoxedHandle(env, v, G_TYPE_VARIANT, true);
}

// variantUnpack(handle, deep?, recursive?) -> unknown
Napi::Value VariantUnpack(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  GVariant* v = UnwrapVariant(env, info.Length() >= 1 ? info[0] : env.Undefined());
  if (v == nullptr) return env.Null();
  bool deep = info.Length() >= 2 && info[1].ToBoolean().Value();
  bool recursive = info.Length() >= 3 && info[2].ToBoolean().Value();
  return VariantToJs(env, v, deep, recursive);
}

// variantGetTypeString(handle) -> string
Napi::Value VariantGetTypeString(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  GVariant* v = UnwrapVariant(env, info.Length() >= 1 ? info[0] : env.Undefined());
  if (v == nullptr) return env.Null();
  return Napi::String::New(env, g_variant_get_type_string(v));
}

// isVariantHandle(value) -> boolean (a boxed handle tagged with G_TYPE_VARIANT)
Napi::Value IsVariantHandle(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool is = false;
  if (info.Length() >= 1 && info[0].IsExternal()) {
    Napi::External<BoxedHandle> ext = info[0].As<Napi::External<BoxedHandle>>();
    if (ext.CheckTypeTag(&kBoxedHandleTag)) {
      BoxedHandle* h = ext.Data();
      is = h != nullptr && h->gtype == G_TYPE_VARIANT;
    }
  }
  return Napi::Boolean::New(env, is);
}

}  // namespace nodegi
