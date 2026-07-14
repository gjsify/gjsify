// SPDX-License-Identifier: MIT
// Value marshalling: GIArgument <-> JS, boxed/GType handles, array/GList/GSList/GHashTable containers.

#include "common.h"

namespace nodegi {

// ---- value marshalling (milestone 1: primitives + strings) ----
//
// The minimal GIArgument <-> JS boundary. This is the seam node-gtk's value.cc
// fills out exhaustively; here it covers the numeric + string + boolean tags so
// real GI function calls work end to end. Compound tags (ARRAY/INTERFACE/GLIST/
// GHASH/…) and OUT/INOUT directions land with the GObject + full-marshalling
// drops.

// Marshal a JS value into a GIArgument for an IN argument of `type`.
// `heldString` keeps UTF-8 storage alive for the duration of the call.

extern const napi_type_tag kBoxedHandleTag = {0x6d2f8c4b1a9e7350ULL,
                                              0xb7e1d3a5c9f08264ULL};

Napi::Value MakeBoxedHandle(Napi::Env env, gpointer ptr, GType gtype, bool owns) {
  BoxedHandle* bh = new BoxedHandle{ptr, gtype, owns};
  Napi::External<BoxedHandle> ext =
      Napi::External<BoxedHandle>::New(env, bh, [](Napi::Env, BoxedHandle* h) {
        if (h->owns && h->ptr != nullptr && h->gtype != G_TYPE_INVALID) {
          // GVariant is a fundamental (NOT a boxed) GType, so it cannot go
          // through g_boxed_free — it is reference-counted via g_variant_unref.
          // (GLib.Variant flows through this handle so it reuses the boxed
          // method-resolution + IN-arg-unwrap path; only the free differs.)
          if (h->gtype == G_TYPE_VARIANT) {
            g_variant_unref(static_cast<GVariant*>(h->ptr));
          } else if (G_TYPE_IS_BOXED(h->gtype)) {
            g_boxed_free(h->gtype, h->ptr);
          }
        }
        delete h;
      });
  ext.TypeTag(&kBoxedHandleTag);
  return ext;
}

// Wrap a GVariant pointer as a node-gi boxed handle tagged with G_TYPE_VARIANT.
// GVariant is a fundamental ref-counted (de)floating type, so ownership differs
// from g_boxed types: TAKE the handed ref on transfer-full (sinking a floating
// one), else add our own ref on a borrow. The finalizer (MakeBoxedHandle) drops
// exactly the one ref we end up owning via g_variant_unref. The L1 layer turns
// this handle into a GLib.Variant wrapper (deepUnpack/unpack/recursiveUnpack/…).
Napi::Value WrapVariant(Napi::Env env, GVariant* var, GITransfer transfer) {
  if (var == nullptr) return env.Null();
  if (transfer == GI_TRANSFER_EVERYTHING)
    g_variant_take_ref(var);
  else
    g_variant_ref_sink(var);
  return MakeBoxedHandle(env, var, G_TYPE_VARIANT, true);
}

// Wrap a returned struct/boxed pointer. `structInfo` is the GIStructInfo (or
// union info) for the static type; the runtime GType (if registered + boxed)
// drives ownership + later method resolution.
static Napi::Value WrapBoxed(Napi::Env env, gpointer ptr, GIBaseInfo* structInfo,
                             GITransfer transfer) {
  if (ptr == nullptr) return env.Null();
  GType gt = G_TYPE_INVALID;
  if (structInfo != nullptr && (GI_IS_STRUCT_INFO(structInfo) || GI_IS_UNION_INFO(structInfo))) {
    gt = gi_registered_type_info_get_g_type(reinterpret_cast<GIRegisteredTypeInfo*>(structInfo));
  }
  if (gt == G_TYPE_VARIANT) return WrapVariant(env, static_cast<GVariant*>(ptr), transfer);
  bool boxed = gt != G_TYPE_INVALID && gt != G_TYPE_NONE && G_TYPE_IS_BOXED(gt);
  bool owns = boxed && transfer == GI_TRANSFER_EVERYTHING;
  return MakeBoxedHandle(env, ptr, boxed ? gt : G_TYPE_INVALID, owns);
}

// Read a boxed handle (ptr + boxed GType) if `v` is one (tag-checked; no deref of
// ptr). Returns nullptr when `v` is not a node-gi boxed handle. The returned handle
// is owned by the External — never free it. Callers that need the GType (boxed
// type-safety checks before g_value_set_boxed / a struct IN arg) use this; the
// pointer-only TryGetBoxedPtr below is the thin wrapper for everyone else.
BoxedHandle* TryGetBoxedHandle(Napi::Value v) {
  if (!v.IsExternal()) return nullptr;
  Napi::External<BoxedHandle> ext = v.As<Napi::External<BoxedHandle>>();
  if (!ext.CheckTypeTag(&kBoxedHandleTag)) return nullptr;
  return ext.Data();
}

// Read a boxed handle's pointer if `v` is one (tag-checked; no deref of ptr).
bool TryGetBoxedPtr(Napi::Value v, gpointer* out) {
  if (!v.IsExternal()) return false;
  Napi::External<BoxedHandle> ext = v.As<Napi::External<BoxedHandle>>();
  if (!ext.CheckTypeTag(&kBoxedHandleTag)) return false;
  BoxedHandle* h = ext.Data();
  *out = h != nullptr ? h->ptr : nullptr;
  return true;
}

// ---- GType value handle ----
//
// A GType is represented in JS as a dedicated, type-tagged External holding the
// `GType` (a `gsize`) directly in its Data() pointer slot — NOT a plain number
// (a number is indistinguishable from an enum value at a GI_TYPE_TAG_GTYPE arg)
// and NOT a GObject/boxed handle (a GType is a small integer, dereferencing it as
// a pointer would crash). The tag lets the marshaller recognise it structurally
// without touching the value. GJS's richer GType *object* (refs/gjs gi/gtype.cpp)
// carries a name slot too; node-gi's tagged External is the minimal equivalent —
// the L1 layer can layer `.name` ergonomics on top if needed. GTypes are
// process-stable (static registration, never freed), so the handle has no
// finalizer. This is also the handle registerClass returns (so a registered
// class's `$gtype` and the constructType type-handle are one and the same).
static const napi_type_tag kGTypeHandleTag = {0x3a7f1c9e5b2d4860ULL,
                                              0xc4e8a1b3d5f72096ULL};

Napi::Value MakeGTypeHandle(Napi::Env env, GType gtype) {
  Napi::External<void> ext = Napi::External<void>::New(env, reinterpret_cast<void*>(gtype));
  ext.TypeTag(&kGTypeHandleTag);
  return ext;
}

// Read a GType from a kGTypeHandleTag External (the GType representation above),
// without dereferencing. Returns 0 (G_TYPE_INVALID) when `v` is not a GType handle.
GType ReadGTypeHandle(Napi::Value v) {
  if (!v.IsExternal()) return 0;
  Napi::External<void> ext = v.As<Napi::External<void>>();
  if (!ext.CheckTypeTag(&kGTypeHandleTag)) return 0;
  return reinterpret_cast<GType>(ext.Data());
}

// Marshal a JS GType argument (a GType handle, or null → 0) into a GType, throwing
// a clean TypeError otherwise. Shared by the GI_TYPE_TAG_GTYPE / G_TYPE_GTYPE
// marshalling paths.
bool UnwrapGTypeArg(Napi::Env env, Napi::Value v, GType* out) {
  if (v.IsNull() || v.IsUndefined()) {
    *out = 0;
    return true;
  }
  if (v.IsExternal() && v.As<Napi::External<void>>().CheckTypeTag(&kGTypeHandleTag)) {
    *out = reinterpret_cast<GType>(v.As<Napi::External<void>>().Data());
    return true;
  }
  Napi::TypeError::New(env, "expected a GType handle (e.g. Class.$gtype)")
      .ThrowAsJavaScriptException();
  return false;
}

// `ownedStrings` (optional): when a transfer-full string IN/INOUT arg is g_strdup'd
// here, the freshly-allocated pointer is appended so the caller can g_free it if the
// invoke never adopts it (an arg-marshal error before the call, or a failed invoke).
// nullptr (the default) → no tracking, for the vfunc-return / signal-arg callers.
bool JsToGIArgument(Napi::Env env, Napi::Value v, GITypeInfo* type, GIArgument* out,
                    std::string* heldString,
                    GITransfer transfer,
                    std::vector<gpointer>* ownedStrings) {
  GITypeTag tag = gi_type_info_get_tag(type);
  switch (tag) {
    case GI_TYPE_TAG_BOOLEAN: out->v_boolean = v.ToBoolean().Value(); return true;
    case GI_TYPE_TAG_INT8: out->v_int8 = static_cast<int8_t>(v.ToNumber().Int32Value()); return true;
    case GI_TYPE_TAG_UINT8: out->v_uint8 = static_cast<uint8_t>(v.ToNumber().Uint32Value()); return true;
    case GI_TYPE_TAG_INT16: out->v_int16 = static_cast<int16_t>(v.ToNumber().Int32Value()); return true;
    case GI_TYPE_TAG_UINT16: out->v_uint16 = static_cast<uint16_t>(v.ToNumber().Uint32Value()); return true;
    case GI_TYPE_TAG_INT32: out->v_int32 = v.ToNumber().Int32Value(); return true;
    case GI_TYPE_TAG_UINT32: out->v_uint32 = v.ToNumber().Uint32Value(); return true;
    // 64-bit: accept a BigInt losslessly (else a Number, truncated) — never let a
    // BigInt reach ToNumber() (fatal abort). See JsValueTo{Int,Uint}64 in common.h.
    case GI_TYPE_TAG_INT64: out->v_int64 = JsValueToInt64(v); return true;
    case GI_TYPE_TAG_UINT64: out->v_uint64 = JsValueToUint64(v); return true;
    case GI_TYPE_TAG_FLOAT: out->v_float = static_cast<float>(v.ToNumber().DoubleValue()); return true;
    case GI_TYPE_TAG_DOUBLE: out->v_double = v.ToNumber().DoubleValue(); return true;
    case GI_TYPE_TAG_UTF8:
    case GI_TYPE_TAG_FILENAME:
      if (v.IsNull() || v.IsUndefined()) {
        out->v_string = nullptr;
        return true;
      }
      if (transfer == GI_TRANSFER_EVERYTHING) {
        // The callee adopts the string and g_free's it. heldString points into a
        // std::string buffer (NOT g_malloc'd) → an invalid free. Hand over a
        // g_strdup'd copy the callee can legally free; we keep no reference. Track
        // it so a NON-adopting caller (error before / failed invoke) can free it.
        out->v_string = g_strdup(v.ToString().Utf8Value().c_str());
        if (ownedStrings != nullptr) ownedStrings->push_back(out->v_string);
      } else {
        *heldString = v.ToString().Utf8Value();
        out->v_string = const_cast<char*>(heldString->c_str());
      }
      return true;
    case GI_TYPE_TAG_INTERFACE: {
      // Object/interface instances arrive as opaque External<GObject> handles;
      // enums/flags as plain numbers. Other interface kinds (structs/unions/
      // callbacks) follow with the full-marshalling drop.
      GIBaseInfo* iface = gi_type_info_get_interface(type);
      bool handled = false;
      if (iface != nullptr) {
        if (GI_IS_OBJECT_INFO(iface) || GI_IS_INTERFACE_INFO(iface)) {
          if (v.IsNull() || v.IsUndefined()) {
            out->v_pointer = nullptr;
            handled = true;
          } else if (v.IsExternal()) {
            out->v_pointer = v.As<Napi::External<GObject>>().Data();
            handled = true;
          }
        } else if (GI_IS_ENUM_INFO(iface) || GI_IS_FLAGS_INFO(iface)) {
          out->v_int = v.ToNumber().Int32Value();
          handled = true;
        } else if (GI_IS_STRUCT_INFO(iface) || GI_IS_UNION_INFO(iface)) {
          // Boxed/struct IN args arrive as boxed handles; null/undefined maps to
          // a NULL pointer (e.g. GLib.MainLoop.new(null, false)).
          if (v.IsNull() || v.IsUndefined()) {
            out->v_pointer = nullptr;
            handled = true;
          } else {
            BoxedHandle* h = TryGetBoxedHandle(v);
            if (h != nullptr) {
              // Type-safety: handing a wrong boxed handle's raw pointer to the
              // callee is undefined behaviour. Reject a mismatch with a clean
              // TypeError. Only checkable when BOTH the handle and the expected
              // struct carry a known registered GType (non-registered C structs are
              // G_TYPE_INVALID → no GType to compare, fall through as before).
              GType expected = gi_registered_type_info_get_g_type(
                  reinterpret_cast<GIRegisteredTypeInfo*>(iface));
              if (h->gtype != G_TYPE_INVALID && expected != G_TYPE_INVALID &&
                  expected != G_TYPE_NONE && !g_type_is_a(h->gtype, expected)) {
                gi_base_info_unref(iface);
                Napi::TypeError::New(env, std::string("expected a ") + g_type_name(expected) +
                                              " boxed handle, got " + g_type_name(h->gtype))
                    .ThrowAsJavaScriptException();
                return false;
              }
              out->v_pointer = h->ptr;
              handled = true;
            }
          }
        }
        gi_base_info_unref(iface);
      }
      if (!handled) {
        Napi::TypeError::New(
            env,
            "Unsupported interface IN argument (expected a GObject/boxed handle, enum or flags number)")
            .ThrowAsJavaScriptException();
        return false;
      }
      return true;
    }
    case GI_TYPE_TAG_GTYPE: {
      // A GType argument (e.g. GObject.type_ensure, g_type_name): read the GType
      // from a node-gi GType handle and write it into the GType slot (gsize-wide).
      GType gt = 0;
      if (!UnwrapGTypeArg(env, v, &gt)) return false;
      out->v_size = static_cast<gsize>(gt);
      return true;
    }
    default:
      Napi::TypeError::New(
          env, "Unsupported IN argument type tag " + std::to_string(static_cast<int>(tag)) +
                   " (milestone 1 supports numbers, booleans and strings)")
          .ThrowAsJavaScriptException();
      return false;
  }
}

// A process-unique type tag distinguishing node-gi's GObject-instance Externals
// from other Externals (notably registerClass's GType handle). isGObjectHandle /
// UnwrapGObject validate against it WITHOUT dereferencing the pointer — a GType
// handle holds a small integer, not a valid GObject*, so a blind G_IS_OBJECT on
// it would segfault.
extern const napi_type_tag kGObjectHandleTag = {0x9f3c1a7b5e2d4068ULL,
                                                0xa1b2c3d4e5f60718ULL};

// Marshal a return-value GIArgument into a JS value, honouring transfer.
Napi::Value GIArgumentToJs(Napi::Env env, GITypeInfo* type, GIArgument* arg,
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
    // 64-bit: GJS always returns a Number, warning when the value is not exactly
    // representable (|v| > 2^53-1). See WarnIfUnsafe{Int,Uint}64 in common.h.
    case GI_TYPE_TAG_INT64:
      WarnIfUnsafeInt64(arg->v_int64);
      return Napi::Number::New(env, static_cast<double>(arg->v_int64));
    case GI_TYPE_TAG_UINT64:
      WarnIfUnsafeUint64(arg->v_uint64);
      return Napi::Number::New(env, static_cast<double>(arg->v_uint64));
    case GI_TYPE_TAG_FLOAT: return Napi::Number::New(env, arg->v_float);
    case GI_TYPE_TAG_DOUBLE: return Napi::Number::New(env, arg->v_double);
    case GI_TYPE_TAG_UTF8:
    case GI_TYPE_TAG_FILENAME: {
      if (arg->v_string == nullptr) return env.Null();
      Napi::Value str = Napi::String::New(env, arg->v_string);
      if (transfer == GI_TRANSFER_EVERYTHING) g_free(arg->v_string);
      return str;
    }
    case GI_TYPE_TAG_INTERFACE: {
      GIBaseInfo* iface = gi_type_info_get_interface(type);
      Napi::Value result;
      if (iface != nullptr && (GI_IS_OBJECT_INFO(iface) || GI_IS_INTERFACE_INFO(iface))) {
        result = WrapGObject(env, static_cast<GObject*>(arg->v_pointer), transfer);
      } else if (iface != nullptr && (GI_IS_ENUM_INFO(iface) || GI_IS_FLAGS_INFO(iface))) {
        result = Napi::Number::New(env, arg->v_int);
      } else if (iface != nullptr && (GI_IS_STRUCT_INFO(iface) || GI_IS_UNION_INFO(iface))) {
        result = WrapBoxed(env, arg->v_pointer, iface, transfer);
      } else {
        Napi::TypeError::New(
            env,
            "Unsupported interface return type (milestone: objects, interfaces, enums, flags, boxed)")
            .ThrowAsJavaScriptException();
        result = env.Undefined();
      }
      if (iface != nullptr) gi_base_info_unref(iface);
      return result;
    }
    case GI_TYPE_TAG_GTYPE: {
      // A GType return value (e.g. g_type_from_name): wrap the GType slot
      // (gsize-wide) as a node-gi GType handle so it round-trips back into the
      // engine. A 0 GType (not found) becomes null.
      GType gt = static_cast<GType>(arg->v_size);
      return gt != 0 ? MakeGTypeHandle(env, gt) : env.Null();
    }
    default:
      Napi::TypeError::New(env, "Unsupported return type tag " +
                                    std::to_string(static_cast<int>(tag)) + " (milestone 1)")
          .ThrowAsJavaScriptException();
      return env.Undefined();
  }
}

