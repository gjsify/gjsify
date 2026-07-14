// SPDX-License-Identifier: MIT
// GObject lifecycle + properties: GValue <-> JS, construction and the property/type entry points.

#include "common.h"

namespace nodegi {

// ---- GObject lifecycle + properties (milestone 1) ----
//
// Construct GObjects and read/write their properties. Ownership now flows through
// the toggle-ref instance GC bridge above: ConstructGObject hands its single
// construction ref to the cache-aware MakeGObjectHandle, which installs the
// canonical toggle ref (so the wrapper is collectable when JS is the sole owner,
// rooted when C also holds the object, and identity-stable + resurrectable).
//
// Instances are handed back as opaque Napi::External<GObject> handles; the
// ergonomic class/prototype surface is layered in the GJS-compat runtime.

// Marshal a GValue into a JS value (fundamental types).
Napi::Value GValueToJs(Napi::Env env, const GValue* v) {
  GType ft = G_TYPE_FUNDAMENTAL(G_VALUE_TYPE(v));
  // G_TYPE_GTYPE is a runtime-resolved type (g_gtype_get_type()), so it cannot be
  // a switch case label — handle it up front. A GType-valued GValue marshals to a
  // node-gi GType handle (0 → null).
  if (G_VALUE_HOLDS_GTYPE(v)) {
    GType gt = g_value_get_gtype(v);
    return gt != 0 ? MakeGTypeHandle(env, gt) : env.Null();
  }
  // An interface-typed property/signal value (e.g. Adw.ComboRow:model →
  // GListModel, a GObject INTERFACE). G_TYPE_FUNDAMENTAL(an interface) ==
  // G_TYPE_INTERFACE, which has no switch case below → the default branch would
  // reject it ("Unsupported property GType GListModel"). The object lives in the
  // value's pointer slot: the interface inherits GObject's GTypeValueTable via
  // its GObject prerequisite, so the slot IS an owned-object ref. Read it
  // directly — g_value_get_object g_return_val_if_fail's G_VALUE_HOLDS_OBJECT,
  // which is FALSE for an interface type (g_type_is_a(GListModel, G_TYPE_OBJECT)
  // == false). Mirrors GJS (refs/gjs/gi/value.cpp:1071 + gi/value.h:110) +
  // JsToGValue's interface branch. Borrow (transfer-none; WrapGObject refs).
  if (G_TYPE_IS_INTERFACE(G_VALUE_TYPE(v))) {
    return WrapGObject(env, static_cast<GObject*>(v->data[0].v_pointer),
                       GI_TRANSFER_NOTHING);
  }
  switch (ft) {
    case G_TYPE_BOOLEAN: return Napi::Boolean::New(env, g_value_get_boolean(v));
    case G_TYPE_CHAR: return Napi::Number::New(env, g_value_get_schar(v));
    case G_TYPE_UCHAR: return Napi::Number::New(env, g_value_get_uchar(v));
    case G_TYPE_INT: return Napi::Number::New(env, g_value_get_int(v));
    case G_TYPE_UINT: return Napi::Number::New(env, g_value_get_uint(v));
    // 64-bit OUT: GJS returns a Number, warning when it can't be stored exactly.
    case G_TYPE_LONG: {
      glong x = g_value_get_long(v);
      WarnIfUnsafeInt64(x);
      return Napi::Number::New(env, static_cast<double>(x));
    }
    case G_TYPE_ULONG: {
      gulong x = g_value_get_ulong(v);
      WarnIfUnsafeUint64(x);
      return Napi::Number::New(env, static_cast<double>(x));
    }
    case G_TYPE_INT64: {
      gint64 x = g_value_get_int64(v);
      WarnIfUnsafeInt64(x);
      return Napi::Number::New(env, static_cast<double>(x));
    }
    case G_TYPE_UINT64: {
      guint64 x = g_value_get_uint64(v);
      WarnIfUnsafeUint64(x);
      return Napi::Number::New(env, static_cast<double>(x));
    }
    case G_TYPE_FLOAT: return Napi::Number::New(env, g_value_get_float(v));
    case G_TYPE_DOUBLE: return Napi::Number::New(env, g_value_get_double(v));
    case G_TYPE_ENUM: return Napi::Number::New(env, g_value_get_enum(v));
    case G_TYPE_FLAGS: return Napi::Number::New(env, g_value_get_flags(v));
    case G_TYPE_STRING: {
      const char* s = g_value_get_string(v);
      return s != nullptr ? Napi::Value(Napi::String::New(env, s)) : env.Null();
    }
    case G_TYPE_VARIANT: {
      // A GVariant-typed property (e.g. Gio.SimpleAction:state) or signal
      // parameter (Gio.SimpleAction::change-state). g_value_get_variant borrows
      // (transfer none) → wrap as a node-gi GLib.Variant handle (own a ref).
      GVariant* var = g_value_get_variant(v);
      if (var == nullptr) return env.Null();
      return WrapVariant(env, var, GI_TRANSFER_NOTHING);
    }
    case G_TYPE_OBJECT:
      // Signal/property object values are transfer-none borrows; WrapGObject refs.
      return WrapGObject(env, static_cast<GObject*>(g_value_get_object(v)), GI_TRANSFER_NOTHING);
    case G_TYPE_PARAM: {
      // GParamSpec (e.g. the `notify` signal argument) — surface the changed
      // property's name so a `notify` handler can read it.
      GParamSpec* p = g_value_get_param(v);
      if (p == nullptr) return env.Null();
      Napi::Object o = Napi::Object::New(env);
      o.Set("name", Napi::String::New(env, p->name));
      o.Set("valueType", Napi::String::New(env, g_type_name(p->value_type)));
      return o;
    }
    default:
      Napi::TypeError::New(env, std::string("Unsupported property GType ") +
                                    g_type_name(G_VALUE_TYPE(v)) + " (milestone 1: fundamentals only)")
          .ThrowAsJavaScriptException();
      return env.Undefined();
  }
}

// Marshal a JS value into an already-g_value_init'd GValue.
bool JsToGValue(Napi::Env env, Napi::Value js, GValue* v) {
  GType ft = G_TYPE_FUNDAMENTAL(G_VALUE_TYPE(v));
  // G_TYPE_GTYPE is a runtime-resolved type (not constexpr) → handle before the
  // switch. A GType handle (or null → 0) into a GType-valued GValue.
  if (G_VALUE_HOLDS_GTYPE(v)) {
    GType gt = 0;
    if (!UnwrapGTypeArg(env, js, &gt)) return false;
    g_value_set_gtype(v, gt);
    return true;
  }
  // G_TYPE_STRV (a GStrv / NULL-terminated char** boxed property, e.g.
  // Gtk.Widget:css-classes). G_TYPE_FUNDAMENTAL(G_TYPE_STRV) == G_TYPE_BOXED, so
  // the switch below would route it to the boxed-HANDLE case and reject a JS array
  // ("expected a boxed handle for a GStrv property"). Special-case it FIRST — a JS
  // string[] → a freshly-allocated GStrv — exactly as GJS does before its generic
  // g_type_is_a(gtype, G_TYPE_BOXED) handling (refs/gjs/gi/value.cpp:704-725).
  // Ownership: g_value_take_boxed makes the GValue OWN the GStrv; g_object_new
  // COPIES it into the property (g_strdupv), and ConstructGObject's g_value_unset
  // frees the GValue's copy via g_strfreev — no double-free, no leak.
  if (G_VALUE_HOLDS(v, G_TYPE_STRV)) {
    if (js.IsNull() || js.IsUndefined()) {
      g_value_set_boxed(v, nullptr);
      return true;
    }
    if (!js.IsArray()) {
      Napi::TypeError::New(env, "expected a string[] for a GStrv property")
          .ThrowAsJavaScriptException();
      return false;
    }
    Napi::Array arr = js.As<Napi::Array>();
    guint len = arr.Length();
    gchar** strv = g_new0(gchar*, len + 1);  // +1 for the NULL terminator
    for (guint i = 0; i < len; i++) {
      strv[i] = g_strdup(arr.Get(i).ToString().Utf8Value().c_str());
    }
    g_value_take_boxed(v, strv);
    return true;
  }
  // An interface-typed property (e.g. Adw.ComboRow:model is GListModel, a GObject
  // INTERFACE; Gtk.MenuButton:menu-model, …). G_TYPE_FUNDAMENTAL(an interface) ==
  // G_TYPE_INTERFACE, which has no switch case below → the default branch would
  // reject it ("Unsupported property GType GListModel"). The JS value is a wrapped
  // GObject that IMPLEMENTS the interface (e.g. a Gtk.StringList / Gio.ListStore
  // implementing GListModel). GObject's g_value_set_object g_return_if_fail's
  // G_VALUE_HOLDS_OBJECT, which is FALSE for an interface-typed GValue
  // (g_type_is_a(GListModel, G_TYPE_OBJECT) == false), so mirror GJS
  // (refs/gjs/gi/value.cpp:684 + gi/value.h:165): set the value's object slot
  // directly with g_set_object — the interface inherits GObject's value table via
  // its GObject prerequisite, so the slot IS an owned-object ref. Same ownership
  // as the G_TYPE_OBJECT case (#659): g_set_object refs the object (our wrapper
  // keeps its own ref → no double-free), ConstructGObject's g_value_unset drops
  // the GValue's ref. null/undefined → clear; a non-implementing / non-GObject
  // value → clean TypeError.
  if (G_TYPE_IS_INTERFACE(G_VALUE_TYPE(v))) {
    GObject* obj = nullptr;
    if (!(js.IsNull() || js.IsUndefined())) {
      obj = UnwrapGObject(env, js);
      if (obj == nullptr) return false;  // UnwrapGObject threw a TypeError
      if (!g_type_is_a(G_OBJECT_TYPE(obj), G_VALUE_TYPE(v))) {
        Napi::TypeError::New(env, std::string("expected an object implementing ") +
                                      g_type_name(G_VALUE_TYPE(v)) + ", got " +
                                      g_type_name(G_OBJECT_TYPE(obj)))
            .ThrowAsJavaScriptException();
        return false;
      }
    }
    g_set_object(&v->data[0].v_pointer, obj);
    return true;
  }
  switch (ft) {
    case G_TYPE_BOOLEAN: g_value_set_boolean(v, js.ToBoolean().Value()); return true;
    case G_TYPE_CHAR: g_value_set_schar(v, static_cast<gint8>(js.ToNumber().Int32Value())); return true;
    case G_TYPE_UCHAR: g_value_set_uchar(v, static_cast<guchar>(js.ToNumber().Uint32Value())); return true;
    case G_TYPE_INT: g_value_set_int(v, js.ToNumber().Int32Value()); return true;
    case G_TYPE_UINT: g_value_set_uint(v, js.ToNumber().Uint32Value()); return true;
    // 64-bit (glong/gulong are 64-bit on LP64): accept a BigInt losslessly, else a
    // truncated Number — never let a BigInt reach ToNumber(). Shared with the GI
    // scalar marshaller via JsValueTo{Int,Uint}64 (common.h).
    case G_TYPE_LONG: g_value_set_long(v, static_cast<glong>(JsValueToInt64(js))); return true;
    case G_TYPE_ULONG: g_value_set_ulong(v, static_cast<gulong>(JsValueToUint64(js))); return true;
    case G_TYPE_INT64: g_value_set_int64(v, JsValueToInt64(js)); return true;
    case G_TYPE_UINT64: g_value_set_uint64(v, JsValueToUint64(js)); return true;
    case G_TYPE_FLOAT: g_value_set_float(v, static_cast<float>(js.ToNumber().DoubleValue())); return true;
    case G_TYPE_DOUBLE: g_value_set_double(v, js.ToNumber().DoubleValue()); return true;
    case G_TYPE_ENUM: g_value_set_enum(v, js.ToNumber().Int32Value()); return true;
    case G_TYPE_FLAGS: g_value_set_flags(v, js.ToNumber().Uint32Value()); return true;
    case G_TYPE_STRING:
      if (js.IsNull() || js.IsUndefined()) {
        g_value_set_string(v, nullptr);
      } else {
        std::string s = js.ToString().Utf8Value();
        g_value_set_string(v, s.c_str());  // g_value_set_string copies
      }
      return true;
    case G_TYPE_VARIANT: {
      // A GLib.Variant handle (or null) into a GVariant-typed GValue.
      // g_value_set_variant refs (and sinks a floating ref); our handle keeps
      // its own ref, so no double-free.
      if (js.IsNull() || js.IsUndefined()) {
        g_value_set_variant(v, nullptr);
        return true;
      }
      gpointer p = nullptr;
      if (!TryGetBoxedPtr(js, &p) || p == nullptr) {
        Napi::TypeError::New(env, "expected a GLib.Variant for a GVariant value")
            .ThrowAsJavaScriptException();
        return false;
      }
      g_value_set_variant(v, static_cast<GVariant*>(p));
      return true;
    }
    case G_TYPE_OBJECT: {
      // An object-typed property (e.g. Gtk.ApplicationWindow:application,
      // Gtk.Widget:child, :transient-for, :model …). Mirrors GValueToJs's
      // G_TYPE_OBJECT case in the other direction: unwrap the node-gi GObject
      // handle and hand it to g_value_set_object, which takes its OWN ref (our
      // wrapper keeps its handle ref → no double-free). null/undefined clears it.
      if (js.IsNull() || js.IsUndefined()) {
        g_value_set_object(v, nullptr);
        return true;
      }
      GObject* obj = UnwrapGObject(env, js);
      if (obj == nullptr) return false;  // UnwrapGObject threw a TypeError
      // Type-safety: g_value_set_object only g_warning's on a type mismatch (then
      // sets NULL) — but that warning ABORTS under G_DEBUG=fatal-criticals. Pre-check
      // with g_type_is_a and throw a clean, catchable JS TypeError instead (#659).
      if (!g_type_is_a(G_OBJECT_TYPE(obj), G_VALUE_TYPE(v))) {
        Napi::TypeError::New(env, std::string("expected a ") + g_type_name(G_VALUE_TYPE(v)) +
                                      ", got " + g_type_name(G_OBJECT_TYPE(obj)))
            .ThrowAsJavaScriptException();
        return false;
      }
      g_value_set_object(v, obj);
      return true;
    }
    case G_TYPE_BOXED: {
      // A boxed-typed property (e.g. a GdkRGBA, Gtk.Border, …). g_value_set_boxed
      // COPIES the boxed payload, so handing it our handle's pointer is safe — the
      // handle retains ownership. null/undefined clears it.
      if (js.IsNull() || js.IsUndefined()) {
        g_value_set_boxed(v, nullptr);
        return true;
      }
      BoxedHandle* h = TryGetBoxedHandle(js);
      if (h == nullptr || h->ptr == nullptr) {
        Napi::TypeError::New(env, std::string("expected a boxed handle for a ") +
                                      g_type_name(G_VALUE_TYPE(v)) + " property")
            .ThrowAsJavaScriptException();
        return false;
      }
      // Type-safety: g_value_set_boxed blind-copies per the GValue's boxed GType, so
      // a wrong boxed handle is undefined behaviour (no GLib guard at all). Reject a
      // mismatch with a clean TypeError. Only checkable when the handle carries a
      // known boxed GType (non-registered C structs are G_TYPE_INVALID) (#659).
      if (h->gtype != G_TYPE_INVALID && !g_type_is_a(h->gtype, G_VALUE_TYPE(v))) {
        Napi::TypeError::New(env, std::string("expected a ") + g_type_name(G_VALUE_TYPE(v)) +
                                      " boxed handle, got " + g_type_name(h->gtype))
            .ThrowAsJavaScriptException();
        return false;
      }
      g_value_set_boxed(v, h->ptr);
      return true;
    }
    default:
      Napi::TypeError::New(env, std::string("Unsupported property GType ") +
                                    g_type_name(G_VALUE_TYPE(v)))
          .ThrowAsJavaScriptException();
      return false;
  }
}

GObject* UnwrapGObject(Napi::Env env, Napi::Value handle) {
  // Tag-check before touching Data() — a GType handle (registerClass) is also an
  // External but holds a non-dereferenceable integer; G_IS_OBJECT on it crashes.
  if (!handle.IsExternal() ||
      !handle.As<Napi::External<GObject>>().CheckTypeTag(&kGObjectHandleTag)) {
    Napi::TypeError::New(env, "expected a node-gi GObject handle").ThrowAsJavaScriptException();
    return nullptr;
  }
  GObject* obj = handle.As<Napi::External<GObject>>().Data();
  if (obj == nullptr || !G_IS_OBJECT(obj)) {
    Napi::TypeError::New(env, "invalid GObject handle").ThrowAsJavaScriptException();
    return nullptr;
  }
  return obj;
}

// Shared constructor core: realise the class, marshal `props` into a GValue
// vector against the type's (inherited) GParamSpecs, g_object_new_with_properties,
// and hand back an owned External<GObject>. Used by both newObject (resolve by
// namespace.typeName) and constructType (resolve by a registered GType handle).
Napi::Value ConstructGObject(Napi::Env env, GType gtype, Napi::Object props,
                             const std::string& displayName) {
  Napi::Array names = props.GetPropertyNames();
  guint n = names.Length();
  std::vector<GValue> values(n);  // zero-initialised == G_VALUE_INIT
  std::vector<std::string> nameStorage(n);
  std::vector<const char*> cnames(n);

  gpointer klass = g_type_class_ref(gtype);  // realises the class so pspecs exist
  guint initialised = 0;
  bool ok = true;
  for (guint i = 0; i < n; i++) {
    nameStorage[i] = names.Get(i).ToString().Utf8Value();
    GParamSpec* pspec =
        g_object_class_find_property(reinterpret_cast<GObjectClass*>(klass), nameStorage[i].c_str());
    if (pspec == nullptr) {
      Napi::TypeError::New(env, displayName + " has no property '" + nameStorage[i] + "'")
          .ThrowAsJavaScriptException();
      ok = false;
      break;
    }
    g_value_init(&values[i], pspec->value_type);
    initialised = i + 1;
    if (!JsToGValue(env, props.Get(nameStorage[i]), &values[i])) {
      ok = false;
      break;
    }
    cnames[i] = nameStorage[i].c_str();
  }

  GObject* obj = nullptr;
  if (ok) {
    obj = g_object_new_with_properties(gtype, n, cnames.data(), values.data());
  }
  for (guint j = 0; j < initialised; j++) g_value_unset(&values[j]);
  g_type_class_unref(klass);

  if (!ok) return env.Null();
  if (obj == nullptr) {
    Napi::Error::New(env, "Failed to construct " + displayName).ThrowAsJavaScriptException();
    return env.Null();
  }
  // Take a single strong, non-floating ref; the finalizer releases it.
  if (g_object_is_floating(obj)) {
    g_object_ref_sink(obj);
  }
  // Gtk.Widget composite template: instantiate the template tree on this
  // instance. The canonical GTK call is from instance_init; calling it here —
  // right after construction, before the wrapper reaches JS — is equivalent for a
  // templated leaf type (the widget is fully constructed; init_template builds the
  // declared children + binds them so get_template_child resolves). A no-op unless
  // the constructed type carries node-gi template data (defined below; forward-
  // declared above), so plain introspected construction (newObject) is untouched.
  MaybeInitTemplate(env, obj);
  return MakeGObjectHandle(env, obj);
}

// newObject(namespace, typeName, props?: Record<string, unknown>) -> External<GObject>
Napi::Value NewObject(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "newObject(namespace: string, typeName: string, props?: object)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string ns = info[0].As<Napi::String>().Utf8Value();
  std::string tn = info[1].As<Napi::String>().Utf8Value();
  Napi::Object props =
      (info.Length() >= 3 && info[2].IsObject()) ? info[2].As<Napi::Object>() : Napi::Object::New(env);

  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* base = gi_repository_find_by_name(repo, ns.c_str(), tn.c_str());
  bool isObject = base != nullptr && GI_IS_OBJECT_INFO(base);
  GType gtype = isObject
                    ? gi_registered_type_info_get_g_type(reinterpret_cast<GIRegisteredTypeInfo*>(base))
                    : G_TYPE_INVALID;
  if (base != nullptr) gi_base_info_unref(base);
  g_object_unref(repo);
  if (!isObject || gtype == G_TYPE_INVALID || gtype == G_TYPE_NONE) {
    Napi::TypeError::New(env, ns + "." + tn + " is not a constructible GObject type")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  return ConstructGObject(env, gtype, props, ns + "." + tn);
}

// getProperty(handle, name) -> unknown
Napi::Value GetProperty(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsString()) {
    Napi::TypeError::New(env, "getProperty(handle, name: string)").ThrowAsJavaScriptException();
    return env.Null();
  }
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Null();
  std::string name = info[1].As<Napi::String>().Utf8Value();
  GParamSpec* pspec = g_object_class_find_property(G_OBJECT_GET_CLASS(obj), name.c_str());
  if (pspec == nullptr) {
    Napi::TypeError::New(env, "no such property '" + name + "'").ThrowAsJavaScriptException();
    return env.Null();
  }
  GValue v = G_VALUE_INIT;
  g_value_init(&v, pspec->value_type);
  g_object_get_property(obj, name.c_str(), &v);
  Napi::Value result = GValueToJs(env, &v);
  g_value_unset(&v);
  return result;
}

// setProperty(handle, name, value) -> void
Napi::Value SetProperty(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[1].IsString()) {
    Napi::TypeError::New(env, "setProperty(handle, name: string, value)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Undefined();
  std::string name = info[1].As<Napi::String>().Utf8Value();
  GParamSpec* pspec = g_object_class_find_property(G_OBJECT_GET_CLASS(obj), name.c_str());
  if (pspec == nullptr) {
    Napi::TypeError::New(env, "no such property '" + name + "'").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  GValue v = G_VALUE_INIT;
  g_value_init(&v, pspec->value_type);
  if (JsToGValue(env, info[2], &v)) {
    g_object_set_property(obj, name.c_str(), &v);
  }
  g_value_unset(&v);
  return env.Undefined();
}

// getTypeName(handle) -> string   (the runtime GType name of an instance)
Napi::Value GetTypeName(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Null();
  return Napi::String::New(env, G_OBJECT_TYPE_NAME(obj));
}

// getGType(namespace, name) -> GType handle | null
// The runtime GType of an introspected registered type (object/interface/struct/
// union/enum/flags), as a node-gi GType handle. The L1 layer surfaces it as a
// lazy `Ns.Type.$gtype` getter (so `Adw.Clamp.$gtype` / `GObject.type_ensure(...)`
// work). Returns null for an unknown or unregistered name.
Napi::Value GetGType(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "getGType(namespace: string, name: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string ns = info[0].As<Napi::String>().Utf8Value();
  std::string nm = info[1].As<Napi::String>().Utf8Value();
  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* base = gi_repository_find_by_name(repo, ns.c_str(), nm.c_str());
  GType gt = (base != nullptr && GI_IS_REGISTERED_TYPE_INFO(base))
                 ? gi_registered_type_info_get_g_type(reinterpret_cast<GIRegisteredTypeInfo*>(base))
                 : G_TYPE_INVALID;
  if (base != nullptr) gi_base_info_unref(base);
  g_object_unref(repo);
  if (gt == G_TYPE_INVALID || gt == G_TYPE_NONE) return env.Null();
  return MakeGTypeHandle(env, gt);
}

// isInstanceOf(handle, namespace, typeName) -> boolean
// Whether the instance's GType is-a `namespace.typeName` (g_type_is_a, which also
// returns true when the type IMPLEMENTS an interface). The L1 wrapper uses it to
// pick the right Gio._promisify registration when two classes promisify a method
// of the same name (resolve by the instance's class). False for an unknown type.
Napi::Value IsInstanceOf(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[1].IsString() || !info[2].IsString()) {
    Napi::TypeError::New(env, "isInstanceOf(handle, namespace: string, typeName: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Null();  // already threw
  std::string ns = info[1].As<Napi::String>().Utf8Value();
  std::string tn = info[2].As<Napi::String>().Utf8Value();
  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* base = gi_repository_find_by_name(repo, ns.c_str(), tn.c_str());
  GType target = (base != nullptr && GI_IS_REGISTERED_TYPE_INFO(base))
                     ? gi_registered_type_info_get_g_type(reinterpret_cast<GIRegisteredTypeInfo*>(base))
                     : 0;
  bool result = target != 0 && g_type_is_a(G_OBJECT_TYPE(obj), target);
  if (base != nullptr) gi_base_info_unref(base);
  g_object_unref(repo);
  return Napi::Boolean::New(env, result);
}

// hasProperty(handle, name) -> boolean
// Whether the instance's type has a GObject property by this name. The L1
// wrapper uses it to route `obj.foo` to a property read vs an `obj.foo()` method.
Napi::Value HasProperty(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsString()) {
    Napi::TypeError::New(env, "hasProperty(handle, name: string)").ThrowAsJavaScriptException();
    return env.Null();
  }
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Null();
  std::string name = info[1].As<Napi::String>().Utf8Value();
  GParamSpec* pspec = g_object_class_find_property(G_OBJECT_GET_CLASS(obj), name.c_str());
  return Napi::Boolean::New(env, pspec != nullptr);
}

// isGObjectHandle(value) -> boolean
// Whether `value` is one of node-gi's GObject-instance handles (tag-checked, no
// dereference). Lets the L1 wrapper detect object-typed return values and wrap
// them as instances for chaining, without misclassifying a GType handle.
Napi::Value IsGObjectHandle(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool is = info.Length() >= 1 && info[0].IsExternal() &&
            info[0].As<Napi::External<GObject>>().CheckTypeTag(&kGObjectHandleTag);
  return Napi::Boolean::New(env, is);
}

}  // namespace nodegi
