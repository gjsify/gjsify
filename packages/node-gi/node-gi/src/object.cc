// SPDX-License-Identifier: MIT
// GObject lifecycle + properties: GValue <-> JS, construction and the property/type entry points.

#include "common.h"

namespace nodegi {

// ---- GParamSpec wrapping (phase 2.7a) --------------------------------------
//
// A GParamSpec is a GObject FUNDAMENTAL (its own G_TYPE_PARAM hierarchy), NOT a
// GObject and NOT a boxed type — it is reference-counted via g_param_spec_ref /
// g_param_spec_unref. So it gets its own type-tagged External (distinct from the
// GObject + boxed handles so the three never cross-dereference), carrying a held
// ref dropped on GC. The L1 layer (gi.js wrapParamSpec) turns this handle into a
// GObject.ParamSpec-shaped object exposing name/get_name/nick/blurb/flags/
// value_type/owner_type/default_value — mirroring gjs's gi/param.cpp + the
// GObject.js ParamSpec.prototype. This is what a `notify` handler's second arg
// (the changed property's pspec) and a GParamSpec-typed GValue now surface as.
static const napi_type_tag kParamSpecHandleTag = {0x7c1e9a4b2f6d8035ULL,
                                                  0xd2b8f0a3e5c74196ULL};

Napi::Value MakeParamSpecHandle(Napi::Env env, GParamSpec* pspec, GITransfer transfer) {
  if (pspec == nullptr) return env.Null();
  // transfer-everything hands us an owned ref (adopt it); a borrow → add our own.
  if (transfer != GI_TRANSFER_EVERYTHING) g_param_spec_ref(pspec);
  Napi::External<GParamSpec> ext = Napi::External<GParamSpec>::New(
      env, pspec, [](Napi::Env, GParamSpec* p) { g_param_spec_unref(p); });
  if (ext.IsEmpty()) {
    // napi_create_external failed with the throw swallowed (terminating env /
    // pending exception). TypeTag on the empty External would abort via
    // Error::New(nullptr)'s fatal sites — release the ref we took and bail with
    // the empty value (see the common.h terminate-safe helpers). The finalizer
    // was never registered, so this g_param_spec_unref balances the ref above.
    g_param_spec_unref(pspec);
    return ext;
  }
  ext.TypeTag(&kParamSpecHandleTag);
  return ext;
}

// Read a GParamSpec from a kParamSpecHandleTag External (no dereference on a
// non-paramspec). Returns nullptr when `v` is not a node-gi paramspec handle.
static GParamSpec* TryGetParamSpec(Napi::Value v) {
  if (!v.IsExternal()) return nullptr;
  Napi::External<GParamSpec> ext = v.As<Napi::External<GParamSpec>>();
  if (!ext.CheckTypeTag(&kParamSpecHandleTag)) return nullptr;
  return ext.Data();
}

// isParamSpecHandle(value) → boolean (tag-checked; no dereference).
Napi::Value IsParamSpecHandle(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool is = info.Length() >= 1 && TryGetParamSpec(info[0]) != nullptr;
  return Napi::Boolean::New(env, is);
}

// ---- non-GObject GObject-fundamental wrapping (GskRenderNode, GdkEvent, …) --
//
// Some types introspected as OBJECT_INFO are GObject FUNDAMENTALS that do NOT
// derive from GObject — e.g. GskRenderNode (Gtk.Snapshot.to_node()), GdkEvent.
// They carry their OWN ref/unref funcs (gsk_render_node_ref/unref) in the
// introspection, NOT g_object_ref/unref, and G_IS_OBJECT(them) is FALSE — so
// routing them through WrapGObject runs the toggle-ref/qdata dance on a
// non-GObject → a cascade of `g_object_*: assertion 'G_IS_OBJECT (object)'
// failed` criticals AND a leaked ref (the closing g_object_unref no-ops). They
// get their own type-tagged External carrying the raw pointer as its Data (so an
// IN arg round-trips via the OBJECT External branch) + the introspected unref
// func boxed as the finalizer hint, the held ref dropped on GC via that func.
// Opaque at L1 (a pass-through intermediate); mirrors gjs's gi/fundamental.cpp
// pointer lifecycle. GParamSpec + GValue keep their dedicated branches BEFORE
// this one, so this catches the remaining fundamentals.
static const napi_type_tag kFundamentalHandleTag = {0x3b7f2e1c9a4d6058ULL,
                                                    0x8e5a0c7b1f2d6493ULL};

Napi::Value MakeFundamentalHandle(Napi::Env env, gpointer ptr, GIObjectInfo* info,
                                  GITransfer transfer) {
  if (ptr == nullptr) return env.Null();
  GIObjectInfoRefFunction refFn = gi_object_info_get_ref_function_pointer(info);
  GIObjectInfoUnrefFunction unrefFn = gi_object_info_get_unref_function_pointer(info);
  // We own a ref to drop on GC when the type gives us a way to take one: a
  // transfer-everything return hands us an owned ref (adopt it), a borrow gets our
  // own via refFn. A fundamental exposing neither ref nor a transfer-full handoff
  // (unusual) is held without an owned ref → no finalizer unref (never over-unref).
  bool owns = (transfer == GI_TRANSFER_EVERYTHING) || (refFn != nullptr);
  if (transfer != GI_TRANSFER_EVERYTHING && refFn != nullptr) refFn(ptr);
  // Box the unref func so the finalizer (which only receives data + hint) drops
  // exactly the one ref we own with the RIGHT function. nullptr = don't unref.
  GIObjectInfoUnrefFunction* unrefBox =
      new GIObjectInfoUnrefFunction(owns ? unrefFn : nullptr);
  Napi::External<void> ext = Napi::External<void>::New(
      env, ptr,
      [](Napi::Env, void* p, GIObjectInfoUnrefFunction* box) {
        if (box != nullptr) {
          if (*box != nullptr && p != nullptr) (*box)(p);
          delete box;
        }
      },
      unrefBox);
  if (ext.IsEmpty()) {
    // napi_create_external failed with the throw swallowed (terminating env /
    // pending exception). The finalizer was never registered — drop the ref we own
    // + free the box here (mirrors MakeParamSpecHandle / MakeBoxedHandle).
    if (owns && unrefFn != nullptr) unrefFn(ptr);
    delete unrefBox;
    return ext;
  }
  ext.TypeTag(&kFundamentalHandleTag);
  return ext;
}

// Read a fundamental pointer from a kFundamentalHandleTag External (no dereference
// on a non-fundamental). Returns nullptr when `v` is not a node-gi fundamental.
static gpointer TryGetFundamental(Napi::Value v) {
  if (!v.IsExternal()) return nullptr;
  Napi::External<void> ext = v.As<Napi::External<void>>();
  if (!ext.CheckTypeTag(&kFundamentalHandleTag)) return nullptr;
  return ext.Data();
}

// isFundamentalHandle(value) → boolean (tag-checked; no dereference).
Napi::Value IsFundamentalHandle(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool is = info.Length() >= 1 && TryGetFundamental(info[0]) != nullptr;
  return Napi::Boolean::New(env, is);
}

// paramSpecProp(handle, which) → the requested accessor value. `which` ∈
// name | nick | blurb | flags | valueType | ownerType | defaultValue. A single
// dispatcher keeps the native surface small; the L1 wrapper maps it to the
// GObject.ParamSpec getters + get_name()/get_nick()/get_blurb() methods.
Napi::Value ParamSpecProp(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  GParamSpec* p = info.Length() >= 1 ? TryGetParamSpec(info[0]) : nullptr;
  if (p == nullptr || info.Length() < 2 || !info[1].IsString()) {
    Napi::TypeError::New(env, "paramSpecProp(handle, which: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string which = info[1].As<Napi::String>().Utf8Value();
  if (which == "name") return Napi::String::New(env, g_param_spec_get_name(p));
  if (which == "nick") {
    const char* s = g_param_spec_get_nick(p);
    return s != nullptr ? Napi::Value(Napi::String::New(env, s)) : env.Null();
  }
  if (which == "blurb") {
    const char* s = g_param_spec_get_blurb(p);
    return s != nullptr ? Napi::Value(Napi::String::New(env, s)) : env.Null();
  }
  if (which == "flags") return Napi::Number::New(env, static_cast<double>(p->flags));
  if (which == "valueType") return MakeGTypeHandle(env, p->value_type);
  if (which == "ownerType") return MakeGTypeHandle(env, p->owner_type);
  if (which == "defaultValue") {
    const GValue* dv = g_param_spec_get_default_value(p);
    if (dv == nullptr || !G_IS_VALUE(dv)) return env.Null();
    return GValueToJs(env, dv);
  }
  Napi::TypeError::New(env, std::string("unknown paramspec property '") + which + "'")
      .ThrowAsJavaScriptException();
  return env.Null();
}

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
    case G_TYPE_BOXED: {
      // A boxed-typed property/signal value (e.g. Gio.SimpleAction:parameter-type →
      // GVariantType, a boxed `G_TYPE_VARIANT_TYPE`). g_value_get_boxed BORROWS the
      // payload; copy so our handle owns its own and can g_boxed_free it on GC.
      // An UNSET boxed property (NULL pointer) → null, matching GJS — NOT a throw.
      // Verified against gjs 1.88:
      //   new Gio.SimpleAction({name:'x'}).parameterType                    → null
      //   Gio.SimpleAction.new('y', GLib.VariantType.new('s')).parameterType
      //     .dup_string()                                                    → 's'
      // The wrapped boxed handle carries its GType, so L1 wrapBoxed routes
      // `.dup_string()` etc. through CallBoxedMethod (gi_repository_find_by_gtype →
      // GLib.VariantType struct methods). (GVariant is fundamental, handled by its
      // own G_TYPE_VARIANT case above.)
      //
      // G_TYPE_BYTE_ARRAY (a GByteArray) is special-cased to a Node Buffer (Uint8Array)
      // — NOT a boxed handle — matching gjs (refs/gjs/gi/value.cpp:1091
      // gjs_byte_array_from_byte_array). Verified vs gjs 1.88 (a GByteArray signal
      // param → a Uint8Array in the handler). GBytes (G_TYPE_BYTES) is deliberately
      // NOT special-cased here: gjs leaves it as a GLib.Bytes boxed handle
      // (value.cpp has no GBytes case → the generic boxed branch), which is what the
      // MakeBoxedHandle below already produces (verified: a GBytes signal param →
      // `instanceof GLib.Bytes`).
      //
      // G_TYPE_STRV (a NULL-terminated gchar**, e.g. Gtk.Widget:css-classes,
      // Gio.ThemedIcon:names, or any Vala `public string[] x { get; }` property —
      // valac emits g_param_spec_boxed(…, G_TYPE_STRV) for those). This is the READ
      // half of the pair JsToGValue's GStrv branch opened: without it a GStrv
      // property fell through to MakeBoxedHandle and JS got an opaque boxed handle
      // instead of an array — SILENTLY, because a handle is a truthy object whose
      // `.length` is undefined, so `arr ?? []` keeps it and every index/`for` over it
      // yields nothing (this is how @gjsify/http lost every request header on the
      // node-gi bridge: `bridgeReq.header_pairs` became a handle and the pair loop
      // ran zero times). Mirrors GJS gjs_value_from_g_value_internal
      // (refs/gjs/gi/value.cpp:1082 `gtype == G_TYPE_STRV` → gjs_array_from_strv).
      // NULL → an EMPTY ARRAY, not null: GJS explicitly excludes G_TYPE_STRV from its
      // "pointer-valued NULL → JS null" pre-check (value.cpp:1023) and documents the
      // choice in gjs_array_from_strv (arg.cpp:2267) — "clients would need to always
      // check for both an empty array and null" otherwise. g_value_get_boxed BORROWS;
      // every string is copied into JS, so nothing is owned here.
      if (G_VALUE_HOLDS(v, G_TYPE_STRV)) {
        const gchar* const* strv = static_cast<const gchar* const*>(g_value_get_boxed(v));
        guint len = 0;
        while (strv != nullptr && strv[len] != nullptr) len++;
        Napi::Array arr = Napi::Array::New(env, len);
        for (guint i = 0; i < len; i++) arr.Set(i, Napi::String::New(env, strv[i]));
        return arr;
      }
      if (G_VALUE_HOLDS(v, G_TYPE_BYTE_ARRAY)) {
        GByteArray* ba = static_cast<GByteArray*>(g_value_get_boxed(v));
        if (ba == nullptr) return env.Null();
        return Napi::Buffer<uint8_t>::Copy(env, ba->data, ba->len);
      }
      gpointer boxed = g_value_get_boxed(v);
      if (boxed == nullptr) return env.Null();
      GType bt = G_VALUE_TYPE(v);
      return MakeBoxedHandle(env, g_boxed_copy(bt, boxed), bt, true);
    }
    case G_TYPE_OBJECT:
      // Signal/property object values are transfer-none borrows; WrapGObject refs.
      return WrapGObject(env, static_cast<GObject*>(g_value_get_object(v)), GI_TRANSFER_NOTHING);
    case G_TYPE_PARAM: {
      // GParamSpec (e.g. the `notify` signal's second argument, or a
      // GParamSpec-typed property/value). Surface a real, tagged GObject.ParamSpec
      // handle (borrow → own a ref) so a handler can read
      // .name/.get_name()/.value_type/.nick/.blurb/.flags/.owner_type — matching
      // gjs. g_value_get_param BORROWS (transfer none).
      GParamSpec* p = g_value_get_param(v);
      return MakeParamSpecHandle(env, p, GI_TRANSFER_NOTHING);
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
  if (js.IsEmpty()) {
    // Residue of a swallowed napi failure upstream (a fallible props.Get() /
    // coercion failed on a terminating env, or a throwing getter left the
    // exception pending). Coercing it would abort via Error::New(nullptr)'s
    // fatal sites — fail the marshal cleanly (see the common.h terminate-safe
    // helpers). This is the terminate-mid-`newObject` path: ConstructGObject's
    // props loop calls this per property value. Gate the diagnostic throw on
    // NodeGiJsAvailable — false on a dying env (a Napi::Error built there aborts
    // via the SAME funnel) AND on a live env with a pending exception (propagate
    // that one) — so we only throw when the env can safely build the error.
    if (NodeGiJsAvailable(env)) {
      Napi::Error::New(env, "property value unavailable (env is terminating)")
          .ThrowAsJavaScriptException();
    }
    return false;
  }
  GType ft = G_TYPE_FUNDAMENTAL(G_VALUE_TYPE(v));
  // G_TYPE_GTYPE is a runtime-resolved type (not constexpr) → handle before the
  // switch. A GType handle (or null → 0) into a GType-valued GValue.
  if (G_VALUE_HOLDS_GTYPE(v)) {
    GType gt = 0;
    if (!UnwrapGTypeArg(env, js, &gt)) return false;
    g_value_set_gtype(v, gt);
    return true;
  }
  // G_TYPE_BYTE_ARRAY (a GByteArray boxed value, e.g. a byte-array signal param or
  // property). G_TYPE_FUNDAMENTAL == G_TYPE_BOXED, so the switch below would route a
  // Uint8Array to the boxed-HANDLE case and reject it. Special-case it FIRST — a JS
  // Uint8Array/Buffer → a freshly-allocated GByteArray, matching gjs
  // (refs/gjs/gi/value.cpp:783 gjs_byte_array_get_byte_array, gated on
  // JS_IsUint8Array). A non-Uint8Array value falls through to the generic boxed
  // handling below (so a real GByteArray boxed handle still works), exactly as gjs
  // does. g_value_take_boxed makes the GValue OWN the GByteArray; g_value_unset frees
  // it. null/undefined → NULL. Verified vs gjs 1.88 (Uint8Array → GByteArray signal
  // param round-trips to a Uint8Array in the handler).
  if (G_VALUE_HOLDS(v, G_TYPE_BYTE_ARRAY)) {
    if (js.IsNull() || js.IsUndefined()) {
      g_value_set_boxed(v, nullptr);
      return true;
    }
    const uint8_t* bytes = nullptr;
    size_t len = 0;
    bool isU8 = false;
    if (js.IsBuffer()) {
      Napi::Buffer<uint8_t> b = js.As<Napi::Buffer<uint8_t>>();
      bytes = b.Data();
      len = b.Length();
      isU8 = true;
    } else if (js.IsTypedArray() && js.As<Napi::TypedArray>().TypedArrayType() == napi_uint8_array) {
      Napi::TypedArray ta = js.As<Napi::TypedArray>();
      bytes = static_cast<const uint8_t*>(ta.ArrayBuffer().Data()) + ta.ByteOffset();
      len = ta.ByteLength();
      isU8 = true;
    }
    if (isU8) {
      GByteArray* ba = g_byte_array_new();
      if (len > 0) g_byte_array_append(ba, bytes, static_cast<guint>(len));
      g_value_take_boxed(v, ba);
      return true;
    }
    // else: fall through to the generic G_TYPE_BOXED handling (a boxed handle).
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
      // NodeGiToUtf8: terminate-safe (a swallowed Get/coercion failure must not
      // cascade into Error::New(nullptr) — see common.h).
      strv[i] = g_strdup(NodeGiToUtf8(arr.Get(i)).c_str());
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
    // Scalar coercions via the terminate-safe helpers (common.h): a swallowed
    // napi failure mid worker.terminate() must degrade to a zero, not cascade
    // into Error::New(nullptr)'s fatal sites (the terminate-mid-`newObject` path).
    case G_TYPE_BOOLEAN: g_value_set_boolean(v, NodeGiToBool(js)); return true;
    case G_TYPE_CHAR: g_value_set_schar(v, static_cast<gint8>(NodeGiToInt32(js))); return true;
    case G_TYPE_UCHAR: g_value_set_uchar(v, static_cast<guchar>(NodeGiToUint32(js))); return true;
    case G_TYPE_INT: g_value_set_int(v, NodeGiToInt32(js)); return true;
    case G_TYPE_UINT: g_value_set_uint(v, NodeGiToUint32(js)); return true;
    // 64-bit (glong/gulong are 64-bit on LP64): accept a BigInt losslessly, else a
    // truncated Number — never let a BigInt reach ToNumber(). Shared with the GI
    // scalar marshaller via JsValueTo{Int,Uint}64 (common.h).
    case G_TYPE_LONG: g_value_set_long(v, static_cast<glong>(JsValueToInt64(js))); return true;
    case G_TYPE_ULONG: g_value_set_ulong(v, static_cast<gulong>(JsValueToUint64(js))); return true;
    case G_TYPE_INT64: g_value_set_int64(v, JsValueToInt64(js)); return true;
    case G_TYPE_UINT64: g_value_set_uint64(v, JsValueToUint64(js)); return true;
    case G_TYPE_FLOAT: g_value_set_float(v, static_cast<float>(NodeGiToDouble(js))); return true;
    case G_TYPE_DOUBLE: g_value_set_double(v, NodeGiToDouble(js)); return true;
    case G_TYPE_ENUM: g_value_set_enum(v, NodeGiToInt32(js)); return true;
    case G_TYPE_FLAGS: g_value_set_flags(v, NodeGiToUint32(js)); return true;
    case G_TYPE_STRING:
      if (js.IsNull() || js.IsUndefined()) {
        g_value_set_string(v, nullptr);
      } else {
        std::string s = NodeGiToUtf8(js);
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
  if (names.IsEmpty()) {
    // napi_get_property_names failed with the throw swallowed — worker.terminate()
    // landed while inside this native construct (the dominant terminate-mid-
    // `newObject` funnel: the hot loop is here when the env dies). names.Length()
    // on the empty Array would abort via Error::New(nullptr)'s fatal sites. Bail
    // with the empty value; gate the diagnostic throw on NodeGiJsAvailable —
    // constructing a Napi::Error on the dying env would abort via the SAME funnel
    // (false there AND on a live env with a pending exception, which we let
    // propagate). Nothing was allocated yet.
    if (NodeGiJsAvailable(env)) {
      Napi::Error::New(env, "construction unavailable (env is terminating)")
          .ThrowAsJavaScriptException();
    }
    return env.Null();
  }
  guint n = names.Length();
  std::vector<GValue> values(n);  // zero-initialised == G_VALUE_INIT
  std::vector<std::string> nameStorage(n);
  std::vector<const char*> cnames(n);

  gpointer klass = g_type_class_ref(gtype);  // realises the class so pspecs exist
  guint initialised = 0;
  bool ok = true;
  for (guint i = 0; i < n; i++) {
    // A per-property name read can come back EMPTY when worker.terminate() lands
    // mid-loop (a swallowed napi failure). Bail WITHOUT throwing — the pre-existing
    // "has no property ''" TypeError below would run Error::New on the now-dying
    // env and abort via the funnel. On a live env names.Get(i) is never empty.
    Napi::Value nameVal = names.Get(i);
    if (nameVal.IsEmpty()) {
      ok = false;
      break;
    }
    nameStorage[i] = NodeGiToUtf8(nameVal);
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
    // Raise the JS-`new` latch across construction: this is the node-gi JS-driven
    // path, where the makeClass super-substitution runs the user ctor AFTER this
    // returns. NodeGiConstructor reads the latch and does NOT re-run the ctor (a
    // C/GtkBuilder-driven g_object_new leaves it clear, so NodeGiConstructor runs
    // the ctor there). Save/restore keeps a reentrant construct correct.
    bool prevConstructing = NodeGiJsConstructing();
    NodeGiSetJsConstructing(true);
    obj = g_object_new_with_properties(gtype, n, cnames.data(), values.data());
    NodeGiSetJsConstructing(prevConstructing);
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
    // On a terminating env the ns/tn string reads above degrade to "" (a swallowed
    // napi failure), so find_by_name misses and we land here — but building a
    // Napi::TypeError on the dying env would abort via Error::New's fatal funnel.
    // Gate on NodeGiJsAvailable (false on a dying env AND on a live env with a
    // pending exception); a genuine bad-name on a live env still throws.
    if (NodeGiJsAvailable(env)) {
      Napi::TypeError::New(env, ns + "." + tn + " is not a constructible GObject type")
          .ThrowAsJavaScriptException();
    }
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

// classInfoForTypeName(gtypeName) -> { namespace, name } | null
// The introspected type that OWNS a runtime GType name — the reverse of
// getGType, over the same nearest-ancestor walk method resolution uses (a
// private concrete type such as GLocalFile carries no info of its own). L1 needs
// it to hand a wrapper the JS prototype of its class, so that a member the
// program put on `Ns.Class.prototype` is what the instance resolves (#1175).
// Searches only LOADED namespaces (gi_repository_find_by_gtype), so it never
// pulls in a typelib as a side effect of wrapping an object.
Napi::Value ClassInfoForTypeName(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "classInfoForTypeName(gtypeName: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string typeName = info[0].As<Napi::String>().Utf8Value();
  GType gtype = g_type_from_name(typeName.c_str());
  if (gtype == G_TYPE_INVALID) return env.Null();
  GIRepository* repo = DupDefaultRepository();
  GIObjectInfo* objInfo = FindNearestObjectInfo(repo, gtype);
  Napi::Value result = env.Null();
  if (objInfo != nullptr) {
    GIBaseInfo* base = reinterpret_cast<GIBaseInfo*>(objInfo);
    Napi::Object out = Napi::Object::New(env);
    out.Set("namespace", Napi::String::New(env, gi_base_info_get_namespace(base)));
    out.Set("name", Napi::String::New(env, gi_base_info_get_name(base)));
    gi_base_info_unref(base);
    result = out;
  }
  g_object_unref(repo);
  return result;
}

// getGType(namespace, name) -> GType handle | null
// The runtime GType of an introspected registered type (object/interface/struct/
// union/enum/flags), as a node-gi GType handle. The L1 layer surfaces it as a
// lazy `Ns.Type.$gtype` getter (so `Adw.Clamp.$gtype` / `GObject.type_ensure(...)`
// work). Returns null for an unknown or unregistered name.
//
// It also REALISES a classed type, because gjs's whole type system rests on the
// invariant its own gi/function.cpp states — "the GType class is referenced at least
// once when the JS constructor is initialized". Signals and properties are installed
// in `class_init`, which GLib defers until something takes a `g_type_class_ref`, so a
// class NOTHING in the process has referenced reports none of its own: measured,
// `GObject.signal_lookup('popped', Adw.NavigationView.$gtype)` answered 84 under gjs
// and 0 here, and `signal_lookup('activate', Gio.Application.$gtype)` 28 against 0 —
// a wrong answer with nothing thrown, which a caller reads as "this class has no such
// signal" (#1438). `$gtype` is the one read every such lookup goes through and gi.js
// memoises it, so this costs exactly one `g_type_class_ref` per GType.
//
// The ref is KEPT, for the reason calls.cc's ClassStructInstanceForGType keeps its
// own: it establishes the invariant once, a static type's class is never really freed
// (measured on glib 2.88.3 — `g_type_class_peek` still answers the same pointer after
// an unref), and pairing could only invalidate what a caller is still holding. The
// `g_type_class_peek` guard bounds it at ONE ref per GType for the process, whatever
// order the two ref sites are reached in.
//
// Guarded on G_TYPE_IS_CLASSED because the UNCLASSED fundamentals — boxed/struct and
// interface — have no class: `g_type_class_ref` answers nullptr there after a
// `GLib-GObject-CRITICAL`, so without the guard every `GLib.Bytes.$gtype` read would
// print one. ENUM and FLAGS are classed (GEnumClass/GFlagsClass) and deliberately go
// through, as they do in gjs. Nothing THROWS on the unguarded path, so the witness is
// `class-realization.test.mjs`'s child-process stderr case, not an in-process read.
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
  if (G_TYPE_IS_CLASSED(gt) && g_type_class_peek(gt) == nullptr) g_type_class_ref(gt);
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

// newGValue() -> a fresh, zero-initialised GObject.Value boxed handle.
//
// GObject.Value has no g_value_new(): a GValue is a plain struct the caller owns,
// so GJS's `new GObject.Value()` allocates one specially (refs/gjs gi/value.cpp).
// Allocate a zeroed GValue THROUGH the G_TYPE_VALUE boxed system —
// g_boxed_copy(G_TYPE_VALUE, &zero) slice-dups an all-zero G_VALUE_INIT struct into
// a fresh GValue (G_IS_VALUE(&zero) is false, so value_copy just dups the zeroed
// bytes) — so the handle's finalizer g_boxed_free(G_TYPE_VALUE, ...) frees it via
// the MATCHING allocator (value_free: g_value_unset + slice-free). The L1 layer
// (gi.js makeValueClass) wraps it with the GObject.Value ergonomics
// (.init/.set_*/.get_*/.copy/.unset via the boxed-method path). The Node twin of
// GJS's `new GObject.Value()` (refs/gjs/modules/core/overrides/GObject.js
// gValueConstructorFunc over realGValueClass).
Napi::Value NewGValue(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  GValue zero = G_VALUE_INIT;
  GValue* v = static_cast<GValue*>(g_boxed_copy(G_TYPE_VALUE, &zero));
  return MakeBoxedHandle(env, v, G_TYPE_VALUE, true);
}

}  // namespace nodegi