// ====================================================================
// ---- array / GList / GSList / GHashTable / GStrv marshalling --------
// ====================================================================
//
// Compound container marshalling for IN, return, and OUT directions. Reference:
// refs/node-gtk src/{value,function}.cc (romgrk, MIT), retargeted to the
// girepository-2.0 API and the dense in_args/out_args layout this addon uses.
//
// SCOPE (the common cases real GJS code hits): C arrays + GStrv, GByteArray,
// GArray, GPtrArray (read), GList/GSList, GHashTable with string keys. Element
// types: utf8/filename (strings), the numeric fundamentals + boolean, and
// GObject/interface instances. EXOTIC combos (struct/union/enum/flags/nested-
// container elements, non-string hash keys, GArray/GPtrArray as IN, INOUT
// containers) are DEFERRED with a clear "<type> not yet supported" thrown BEFORE
// the invoke — mirroring the #652 IsSupportedOutType pattern.
//
// OWNERSHIP (the leak/UAF surface — scrutinise here):
//  * Returns / OUT (caller-owns per gi_arg_info_get_ownership_transfer /
//    gi_callable_info_get_caller_owns): TRANSFER_EVERYTHING frees both the
//    container AND its elements after the read (strings g_free'd, object refs
//    adopted by the JS wrapper); TRANSFER_CONTAINER frees only the container
//    (elements stay callee-owned); TRANSFER_NOTHING frees nothing.
//  * IN: TRANSFER_NOTHING means the callee borrows — we build the container,
//    pass it, and free it (container + any g_strdup'd strings) AFTER the invoke.
//    TRANSFER_EVERYTHING / TRANSFER_CONTAINER means the callee adopts what we
//    built — we must NOT free it (that would UAF / double-free).

