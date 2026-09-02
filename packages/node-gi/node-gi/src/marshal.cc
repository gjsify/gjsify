// SPDX-License-Identifier: MIT
// Value marshalling: GIArgument <-> JS, boxed/GType handles, array/GList/GSList/GHashTable containers.

#include "common.h"

#include <cmath>
#include <unordered_map>
#include <utility>

namespace nodegi {

// ---- foreign-struct registry (cairo seam) -----------------------------------
//
// Port of GJS's gi/foreign.cpp table (keyed by (namespace, type_name)). A module
// (cairo.cc) registers converters for its foreign structs; the INTERFACE
// marshalling branches below route a foreign-typed arg/return to them instead of
// the generic boxed path. Populated at addon init (before any GI call marshals a
// foreign type), then read-only — no lock needed.
using ForeignKey = std::pair<std::string, std::string>;
struct ForeignKeyHash {
  size_t operator()(const ForeignKey& k) const {
    return std::hash<std::string>()(k.first) ^ (std::hash<std::string>()(k.second) << 1);
  }
};
static std::unordered_map<ForeignKey, const ForeignStructOps*, ForeignKeyHash> g_foreign_structs;

void RegisterForeignStruct(const char* ns, const char* type_name, const ForeignStructOps* ops) {
  g_foreign_structs[{ns != nullptr ? ns : "", type_name != nullptr ? type_name : ""}] = ops;
}
const ForeignStructOps* LookupForeignStruct(const char* ns, const char* type_name) {
  auto it = g_foreign_structs.find({ns != nullptr ? ns : "", type_name != nullptr ? type_name : ""});
  return it == g_foreign_structs.end() ? nullptr : it->second;
}
const ForeignStructOps* ForeignOpsForInfo(GIBaseInfo* iface) {
  if (iface == nullptr || !GI_IS_STRUCT_INFO(iface)) return nullptr;
  if (!gi_struct_info_is_foreign(reinterpret_cast<GIStructInfo*>(iface))) return nullptr;
  return LookupForeignStruct(gi_base_info_get_namespace(iface), gi_base_info_get_name(iface));
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

extern const napi_type_tag kBoxedHandleTag = {0x6d2f8c4b1a9e7350ULL,
                                              0xb7e1d3a5c9f08264ULL};

// Release a BoxedHandle record + what it owns. Shared by the External finalizer
// and the swallowed-failure bail below (which must free exactly what the never-
// registered finalizer would have).
static void FreeBoxedHandleRecord(BoxedHandle* h) {
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
  } else if (h->rawOwned && h->ptr != nullptr) {
    // A plain (non-boxed) C struct whose storage the engine g_malloc0'd itself —
    // the caller-allocates OUT case. No boxed free-func exists; the handle owns
    // the block (matches gjs CallerAllocatesOut::release, a plain g_free).
    g_free(h->ptr);
  }
  if (h->info != nullptr) gi_base_info_unref(h->info);
  delete h;
}

Napi::Value MakeBoxedHandle(Napi::Env env, gpointer ptr, GType gtype, bool owns,
                            GIBaseInfo* info, bool rawOwned) {
  GIBaseInfo* heldInfo = info != nullptr ? gi_base_info_ref(info) : nullptr;
  BoxedHandle* bh = new BoxedHandle{ptr, gtype, owns, heldInfo, rawOwned};
  Napi::External<BoxedHandle> ext = Napi::External<BoxedHandle>::New(
      env, bh, [](Napi::Env, BoxedHandle* h) { FreeBoxedHandleRecord(h); });
  if (ext.IsEmpty()) {
    // napi_create_external failed with the throw swallowed (terminating env /
    // pending exception). The finalizer was never registered — free the record
    // here and bail instead of chaining TypeTag on the empty External, which
    // would abort via Error::New(nullptr)'s fatal sites (see common.h helpers).
    FreeBoxedHandleRecord(bh);
    return ext;
  }
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
  GIBaseInfo* info = nullptr;
  GType gt = G_TYPE_INVALID;
  if (structInfo != nullptr && (GI_IS_STRUCT_INFO(structInfo) || GI_IS_UNION_INFO(structInfo))) {
    info = structInfo;  // stored (re-ref'd) so field/method resolution has the static info
    gt = gi_registered_type_info_get_g_type(reinterpret_cast<GIRegisteredTypeInfo*>(structInfo));
  }
  if (gt == G_TYPE_VARIANT) return WrapVariant(env, static_cast<GVariant*>(ptr), transfer);
  bool boxed = gt != G_TYPE_INVALID && gt != G_TYPE_NONE && G_TYPE_IS_BOXED(gt);
  // COPY a transfer-none BOXED return so the JS handle owns an independent copy —
  // matching gjs (gi/boxed.cpp: a transfer-none boxed is g_boxed_copy'd). Without
  // this the handle shares the callee's (often static) instance, so a field WRITE
  // (union.long_ = …) would corrupt that shared instance across calls. A
  // transfer-everything boxed is already owned; a non-boxed struct has no copy
  // function, so it keeps sharing (reads only — its fields aren't mutated here).
  gpointer handlePtr = ptr;
  bool owns = false;
  if (boxed) {
    handlePtr = transfer == GI_TRANSFER_EVERYTHING ? ptr : g_boxed_copy(gt, ptr);
    owns = true;
  }
  // Keep a valid registered GType on the handle even for a NON-boxed struct (e.g.
  // GIMarshalling PointerStruct): it drives method + field resolution via
  // find_by_gtype. `owns` stays gated on boxed-ness, so the finalizer only ever
  // g_boxed_free's a real boxed type — never a plain registered struct.
  GType handleGType = (gt != G_TYPE_INVALID && gt != G_TYPE_NONE) ? gt : G_TYPE_INVALID;
  return MakeBoxedHandle(env, handlePtr, handleGType, owns, info);
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

// The pointer to hand a callee for a boxed/struct IN argument, honouring the
// arg's TRANSFER annotation.
//
// A transfer-full (or -container) IN arg is ADOPTED by the callee: it will free
// the pointer. Handing over the very block this handle still owns makes both
// sides free it — the finalizer's g_boxed_free then hits already-released
// memory (`free(): invalid pointer`, SIGABRT). The canonical case is
// `GstWebRTC.WebRTCSessionDescription.new(type, sdp)`, whose `sdp` param is
// `(transfer full)`: the fresh `GstSDPMessage` from
// `GstSdp.SDPMessage.new_from_text()` (an OUT `(transfer full)`, so our handle
// owns it) got freed once by `gst_webrtc_session_description_free` and again by
// its own finalizer.
//
// gjs solves this by COPYING on transfer — refs/gjs/gi/wrapperutils.h
// `GIWrapperBase::transfer_to_gi_argument` (`GI_DIRECTION_IN &&
// transfer != GI_TRANSFER_NOTHING` → `Instance::copy_ptr`), with
// refs/gjs/gi/struct.h `StructInstance::copy_ptr` = `g_variant_ref` for
// GVariant else refs/gjs/gi/boxed.h `BoxedInstance::copy_ptr` = `g_boxed_copy`.
// Mirror that: the callee owns an independent instance, the handle keeps (and
// still owns) its own. Transfer-NOTHING is a plain borrow — unchanged.
//
// A handle with no copy function (a plain, non-boxed C struct — G_TYPE_INVALID,
// or a `rawOwned` caller-allocates OUT block) cannot be duplicated. gjs throws
// there; we instead RELINQUISH ownership so the finalizer stays out of the
// callee's way — a leak-free hand-over is impossible either way, and not
// double-freeing is strictly safer than the alternative.
gpointer TransferBoxedIn(BoxedHandle* h, GITransfer transfer) {
  if (h == nullptr) return nullptr;
  if (transfer == GI_TRANSFER_NOTHING || h->ptr == nullptr) return h->ptr;
  if (h->gtype == G_TYPE_VARIANT) return g_variant_ref(static_cast<GVariant*>(h->ptr));
  if (h->gtype != G_TYPE_INVALID && G_TYPE_IS_BOXED(h->gtype))
    return g_boxed_copy(h->gtype, h->ptr);
  h->owns = false;
  h->rawOwned = false;
  return h->ptr;
}

// Whether `v` is a boxed handle that ALREADY holds a GValue — the one shape a
// `GObject.Value` IN-arg takes as-is (gjs GValueIn::in passes it through when the
// JS object's own gtype is G_TYPE_VALUE, and boxes EVERYTHING else, including
// other boxed handles: a GVariant handed to `set_property('state', …)` becomes a
// G_TYPE_VARIANT GValue, it does not become the GValue).
static bool NodeGiIsGValueHandle(Napi::Value v) {
  BoxedHandle* h = TryGetBoxedHandle(v);
  return h != nullptr && h->gtype != G_TYPE_INVALID && g_type_is_a(h->gtype, G_TYPE_VALUE);
}

// Initialise `out` from a plain JS value, guessing the GType the way gjs does
// for an uninitialized GValue (refs/gjs/gi/value.cpp gjs_value_guess_g_type +
// gjs_value_to_g_value_internal). Returns false with a pending JS exception when
// the value has no sensible GValue representation.
//
// The int32-vs-double split matches gjs exactly (`value.isInt32()` →
// `G_TYPE_INT`, `value.isDouble()` → `G_TYPE_DOUBLE`); JS has no such tag at the
// N-API boundary, so an integral number in int32 range stands in for isInt32.
// That distinction is not load-bearing for correctness — `g_object_set_property`
// transforms between the numeric fundamentals — but staying bit-for-bit with gjs
// keeps a property that reads the GValue's own type behaving identically.
static bool JsToFreshGValue(Napi::Env env, Napi::Value v, GValue* out) {
  if (v.IsNull() || v.IsUndefined()) {
    // gjs guesses G_TYPE_POINTER for null. A real GValue holding NULL is also
    // the only thing a callee can safely dereference — passing a NULL GValue*
    // (the plain boxed-null path) would crash g_object_set_property.
    g_value_init(out, G_TYPE_POINTER);
    g_value_set_pointer(out, nullptr);
    return true;
  }
  if (v.IsBoolean()) {
    g_value_init(out, G_TYPE_BOOLEAN);
    g_value_set_boolean(out, v.As<Napi::Boolean>().Value() ? TRUE : FALSE);
    return true;
  }
  if (v.IsString()) {
    g_value_init(out, G_TYPE_STRING);
    g_value_set_string(out, v.As<Napi::String>().Utf8Value().c_str());
    return true;
  }
  if (v.IsBigInt()) {
    bool lossless = false;
    int64_t i64 = v.As<Napi::BigInt>().Int64Value(&lossless);
    if (lossless || i64 < 0) {
      g_value_init(out, G_TYPE_INT64);
      g_value_set_int64(out, i64);
    } else {
      bool ulossless = false;
      g_value_init(out, G_TYPE_UINT64);
      g_value_set_uint64(out, v.As<Napi::BigInt>().Uint64Value(&ulossless));
    }
    return true;
  }
  if (v.IsNumber()) {
    double d = v.As<Napi::Number>().DoubleValue();
    if (d == std::trunc(d) && d >= static_cast<double>(G_MININT32) &&
        d <= static_cast<double>(G_MAXINT32)) {
      g_value_init(out, G_TYPE_INT);
      g_value_set_int(out, static_cast<gint>(d));
    } else {
      g_value_init(out, G_TYPE_DOUBLE);
      g_value_set_double(out, d);
    }
    return true;
  }
  if (v.IsExternal()) {
    // A GObject handle → a G_TYPE_OBJECT GValue carrying its own GType, so a
    // property typed against a subclass still accepts it.
    Napi::External<GObject> objExt = v.As<Napi::External<GObject>>();
    if (objExt.CheckTypeTag(&kGObjectHandleTag)) {
      GObject* obj = objExt.Data();
      GType gt = obj != nullptr ? G_OBJECT_TYPE(obj) : G_TYPE_OBJECT;
      g_value_init(out, gt);
      g_value_set_object(out, obj);
      return true;
    }
    // A boxed handle → its own registered GType (GVariant has its own
    // fundamental; a non-registered C struct has no GType to name and is
    // rejected rather than guessed at).
    BoxedHandle* h = TryGetBoxedHandle(v);
    if (h != nullptr && h->gtype != G_TYPE_INVALID) {
      g_value_init(out, h->gtype);
      if (h->gtype == G_TYPE_VARIANT) g_value_set_variant(out, static_cast<GVariant*>(h->ptr));
      else if (G_TYPE_IS_BOXED(h->gtype)) g_value_set_boxed(out, h->ptr);
      else g_value_set_pointer(out, h->ptr);
      return true;
    }
  }
  Napi::TypeError::New(
      env, "Cannot convert this value to a GObject.Value (expected a boolean, number, bigint, "
           "string, null, or a GObject/boxed handle)")
      .ThrowAsJavaScriptException();
  return false;
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

// boxedTypeName(value) -> the boxed handle's GType name (e.g. "GBytes"), or null
// when the handle carries no registered GType. Lets the L1 layer attach a
// type-specific convenience (GLib.Bytes.toArray) without a per-type wrapper.
Napi::Value BoxedTypeName(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsExternal() ||
      !info[0].As<Napi::External<BoxedHandle>>().CheckTypeTag(&kBoxedHandleTag)) {
    return env.Null();
  }
  BoxedHandle* bh = info[0].As<Napi::External<BoxedHandle>>().Data();
  if (bh == nullptr || bh->gtype == G_TYPE_INVALID) return env.Null();
  const char* name = g_type_name(bh->gtype);
  return name != nullptr ? Napi::Value(Napi::String::New(env, name)) : env.Null();
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
  // Swallowed napi failure (terminating env): TypeTag on the empty External
  // would abort via Error::New(nullptr) — bail with the empty value instead.
  if (ext.IsEmpty()) return ext;
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

// Byte width of one element of a napi typed array.
static size_t TypedArrayElementSize(napi_typedarray_type t) {
  switch (t) {
    case napi_int8_array:
    case napi_uint8_array:
    case napi_uint8_clamped_array: return 1;
    case napi_int16_array:
    case napi_uint16_array: return 2;
    case napi_int32_array:
    case napi_uint32_array:
    case napi_float32_array: return 4;
    case napi_float64_array:
    case napi_bigint64_array:
    case napi_biguint64_array: return 8;
    default: return 1;
  }
}

// Extract the byte slice of a JS binary value — a TypedArray (incl. a Node
// Buffer and Uint8ClampedArray), a DataView, or a bare ArrayBuffer. Returns
// false when `v` is none of those. The slice borrows the JS backing store; it
// is only valid until control returns to JS (copy before storing).
//
// CROSS-RUNTIME: read the `data` out-param of napi_get_typedarray_info /
// napi_get_dataview_info — it already points at the VIEW's first byte on every
// runtime. Do NOT recompute `arraybuffer.Data() + byte_offset`: Bun reports a
// byte_offset inconsistent with its arraybuffer data pointer for subarray
// views, which silently marshals the wrong slice (caught by the bytes-in
// conformance program's `subarray` case on bun).
static bool JsBinaryData(Napi::Env env, Napi::Value v, const uint8_t** data, size_t* len) {
  napi_value val = v;
  bool is = false;
  if (napi_is_typedarray(env, val, &is) == napi_ok && is) {
    napi_typedarray_type type = napi_uint8_array;
    size_t length = 0;
    void* d = nullptr;
    if (napi_get_typedarray_info(env, val, &type, &length, &d, nullptr, nullptr) != napi_ok)
      return false;
    *data = static_cast<const uint8_t*>(d);
    *len = length * TypedArrayElementSize(type);
    return true;
  }
  if (napi_is_dataview(env, val, &is) == napi_ok && is) {
    size_t byteLength = 0;
    void* d = nullptr;
    if (napi_get_dataview_info(env, val, &byteLength, &d, nullptr, nullptr) != napi_ok)
      return false;
    *data = static_cast<const uint8_t*>(d);
    *len = byteLength;
    return true;
  }
  if (napi_is_arraybuffer(env, val, &is) == napi_ok && is) {
    void* d = nullptr;
    size_t byteLength = 0;
    if (napi_get_arraybuffer_info(env, val, &d, &byteLength) != napi_ok) return false;
    *data = static_cast<const uint8_t*>(d);
    *len = byteLength;
    return true;
  }
  return false;
}

// The name SpiderMonkey's JS::InformalValueTypeName gives a value — what gjs
// interpolates into its marshalling errors. Primitives report their typeof;
// objects report their class name, which for the shapes reachable here is
// enough at "Object"/"Function".
static const char* InformalValueTypeName(const Napi::Value& v) {
  if (v.IsNull()) return "null";
  if (v.IsUndefined()) return "undefined";
  if (v.IsBoolean()) return "boolean";
  if (v.IsNumber()) return "number";
  if (v.IsBigInt()) return "bigint";
  if (v.IsString()) return "string";
  if (v.IsSymbol()) return "symbol";
  if (v.IsFunction()) return "Function";
  if (v.IsArray()) return "Array";
  return "Object";
}

// "Gtk.Box" for an introspected GType, g_type_name() otherwise (a registerClass
// subtype has no GI info of its own; its C name is still exact). The gjs twin is
// GIWrapperBase::format_name() (refs/gjs/gi/wrapperutils.h).
static std::string GTypeDisplayName(GType gtype) {
  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* info = gi_repository_find_by_gtype(repo, gtype);
  std::string name;
  if (info != nullptr) {
    name = std::string(gi_base_info_get_namespace(info)) + "." + gi_base_info_get_name(info);
    gi_base_info_unref(info);
  } else {
    name = g_type_name(gtype);
  }
  g_object_unref(repo);
  return name;
}

// `ownedStrings` (optional): when a transfer-full string IN/INOUT arg is g_strdup'd
// here, the freshly-allocated pointer is appended so the caller can g_free it if the
// invoke never adopts it (an arg-marshal error before the call, or a failed invoke).
// nullptr (the default) → no tracking, for the vfunc-return / signal-arg callers.
bool JsToGIArgument(Napi::Env env, Napi::Value v, GITypeInfo* type, GIArgument* out,
                    std::string* heldString,
                    GITransfer transfer,
                    std::vector<gpointer>* ownedStrings,
                    CreatedClosures* closures,
                    CreatedBytes* bytes,
                    CreatedValues* values,
                    const char* argName) {
  if (v.IsEmpty()) {
    // Residue of a swallowed napi failure (a fallible Get()/coercion upstream
    // failed on a terminating env, or a throwing getter left the exception
    // pending). Nothing can be marshalled from it, and coercing it would abort
    // via Error::New(nullptr)'s fatal sites — fail the marshal cleanly. Gate the
    // diagnostic THROW on NodeGiJsAvailable: it is false both on a dying env
    // (worker.terminate mid-call — constructing a Napi::Error there runs fallible
    // napi calls that abort via the SAME funnel) AND on a live env with an
    // exception already pending (propagate that one). Only throw when the env can
    // safely build the error.
    if (NodeGiJsAvailable(env)) {
      Napi::Error::New(env, "argument value unavailable (env is terminating)")
          .ThrowAsJavaScriptException();
    }
    return false;
  }
  GITypeTag tag = gi_type_info_get_tag(type);
  switch (tag) {
    case GI_TYPE_TAG_BOOLEAN: out->v_boolean = NodeGiToBool(v); return true;
    case GI_TYPE_TAG_INT8: out->v_int8 = static_cast<int8_t>(NodeGiToInt32(v)); return true;
    case GI_TYPE_TAG_UINT8: out->v_uint8 = static_cast<uint8_t>(NodeGiToUint32(v)); return true;
    case GI_TYPE_TAG_INT16: out->v_int16 = static_cast<int16_t>(NodeGiToInt32(v)); return true;
    case GI_TYPE_TAG_UINT16: out->v_uint16 = static_cast<uint16_t>(NodeGiToUint32(v)); return true;
    case GI_TYPE_TAG_INT32: out->v_int32 = NodeGiToInt32(v); return true;
    case GI_TYPE_TAG_UINT32: out->v_uint32 = NodeGiToUint32(v); return true;
    // 64-bit: accept a BigInt losslessly (else a Number, truncated) — never let a
    // BigInt reach ToNumber() (fatal abort). See JsValueTo{Int,Uint}64 in common.h.
    case GI_TYPE_TAG_INT64: out->v_int64 = JsValueToInt64(v); return true;
    case GI_TYPE_TAG_UINT64: out->v_uint64 = JsValueToUint64(v); return true;
    case GI_TYPE_TAG_FLOAT: out->v_float = static_cast<float>(NodeGiToDouble(v)); return true;
    case GI_TYPE_TAG_DOUBLE: out->v_double = NodeGiToDouble(v); return true;
    case GI_TYPE_TAG_UTF8:
    case GI_TYPE_TAG_FILENAME:
      if (v.IsNull() || v.IsUndefined()) {
        out->v_string = nullptr;
        return true;
      }
      if (!v.IsString()) {
        // gjs refuses any non-string here rather than coercing (arg-cache.cpp
        // report_typeof_mismatch) — coercion is how `add_titled(child, 5, …)`
        // silently registered a stack page named "5" while the same call threw
        // on gjs, so @gjsify/gtk-host's refused-layout-write recovery never ran.
        // Thrown as a plain Error, not TypeError: gjs_throw builds JSEXN_ERR.
        std::string msg = std::string("Expected type string for ") +
                          (argName != nullptr ? std::string("argument '") + argName + "'"
                                              : std::string("argument")) +
                          " but got type " + InformalValueTypeName(v);
        Napi::Error::New(env, msg).ThrowAsJavaScriptException();
        return false;
      }
      if (transfer == GI_TRANSFER_EVERYTHING) {
        // The callee adopts the string and g_free's it. heldString points into a
        // std::string buffer (NOT g_malloc'd) → an invalid free. Hand over a
        // g_strdup'd copy the callee can legally free; we keep no reference. Track
        // it so a NON-adopting caller (error before / failed invoke) can free it.
        out->v_string = g_strdup(NodeGiToUtf8(v).c_str());
        if (ownedStrings != nullptr) ownedStrings->push_back(out->v_string);
      } else {
        *heldString = NodeGiToUtf8(v);
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
            GObject* obj = v.As<Napi::External<GObject>>().Data();
            // Runtime type check, as gjs (wrapperutils.h GIWrapperBase::typecheck):
            // handing GTK a pointer of the wrong GType is not an error IT reports
            // as an exception — adw_preferences_page_add() logs one CRITICAL and
            // returns at exit 0, so the caller's recovery path never runs. Only a
            // handle carrying the GObject type tag can be dereferenced safely (a
            // fundamental handle also lands here and keeps the old pass-through).
            if (v.As<Napi::External<GObject>>().CheckTypeTag(&kGObjectHandleTag) &&
                obj != nullptr) {
              GType expected = gi_registered_type_info_get_g_type(
                  reinterpret_cast<GIRegisteredTypeInfo*>(iface));
              if (expected != G_TYPE_INVALID && expected != G_TYPE_NONE &&
                  !g_type_is_a(G_OBJECT_TYPE(obj), expected)) {
                std::string msg = "Object is of type " + GTypeDisplayName(G_OBJECT_TYPE(obj)) +
                                  " - cannot convert to " + g_type_name(expected);
                gi_base_info_unref(iface);
                Napi::TypeError::New(env, msg).ThrowAsJavaScriptException();
                return false;
              }
            }
            // A (transfer full) GObject IN arg CONSUMES a reference: the callee
            // takes over the one it is handed. Passing the handle's own ref
            // makes the callee and the JS wrapper share a single ref that BOTH
            // release — the wrapper's finalize then frees an object the callee
            // still owns, and the callee is left dereferencing freed memory.
            //
            // `gtk_widget_add_controller()` is the canonical case and the one
            // that surfaced it: GTK keeps the controller in the widget's list,
            // the JS wrapper for it goes out of scope, and the next pointer
            // motion over the widget hits
            //
            //   Gtk-CRITICAL **: gtk_event_controller_handle_crossing:
            //   assertion 'GTK_IS_EVENT_CONTROLLER (controller)' failed
            //
            // NONDETERMINISTICALLY — it needs a GC between the add and the
            // event, which is why it looked unrelated to anything nearby.
            //
            // gjs takes the ref here (wrapperutils.h
            // `transfer_to_gi_argument`: `GI_DIRECTION_IN && transfer !=
            // GI_TRANSFER_NOTHING` → `copy_ptr` → `g_object_ref`), and this
            // file already does the equivalent for BOXED args via
            // `TransferBoxedIn`. Objects were simply never given the same rule.
            if (transfer != GI_TRANSFER_NOTHING && obj != nullptr) g_object_ref(obj);
            out->v_pointer = obj;
            handled = true;
          }
        } else if (GI_IS_ENUM_INFO(iface) || GI_IS_FLAGS_INFO(iface)) {
          out->v_int = NodeGiToInt32(v);
          handled = true;
        } else if (GI_IS_STRUCT_INFO(iface) || GI_IS_UNION_INFO(iface)) {
          // A foreign struct (cairo Context/Surface/Pattern) marshals through its
          // module's converter, not the boxed path.
          const ForeignStructOps* fops = ForeignOpsForInfo(iface);
          if (fops != nullptr) {
            if (!fops->to(env, v, transfer, out)) {
              gi_base_info_unref(iface);
              return false;  // to() already threw
            }
            handled = true;
          } else if (v.IsFunction() && closures != nullptr &&
                     gi_registered_type_info_get_g_type(
                         reinterpret_cast<GIRegisteredTypeInfo*>(iface)) == G_TYPE_CLOSURE) {
            // A JS function for a `GObject.Closure` IN-arg → a real marshaled
            // GClosure, exactly as gjs (refs/gjs/gi/arg-cache.cpp
            // GClosureInTransferNone::in: create_marshaled + g_closure_ref +
            // g_closure_sink). The ref taken here is released by calls.cc after
            // the invoke for transfer-none (gjs BoxedInTransferNone::release —
            // the callee keeps its own ref if it stored the closure), and left
            // with the callee for transfer-full (gjs GClosureIn::release skips).
            // An existing GObject.Closure boxed handle still routes through the
            // boxed-handle branch below.
            GClosure* closure = NodeGiMakeGenericJsClosure(env, v);
            g_closure_ref(closure);
            g_closure_sink(closure);
            out->v_pointer = closure;
            if (transfer == GI_TRANSFER_NOTHING) closures->transferNone.push_back(closure);
            else closures->transferFull.push_back(closure);
            handled = true;
          } else if (bytes != nullptr &&
                     (v.IsTypedArray() || v.IsDataView() || v.IsArrayBuffer()) &&
                     g_type_is_a(gi_registered_type_info_get_g_type(
                                     reinterpret_cast<GIRegisteredTypeInfo*>(iface)),
                                 G_TYPE_BYTES)) {
            // JS bytes for a `GLib.Bytes` IN-arg → a fresh GBytes COPY, exactly
            // as gjs (refs/gjs/gi/arg-cache.cpp GBytesIn::in Uint8Array path →
            // gjs_byte_array_get_bytes → g_bytes_new). Recorded in `bytes` so
            // calls.cc releases the fresh ref per transfer after the invoke
            // (transfer-none: always unref — the callee ref'd it if it kept it;
            // transfer-full: the callee adopts it). An existing GLib.Bytes boxed
            // handle still routes through the boxed-handle branch below.
            const uint8_t* data = nullptr;
            size_t len = 0;
            JsBinaryData(env, v, &data, &len);
            GBytes* b = g_bytes_new(data, len);
            out->v_pointer = b;
            if (transfer == GI_TRANSFER_NOTHING) bytes->transferNone.push_back(b);
            else bytes->transferFull.push_back(b);
            handled = true;
          } else if (values != nullptr && !NodeGiIsGValueHandle(v) &&
                     gi_registered_type_info_get_g_type(
                         reinterpret_cast<GIRegisteredTypeInfo*>(iface)) == G_TYPE_VALUE) {
            // A plain JS value for a `GObject.Value` IN-arg → a fresh GValue whose
            // GType is guessed from the value, exactly as gjs (refs/gjs
            // gi/arg-cache.cpp GValueIn::in → gjs_value_to_g_value). This is what
            // makes `obj.set_property('volume', 0.5)` — whose GI signature takes a
            // GValue — work at all; a JS number is not a boxed handle, so it used
            // to fall through to the "Unsupported interface IN argument" throw.
            //
            // An EXISTING GObject.Value handle is excluded here and routes through
            // the boxed-handle branch below untouched, matching gjs's pass-through
            // for an already-typed GValue.
            GValue* boxed = g_new0(GValue, 1);
            if (!JsToFreshGValue(env, v, boxed)) {
              g_free(boxed);
              gi_base_info_unref(iface);
              return false;  // JsToFreshGValue already threw
            }
            out->v_pointer = boxed;
            if (transfer == GI_TRANSFER_NOTHING) values->transferNone.push_back(boxed);
            else values->transferFull.push_back(boxed);
            handled = true;
          } else if (v.IsNull() || v.IsUndefined()) {
            // Boxed/struct IN args arrive as boxed handles; null/undefined maps to
            // a NULL pointer (e.g. GLib.MainLoop.new(null, false)).
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
              out->v_pointer = TransferBoxedIn(h, transfer);
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
      // A GParamSpec return (e.g. GObject.ParamSpec factory / *_returnv) is a
      // GObject FUNDAMENTAL, not a GObject — introspected as an object info but
      // ref-counted via g_param_spec_ref, so it must NOT go through WrapGObject
      // (g_object_ref would be wrong). Route it to the paramspec handle.
      GType ifaceGType =
          iface != nullptr && (GI_IS_OBJECT_INFO(iface) || GI_IS_STRUCT_INFO(iface))
              ? gi_registered_type_info_get_g_type(reinterpret_cast<GIRegisteredTypeInfo*>(iface))
              : G_TYPE_INVALID;
      if (ifaceGType != G_TYPE_INVALID && g_type_is_a(ifaceGType, G_TYPE_VALUE)) {
        // A GValue return/OUT (GType G_TYPE_VALUE, or derived): GJS AUTO-UNBOXES it
        // to the contained JS value (int/uint/int64/string/boolean/double/enum/
        // object/boxed/GVariant/GParamSpec/GType/null), NOT a boxed handle. Verified
        // against gjs 1.88: GIMarshallingTests.gvalue_return() → 42 (a number), not a
        // GObject.Value box; gvalue_copy(<string GValue>) → "hi"; an object-holding
        // GValue → the wrapped GObject (same identity); a NULL/unset string/object
        // GValue → null. Unbox via GValueToJs — the SAME converter property/signal
        // GValues use (BigInt/lossy 64-bit warning + all contained-type logic). The
        // pointer slot holds the GValue* (a GValue return/OUT is always a pointer).
        // Reference: refs/gjs/gi/arg.cpp gjs_value_from_gi_argument (INTERFACE branch
        // tests `g_type_is_a(gtype, G_TYPE_VALUE)` BEFORE Struct) → value.cpp
        // gjs_value_from_g_value. NB an EXPLICIT GObject.Value instance a user
        // constructs stays a box — this only fires on a function's GValue return/OUT.
        GValue* gvalue = static_cast<GValue*>(arg->v_pointer);
        if (gvalue == nullptr) {
          result = env.Null();
        } else {
          result = GValueToJs(env, gvalue);
          // Transfer/free: GValueToJs COPIES/REFS every contained value into JS
          // (strings are copied into V8, objects/boxeds ref'd/copied), so freeing the
          // GValue container after the read is always safe. A transfer-EVERYTHING
          // GValue* return (caller owns) is g_boxed_free'd — g_value_unset + free the
          // GValue slice — exactly as GJS does (refs/gjs/gi/arg.cpp
          // gjs_gi_argument_release G_TYPE_VALUE: pointer → g_boxed_free(gtype, …)).
          // Transfer-NONE (the common case: gvalue_return/out, Gda.get_value_at) is a
          // borrow → no free.
          if (transfer == GI_TRANSFER_EVERYTHING) g_boxed_free(G_TYPE_VALUE, gvalue);
        }
      } else if (ifaceGType != G_TYPE_INVALID && g_type_is_a(ifaceGType, G_TYPE_PARAM)) {
        result = MakeParamSpecHandle(env, static_cast<GParamSpec*>(arg->v_pointer), transfer);
      } else if (iface != nullptr && GI_IS_OBJECT_INFO(iface) &&
                 gi_object_info_get_fundamental(reinterpret_cast<GIObjectInfo*>(iface))) {
        // A non-GObject GObject-fundamental (GskRenderNode from Gtk.Snapshot.to_node,
        // GdkEvent, …): introspected as object info but ref-counted via its OWN
        // ref/unref funcs — G_IS_OBJECT is FALSE. WrapGObject would run the
        // toggle-ref/qdata dance on a non-GObject → a G_IS_OBJECT critical cascade +
        // a leaked ref. Wrap with the introspected ref/unref instead. (GParamSpec +
        // GValue are handled by their dedicated branches above, so this is the rest.)
        result = MakeFundamentalHandle(env, arg->v_pointer,
                                       reinterpret_cast<GIObjectInfo*>(iface), transfer);
      } else if (iface != nullptr && (GI_IS_OBJECT_INFO(iface) || GI_IS_INTERFACE_INFO(iface))) {
        result = WrapGObject(env, static_cast<GObject*>(arg->v_pointer), transfer);
      } else if (iface != nullptr && (GI_IS_ENUM_INFO(iface) || GI_IS_FLAGS_INFO(iface))) {
        result = Napi::Number::New(env, arg->v_int);
      } else if (iface != nullptr && (GI_IS_STRUCT_INFO(iface) || GI_IS_UNION_INFO(iface))) {
        // A foreign struct (cairo) returned/handed to a callback (e.g. a draw-func's
        // cairo_t) wraps via its module's converter, not the boxed path.
        const ForeignStructOps* fops = ForeignOpsForInfo(iface);
        result = fops != nullptr ? fops->from(env, arg->v_pointer, transfer)
                                 : WrapBoxed(env, arg->v_pointer, iface, transfer);
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
    case GI_TYPE_TAG_ERROR: {
      // A GError-typed value (a `GLib.Error` return like Gtk.GLArea.get_error(),
      // or a GLib.Error.new_literal construct): GJS surfaces it as a GLib.Error
      // boxed (G_TYPE_ERROR) with `.domain`/`.code`/`.message` field access +
      // `.matches()`/`.copy()` methods. Wrap through the GLib.Error struct info
      // so the boxed handle resolves fields and methods; a NULL GError (the
      // no-error case) stays null. WrapBoxed handles transfer: a transfer-none
      // borrow is g_boxed_copy'd into an owned copy, transfer-full is adopted.
      GError* gerr = static_cast<GError*>(arg->v_pointer);
      if (gerr == nullptr) return env.Null();
      GIRepository* repo = DupDefaultRepository();
      // GLib is loaded by any namespace require; require defensively anyway so a
      // bare engine call still resolves the struct info (idempotent, cheap).
      gi_repository_require(repo, "GLib", "2.0", static_cast<GIRepositoryLoadFlags>(0), nullptr);
      GIBaseInfo* errInfo = gi_repository_find_by_name(repo, "GLib", "Error");
      Napi::Value result = WrapBoxed(env, gerr, errInfo, transfer);
      if (errInfo != nullptr) gi_base_info_unref(errInfo);
      g_object_unref(repo);
      return result;
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
//  * IN, PER ELEMENT: the container transfer also decides who owns the ELEMENTS,
//    and the two answers differ. CONTAINER hands over only the container, so the
//    elements stay ours and a borrowed pointer is right. EVERYTHING hands over the
//    elements TOO — a borrowed object/boxed pointer there is freed by the callee
//    AND by the JS handle that still owns it. Measured on the pointer-struct case
//    the moment it was admitted: `Pango.Font.descriptions_free([desc])` (`descs` is
//    `(transfer full)`) read back garbage and died in `free(): invalid size`. So
//    ElementToGIArgument takes the ELEMENT transfer — NOTHING for a borrow (incl.
//    CONTAINER), EVERYTHING for adoption, exactly the rule the read side already
//    uses — and refs/copies on EVERYTHING. Strings were always right (g_strdup'd
//    per element either way).
//  * IN, ROOTING: a borrowed element pointer stays valid across the invoke because
//    the JS array is an ARGUMENT of the running native call — it and everything
//    reachable from it are held by that call's handle scope, which is not popped
//    until we return. So nothing can be collected between building the container
//    and the callee reading it, not even an element a getter/Proxy synthesised.

// Element-type support shared by every container kind. *why receives a short
// label on refusal (so the caller can throw a precise deferral message).
//
// `byValueOk` is true only where the element is a SIZED CELL the IN path lays out
// itself — a C array being built for an IN argument. It is false for a read-back
// (ReadCElement still dereferences an interface element as a pointer) and false for
// GList/GSList/GHashTable, whose elements are POINTER slots filled through
// gi_type_info_hash_pointer_from_argument: that helper passes a pointer through
// unchanged, which is right for a pointer-struct element and meaningless for a
// four-byte enum or a twenty-four-byte record. So the by-value admission is scoped to
// the one container kind that has somewhere to put the bytes.
static bool IsSupportedElementType(GITypeInfo* elem, std::string* why, bool byValueOk) {
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
      // A struct element that is a POINTER occupies exactly one pointer slot, which is
      // the same shape an object element already has: CElementSize answers
      // sizeof(gpointer) and the write loop memcpy's the low 8 bytes.
      // `GLib.Variant.new_tuple` is the call this unblocks: measured against the
      // installed typelib, its `children` element is `tag=interface ptr=1 kind=STRUCT`.
      //
      // Admission alone was NOT enough, and the reading that said it was is worth
      // keeping: "FreeInContainer's non-string branch already frees the buffer without
      // touching what the pointers point at" is true and beside the point, because
      // FreeInContainer runs only for TRANSFER_NOTHING. On a (transfer full) container
      // the CALLEE frees the elements — see the per-element half of the OWNERSHIP note
      // above and ElementToGIArgument, which is where that is now handled.
      //
      // A BY-VALUE struct element stays refused, and the distinction is the whole point
      // of testing is_pointer here rather than the kind alone: `Gtk.Accessible
      // .update_property`'s values are `ptr=0 kind=STRUCT size=24`, so admitting them
      // would lay 24-byte GValues out at an 8-byte stride and hand the callee garbage.
      // That case needs gi_struct_info_get_size plus an ownership rule (each in-place
      // g_value_init would need unsetting, and FreeInContainer has no branch for it) —
      // the same deferred work this file already records at its CALLER_ALLOCATES site.
      if (!ok && iface != nullptr && GI_IS_STRUCT_INFO(iface) && gi_type_info_is_pointer(elem)) {
        ok = true;
      }
      // BY-VALUE elements, admitted only where there is a sized cell to write them
      // into (see `byValueOk`). An enum/flags element is its storage integer; a
      // record/union element is its own bytes, copied out of a boxed handle. Both go
      // through CInElementSize + ElementToCArrayCell, which is the write path that
      // does NOT run the GIArgument union through memcpy — see the note there.
      if (!ok && byValueOk && iface != nullptr && !gi_type_info_is_pointer(elem) &&
          (GI_IS_ENUM_INFO(iface) || GI_IS_FLAGS_INFO(iface) || GI_IS_STRUCT_INFO(iface) ||
           GI_IS_UNION_INFO(iface))) {
        ok = true;
      }
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
bool IsSupportedContainerType(GITypeInfo* type, std::string* why, ContainerUse use) {
  switch (gi_type_info_get_tag(type)) {
    case GI_TYPE_TAG_ARRAY:
    case GI_TYPE_TAG_GLIST:
    case GI_TYPE_TAG_GSLIST: {
      GITypeInfo* elem = gi_type_info_get_param_type(type, 0);
      if (elem == nullptr) {
        if (why != nullptr) *why = "untyped container";
        return false;
      }
      // A by-value element needs a sized cell, which only a C array being BUILT has.
      // GArray is deliberately excluded alongside the lists: its elements are sized,
      // but g_array_append_vals copies from a buffer this path would have to size the
      // same way, and no installed typelib has a by-value-element GArray as IN.
      bool byValueOk = use == ContainerUse::kIn &&
                       gi_type_info_get_tag(type) == GI_TYPE_TAG_ARRAY &&
                       gi_type_info_get_array_type(type) == GI_ARRAY_TYPE_C;
      bool ok = IsSupportedElementType(elem, why, byValueOk);
      gi_base_info_unref(elem);
      return ok;
    }
    case GI_TYPE_TAG_GHASH: {
      GITypeInfo* kt = gi_type_info_get_param_type(type, 0);
      GITypeInfo* vt = gi_type_info_get_param_type(type, 1);
      GITypeTag ktag = kt != nullptr ? gi_type_info_get_tag(kt) : GI_TYPE_TAG_VOID;
      // Supported hash key tags — a subset of GJS's is_supported_ghash_key_type
      // (refs/gjs/gi/arg.cpp): strings + the pointer-fitting integers. 64-bit keys
      // (which don't fit a pointer) + unichar keys are out of scope.
      bool kok = ktag == GI_TYPE_TAG_UTF8 || ktag == GI_TYPE_TAG_FILENAME ||
                 ktag == GI_TYPE_TAG_INT8 || ktag == GI_TYPE_TAG_UINT8 ||
                 ktag == GI_TYPE_TAG_INT16 || ktag == GI_TYPE_TAG_UINT16 ||
                 ktag == GI_TYPE_TAG_INT32 || ktag == GI_TYPE_TAG_UINT32;
      bool vok = vt != nullptr && IsSupportedElementType(vt, nullptr, false);
      if (!kok && why != nullptr) *why = "unsupported GHashTable key";
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
size_t CElementSize(GITypeInfo* elem) {
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

// Storage size of one C-array element on the IN path, INCLUDING the by-value
// interface elements CElementSize declines to size.
//
// Deliberately NOT folded into CElementSize, and the split is a scope statement rather
// than duplication: CElementSize is also the READ stride (GIArrayToJs), where a
// by-value interface element is still unreadable — ReadCElement dereferences it as a
// pointer, which is why ElementsAreReadable exists. Teaching CElementSize the true
// size there would turn a wrong stride in front of a wrong read into a RIGHT stride in
// front of a wrong read: more plausible output, the same defect. Opening the read side
// is separate work (this file records it at the inline-record field path and calls.cc
// records it at CALLER_ALLOCATES); until then the IN path answers for itself. Every
// non-interface tag delegates, so the two answers cannot drift.
//
// An enum's size is its OWN storage type, not a hardcoded 4: gi_enum_info_get_storage
// _type is what the typelib records for the C enum, and gjs's sizeof(unsigned int) is
// an assumption this does not have to inherit.
static size_t CInElementSize(GITypeInfo* elem) {
  if (gi_type_info_get_tag(elem) != GI_TYPE_TAG_INTERFACE) return CElementSize(elem);
  if (gi_type_info_is_pointer(elem)) return sizeof(gpointer);
  GIBaseInfo* iface = gi_type_info_get_interface(elem);
  if (iface == nullptr) return sizeof(gpointer);
  size_t size;
  if (GI_IS_ENUM_INFO(iface) || GI_IS_FLAGS_INFO(iface)) {
    switch (gi_enum_info_get_storage_type(reinterpret_cast<GIEnumInfo*>(iface))) {
      case GI_TYPE_TAG_INT8:
      case GI_TYPE_TAG_UINT8: size = 1; break;
      case GI_TYPE_TAG_INT16:
      case GI_TYPE_TAG_UINT16: size = 2; break;
      case GI_TYPE_TAG_INT64:
      case GI_TYPE_TAG_UINT64: size = 8; break;
      default: size = 4; break;  // int32/uint32 and anything unannotated
    }
  } else if (GI_IS_STRUCT_INFO(iface)) {
    size = gi_struct_info_get_size(reinterpret_cast<GIStructInfo*>(iface));
  } else if (GI_IS_UNION_INFO(iface)) {
    size = gi_union_info_get_size(reinterpret_cast<GIUnionInfo*>(iface));
  } else {
    size = sizeof(gpointer);  // object/interface instance: one pointer slot
  }
  gi_base_info_unref(iface);
  return size;
}

// Whether an element is a by-value RECORD (struct or union) — the one kind that must
// not travel through a GIArgument. See ByValueRecordToCell.
static bool IsByValueRecordElement(GITypeInfo* elem) {
  if (gi_type_info_get_tag(elem) != GI_TYPE_TAG_INTERFACE) return false;
  if (gi_type_info_is_pointer(elem)) return false;
  GIBaseInfo* iface = gi_type_info_get_interface(elem);
  if (iface == nullptr) return false;
  bool record = GI_IS_STRUCT_INFO(iface) || GI_IS_UNION_INFO(iface);
  gi_base_info_unref(iface);
  return record;
}

// The GType of a by-value record element, or G_TYPE_INVALID for an unregistered one.
static GType ByValueRecordGType(GITypeInfo* elem) {
  GIBaseInfo* iface = gi_type_info_get_interface(elem);
  if (iface == nullptr) return G_TYPE_INVALID;
  GType gtype = GI_IS_REGISTERED_TYPE_INFO(iface)
                    ? gi_registered_type_info_get_g_type(
                          reinterpret_cast<GIRegisteredTypeInfo*>(iface))
                    : G_TYPE_INVALID;
  gi_base_info_unref(iface);
  return gtype == G_TYPE_NONE ? G_TYPE_INVALID : gtype;
}

// Whether a by-value record element array is one this path OWNS the contents of —
// true only for GValue, the one element kind written by initialising in place rather
// than by copying a caller's bytes. FreeInContainer needs the same answer, so it is
// derived from the type both times instead of carried in InContainer: a flag would be
// a second truth that a later element kind could get wrong in only one of the places.
static bool ElementsAreOwnedGValues(GITypeInfo* type) {
  if (gi_type_info_get_tag(type) != GI_TYPE_TAG_ARRAY) return false;
  if (gi_type_info_get_array_type(type) != GI_ARRAY_TYPE_C) return false;
  GITypeInfo* elem = gi_type_info_get_param_type(type, 0);
  if (elem == nullptr) return false;
  bool owned = IsByValueRecordElement(elem) && ByValueRecordGType(elem) == G_TYPE_VALUE;
  gi_base_info_unref(elem);
  return owned;
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

// Two array arguments can name the SAME length argument — `Gtk.Accessible
// .update_property(n, properties[], values[])` is the shape, and `update_state` and
// `update_relation` repeat it. The autofill writes that argument once per array, so the
// LAST array silently decides the count the callee then reads BOTH arrays by; a shorter
// one is read past its end, inside the callee, with nothing on this side to attribute it
// to afterwards.
//
// gjs does not check this — measured on 1.88.1: `update_property([LABEL, DESCRIPTION],
// ['only one'])` is accepted and reads out of bounds. Refusing it is therefore a
// deliberate divergence, and the cheaper side of one: the caller passed two arrays that
// cannot both be right, and the alternative to a TypeError is an overread.
bool RecordLengthWrite(std::vector<LengthWrite>* seen, unsigned int index, long count,
                       long* other) {
  for (const LengthWrite& w : *seen) {
    if (w.index != index) continue;
    if (w.count == count) return true;
    if (other != nullptr) *other = w.count;
    return false;
  }
  seen->push_back(LengthWrite{index, count});
  return true;
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
  // A NULL container maps to `null` for every array kind EXCEPT a length-annotated
  // C array (an explicit length was passed → an empty array, matching GJS's
  // gjs_array_from_basic_c_array_internal "null pointer takes precedence over
  // length" for the length path vs the fixed/zero-terminated/GArray/GPtrArray/
  // GByteArray readers, which each return null on a NULL container).
  bool hasExplicitLength = length >= 0;

  // Resolve data + length for the boxed array kinds (their own struct carries it).
  // A NULL boxed container → JS null (GJS gjs_value_from_basic_{garray,gptrarray,
  // byte_array}_gi_argument each null-guard before reading).
  if (at == GI_ARRAY_TYPE_BYTE_ARRAY) {
    GByteArray* ba = static_cast<GByteArray*>(container);
    if (ba == nullptr) {
      if (elem != nullptr) gi_base_info_unref(elem);
      return env.Null();
    }
    data = ba->data;
    length = static_cast<long>(ba->len);
    isByte = true;
    elemSize = 1;
  } else if (at == GI_ARRAY_TYPE_ARRAY) {
    GArray* ga = static_cast<GArray*>(container);
    if (ga == nullptr) {
      if (elem != nullptr) gi_base_info_unref(elem);
      return env.Null();
    }
    data = ga->data;
    length = static_cast<long>(ga->len);
    elemSize = g_array_get_element_size(ga);
  } else if (at == GI_ARRAY_TYPE_PTR_ARRAY) {
    GPtrArray* pa = static_cast<GPtrArray*>(container);
    if (pa == nullptr) {
      if (elem != nullptr) gi_base_info_unref(elem);
      return env.Null();
    }
    data = pa->pdata;
    length = static_cast<long>(pa->len);
    elemSize = sizeof(gpointer);
  } else if (data == nullptr) {
    // NULL C-array pointer: a fixed/zero-terminated array (no length param) → null;
    // a length-annotated array (explicit length given) → an empty array below.
    if (elem != nullptr) gi_base_info_unref(elem);
    return hasExplicitLength ? static_cast<Napi::Value>(Napi::Array::New(env, 0)) : env.Null();
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
  // A NULL GHashTable maps to `null` (GJS gjs_value_from_basic_ghash null-guards
  // the table before reading) — NOT an empty object; e.g. an uninitialized OUT.
  if (ht == nullptr) return env.Null();
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

// Fill a GIArgument for a single array/list/hash element from a JS value. Strings
// are g_strdup'd (the container owns them). `elemTransfer` is the ELEMENT half of
// the container's transfer (see the OWNERSHIP note above): NOTHING → an object /
// boxed handle contributes its BORROWED pointer; EVERYTHING → the callee adopts
// the element, so it gets a ref (objects) or an independent copy (boxed) instead.
// Throws + returns false on an unsupported element.
static bool ElementToGIArgument(Napi::Env env, GITypeInfo* elem, Napi::Value v, GIArgument* a,
                                GITransfer elemTransfer) {
  memset(a, 0, sizeof(*a));
  switch (gi_type_info_get_tag(elem)) {
    // Scalar coercions via the terminate-safe helpers (common.h): a swallowed
    // napi failure mid worker.terminate() must degrade to a zero, not cascade
    // into Error::New(nullptr)'s fatal sites.
    case GI_TYPE_TAG_BOOLEAN: a->v_boolean = NodeGiToBool(v); return true;
    case GI_TYPE_TAG_INT8: a->v_int8 = static_cast<gint8>(NodeGiToInt32(v)); return true;
    case GI_TYPE_TAG_UINT8: a->v_uint8 = static_cast<guint8>(NodeGiToUint32(v)); return true;
    case GI_TYPE_TAG_INT16: a->v_int16 = static_cast<gint16>(NodeGiToInt32(v)); return true;
    case GI_TYPE_TAG_UINT16: a->v_uint16 = static_cast<guint16>(NodeGiToUint32(v)); return true;
    case GI_TYPE_TAG_INT32: a->v_int32 = NodeGiToInt32(v); return true;
    case GI_TYPE_TAG_UINT32: a->v_uint32 = NodeGiToUint32(v); return true;
    case GI_TYPE_TAG_INT64: a->v_int64 = JsValueToInt64(v); return true;
    case GI_TYPE_TAG_UINT64: a->v_uint64 = JsValueToUint64(v); return true;
    case GI_TYPE_TAG_FLOAT: a->v_float = static_cast<gfloat>(NodeGiToDouble(v)); return true;
    case GI_TYPE_TAG_DOUBLE: a->v_double = NodeGiToDouble(v); return true;
    case GI_TYPE_TAG_UTF8:
    case GI_TYPE_TAG_FILENAME:
      a->v_string = (v.IsEmpty() || v.IsNull() || v.IsUndefined())
                        ? nullptr
                        : g_strdup(NodeGiToUtf8(v).c_str());
      return true;
    case GI_TYPE_TAG_INTERFACE: {
      // A BY-VALUE enum/flags element is a plain JS number, and it is the one interface
      // element that legitimately reaches this function without a handle. It writes the
      // member's integer into the union's low bytes; JsToCArray then copies exactly
      // CInElementSize bytes, which for an enum is its own storage size (1/2/4/8) and
      // therefore never more than the union holds. Flags take the unsigned field for
      // the same reason g_value_set_flags does — a mask with the top bit set must not
      // become negative on its way through.
      if (!gi_type_info_is_pointer(elem)) {
        GIBaseInfo* enumIface = gi_type_info_get_interface(elem);
        if (enumIface != nullptr &&
            (GI_IS_ENUM_INFO(enumIface) || GI_IS_FLAGS_INFO(enumIface))) {
          bool isFlags = GI_IS_FLAGS_INFO(enumIface);
          gi_base_info_unref(enumIface);
          if (isFlags) {
            a->v_uint32 = NodeGiToUint32(v);
          } else {
            a->v_int32 = NodeGiToInt32(v);
          }
          return true;
        }
        if (enumIface != nullptr) gi_base_info_unref(enumIface);
      }
      if (v.IsNull() || v.IsUndefined()) {
        a->v_pointer = nullptr;
        return true;
      }
      if (v.IsExternal() && v.As<Napi::External<GObject>>().CheckTypeTag(&kGObjectHandleTag)) {
        GObject* obj = v.As<Napi::External<GObject>>().Data();
        // The callee adopts one ref PER ELEMENT on EVERYTHING (Gdk.ContentProvider
        // .new_union's `providers`, Gtk.ClosureExpression.new's `params`, the
        // Gst/GstPbutils `*_list_free` helpers): hand it one it may drop, never the
        // wrapper's own — that would under-ref and free the object out from under JS.
        if (obj != nullptr && elemTransfer == GI_TRANSFER_EVERYTHING) g_object_ref(obj);
        a->v_pointer = obj;
        return true;
      }
      // A boxed/struct handle contributes its pointer, exactly as an object handle
      // does. Only reachable for a POINTER struct element — IsSupportedElementType
      // refuses the by-value kind before the invoke, so no by-value record can arrive
      // here and be silently treated as a pointer. TransferBoxedIn is the SAME
      // adopt-or-borrow helper the scalar boxed IN arg uses (g_variant_ref /
      // g_boxed_copy on EVERYTHING, relinquish for a struct with no copy function),
      // so a container element and a plain argument cannot drift apart.
      if (BoxedHandle* boxed = TryGetBoxedHandle(v); boxed != nullptr) {
        a->v_pointer = TransferBoxedIn(boxed, elemTransfer);
        return true;
      }
      // Everything else refuses LOUDLY here rather than silently contributing a
      // nullptr. Two element kinds reach this on purpose: a GObject FUNDAMENTAL
      // (GskRenderNode — object info, so the predicate admits it, but its handle
      // carries kFundamentalHandleTag) and a FOREIGN struct (cairo, kCairoHandleTag),
      // neither of which owns its pointer the way the two branches above assume. No
      // installed typelib has a foreign-struct container element today; if one is
      // added, route it through ForeignStructOps::to rather than widening this test.
      Napi::TypeError::New(env, "expected a GObject or boxed handle as a container element")
          .ThrowAsJavaScriptException();
      return false;
    }
    default:
      Napi::TypeError::New(env, "unsupported container element type")
          .ThrowAsJavaScriptException();
      return false;
  }
}

// The introspected size of a record handle's own type, or 0 when it has none.
static size_t BoxedInfoSize(GIBaseInfo* info) {
  if (info == nullptr) return 0;
  if (GI_IS_STRUCT_INFO(info)) return gi_struct_info_get_size(reinterpret_cast<GIStructInfo*>(info));
  if (GI_IS_UNION_INFO(info)) return gi_union_info_get_size(reinterpret_cast<GIUnionInfo*>(info));
  return 0;
}

// Write ONE by-value record element straight into its C-array cell.
//
// WHY THIS IS NOT A GIArgument, which is the whole reason the function exists. The
// array write loop copies `elemSize` bytes out of a GIArgument — a union, eight bytes
// wide. A by-value record is its own size: GValue is 24 on this ABI, Gio.ActionEntry
// 64. Sizing the loop without moving the record off the union would read sixteen bytes
// past it, off the stack, once per element, and would produce a green build with
// plausible-looking output. So a record never enters a GIArgument; its bytes are
// written where they finally live.
//
// TWO SOURCES, and only one of them leaves us owning anything:
//  * GObject.Value — INITIALISED IN PLACE, either from any JS value (gjs 1.88.1
//    accepts `update_property([Gtk.AccessibleProperty.LABEL], ['text'])`, measured)
//    or by copying an existing GObject.Value handle. Both end with a GValue THIS call
//    constructed, so it is unset after the invoke — see ElementsAreOwnedGValues and
//    FreeInContainer. Copying rather than memcpy'ing a handle's GValue is what makes
//    that rule uniform: a bitwise copy would share the string or boxed the original
//    holds, and unsetting it would free the handle's contents underneath JS.
//  * every other record — COPIED from a boxed handle, which is also what gjs requires
//    (measured: a plain object is refused there with "not a subclass of
//    GObject_Struct"). The copy shares whatever the source points at, so nothing here
//    is freed and the handle keeps owning its own storage across the invoke.
//
// THE TYPE CHECK IS A SAFETY PROPERTY rather than ergonomics: copying `elemSize` bytes
// out of a handle of a DIFFERENT record type reads past the end of the source whenever
// the source is smaller. So the source must be the element's own type — compared by
// GType where the element has one, and by introspected size where it does not, an
// unregistered struct having no GType to compare.
static bool ByValueRecordToCell(Napi::Env env, GITypeInfo* elem, Napi::Value v, void* dst,
                                size_t elemSize) {
  GType want = ByValueRecordGType(elem);
  if (want == G_TYPE_VALUE) {
    GValue* cell = static_cast<GValue*>(dst);
    memset(cell, 0, elemSize);
    if (NodeGiIsGValueHandle(v)) {
      BoxedHandle* h = TryGetBoxedHandle(v);
      GValue* src = h == nullptr ? nullptr : static_cast<GValue*>(h->ptr);
      if (src == nullptr || !G_IS_VALUE(src)) {
        Napi::TypeError::New(env,
                             "an uninitialised GObject.Value cannot be an array element")
            .ThrowAsJavaScriptException();
        return false;
      }
      g_value_init(cell, G_VALUE_TYPE(src));
      g_value_copy(src, cell);
      return true;
    }
    return JsToFreshGValue(env, v, cell);
  }

  BoxedHandle* h = TryGetBoxedHandle(v);
  if (h == nullptr || h->ptr == nullptr) {
    Napi::TypeError::New(
        env, std::string("expected a ") +
                 (want == G_TYPE_INVALID ? "record" : g_type_name(want)) +
                 " handle as a by-value array element")
        .ThrowAsJavaScriptException();
    return false;
  }
  bool sameType = want != G_TYPE_INVALID
                      ? (h->gtype != G_TYPE_INVALID && g_type_is_a(h->gtype, want))
                      : (BoxedInfoSize(h->info) == elemSize && elemSize > 0);
  if (!sameType) {
    Napi::TypeError::New(
        env, std::string("a by-value array element must be a ") +
                 (want == G_TYPE_INVALID ? "record of the same size" : g_type_name(want)) +
                 ", got " +
                 (h->gtype == G_TYPE_INVALID ? "an unregistered record" : g_type_name(h->gtype)))
        .ThrowAsJavaScriptException();
    return false;
  }
  memcpy(dst, h->ptr, elemSize);
  return true;
}

// Build a C array / GStrv / GByteArray / GArray / GPtrArray from a JS value.
// *outCount = element count (for the IN length autofill + later free). Throws +
// returns false on refusal (BEFORE the invoke).
static bool JsToCArray(Napi::Env env, Napi::Value v, GITypeInfo* type, GITransfer transfer,
                       gpointer* outPtr, long* outCount) {
  GITransfer elemTransfer =
      transfer == GI_TRANSFER_EVERYTHING ? GI_TRANSFER_EVERYTHING : GI_TRANSFER_NOTHING;
  GIArrayType at = gi_type_info_get_array_type(type);
  GITypeInfo* elem = gi_type_info_get_param_type(type, 0);
  GITypeTag etag = gi_type_info_get_tag(elem);
  bool zt = gi_type_info_is_zero_terminated(type);
  // CInElementSize, not CElementSize: this is the write side, and it is the side that
  // knows how wide a by-value element's cell is (see the note on that function).
  size_t elemSize = CInElementSize(elem);
  bool byValueRecord = IsByValueRecordElement(elem);
  bool isByte = etag == GI_TYPE_TAG_UINT8 || etag == GI_TYPE_TAG_INT8;
  *outPtr = nullptr;
  *outCount = 0;

  // A by-value record element is a BITWISE copy of a handle's storage, which shares
  // whatever that record points at. That is safe exactly while WE free the buffer:
  // on TRANSFER_EVERYTHING the callee frees the elements too, and it would be freeing
  // strings and boxeds the caller's handles still own — the same use-after-free the
  // pointer-element half of this work shipped once and had to fix, wearing a different
  // shape. There is no general remedy: an arbitrary record has no copy function to
  // deep-copy with.
  //
  // Measured across every installed typelib rather than guessed: of 140 IN parameters
  // with a by-value element, 139 are `transfer=none` and ONE is not — Gsf
  // .property_settings_free's `GObject.Parameter[]`, which exists to free what it is
  // given. So this refusal costs one callable, and that callable is the one where
  // handing over borrowed contents would be exactly wrong.
  if (byValueRecord && transfer != GI_TRANSFER_NOTHING) {
    gi_base_info_unref(elem);
    Napi::TypeError::New(
        env, "a by-value record array with transfer other than none is not yet supported: the "
             "callee would free element contents the caller's handles still own")
        .ThrowAsJavaScriptException();
    return false;
  }

  // null/undefined → a NULL array (count 0), as GJS marshals a null array arg
  // (refs/gjs/gi/arg.cpp gjs_array_to_explicit_array: null in → NULL out).
  // Exposing call: `Gst.init(null)` — a NULLABLE (inout) argv array every GJS
  // GStreamer consumer passes null for (`@gjsify/webaudio`'s ensureGstInit on
  // the jelly-jumper-on-node path).
  if (v.IsNull() || v.IsUndefined()) {
    gi_base_info_unref(elem);
    return true;
  }

  // Raw bytes from a TypedArray / Buffer (Uint8Array round-trips, etc.).
  // `hasRawBytes` (NOT `rawBytes != nullptr`) marks a TypedArray/Buffer SOURCE: an
  // EMPTY Uint8Array/Buffer has a NULL backing-store pointer (V8 hands out nullptr
  // for a zero-length ArrayBuffer), yet it is still a valid 0-length byte source.
  // gjs marshals `new Uint8Array([])` to an empty C container (count 0); it must
  // NOT fall through to the `!v.IsArray()` throw below (a TypedArray isn't a JS
  // Array). Verified vs gjs 1.88: GLib.base64_encode(new Uint8Array([])) === ''.
  const uint8_t* rawBytes = nullptr;
  size_t rawLen = 0;
  bool hasRawBytes = false;
  if (v.IsBuffer()) {
    Napi::Buffer<uint8_t> b = v.As<Napi::Buffer<uint8_t>>();
    rawBytes = b.Data();
    rawLen = b.Length();
    hasRawBytes = true;
  } else if (v.IsTypedArray()) {
    Napi::TypedArray ta = v.As<Napi::TypedArray>();
    rawBytes = static_cast<const uint8_t*>(ta.ArrayBuffer().Data()) + ta.ByteOffset();
    rawLen = ta.ByteLength();
    hasRawBytes = true;
  }

  if (at == GI_ARRAY_TYPE_BYTE_ARRAY) {
    GByteArray* ba = g_byte_array_new();
    if (hasRawBytes) {
      // append is a no-op for len 0; guard so a NULL data ptr (empty typed array)
      // is never handed to g_byte_array_append's memcpy.
      if (rawLen > 0) g_byte_array_append(ba, rawBytes, static_cast<guint>(rawLen));
      *outCount = static_cast<long>(rawLen);
    } else if (v.IsArray()) {
      Napi::Array arr = v.As<Napi::Array>();
      for (uint32_t i = 0; i < arr.Length(); i++) {
        guint8 byte = static_cast<guint8>(NodeGiToUint32(arr.Get(i)));
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

  // C / GArray / GPtrArray share the element-marshalling loop below; only their
  // final container wrapping differs. The byte-specific fast paths (TypedArray /
  // string → bytes) are C-array-only ergonomics (a GArray/GPtrArray of bytes is
  // not something GJS accepts a TypedArray for), so gate them on the C kind.

  // Byte C array from a TypedArray / Buffer. `hasRawBytes` (not `rawBytes !=
  // nullptr`) so an empty typed array (NULL data, len 0) still lands here: it
  // allocates a 0-length buffer (g_malloc0(0) → NULL, i.e. an empty C array,
  // count 0 — the same shape an empty JS array `[]` already produced) instead of
  // falling through to the `!v.IsArray()` throw. memcpy is guarded on rawLen>0.
  if (at == GI_ARRAY_TYPE_C && isByte && hasRawBytes) {
    void* buf = g_malloc0(elemSize * (rawLen + (zt ? 1 : 0)));
    if (rawLen > 0) memcpy(buf, rawBytes, rawLen);
    *outPtr = buf;
    *outCount = static_cast<long>(rawLen);
    gi_base_info_unref(elem);
    return true;
  }

  // A JS string as an int8/uint8 C array → its UTF-8 bytes, exactly as GJS does
  // (refs/gjs/gi/arg.cpp: "Allow strings as int8/uint8/int16/uint16 arrays" →
  // gjs_string_to_intarray → gjs_string_to_utf8_n for the int8/uint8 element tags).
  // The length is the UTF-8 BYTE count (not the JS string length, not NUL-inclusive);
  // a zero-terminated array still gets its trailing NUL slot from g_malloc0.
  // Verified against gjs 1.88: GIMarshallingTests.utf8_as_uint8array_in('const ♥ utf8')
  // is accepted (no throw). A real Uint8Array/Array still works via the paths around this.
  if (at == GI_ARRAY_TYPE_C && isByte && v.IsString()) {
    std::string s = v.As<Napi::String>().Utf8Value();
    size_t n = s.size();
    void* buf = g_malloc0(elemSize * (n + (zt ? 1 : 0)));
    memcpy(buf, s.data(), n);
    *outPtr = buf;
    *outCount = static_cast<long>(n);
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
  // Build the flat element buffer first (the storage a C array uses directly).
  // GArray / GPtrArray then wrap this buffer — mirroring gjs, which marshals the
  // JS array into a C buffer and hands it to g_array_append_vals / the GPtrArray
  // pdata memcpy (refs/gjs/gi/arg.cpp gjs_value_to_basic_array_gi_argument).
  void* buf = g_malloc0(elemSize * (count + (zt ? 1 : 0)));
  bool ok = true;
  long written = 0;
  for (long i = 0; i < count && ok; i++) {
    void* dst = static_cast<char*>(buf) + i * elemSize;
    if (byValueRecord) {
      // The record writes ITSELF into the cell — it never passes through a GIArgument,
      // because the union is eight bytes and the record is its own size.
      ok = ByValueRecordToCell(env, elem, arr.Get(static_cast<uint32_t>(i)), dst, elemSize);
      if (ok) written++;
      continue;
    }
    GIArgument a;
    ok = ElementToGIArgument(env, elem, arr.Get(static_cast<uint32_t>(i)), &a, elemTransfer);
    if (!ok) break;
    // Copy the element's storage bytes (LE: the low elemSize bytes of the union
    // alias the active field — v_string/v_pointer for pointers, the scalar
    // otherwise). elemSize never exceeds the union here: the one element kind that is
    // wider took the branch above.
    memcpy(dst, &a, elemSize);
    written++;
  }
  if (!ok) {
    // The GValues already initialised are ours and are released here — the container is
    // never recorded for cleanup on this path, so nothing else will. (Partial
    // g_strdup'd strings, and on an EVERYTHING container the refs/copies taken for
    // earlier elements, still leak: pre-checked and rare, needing a non-handle value
    // mid-array. A leak, never a double free.)
    if (byValueRecord && ElementsAreOwnedGValues(type)) {
      for (long i = 0; i < written; i++) {
        GValue* cell = reinterpret_cast<GValue*>(static_cast<char*>(buf) + i * elemSize);
        if (G_IS_VALUE(cell)) g_value_unset(cell);
      }
    }
    g_free(buf);
    gi_base_info_unref(elem);
    return false;
  }

  if (at == GI_ARRAY_TYPE_ARRAY) {
    // GArray: a zero-terminated, sized GArray over `elemSize` elements
    // (garray_new_for_basic_type in gjs uses zero_terminated=true). append_vals
    // COPIES the buffer, so free our scratch buffer afterwards. String elements
    // (g_strdup'd pointers) now live in the GArray data; freed per-transfer in
    // FreeInContainer.
    GArray* ga = g_array_sized_new(TRUE, FALSE, static_cast<guint>(elemSize),
                                   static_cast<guint>(count));
    if (count > 0) g_array_append_vals(ga, buf, static_cast<guint>(count));
    g_free(buf);
    *outPtr = ga;
  } else if (at == GI_ARRAY_TYPE_PTR_ARRAY) {
    // GPtrArray: element pointers copied into pdata (gjs memcpy's the same way).
    GPtrArray* pa = g_ptr_array_sized_new(static_cast<guint>(count));
    g_ptr_array_set_size(pa, static_cast<int>(count));
    if (count > 0) memcpy(pa->pdata, buf, sizeof(gpointer) * static_cast<size_t>(count));
    g_free(buf);
    *outPtr = pa;
  } else {
    *outPtr = buf;  // GI_ARRAY_TYPE_C
  }
  *outCount = count;
  gi_base_info_unref(elem);
  return true;
}

// Build a GList / GSList from a JS array.
static bool JsToGListLike(Napi::Env env, Napi::Value v, GITypeInfo* type, bool isSList,
                          GITransfer transfer, gpointer* outPtr) {
  GITransfer elemTransfer =
      transfer == GI_TRANSFER_EVERYTHING ? GI_TRANSFER_EVERYTHING : GI_TRANSFER_NOTHING;
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
    ok = ElementToGIArgument(env, elem, arr.Get(i), &a, elemTransfer);
    if (!ok) break;
    // Measured, not assumed: for an INTERFACE element that is a pointer this helper
    // passes v_pointer through unchanged and gi_type_info_argument_from_hash_pointer
    // reads the same address back, so a pointer-struct element fills a node's data
    // slot exactly as an object element does.
    gpointer p = gi_type_info_hash_pointer_from_argument(elem, &a);
    if (!isSList) glist = g_list_prepend(glist, p);
    else gslist = g_slist_prepend(gslist, p);
  }
  if (!isSList) *outPtr = g_list_reverse(glist);
  else *outPtr = g_slist_reverse(gslist);
  gi_base_info_unref(elem);
  return ok;
}

// Build a GHashTable from a JS object. Keys ∈ {string, pointer-fitting int};
// values ∈ {string, object, int, and the heap-boxed int64/uint64/float/double}.
// Mirrors GJS (refs/gjs/gi/arg.cpp gjs_object_to_g_hash + value_to_ghashtable_key):
//   * string keys → g_strdup + g_str_hash/equal; integer keys → GINT_TO_POINTER
//     via gi_type_info_hash_pointer_from_argument + g_direct_hash/equal.
//   * int/int32/string/object values fit a pointer (hash_pointer_from_argument);
//     int64/uint64/float/double do NOT, so they are heap-allocated (g_new) and a
//     pointer to the heap value is stored (the hash owns + g_free's it).
// Key/value GDestroyNotify funcs are attached so a transfer-none teardown
// (g_hash_table_unref in FreeInContainer) releases everything; a transfer-full
// hash is adopted by the callee, which frees it (and thus runs the notifies).
static bool JsToGHashIn(Napi::Env env, Napi::Value v, GITypeInfo* type, GITransfer transfer,
                        gpointer* outPtr) {
  // A hash's VALUE destroy-notify is set below for the string/heap kinds only, so an
  // EVERYTHING hash of object/boxed values leaks the copies rather than double-freeing
  // the originals. That is the safe side of the trade and the only one reachable: no
  // installed typelib has an EVERYTHING GHashTable IN with a POINTER-STRUCT value.
  GITransfer elemTransfer =
      transfer == GI_TRANSFER_EVERYTHING ? GI_TRANSFER_EVERYTHING : GI_TRANSFER_NOTHING;
  *outPtr = nullptr;
  if (!v.IsObject() || v.IsArray()) {
    Napi::TypeError::New(env, "expected an object for the GHashTable argument")
        .ThrowAsJavaScriptException();
    return false;
  }
  GITypeInfo* kt = gi_type_info_get_param_type(type, 0);
  GITypeInfo* vt = gi_type_info_get_param_type(type, 1);
  GITypeTag ktag = gi_type_info_get_tag(kt);
  GITypeTag vtag = gi_type_info_get_tag(vt);
  bool keyIsString = ktag == GI_TYPE_TAG_UTF8 || ktag == GI_TYPE_TAG_FILENAME;
  bool valueIsString = vtag == GI_TYPE_TAG_UTF8 || vtag == GI_TYPE_TAG_FILENAME;
  bool valueHeap = vtag == GI_TYPE_TAG_INT64 || vtag == GI_TYPE_TAG_UINT64 ||
                   vtag == GI_TYPE_TAG_FLOAT || vtag == GI_TYPE_TAG_DOUBLE;
  GDestroyNotify keyFree = keyIsString ? g_free : nullptr;
  GDestroyNotify valFree = (valueIsString || valueHeap) ? g_free : nullptr;
  GHashTable* ht = g_hash_table_new_full(keyIsString ? g_str_hash : g_direct_hash,
                                         keyIsString ? g_str_equal : g_direct_equal,
                                         keyFree, valFree);
  Napi::Object obj = v.As<Napi::Object>();
  Napi::Array keys = obj.GetPropertyNames();
  if (keys.IsEmpty()) {
    // napi_get_property_names failed with the throw swallowed (terminating env /
    // a throwing proxy trap left the exception pending). keys.Length() on the
    // empty Array would abort via Error::New(nullptr) — fail the marshal.
    g_hash_table_unref(ht);
    gi_base_info_unref(kt);
    gi_base_info_unref(vt);
    return false;
  }
  bool ok = true;
  for (uint32_t i = 0; i < keys.Length() && ok; i++) {
    Napi::Value key = keys.Get(i);
    std::string ks = NodeGiToUtf8(key);  // JS property keys are strings

    // Key pointer: g_strdup for strings, else the integer key parsed from the
    // (string) property name and GINT_TO_POINTER-encoded per its tag.
    gpointer kp = nullptr;
    if (keyIsString) {
      kp = g_strdup(ks.c_str());
    } else {
      GIArgument ka;
      Napi::Value keyNum = Napi::Number::New(env, static_cast<double>(g_ascii_strtoll(ks.c_str(), nullptr, 10)));
      ok = ElementToGIArgument(env, kt, keyNum, &ka, GI_TRANSFER_NOTHING);
      if (!ok) break;
      kp = gi_type_info_hash_pointer_from_argument(kt, &ka);
    }

    // Value pointer: heap-box the wide/float values (they don't fit a pointer),
    // else pointer-encode via hash_pointer_from_argument (strings g_strdup'd by
    // ElementToGIArgument, ints GINT_TO_POINTER, objects the borrowed handle).
    Napi::Value val = obj.Get(key);
    gpointer vp = nullptr;
    GIArgument va;
    ok = ElementToGIArgument(env, vt, val, &va, elemTransfer);
    if (!ok) {
      g_free(kp);
      break;
    }
    if (vtag == GI_TYPE_TAG_INT64) {
      gint64* p = g_new(gint64, 1);
      *p = va.v_int64;
      vp = p;
    } else if (vtag == GI_TYPE_TAG_UINT64) {
      guint64* p = g_new(guint64, 1);
      *p = va.v_uint64;
      vp = p;
    } else if (vtag == GI_TYPE_TAG_FLOAT) {
      gfloat* p = g_new(gfloat, 1);
      *p = va.v_float;
      vp = p;
    } else if (vtag == GI_TYPE_TAG_DOUBLE) {
      gdouble* p = g_new(gdouble, 1);
      *p = va.v_double;
      vp = p;
    } else {
      vp = gi_type_info_hash_pointer_from_argument(vt, &va);
    }
    g_hash_table_insert(ht, kp, vp);
  }
  *outPtr = ht;
  gi_base_info_unref(kt);
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
    bool freeStrings = etag == GI_TYPE_TAG_UTF8 || etag == GI_TYPE_TAG_FILENAME;
    if (at == GI_ARRAY_TYPE_BYTE_ARRAY) {
      g_byte_array_unref(static_cast<GByteArray*>(c.ptr));
    } else if (at == GI_ARRAY_TYPE_ARRAY) {
      // GArray: free the g_strdup'd string elements first (g_array_free's
      // free_segment=TRUE releases the data block but not what its pointers
      // point at), then the GArray + its data segment.
      GArray* ga = static_cast<GArray*>(c.ptr);
      if (freeStrings)
        for (guint i = 0; i < ga->len; i++) g_free(g_array_index(ga, char*, i));
      g_array_free(ga, TRUE);
    } else if (at == GI_ARRAY_TYPE_PTR_ARRAY) {
      // GPtrArray: same — free owned string elements, then the array. Object
      // elements are borrowed handle pointers (never freed here).
      GPtrArray* pa = static_cast<GPtrArray*>(c.ptr);
      if (freeStrings)
        for (guint i = 0; i < pa->len; i++) g_free(g_ptr_array_index(pa, i));
      g_ptr_array_free(pa, TRUE);
    } else {  // C array
      if (freeStrings) {
        char** s = static_cast<char**>(c.ptr);
        if (gi_type_info_is_zero_terminated(c.type)) {
          g_strfreev(s);
        } else {
          for (long i = 0; i < c.count; i++) g_free(s[i]);
          g_free(s);
        }
      } else {
        // A GValue element array is the one C array whose CELLS hold something beyond
        // their own bytes: JsToCArray initialised each one (from a JS value or by
        // copying a handle's GValue), so each one holds a string, a boxed or a ref that
        // g_free on the buffer would strand. Only this transfer reaches here — on
        // EVERYTHING/CONTAINER the callee owns the buffer and unsets them itself.
        if (ElementsAreOwnedGValues(c.type)) {
          size_t elemSize = elem != nullptr ? CInElementSize(elem) : 0;
          for (long i = 0; elemSize > 0 && i < c.count; i++) {
            GValue* cell = reinterpret_cast<GValue*>(static_cast<char*>(c.ptr) + i * elemSize);
            if (G_IS_VALUE(cell)) g_value_unset(cell);
          }
        }
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
    ok = JsToCArray(env, v, type, transfer, outPtr, outCount);
  } else if (tag == GI_TYPE_TAG_GLIST || tag == GI_TYPE_TAG_GSLIST) {
    ok = JsToGListLike(env, v, type, tag == GI_TYPE_TAG_GSLIST, transfer, outPtr);
  } else if (tag == GI_TYPE_TAG_GHASH) {
    ok = JsToGHashIn(env, v, type, transfer, outPtr);
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

// ---- struct / boxed / union FIELD access (phase 2.6) -----------------------
//
// Read/write a named field of a boxed/struct/union handle, mirroring GJS's
// gi/boxed.cpp field_getter_impl / field_setter_impl. Simple-typed fields
// (ints/floats/bool/enum) go through gi_field_info_get/set_field; pointer-backed
// fields (strings, arrays, pointer-to-boxed) are read via the raw offset because
// gi_field_info_get_field refuses non-simple fields on some libgirepository
// versions; a nested BY-VALUE struct/union field returns a borrowing sub-handle.
// Resolution rule (VERIFIED against gjs 1.88, find_unique_js_field_name): a name
// that is BOTH a method and a field resolves to the METHOD (gjs renames the field
// to `_name`); so boxedMemberKind checks methods first.

// Resolve the struct/union GIBaseInfo backing a boxed handle. Prefers the stored
// static info (required for an unregistered struct whose GType is G_TYPE_NONE),
// else looks it up by the registered GType. Returns a NEW ref (unref by caller) or
// nullptr when neither source resolves a struct/union.
static GIBaseInfo* DupBoxedTypeInfo(BoxedHandle* bh) {
  if (bh->info != nullptr && (GI_IS_STRUCT_INFO(bh->info) || GI_IS_UNION_INFO(bh->info))) {
    return gi_base_info_ref(bh->info);
  }
  if (bh->gtype != G_TYPE_INVALID && bh->gtype != G_TYPE_NONE) {
    GIRepository* repo = DupDefaultRepository();
    GIBaseInfo* bi = gi_repository_find_by_gtype(repo, bh->gtype);
    g_object_unref(repo);
    if (bi != nullptr && (GI_IS_STRUCT_INFO(bi) || GI_IS_UNION_INFO(bi))) return bi;
    if (bi != nullptr) gi_base_info_unref(bi);
  }
  return nullptr;
}

// Find a field by name on a struct or union info. GIUnionInfo has no find_field,
// so iterate. Returns a NEW ref (unref by caller) or nullptr.
static GIFieldInfo* FindBoxedField(GIBaseInfo* info, const char* name) {
  if (GI_IS_STRUCT_INFO(info)) {
    return gi_struct_info_find_field(reinterpret_cast<GIStructInfo*>(info), name);
  }
  if (GI_IS_UNION_INFO(info)) {
    GIUnionInfo* u = reinterpret_cast<GIUnionInfo*>(info);
    unsigned n = gi_union_info_get_n_fields(u);
    for (unsigned i = 0; i < n; i++) {
      GIFieldInfo* f = gi_union_info_get_field(u, i);
      if (f != nullptr &&
          g_strcmp0(gi_base_info_get_name(reinterpret_cast<GIBaseInfo*>(f)), name) == 0) {
        return f;
      }
      if (f != nullptr) gi_base_info_unref(f);
    }
  }
  return nullptr;
}

// Whether `name` is a method on the struct/union (methods win over fields).
static bool BoxedHasMethod(GIBaseInfo* info, const char* name) {
  GIFunctionInfo* m = nullptr;
  if (GI_IS_STRUCT_INFO(info)) {
    m = gi_struct_info_find_method(reinterpret_cast<GIStructInfo*>(info), name);
  } else if (GI_IS_UNION_INFO(info)) {
    m = gi_union_info_find_method(reinterpret_cast<GIUnionInfo*>(info), name);
  }
  if (m != nullptr) {
    gi_base_info_unref(m);
    return true;
  }
  return false;
}

// Read the field's raw GIArgument. Uses gi_field_info_get_field for simple types;
// falls back to a raw pointer read at the field offset for pointer-typed fields
// (strings/arrays/pointer-to-interface) that the info API declines. Returns false
// only for a genuinely unsupported field (a non-pointer composite the caller must
// have already special-cased). BORROWS: the container owns the pointed-to memory.
static bool ReadFieldArg(GIFieldInfo* field, gpointer base, GITypeInfo* ftype,
                         GIArgument* arg) {
  memset(arg, 0, sizeof(*arg));
  if (gi_field_info_get_field(field, base, arg)) return true;
  GITypeTag tag = gi_type_info_get_tag(ftype);
  bool pointerish = gi_type_info_is_pointer(ftype) || tag == GI_TYPE_TAG_UTF8 ||
                    tag == GI_TYPE_TAG_FILENAME || tag == GI_TYPE_TAG_ARRAY;
  if (pointerish) {
    size_t off = gi_field_info_get_offset(field);
    arg->v_pointer = *reinterpret_cast<gpointer*>(static_cast<char*>(base) + off);
    return true;
  }
  return false;
}

// Field #`index` of a struct/union, or nullptr. The by-NAME lookup is
// `FindBoxedField`; this is the by-POSITION one an `array length=` annotation needs.
static GIFieldInfo* BoxedFieldAt(GIBaseInfo* owner, unsigned index) {
  if (GI_IS_STRUCT_INFO(owner)) {
    GIStructInfo* s = reinterpret_cast<GIStructInfo*>(owner);
    return index < gi_struct_info_get_n_fields(s) ? gi_struct_info_get_field(s, index) : nullptr;
  }
  if (GI_IS_UNION_INFO(owner)) {
    GIUnionInfo* u = reinterpret_cast<GIUnionInfo*>(owner);
    return index < gi_union_info_get_n_fields(u) ? gi_union_info_get_field(u, index) : nullptr;
  }
  return nullptr;
}

// Can `ReadCElement` actually read this array's elements?
//
// Resolving a length is only ever an improvement where the reader can then walk that
// many elements. Two shapes it cannot: an element tag it answers with `Undefined()`
// (its `default:`), and an INLINE (by-value) interface element — for those it
// dereferences `src` as a pointer while `CElementSize` reports `sizeof(gpointer)`
// rather than the record's real size, so a resolved length walks garbage. Measured:
// `new Pango.GlyphString(); gs.set_size(3); gs.glyphs[0].glyph` SIGSEGVs with a
// length and returns an empty array without one.
//
// `calls.cc` draws exactly this line at its own CALLER_ALLOCATES site, with the same
// reason recorded there — a by-value element array needs `gi_struct_info_get_size`
// per element plus a field-access read-back. That is ONE deferred piece of work, and
// this predicate keeps the field path on the same side of it rather than opening a
// second, crashing entrance to it.
static bool ElementsAreReadable(GITypeInfo* type) {
  GITypeInfo* elem = gi_type_info_get_param_type(type, 0);
  if (elem == nullptr) return false;
  bool readable;
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
      readable = true;
      break;
    // A pointer array of interfaces is a `gpointer` per slot, which is what
    // `ReadCElement` reads. By value it is the record itself, which is not.
    case GI_TYPE_TAG_INTERFACE:
      readable = gi_type_info_is_pointer(elem);
      break;
    default:
      readable = false;
      break;
  }
  gi_base_info_unref(elem);
  return readable;
}

// The element count for an array FIELD whose GIR carries `array length=<n>`,
// meaning "sibling field <n> of this same struct holds it".
//
// This is the one GIArrayToJs call site that used to pass a hard `-1`, and the cost
// was silence: `GstMapInfo.data` is `<array length="3" c:type="guint8*">` with field 3
// being `size`, so a mapped 32-byte buffer marshalled as `size=32, data.length=0` — no
// error, no warning, an empty array indistinguishable from a genuinely empty one. That
// made audio inaudible on node for an entire investigation because every layer above
// reported success. gjs reads 32 for the identical struct.
//
// The ledger entry that recorded this said the dependency was one "GI cannot express
// for a struct-field READ". It can, and does: the annotation is in the GIR and survives
// into the typelib, which is why the CALL-argument path (`calls.cc`) has resolved it for
// as long as it has existed. Only the field reader ignored it.
//
// Returns false when there is no annotation, when the index is out of range, or when
// the sibling is not integer-typed — all of which leave the caller on its previous
// zero-terminated/fixed-size derivation rather than inventing a length.
static bool FieldArrayLength(GITypeInfo* ftype, GIBaseInfo* owner, gpointer base, long* out) {
  unsigned int index = 0;
  if (!gi_type_info_get_array_length_index(ftype, &index)) return false;
  if (!ElementsAreReadable(ftype)) return false;
  GIFieldInfo* lengthField = BoxedFieldAt(owner, index);
  if (lengthField == nullptr) return false;

  bool resolved = false;
  GITypeInfo* ltype = gi_field_info_get_type_info(lengthField);
  if (ltype != nullptr) {
    GIArgument larg;
    if (ReadFieldArg(lengthField, base, ltype, &larg)) {
      switch (gi_type_info_get_tag(ltype)) {
        case GI_TYPE_TAG_INT8: *out = larg.v_int8; resolved = true; break;
        case GI_TYPE_TAG_UINT8: *out = larg.v_uint8; resolved = true; break;
        case GI_TYPE_TAG_INT16: *out = larg.v_int16; resolved = true; break;
        case GI_TYPE_TAG_UINT16: *out = larg.v_uint16; resolved = true; break;
        case GI_TYPE_TAG_INT32: *out = larg.v_int32; resolved = true; break;
        case GI_TYPE_TAG_UINT32: *out = static_cast<long>(larg.v_uint32); resolved = true; break;
        case GI_TYPE_TAG_INT64: *out = static_cast<long>(larg.v_int64); resolved = true; break;
        case GI_TYPE_TAG_UINT64: *out = static_cast<long>(larg.v_uint64); resolved = true; break;
        default: break;  // non-integer sibling: not a length, leave it alone
      }
    }
    gi_base_info_unref(ltype);
  }
  gi_base_info_unref(lengthField);
  // A signed length field holding a negative value is a broken typelib, not a count.
  // Declining sends it down the zero-terminated/fixed-size derivation the caller would
  // have used anyway — which is also what a negative reaching `GIArrayToJs` does, so this
  // changes no observable behaviour today. It is here to keep the CONTRACT of this
  // function honest: it returns a resolved element count or nothing.
  if (resolved && *out < 0) resolved = false;
  return resolved;
}

// Marshal a field GIArgument to JS. ARRAY tags dispatch to GIArrayToJs with the
// length resolved from an `array length=` sibling field where the GIR declares one,
// and otherwise derived from zero-terminated / fixed-size (the common GStrv field
// case). Everything else goes through GIArgumentToJs. TRANSFER NOTHING throughout —
// a field read is a borrow (the container keeps ownership), so the JS value is a copy
// and no container/element memory is freed.
static Napi::Value FieldArgToJs(Napi::Env env, GITypeInfo* ftype, GIArgument* arg,
                                GIBaseInfo* owner, gpointer base) {
  if (gi_type_info_get_tag(ftype) == GI_TYPE_TAG_ARRAY) {
    long length = -1;
    if (!FieldArrayLength(ftype, owner, base, &length)) length = -1;
    return GIArrayToJs(env, ftype, arg, GI_TRANSFER_NOTHING, length);
  }
  return GIArgumentToJs(env, ftype, arg, GI_TRANSFER_NOTHING);
}

// Validate arg 0 as a boxed handle and return its record (throwing on mismatch).
static BoxedHandle* UnwrapBoxedArg(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!info[0].IsExternal() ||
      !info[0].As<Napi::External<BoxedHandle>>().CheckTypeTag(&kBoxedHandleTag)) {
    Napi::TypeError::New(env, "expected a node-gi boxed handle").ThrowAsJavaScriptException();
    return nullptr;
  }
  BoxedHandle* bh = info[0].As<Napi::External<BoxedHandle>>().Data();
  if (bh == nullptr || bh->ptr == nullptr) {
    Napi::TypeError::New(env, "invalid boxed handle").ThrowAsJavaScriptException();
    return nullptr;
  }
  return bh;
}

// boxedMemberKind(handle, name) → 0 (neither) | 1 (method) | 2 (field) | 3 (type
// info unavailable — membership undecidable). Methods take priority (gjs
// find_unique_js_field_name renames a colliding field to `_name`), so L1 wrapBoxed
// checks this to route method-dispatch vs field access. The 3 case only arises for
// a boxed handle whose GType is unregistered AND carries no static info (neither
// gtype nor stored info resolves a struct/union): L1 keeps its method-dispatch
// fallback there. When info IS resolvable, 0 is AUTHORITATIVE ("not a member"), so
// L1 returns `undefined` for it — matching gjs, where `typeof boxed.noSuchName` is
// `'undefined'` (a fabricated dispatcher would make it `'function'`, breaking JS
// duck-typing like `typeof x.toArray === 'function'`).
Napi::Value BoxedMemberKind(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsString()) {
    Napi::TypeError::New(env, "boxedMemberKind(handle, name: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  BoxedHandle* bh = UnwrapBoxedArg(info);
  if (bh == nullptr) return env.Null();
  std::string name = info[1].As<Napi::String>().Utf8Value();
  GIBaseInfo* ti = DupBoxedTypeInfo(bh);
  int kind = 3;  // no resolvable type info → membership undecidable (L1 keeps its fallback)
  if (ti != nullptr) {
    kind = 0;  // info resolvable → 0 is authoritative ("not a member")
    if (BoxedHasMethod(ti, name.c_str())) {
      kind = 1;
    } else {
      GIFieldInfo* f = FindBoxedField(ti, name.c_str());
      if (f != nullptr) {
        kind = 2;
        gi_base_info_unref(f);
      }
    }
    gi_base_info_unref(ti);
  }
  return Napi::Number::New(env, kind);
}

// getBoxedField(handle, name) → the field value (throws if not a field, or the
// field is unreadable / unsupported — matching gjs's error-message shape).
Napi::Value GetBoxedField(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsString()) {
    Napi::TypeError::New(env, "getBoxedField(handle, name: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  BoxedHandle* bh = UnwrapBoxedArg(info);
  if (bh == nullptr) return env.Null();
  std::string name = info[1].As<Napi::String>().Utf8Value();
  GIBaseInfo* ti = DupBoxedTypeInfo(bh);
  if (ti == nullptr) {
    Napi::Error::New(env, "boxed handle has no introspection info for field access")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string typeName = gi_base_info_get_name(ti) != nullptr ? gi_base_info_get_name(ti) : "?";
  GIFieldInfo* field = FindBoxedField(ti, name.c_str());
  if (field == nullptr) {
    gi_base_info_unref(ti);
    Napi::Error::New(env, std::string("no field '") + name + "' on " + typeName)
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Value result = env.Undefined();
  if (!(gi_field_info_get_flags(field) & GI_FIELD_IS_READABLE)) {
    Napi::Error::New(env, std::string("Reading field ") + typeName + "." + name + " is not supported")
        .ThrowAsJavaScriptException();
  } else {
    GITypeInfo* ftype = gi_field_info_get_type_info(field);
    // A nested BY-VALUE struct/union field: return a borrowing sub-handle into the
    // parent's memory at the field offset (mirrors gjs get_nested_interface_object).
    if (!gi_type_info_is_pointer(ftype) && gi_type_info_get_tag(ftype) == GI_TYPE_TAG_INTERFACE) {
      GIBaseInfo* iface = gi_type_info_get_interface(ftype);
      if (iface != nullptr && (GI_IS_STRUCT_INFO(iface) || GI_IS_UNION_INFO(iface))) {
        size_t off = gi_field_info_get_offset(field);
        GType nt = gi_registered_type_info_get_g_type(reinterpret_cast<GIRegisteredTypeInfo*>(iface));
        GType nested = (nt != G_TYPE_INVALID && nt != G_TYPE_NONE) ? nt : G_TYPE_INVALID;
        result = MakeBoxedHandle(env, static_cast<char*>(bh->ptr) + off, nested,
                                 /*owns=*/false, iface);
        gi_base_info_unref(iface);
        gi_base_info_unref(ftype);
        gi_base_info_unref(field);
        gi_base_info_unref(ti);
        return result;
      }
      if (iface != nullptr) gi_base_info_unref(iface);
    }
    GIArgument arg;
    if (ReadFieldArg(field, bh->ptr, ftype, &arg)) {
      result = FieldArgToJs(env, ftype, &arg, ti, bh->ptr);
    } else {
      Napi::Error::New(env, std::string("Reading field ") + typeName + "." + name + " is not supported")
          .ThrowAsJavaScriptException();
    }
    gi_base_info_unref(ftype);
  }
  gi_base_info_unref(field);
  gi_base_info_unref(ti);
  return result;
}

// setBoxedField(handle, name, value) — writes a simple-typed field (throws if not
// a field, the field is unwritable, or the type is unsupported — gjs message shape).
Napi::Value SetBoxedField(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[1].IsString()) {
    Napi::TypeError::New(env, "setBoxedField(handle, name: string, value)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  BoxedHandle* bh = UnwrapBoxedArg(info);
  if (bh == nullptr) return env.Null();
  std::string name = info[1].As<Napi::String>().Utf8Value();
  Napi::Value value = info[2];
  GIBaseInfo* ti = DupBoxedTypeInfo(bh);
  if (ti == nullptr) {
    Napi::Error::New(env, "boxed handle has no introspection info for field access")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string typeName = gi_base_info_get_name(ti) != nullptr ? gi_base_info_get_name(ti) : "?";
  GIFieldInfo* field = FindBoxedField(ti, name.c_str());
  if (field == nullptr) {
    gi_base_info_unref(ti);
    Napi::Error::New(env, std::string("no field '") + name + "' on " + typeName)
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  if (!(gi_field_info_get_flags(field) & GI_FIELD_IS_WRITABLE)) {
    gi_base_info_unref(field);
    gi_base_info_unref(ti);
    Napi::Error::New(env, std::string("Writing field ") + typeName + "." + name + " is not supported")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  GITypeInfo* ftype = gi_field_info_get_type_info(field);
  GIArgument arg;
  memset(&arg, 0, sizeof(arg));
  std::string heldString;
  if (JsToGIArgument(env, value, ftype, &arg, &heldString, GI_TRANSFER_NOTHING, nullptr)) {
    if (!gi_field_info_set_field(field, bh->ptr, &arg)) {
      Napi::Error::New(env, std::string("Writing field ") + typeName + "." + name + " is not supported")
          .ThrowAsJavaScriptException();
    }
  }
  gi_base_info_unref(ftype);
  gi_base_info_unref(field);
  gi_base_info_unref(ti);
  return env.Undefined();
}

}  // namespace nodegi