// Element-type support shared by every container kind. *why receives a short
// label on refusal (so the caller can throw a precise deferral message).
static bool IsSupportedElementType(GITypeInfo* elem, std::string* why) {
  switch (gi_type_info_get_tag(elem)) {
    case GI_TYPE_TAG_BOOLEAN:
    case GI_TYPE_TAG_INT8:
    case GI_TYPE_TAG_UINT8:
    case GI_TYPE_TAG_INT16:
    case GI_TYPE_TAG_UINT16:
    case GI_TYPE_TAG_INT32:
    case GI_TYPE_TAG_UINT32:
    case GI_TYPE_TAG_INT64:
    case GI_TYPE_TAG_UINT64:
    case GI_TYPE_TAG_FLOAT:
    case GI_TYPE_TAG_DOUBLE:
    case GI_TYPE_TAG_UTF8:
    case GI_TYPE_TAG_FILENAME:
      return true;
    case GI_TYPE_TAG_INTERFACE: {
      GIBaseInfo* iface = gi_type_info_get_interface(elem);
      bool ok = iface != nullptr && (GI_IS_OBJECT_INFO(iface) || GI_IS_INTERFACE_INFO(iface));
      if (!ok && why != nullptr) *why = "struct/union/enum element";
      if (iface != nullptr) gi_base_info_unref(iface);
      return ok;
    }
    default:
      if (why != nullptr) *why = "nested-container element";
      return false;
  }
}

// Whether a container type (ARRAY/GLIST/GSLIST/GHASH) is marshallable. Used by
// IsSupportedOutType (OUT/return) and the IN path to defer the unsupported cases
// up front. Array-type kind is intentionally NOT restricted here — the read side
// (GIArrayToJs) handles C/BYTE_ARRAY/GArray/GPtrArray; the IN side rejects
// GArray/GPtrArray separately (they're rare as IN in headless GLib).
bool IsSupportedContainerType(GITypeInfo* type, std::string* why) {
  switch (gi_type_info_get_tag(type)) {
    case GI_TYPE_TAG_ARRAY:
    case GI_TYPE_TAG_GLIST:
    case GI_TYPE_TAG_GSLIST: {
      GITypeInfo* elem = gi_type_info_get_param_type(type, 0);
      if (elem == nullptr) {
        if (why != nullptr) *why = "untyped container";
        return false;
      }
      bool ok = IsSupportedElementType(elem, why);
      gi_base_info_unref(elem);
      return ok;
    }
    case GI_TYPE_TAG_GHASH: {
      GITypeInfo* kt = gi_type_info_get_param_type(type, 0);
      GITypeInfo* vt = gi_type_info_get_param_type(type, 1);
      GITypeTag ktag = kt != nullptr ? gi_type_info_get_tag(kt) : GI_TYPE_TAG_VOID;
      bool kok = ktag == GI_TYPE_TAG_UTF8 || ktag == GI_TYPE_TAG_FILENAME;
      bool vok = vt != nullptr && IsSupportedElementType(vt, nullptr);
      if (!kok && why != nullptr) *why = "non-string GHashTable key";
      else if (!vok && why != nullptr) *why = "unsupported GHashTable value";
      if (kt != nullptr) gi_base_info_unref(kt);
      if (vt != nullptr) gi_base_info_unref(vt);
      return kok && vok;
    }
    default:
      if (why != nullptr) *why = "container";
      return false;
  }
}

// In-memory size of one C-array element. 0 for an unsupported element type.
static size_t CElementSize(GITypeInfo* elem) {
  switch (gi_type_info_get_tag(elem)) {
    case GI_TYPE_TAG_BOOLEAN: return sizeof(gboolean);
    case GI_TYPE_TAG_INT8:
    case GI_TYPE_TAG_UINT8: return 1;
    case GI_TYPE_TAG_INT16:
    case GI_TYPE_TAG_UINT16: return 2;
    case GI_TYPE_TAG_INT32:
    case GI_TYPE_TAG_UINT32: return 4;
    case GI_TYPE_TAG_INT64:
    case GI_TYPE_TAG_UINT64: return 8;
    case GI_TYPE_TAG_FLOAT: return sizeof(gfloat);
    case GI_TYPE_TAG_DOUBLE: return sizeof(gdouble);
    case GI_TYPE_TAG_UTF8:
    case GI_TYPE_TAG_FILENAME:
    case GI_TYPE_TAG_INTERFACE: return sizeof(gpointer);
    default: return 0;
  }
}

// Write the array's element count into a length arg's GIArgument slot (IN length
// autofill). The field is selected by the length arg's own tag; the slot is
// zero-initialised so writing the matching field is correct on little-endian
// (the only targets — Fedora x86_64/aarch64).
void WriteLengthValue(GITypeInfo* lenType, GIArgument* slot, long n) {
  switch (gi_type_info_get_tag(lenType)) {
    case GI_TYPE_TAG_INT8: slot->v_int8 = static_cast<gint8>(n); break;
    case GI_TYPE_TAG_UINT8: slot->v_uint8 = static_cast<guint8>(n); break;
    case GI_TYPE_TAG_INT16: slot->v_int16 = static_cast<gint16>(n); break;
    case GI_TYPE_TAG_UINT16: slot->v_uint16 = static_cast<guint16>(n); break;
    case GI_TYPE_TAG_INT32: slot->v_int32 = static_cast<gint32>(n); break;
    case GI_TYPE_TAG_UINT32: slot->v_uint32 = static_cast<guint32>(n); break;
    case GI_TYPE_TAG_INT64: slot->v_int64 = static_cast<gint64>(n); break;
    case GI_TYPE_TAG_UINT64: slot->v_uint64 = static_cast<guint64>(n); break;
    default: slot->v_int64 = static_cast<gint64>(n); break;  // gsize/gtype: LE-safe
  }
}

// Read a length value the callee wrote into a length arg's slot (OUT length).
static long ReadLengthValue(GITypeInfo* lenType, GIArgument* slot) {
  switch (gi_type_info_get_tag(lenType)) {
    case GI_TYPE_TAG_INT8: return slot->v_int8;
    case GI_TYPE_TAG_UINT8: return slot->v_uint8;
    case GI_TYPE_TAG_INT16: return slot->v_int16;
    case GI_TYPE_TAG_UINT16: return slot->v_uint16;
    case GI_TYPE_TAG_INT32: return slot->v_int32;
    case GI_TYPE_TAG_UINT32: return static_cast<long>(slot->v_uint32);
    case GI_TYPE_TAG_INT64: return static_cast<long>(slot->v_int64);
    case GI_TYPE_TAG_UINT64: return static_cast<long>(slot->v_uint64);
    default: return static_cast<long>(slot->v_int64);  // gsize/gtype: LE-safe
  }
}

// Read one C-array element from raw storage into a JS value, honouring the
// per-element transfer (EVERYTHING frees strings / adopts object refs).
static Napi::Value ReadCElement(Napi::Env env, GITypeInfo* elem, const void* src,
                                GITransfer elemTransfer) {
  GIArgument a;
  memset(&a, 0, sizeof(a));
  switch (gi_type_info_get_tag(elem)) {
    case GI_TYPE_TAG_BOOLEAN: a.v_boolean = *static_cast<const gboolean*>(src); break;
    case GI_TYPE_TAG_INT8: a.v_int8 = *static_cast<const gint8*>(src); break;
    case GI_TYPE_TAG_UINT8: a.v_uint8 = *static_cast<const guint8*>(src); break;
    case GI_TYPE_TAG_INT16: a.v_int16 = *static_cast<const gint16*>(src); break;
    case GI_TYPE_TAG_UINT16: a.v_uint16 = *static_cast<const guint16*>(src); break;
    case GI_TYPE_TAG_INT32: a.v_int32 = *static_cast<const gint32*>(src); break;
    case GI_TYPE_TAG_UINT32: a.v_uint32 = *static_cast<const guint32*>(src); break;
    case GI_TYPE_TAG_INT64: a.v_int64 = *static_cast<const gint64*>(src); break;
    case GI_TYPE_TAG_UINT64: a.v_uint64 = *static_cast<const guint64*>(src); break;
    case GI_TYPE_TAG_FLOAT: a.v_float = *static_cast<const gfloat*>(src); break;
    case GI_TYPE_TAG_DOUBLE: a.v_double = *static_cast<const gdouble*>(src); break;
    case GI_TYPE_TAG_UTF8:
    case GI_TYPE_TAG_FILENAME: a.v_string = *static_cast<char* const*>(src); break;
    case GI_TYPE_TAG_INTERFACE: a.v_pointer = *static_cast<gpointer const*>(src); break;
    default: return env.Undefined();
  }
  return GIArgumentToJs(env, elem, &a, elemTransfer);
}

// Free a read-side array container after marshalling out its elements. For
// TRANSFER_EVERYTHING the elements were already released per-element during the
// read; this frees the container itself. NOTHING frees nothing (callee owns).
static void FreeReadArrayContainer(gpointer container, GIArrayType at, GITransfer transfer) {
  if (container == nullptr || transfer == GI_TRANSFER_NOTHING) return;
  switch (at) {
    case GI_ARRAY_TYPE_C: g_free(container); break;
    case GI_ARRAY_TYPE_BYTE_ARRAY:
      // CONTAINER frees only the GByteArray wrapper (callee keeps the bytes);
      // EVERYTHING frees the segment too. Mirrors the GArray/GPtrArray cases.
      g_byte_array_free(static_cast<GByteArray*>(container), transfer == GI_TRANSFER_EVERYTHING);
      break;
    case GI_ARRAY_TYPE_ARRAY:
      g_array_free(static_cast<GArray*>(container), transfer == GI_TRANSFER_EVERYTHING);
      break;
    case GI_ARRAY_TYPE_PTR_ARRAY:
      g_ptr_array_free(static_cast<GPtrArray*>(container), transfer == GI_TRANSFER_EVERYTHING);
      break;
  }
}

// Marshal a C array / GStrv / GByteArray / GArray / GPtrArray into a JS value.
// `length` is the resolved element count (or -1 = derive from zero-terminated /
// fixed-size). guint8/gint8 arrays surface as a Node Buffer; everything else as
// a JS Array. Frees the container per `transfer`.
static Napi::Value GIArrayToJs(Napi::Env env, GITypeInfo* type, GIArgument* arg,
                               GITransfer transfer, long length) {
  GIArrayType at = gi_type_info_get_array_type(type);
  GITypeInfo* elem = gi_type_info_get_param_type(type, 0);
  GITypeTag etag = elem != nullptr ? gi_type_info_get_tag(elem) : GI_TYPE_TAG_VOID;
  GITransfer elemTransfer =
      transfer == GI_TRANSFER_EVERYTHING ? GI_TRANSFER_EVERYTHING : GI_TRANSFER_NOTHING;
  gpointer container = arg->v_pointer;
  void* data = container;
  size_t elemSize = CElementSize(elem);
  bool isByte = etag == GI_TYPE_TAG_UINT8 || etag == GI_TYPE_TAG_INT8;

  // Resolve data + length for the boxed array kinds (their own struct carries it).
  if (at == GI_ARRAY_TYPE_BYTE_ARRAY) {
    GByteArray* ba = static_cast<GByteArray*>(container);
    data = ba != nullptr ? ba->data : nullptr;
    length = ba != nullptr ? static_cast<long>(ba->len) : 0;
    isByte = true;
    elemSize = 1;
  } else if (at == GI_ARRAY_TYPE_ARRAY) {
    GArray* ga = static_cast<GArray*>(container);
    data = ga != nullptr ? ga->data : nullptr;
    length = ga != nullptr ? static_cast<long>(ga->len) : 0;
    if (ga != nullptr) elemSize = g_array_get_element_size(ga);
  } else if (at == GI_ARRAY_TYPE_PTR_ARRAY) {
    GPtrArray* pa = static_cast<GPtrArray*>(container);
    data = pa != nullptr ? pa->pdata : nullptr;
    length = pa != nullptr ? static_cast<long>(pa->len) : 0;
    elemSize = sizeof(gpointer);
  } else if (length < 0) {  // C array, length not given by a length arg
    if (gi_type_info_is_zero_terminated(type)) {
      length = 0;
      if (data != nullptr) {
        if (etag == GI_TYPE_TAG_UTF8 || etag == GI_TYPE_TAG_FILENAME ||
            etag == GI_TYPE_TAG_INTERFACE) {
          gpointer* p = static_cast<gpointer*>(data);
          while (p[length] != nullptr) length++;
        } else {  // numeric: scan for an all-zero element
          for (;; length++) {
            const char* e = static_cast<const char*>(data) + length * elemSize;
            bool zero = true;
            for (size_t b = 0; b < elemSize; b++)
              if (e[b] != 0) {
                zero = false;
                break;
              }
            if (zero) break;
          }
        }
      }
    } else {
      size_t fixed = 0;
      length = gi_type_info_get_array_fixed_size(type, &fixed) ? static_cast<long>(fixed) : 0;
    }
  }

  // Byte arrays → a Node Buffer (a Uint8Array subclass).
  if (isByte) {
    Napi::Value buf = (data == nullptr || length <= 0)
                          ? static_cast<Napi::Value>(Napi::Buffer<uint8_t>::New(env, 0))
                          : static_cast<Napi::Value>(Napi::Buffer<uint8_t>::Copy(
                                env, static_cast<const uint8_t*>(data), static_cast<size_t>(length)));
    FreeReadArrayContainer(container, at, transfer);
    if (elem != nullptr) gi_base_info_unref(elem);
    return buf;
  }

  Napi::Array out = Napi::Array::New(env, (data != nullptr && length > 0) ? length : 0);
  for (long i = 0; data != nullptr && i < length && !env.IsExceptionPending(); i++) {
    if (at == GI_ARRAY_TYPE_PTR_ARRAY) {
      GIArgument a;
      memset(&a, 0, sizeof(a));
      a.v_pointer = static_cast<gpointer*>(data)[i];
      out.Set(static_cast<uint32_t>(i), GIArgumentToJs(env, elem, &a, elemTransfer));
    } else {
      out.Set(static_cast<uint32_t>(i),
              ReadCElement(env, elem, static_cast<const char*>(data) + i * elemSize, elemTransfer));
    }
  }
  FreeReadArrayContainer(container, at, transfer);
  if (elem != nullptr) gi_base_info_unref(elem);
  return out;
}

// Marshal a GList / GSList into a JS Array. Elements are unpacked from each
// node's data pointer via the introspection helper (strings/objects keep the
// pointer, fundamentals are GPOINTER_TO_INT-style unpacked). Frees the node
// chain (not the elements — those follow `transfer` per element) for
// EVERYTHING/CONTAINER.
static Napi::Value GListToJs(Napi::Env env, GITypeInfo* type, GIArgument* arg,
                             GITransfer transfer, bool isSList) {
  GITypeInfo* elem = gi_type_info_get_param_type(type, 0);
  GITransfer elemTransfer =
      transfer == GI_TRANSFER_EVERYTHING ? GI_TRANSFER_EVERYTHING : GI_TRANSFER_NOTHING;
  Napi::Array out = Napi::Array::New(env);
  uint32_t i = 0;
  if (!isSList) {
    for (GList* l = static_cast<GList*>(arg->v_pointer); l != nullptr && !env.IsExceptionPending();
         l = l->next) {
      GIArgument a;
      gi_type_info_argument_from_hash_pointer(elem, l->data, &a);
      out.Set(i++, GIArgumentToJs(env, elem, &a, elemTransfer));
    }
  } else {
    for (GSList* l = static_cast<GSList*>(arg->v_pointer); l != nullptr && !env.IsExceptionPending();
         l = l->next) {
      GIArgument a;
      gi_type_info_argument_from_hash_pointer(elem, l->data, &a);
      out.Set(i++, GIArgumentToJs(env, elem, &a, elemTransfer));
    }
  }
  if (transfer == GI_TRANSFER_EVERYTHING || transfer == GI_TRANSFER_CONTAINER) {
    if (!isSList) g_list_free(static_cast<GList*>(arg->v_pointer));
    else g_slist_free(static_cast<GSList*>(arg->v_pointer));
  }
  if (elem != nullptr) gi_base_info_unref(elem);
  return out;
}

// Marshal a GHashTable into a plain JS object (string keys). Keys + values are
// read with TRANSFER_NOTHING (copied / ref'd) because, for an owned table, the
// table's own GDestroyNotify funcs free the originals when we g_hash_table_unref
// below — freeing here too would double-free.
static Napi::Value GHashToJs(Napi::Env env, GITypeInfo* type, GIArgument* arg,
                             GITransfer transfer) {
  GHashTable* ht = static_cast<GHashTable*>(arg->v_pointer);
  Napi::Object out = Napi::Object::New(env);
  if (ht != nullptr) {
    GITypeInfo* kt = gi_type_info_get_param_type(type, 0);
    GITypeInfo* vt = gi_type_info_get_param_type(type, 1);
    GHashTableIter it;
    gpointer k = nullptr;
    gpointer v = nullptr;
    g_hash_table_iter_init(&it, ht);
    while (g_hash_table_iter_next(&it, &k, &v) && !env.IsExceptionPending()) {
      GIArgument ka;
      GIArgument va;
      gi_type_info_argument_from_hash_pointer(kt, k, &ka);
      gi_type_info_argument_from_hash_pointer(vt, v, &va);
      Napi::Value key = GIArgumentToJs(env, kt, &ka, GI_TRANSFER_NOTHING);
      Napi::Value value = GIArgumentToJs(env, vt, &va, GI_TRANSFER_NOTHING);
      if (env.IsExceptionPending()) break;
      out.Set(key, value);
    }
    if (kt != nullptr) gi_base_info_unref(kt);
    if (vt != nullptr) gi_base_info_unref(vt);
  }
  if (ht != nullptr && (transfer == GI_TRANSFER_EVERYTHING || transfer == GI_TRANSFER_CONTAINER)) {
    // CONTAINER transfers the table but NOT its keys/values (callee keeps them).
    // g_hash_table_unref would run the key/value destroy-notifiers → over-free,
    // so steal the entries first; the unref then frees only the table itself.
    // EVERYTHING keeps the destroy-notifiers (we own keys + values). Mirrors the
    // C-array / GList CONTAINER handling that frees only the container.
    if (transfer == GI_TRANSFER_CONTAINER) g_hash_table_steal_all(ht);
    g_hash_table_unref(ht);
  }
  return out;
}

// Dispatch a return / OUT GIArgument to the right reader. `slots` lets an array
// resolve its length from the (already-populated) length arg slot. Scalars fall
// through to GIArgumentToJs.
Napi::Value ReadOutOrReturn(Napi::Env env, GICallableInfo* callable, GITypeInfo* ti,
                            GIArgument* arg, GITransfer transfer,
                            std::vector<GIArgument>* slots) {
  switch (gi_type_info_get_tag(ti)) {
    case GI_TYPE_TAG_ARRAY: {
      long len = -1;
      unsigned int L = 0;
      if (gi_type_info_get_array_length_index(ti, &L) && slots != nullptr && L < slots->size()) {
        GIArgInfo* la = gi_callable_info_get_arg(callable, L);
        GITypeInfo* lt = gi_arg_info_get_type_info(la);
        len = ReadLengthValue(lt, &(*slots)[L]);
        gi_base_info_unref(lt);
        gi_base_info_unref(la);
      }
      return GIArrayToJs(env, ti, arg, transfer, len);
    }
    case GI_TYPE_TAG_GLIST: return GListToJs(env, ti, arg, transfer, false);
    case GI_TYPE_TAG_GSLIST: return GListToJs(env, ti, arg, transfer, true);
    case GI_TYPE_TAG_GHASH: return GHashToJs(env, ti, arg, transfer);
    default: return GIArgumentToJs(env, ti, arg, transfer);
  }
}

// Fill a GIArgument for a single list/hash element from a JS value. Strings are
// g_strdup'd (the container owns them); objects contribute their borrowed
// handle pointer. Throws + returns false on an unsupported element.
static bool ElementToGIArgument(Napi::Env env, GITypeInfo* elem, Napi::Value v, GIArgument* a) {
  memset(a, 0, sizeof(*a));
  switch (gi_type_info_get_tag(elem)) {
    case GI_TYPE_TAG_BOOLEAN: a->v_boolean = v.ToBoolean().Value(); return true;
    case GI_TYPE_TAG_INT8: a->v_int8 = static_cast<gint8>(v.ToNumber().Int32Value()); return true;
    case GI_TYPE_TAG_UINT8: a->v_uint8 = static_cast<guint8>(v.ToNumber().Uint32Value()); return true;
    case GI_TYPE_TAG_INT16: a->v_int16 = static_cast<gint16>(v.ToNumber().Int32Value()); return true;
    case GI_TYPE_TAG_UINT16: a->v_uint16 = static_cast<guint16>(v.ToNumber().Uint32Value()); return true;
    case GI_TYPE_TAG_INT32: a->v_int32 = v.ToNumber().Int32Value(); return true;
    case GI_TYPE_TAG_UINT32: a->v_uint32 = v.ToNumber().Uint32Value(); return true;
    case GI_TYPE_TAG_INT64: a->v_int64 = JsValueToInt64(v); return true;
    case GI_TYPE_TAG_UINT64: a->v_uint64 = JsValueToUint64(v); return true;
    case GI_TYPE_TAG_FLOAT: a->v_float = static_cast<gfloat>(v.ToNumber().DoubleValue()); return true;
    case GI_TYPE_TAG_DOUBLE: a->v_double = v.ToNumber().DoubleValue(); return true;
    case GI_TYPE_TAG_UTF8:
    case GI_TYPE_TAG_FILENAME:
      a->v_string = (v.IsNull() || v.IsUndefined())
                        ? nullptr
                        : g_strdup(v.ToString().Utf8Value().c_str());
      return true;
    case GI_TYPE_TAG_INTERFACE: {
      if (v.IsNull() || v.IsUndefined()) {
        a->v_pointer = nullptr;
        return true;
      }
      if (v.IsExternal() && v.As<Napi::External<GObject>>().CheckTypeTag(&kGObjectHandleTag)) {
        a->v_pointer = v.As<Napi::External<GObject>>().Data();
        return true;
      }
      Napi::TypeError::New(env, "expected a GObject handle as a container element")
          .ThrowAsJavaScriptException();
      return false;
    }
    default:
      Napi::TypeError::New(env, "unsupported container element type")
          .ThrowAsJavaScriptException();
      return false;
  }
}

// Build a C array / GStrv / GByteArray from a JS value. *outCount = element
// count (for the IN length autofill + later free). GArray/GPtrArray IN are
// deferred. Throws + returns false on refusal (BEFORE the invoke).
static bool JsToCArray(Napi::Env env, Napi::Value v, GITypeInfo* type, gpointer* outPtr,
                       long* outCount) {
  GIArrayType at = gi_type_info_get_array_type(type);
  GITypeInfo* elem = gi_type_info_get_param_type(type, 0);
  GITypeTag etag = gi_type_info_get_tag(elem);
  bool zt = gi_type_info_is_zero_terminated(type);
  size_t elemSize = CElementSize(elem);
  bool isByte = etag == GI_TYPE_TAG_UINT8 || etag == GI_TYPE_TAG_INT8;
  *outPtr = nullptr;
  *outCount = 0;

  // Raw bytes from a TypedArray / Buffer (Uint8Array round-trips, etc.).
  const uint8_t* rawBytes = nullptr;
  size_t rawLen = 0;
  if (v.IsBuffer()) {
    Napi::Buffer<uint8_t> b = v.As<Napi::Buffer<uint8_t>>();
    rawBytes = b.Data();
    rawLen = b.Length();
  } else if (v.IsTypedArray()) {
    Napi::TypedArray ta = v.As<Napi::TypedArray>();
    rawBytes = static_cast<const uint8_t*>(ta.ArrayBuffer().Data()) + ta.ByteOffset();
    rawLen = ta.ByteLength();
  }

  if (at == GI_ARRAY_TYPE_BYTE_ARRAY) {
    GByteArray* ba = g_byte_array_new();
    if (rawBytes != nullptr) {
      g_byte_array_append(ba, rawBytes, static_cast<guint>(rawLen));
      *outCount = static_cast<long>(rawLen);
    } else if (v.IsArray()) {
      Napi::Array arr = v.As<Napi::Array>();
      for (uint32_t i = 0; i < arr.Length(); i++) {
        guint8 byte = static_cast<guint8>(arr.Get(i).ToNumber().Uint32Value());
        g_byte_array_append(ba, &byte, 1);
      }
      *outCount = static_cast<long>(arr.Length());
    } else {
      g_byte_array_unref(ba);
      gi_base_info_unref(elem);
      Napi::TypeError::New(env, "expected an array or Uint8Array for the GByteArray argument")
          .ThrowAsJavaScriptException();
      return false;
    }
    *outPtr = ba;
    gi_base_info_unref(elem);
    return true;
  }

  if (at != GI_ARRAY_TYPE_C) {
    gi_base_info_unref(elem);
    Napi::TypeError::New(env, "GArray/GPtrArray IN parameters are not yet supported")
        .ThrowAsJavaScriptException();
    return false;
  }

  // Byte C array from a TypedArray / Buffer.
  if (isByte && rawBytes != nullptr) {
    void* buf = g_malloc0(elemSize * (rawLen + (zt ? 1 : 0)));
    memcpy(buf, rawBytes, rawLen);
    *outPtr = buf;
    *outCount = static_cast<long>(rawLen);
    gi_base_info_unref(elem);
    return true;
  }

  if (!v.IsArray()) {
    gi_base_info_unref(elem);
    Napi::TypeError::New(env, "expected an array for the array argument")
        .ThrowAsJavaScriptException();
    return false;
  }
  Napi::Array arr = v.As<Napi::Array>();
  long count = static_cast<long>(arr.Length());
  void* buf = g_malloc0(elemSize * (count + (zt ? 1 : 0)));
  bool ok = true;
  for (long i = 0; i < count && ok; i++) {
    GIArgument a;
    ok = ElementToGIArgument(env, elem, arr.Get(static_cast<uint32_t>(i)), &a);
    if (!ok) break;
    void* dst = static_cast<char*>(buf) + i * elemSize;
    // Copy the element's storage bytes (LE: the low elemSize bytes of the union
    // alias the active field — v_string/v_pointer for pointers, the scalar
    // otherwise).
    memcpy(dst, &a, elemSize);
  }
  if (!ok) {
    g_free(buf);  // partial g_strdup'd strings leak on this error path (pre-checked, rare)
    gi_base_info_unref(elem);
    return false;
  }
  *outPtr = buf;
  *outCount = count;
  gi_base_info_unref(elem);
  return true;
}

// Build a GList / GSList from a JS array.
static bool JsToGListLike(Napi::Env env, Napi::Value v, GITypeInfo* type, bool isSList,
                          gpointer* outPtr) {
  *outPtr = nullptr;
  if (!v.IsArray()) {
    Napi::TypeError::New(env, "expected an array for the list argument").ThrowAsJavaScriptException();
    return false;
  }
  Napi::Array arr = v.As<Napi::Array>();
  GITypeInfo* elem = gi_type_info_get_param_type(type, 0);
  GList* glist = nullptr;
  GSList* gslist = nullptr;
  bool ok = true;
  for (uint32_t i = 0; i < arr.Length() && ok; i++) {
    GIArgument a;
    ok = ElementToGIArgument(env, elem, arr.Get(i), &a);
    if (!ok) break;
    gpointer p = gi_type_info_hash_pointer_from_argument(elem, &a);
    if (!isSList) glist = g_list_prepend(glist, p);
    else gslist = g_slist_prepend(gslist, p);
  }
  if (!isSList) *outPtr = g_list_reverse(glist);
  else *outPtr = g_slist_reverse(gslist);
  gi_base_info_unref(elem);
  return ok;
}

// Build a GHashTable (string keys) from a JS object. Value type ∈ {string,
// object}. Keys + (string) values are g_strdup'd and owned by the table.
static bool JsToGHashIn(Napi::Env env, Napi::Value v, GITypeInfo* type, gpointer* outPtr) {
  *outPtr = nullptr;
  if (!v.IsObject() || v.IsArray()) {
    Napi::TypeError::New(env, "expected an object for the GHashTable argument")
        .ThrowAsJavaScriptException();
    return false;
  }
  GITypeInfo* vt = gi_type_info_get_param_type(type, 1);
  GITypeTag vtag = gi_type_info_get_tag(vt);
  bool valueIsString = vtag == GI_TYPE_TAG_UTF8 || vtag == GI_TYPE_TAG_FILENAME;
  // String values get g_free'd by the table; borrowed object pointers do not.
  GHashTable* ht =
      g_hash_table_new_full(g_str_hash, g_str_equal, g_free, valueIsString ? g_free : nullptr);
  Napi::Object obj = v.As<Napi::Object>();
  Napi::Array keys = obj.GetPropertyNames();
  bool ok = true;
  for (uint32_t i = 0; i < keys.Length() && ok; i++) {
    Napi::Value key = keys.Get(i);
    std::string ks = key.ToString().Utf8Value();
    Napi::Value val = obj.Get(key);
    gpointer vp = nullptr;
    if (valueIsString) {
      vp = (val.IsNull() || val.IsUndefined()) ? nullptr : g_strdup(val.ToString().Utf8Value().c_str());
    } else {
      GIArgument a;
      ok = ElementToGIArgument(env, vt, val, &a);
      if (!ok) break;
      vp = a.v_pointer;
    }
    g_hash_table_insert(ht, g_strdup(ks.c_str()), vp);
  }
  *outPtr = ht;
  gi_base_info_unref(vt);
  return ok;
}

// Free an IN container after the invoke. Only TRANSFER_NOTHING is freed here —
// EVERYTHING/CONTAINER were adopted by the callee.
void FreeInContainer(const InContainer& c) {
  if (c.ptr == nullptr || c.transfer != GI_TRANSFER_NOTHING) {
    gi_base_info_unref(c.type);
    return;
  }
  GITypeTag tag = gi_type_info_get_tag(c.type);
  if (tag == GI_TYPE_TAG_ARRAY) {
    GIArrayType at = gi_type_info_get_array_type(c.type);
    GITypeInfo* elem = gi_type_info_get_param_type(c.type, 0);
    GITypeTag etag = elem != nullptr ? gi_type_info_get_tag(elem) : GI_TYPE_TAG_VOID;
    if (at == GI_ARRAY_TYPE_BYTE_ARRAY) {
      g_byte_array_unref(static_cast<GByteArray*>(c.ptr));
    } else {  // C array
      if (etag == GI_TYPE_TAG_UTF8 || etag == GI_TYPE_TAG_FILENAME) {
        char** s = static_cast<char**>(c.ptr);
        if (gi_type_info_is_zero_terminated(c.type)) {
          g_strfreev(s);
        } else {
          for (long i = 0; i < c.count; i++) g_free(s[i]);
          g_free(s);
        }
      } else {
        g_free(c.ptr);
      }
    }
    if (elem != nullptr) gi_base_info_unref(elem);
  } else if (tag == GI_TYPE_TAG_GLIST || tag == GI_TYPE_TAG_GSLIST) {
    GITypeInfo* elem = gi_type_info_get_param_type(c.type, 0);
    GITypeTag etag = elem != nullptr ? gi_type_info_get_tag(elem) : GI_TYPE_TAG_VOID;
    bool freeStrings = etag == GI_TYPE_TAG_UTF8 || etag == GI_TYPE_TAG_FILENAME;
    if (tag == GI_TYPE_TAG_GLIST) {
      if (freeStrings)
        for (GList* l = static_cast<GList*>(c.ptr); l != nullptr; l = l->next) g_free(l->data);
      g_list_free(static_cast<GList*>(c.ptr));
    } else {
      if (freeStrings)
        for (GSList* l = static_cast<GSList*>(c.ptr); l != nullptr; l = l->next) g_free(l->data);
      g_slist_free(static_cast<GSList*>(c.ptr));
    }
    if (elem != nullptr) gi_base_info_unref(elem);
  } else if (tag == GI_TYPE_TAG_GHASH) {
    g_hash_table_unref(static_cast<GHashTable*>(c.ptr));  // destroy funcs free keys/values
  }
  gi_base_info_unref(c.type);
}

// Build any supported IN container from a JS value, recording cleanup. The
// container type must already have passed IsSupportedContainerType. Throws +
// returns false on refusal (BEFORE the invoke).
bool JsToInContainer(Napi::Env env, Napi::Value v, GITypeInfo* type, GITransfer transfer,
                     gpointer* outPtr, long* outCount,
                     std::vector<InContainer>* containers) {
  GITypeTag tag = gi_type_info_get_tag(type);
  *outCount = 0;
  bool ok = false;
  if (tag == GI_TYPE_TAG_ARRAY) {
    ok = JsToCArray(env, v, type, outPtr, outCount);
  } else if (tag == GI_TYPE_TAG_GLIST || tag == GI_TYPE_TAG_GSLIST) {
    ok = JsToGListLike(env, v, type, tag == GI_TYPE_TAG_GSLIST, outPtr);
  } else if (tag == GI_TYPE_TAG_GHASH) {
    ok = JsToGHashIn(env, v, type, outPtr);
  }
  if (ok && *outPtr != nullptr) {
    containers->push_back(InContainer{
        reinterpret_cast<GITypeInfo*>(gi_base_info_ref(type)), *outPtr, transfer, *outCount});
  } else if (!ok && *outPtr != nullptr) {
    // An element conversion threw mid-build (JsToGListLike / JsToGHashIn still
    // published the partial container). It was never recorded for cleanup, so
    // the nodes (and any g_strdup'd keys/string values) would leak. Free it now
    // with NOTHING semantics — we still own all of it; the callee never saw it.
    InContainer partial{reinterpret_cast<GITypeInfo*>(gi_base_info_ref(type)), *outPtr,
                        GI_TRANSFER_NOTHING, *outCount};
    FreeInContainer(partial);  // unrefs the type ref taken above
    *outPtr = nullptr;
  }
  return ok;
}

}  // namespace nodegi
