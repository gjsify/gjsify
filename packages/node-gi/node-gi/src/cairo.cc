// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the native cairo binding + the foreign-struct seam.
//
// cairo's types (cairo_t / cairo_surface_t / cairo_pattern_t) are FOREIGN structs
// in GObject-Introspection: GI does not know their layout and delegates their
// marshalling to a module (gi_struct_info_is_foreign → true). GJS ships a
// hand-written native cairo binding plus a foreign-struct registration so that a
// GI function taking/returning a cairo pointer (e.g. a Gtk.DrawingArea draw-func's
// cairo_t) round-trips to/from the JS cairo objects. This is the node-gi port of
// that binding + registration.
//
// Reference: refs/gjs/modules/cairo-*.cpp (Context/Surface/ImageSurface/Pattern/
// SolidPattern) + refs/gjs/gi/foreign.cpp (the foreign seam). Copyright (c) 2010
// litl, LLC / GJS contributors, MIT OR LGPL-2.0-or-later. Retargeted to N-API +
// the node-gi ownership model (adopt-or-ref, no separate release call — matching
// WrapBoxed). Slice: Context (drawing ops), Surface + ImageSurface (headless
// pixels), SolidPattern. Deferred: gradients, path, region, PDF/SVG/PS surfaces.
//
// The JS wrapper classes live in the L1 module (cairo.js); each instance holds
// this binding's pointer as a type-tagged External under `_ptr`. The foreign
// from_func wraps a returned/callback cairo pointer by calling the JS factory the
// L1 module registered via `setup()` (stored per-env). The to_func reads `_ptr`
// off the JS wrapper.

#include "common.h"

#include <cairo.h>
#include <string.h>  // memcpy

namespace nodegi {

// The pointer kind carried by a cairo handle, so the finalizer/dispose picks the
// matching cairo_*_destroy and the marshaller can typecheck a foreign IN arg.
enum class CairoKind : uint8_t { Context, Surface, Pattern };

// A cairo object handle: the ref-counted cairo pointer + its kind. `owns` is true
// for every handle this binding creates (constructors own their fresh ref;
// from_func adopts/references one) — the finalizer drops it via the kind's destroy
// unless `disposed` already did so eagerly ($dispose).
struct CairoHandle {
  void* ptr;
  CairoKind kind;
  bool disposed;
};

// Process-unique tag so a cairo handle is never cross-dereferenced with a boxed /
// GObject / GType External.
static const napi_type_tag kCairoHandleTag = {0xca140b1a5e7f0011ULL,
                                              0x9d3c7a25e6f18042ULL};

// The property under which a JS cairo wrapper stores its native handle External.
static const char kCairoPtrProp[] = "_ptr";

static void DestroyCairo(CairoHandle* h) {
  if (h->ptr == nullptr) return;
  switch (h->kind) {
    case CairoKind::Context: cairo_destroy(static_cast<cairo_t*>(h->ptr)); break;
    case CairoKind::Surface: cairo_surface_destroy(static_cast<cairo_surface_t*>(h->ptr)); break;
    case CairoKind::Pattern: cairo_pattern_destroy(static_cast<cairo_pattern_t*>(h->ptr)); break;
  }
}

// Wrap a cairo pointer as a type-tagged External. These handles always destroy on
// GC (unless already $dispose'd) — this binding never wraps a non-owned pointer.
static Napi::Value MakeCairoHandle(Napi::Env env, void* ptr, CairoKind kind) {
  CairoHandle* h = new CairoHandle{ptr, kind, false};
  Napi::External<CairoHandle> ext =
      Napi::External<CairoHandle>::New(env, h, [](Napi::Env, CairoHandle* d) {
        if (!d->disposed) DestroyCairo(d);
        delete d;
      });
  ext.TypeTag(&kCairoHandleTag);
  return ext;
}

static CairoHandle* HandleFromExternal(Napi::Value v) {
  if (!v.IsExternal()) return nullptr;
  Napi::External<CairoHandle> ext = v.As<Napi::External<CairoHandle>>();
  if (!ext.CheckTypeTag(&kCairoHandleTag)) return nullptr;
  return ext.Data();
}

// ---- status checking (mirrors gjs_cairo_check_status) -----------------------
static bool CheckStatus(Napi::Env env, cairo_status_t status, const char* name) {
  if (status != CAIRO_STATUS_SUCCESS) {
    Napi::Error::New(env, std::string("cairo error on ") + name + ": \"" +
                              cairo_status_to_string(status) + "\" (" +
                              std::to_string(static_cast<int>(status)) + ")")
        .ThrowAsJavaScriptException();
    return false;
  }
  return true;
}

// ---- native-method arg unwrapping (the handle External is info[0]) ----------
static cairo_t* CtxArg(Napi::Env env, const Napi::CallbackInfo& info) {
  CairoHandle* h = HandleFromExternal(info[0]);
  if (h == nullptr || h->kind != CairoKind::Context || h->disposed || h->ptr == nullptr) {
    Napi::TypeError::New(env, "expected a live cairo.Context").ThrowAsJavaScriptException();
    return nullptr;
  }
  return static_cast<cairo_t*>(h->ptr);
}
static cairo_surface_t* SfcArg(Napi::Env env, const Napi::CallbackInfo& info) {
  CairoHandle* h = HandleFromExternal(info[0]);
  if (h == nullptr || h->kind != CairoKind::Surface || h->disposed || h->ptr == nullptr) {
    Napi::TypeError::New(env, "expected a live cairo.Surface").ThrowAsJavaScriptException();
    return nullptr;
  }
  return static_cast<cairo_surface_t*>(h->ptr);
}

// Read the cairo pointer from a JS wrapper OBJECT (the `_ptr` External) — used by
// the foreign to_func, which receives the user's Context/Surface/Pattern instance.
static void* PtrFromWrapper(Napi::Value v, CairoKind kind) {
  if (!v.IsObject()) return nullptr;
  Napi::Value p = v.As<Napi::Object>().Get(kCairoPtrProp);
  CairoHandle* h = HandleFromExternal(p);
  if (h == nullptr || h->kind != kind || h->disposed) return nullptr;
  return h->ptr;
}

// Read a live cairo pointer from an External handle directly (a nested cairo arg
// passed from JS as `other._ptr`: contextCreate's surface, setSource's pattern).
static cairo_surface_t* SurfaceFromExt(Napi::Env env, Napi::Value v) {
  CairoHandle* h = HandleFromExternal(v);
  if (h == nullptr || h->kind != CairoKind::Surface || h->disposed || h->ptr == nullptr) {
    Napi::TypeError::New(env, "expected a live cairo.Surface").ThrowAsJavaScriptException();
    return nullptr;
  }
  return static_cast<cairo_surface_t*>(h->ptr);
}
static cairo_pattern_t* PatternFromExt(Napi::Env env, Napi::Value v) {
  CairoHandle* h = HandleFromExternal(v);
  if (h == nullptr || h->kind != CairoKind::Pattern || h->disposed || h->ptr == nullptr) {
    Napi::TypeError::New(env, "expected a live cairo.Pattern").ThrowAsJavaScriptException();
    return nullptr;
  }
  return static_cast<cairo_pattern_t*>(h->ptr);
}

static double Num(const Napi::CallbackInfo& info, size_t i) {
  return info[i].ToNumber().DoubleValue();
}
static int Int(const Napi::CallbackInfo& info, size_t i) {
  return info[i].ToNumber().Int32Value();
}

// ---- context drawing-method macros ------------------------------------------
// Every op runs the cairo call then a trailing cairo_status(cr) check → throw on
// error (the GJS FUNC-macro contract). Setters return undefined.
#define CTX_0(CFN)                                    \
  +[](const Napi::CallbackInfo& info) -> Napi::Value { \
    Napi::Env env = info.Env();                        \
    cairo_t* cr = CtxArg(env, info);                   \
    if (cr == nullptr) return env.Undefined();         \
    CFN(cr);                                           \
    CheckStatus(env, cairo_status(cr), "context");     \
    return env.Undefined();                            \
  }
#define CTX_1D(CFN)                                   \
  +[](const Napi::CallbackInfo& info) -> Napi::Value { \
    Napi::Env env = info.Env();                        \
    cairo_t* cr = CtxArg(env, info);                   \
    if (cr == nullptr) return env.Undefined();         \
    CFN(cr, Num(info, 1));                             \
    CheckStatus(env, cairo_status(cr), "context");     \
    return env.Undefined();                            \
  }
#define CTX_2D(CFN)                                   \
  +[](const Napi::CallbackInfo& info) -> Napi::Value { \
    Napi::Env env = info.Env();                        \
    cairo_t* cr = CtxArg(env, info);                   \
    if (cr == nullptr) return env.Undefined();         \
    CFN(cr, Num(info, 1), Num(info, 2));               \
    CheckStatus(env, cairo_status(cr), "context");     \
    return env.Undefined();                            \
  }
#define CTX_3D(CFN)                                   \
  +[](const Napi::CallbackInfo& info) -> Napi::Value { \
    Napi::Env env = info.Env();                        \
    cairo_t* cr = CtxArg(env, info);                   \
    if (cr == nullptr) return env.Undefined();         \
    CFN(cr, Num(info, 1), Num(info, 2), Num(info, 3)); \
    CheckStatus(env, cairo_status(cr), "context");     \
    return env.Undefined();                            \
  }
#define CTX_4D(CFN)                                                  \
  +[](const Napi::CallbackInfo& info) -> Napi::Value {               \
    Napi::Env env = info.Env();                                      \
    cairo_t* cr = CtxArg(env, info);                                 \
    if (cr == nullptr) return env.Undefined();                       \
    CFN(cr, Num(info, 1), Num(info, 2), Num(info, 3), Num(info, 4)); \
    CheckStatus(env, cairo_status(cr), "context");                   \
    return env.Undefined();                                          \
  }
#define CTX_5D(CFN)                                                                 \
  +[](const Napi::CallbackInfo& info) -> Napi::Value {                              \
    Napi::Env env = info.Env();                                                     \
    cairo_t* cr = CtxArg(env, info);                                                \
    if (cr == nullptr) return env.Undefined();                                      \
    CFN(cr, Num(info, 1), Num(info, 2), Num(info, 3), Num(info, 4), Num(info, 5));  \
    CheckStatus(env, cairo_status(cr), "context");                                  \
    return env.Undefined();                                                         \
  }
#define CTX_6D(CFN)                                                                              \
  +[](const Napi::CallbackInfo& info) -> Napi::Value {                                           \
    Napi::Env env = info.Env();                                                                  \
    cairo_t* cr = CtxArg(env, info);                                                             \
    if (cr == nullptr) return env.Undefined();                                                   \
    CFN(cr, Num(info, 1), Num(info, 2), Num(info, 3), Num(info, 4), Num(info, 5), Num(info, 6)); \
    CheckStatus(env, cairo_status(cr), "context");                                               \
    return env.Undefined();                                                                      \
  }
// Integer-enum context setter (operator / line cap / line join / fill rule / antialias).
#define CTX_ENUM(CFN, CTYPE)                                    \
  +[](const Napi::CallbackInfo& info) -> Napi::Value {          \
    Napi::Env env = info.Env();                                 \
    cairo_t* cr = CtxArg(env, info);                            \
    if (cr == nullptr) return env.Undefined();                 \
    CFN(cr, static_cast<CTYPE>(Int(info, 1)));                  \
    CheckStatus(env, cairo_status(cr), "context");             \
    return env.Undefined();                                     \
  }

// ---- the foreign-struct converters (Context / Surface / Pattern) ------------
//
// from_func: adopt-or-ref (node-gi ownership model). transfer-nothing (a draw-func
// cairo_t, a borrowed return) → add a ref so the JS wrapper owns one and the
// caller's ref stays intact; transfer-everything → adopt the handed ref. Then wrap
// the External via the L1 factory the module registered (per-env) so the result is
// a real cairo.Context / .Surface (or .ImageSurface) / .Pattern instance.
static Napi::Value CallWrapper(Napi::Env env, const char* kindKey, Napi::Value handle) {
  NodeGiEnvData* d = EnvData(env);
  if (d == nullptr || d->cairoWrappers == nullptr) {
    Napi::Error::New(env, "cairo module not initialized — import 'cairo' before a GI call "
                          "hands you a cairo object")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  napi_value wrappersV = nullptr;
  napi_get_reference_value(env, d->cairoWrappers, &wrappersV);
  Napi::Object wrappers(env, wrappersV);
  Napi::Function fn = wrappers.Get(kindKey).As<Napi::Function>();
  return fn.Call({handle});
}

static bool ContextTo(Napi::Env env, Napi::Value v, GITransfer transfer, GIArgument* arg) {
  if (v.IsNull() || v.IsUndefined()) { arg->v_pointer = nullptr; return true; }
  void* p = PtrFromWrapper(v, CairoKind::Context);
  if (p == nullptr) {
    Napi::TypeError::New(env, "expected a cairo.Context").ThrowAsJavaScriptException();
    return false;
  }
  if (transfer == GI_TRANSFER_EVERYTHING) cairo_reference(static_cast<cairo_t*>(p));
  arg->v_pointer = p;
  return true;
}
static Napi::Value ContextFrom(Napi::Env env, gpointer ptr, GITransfer transfer) {
  if (ptr == nullptr) return env.Null();
  if (transfer == GI_TRANSFER_NOTHING) cairo_reference(static_cast<cairo_t*>(ptr));
  return CallWrapper(env, "context", MakeCairoHandle(env, ptr, CairoKind::Context));
}

static bool SurfaceTo(Napi::Env env, Napi::Value v, GITransfer transfer, GIArgument* arg) {
  if (v.IsNull() || v.IsUndefined()) { arg->v_pointer = nullptr; return true; }
  void* p = PtrFromWrapper(v, CairoKind::Surface);
  if (p == nullptr) {
    Napi::TypeError::New(env, "expected a cairo.Surface").ThrowAsJavaScriptException();
    return false;
  }
  if (transfer == GI_TRANSFER_EVERYTHING) cairo_surface_reference(static_cast<cairo_surface_t*>(p));
  arg->v_pointer = p;
  return true;
}
static Napi::Value SurfaceFrom(Napi::Env env, gpointer ptr, GITransfer transfer) {
  if (ptr == nullptr) return env.Null();
  if (transfer == GI_TRANSFER_NOTHING) cairo_surface_reference(static_cast<cairo_surface_t*>(ptr));
  return CallWrapper(env, "surface", MakeCairoHandle(env, ptr, CairoKind::Surface));
}

static bool PatternTo(Napi::Env env, Napi::Value v, GITransfer transfer, GIArgument* arg) {
  if (v.IsNull() || v.IsUndefined()) { arg->v_pointer = nullptr; return true; }
  void* p = PtrFromWrapper(v, CairoKind::Pattern);
  if (p == nullptr) {
    Napi::TypeError::New(env, "expected a cairo.Pattern").ThrowAsJavaScriptException();
    return false;
  }
  if (transfer == GI_TRANSFER_EVERYTHING) cairo_pattern_reference(static_cast<cairo_pattern_t*>(p));
  arg->v_pointer = p;
  return true;
}
static Napi::Value PatternFrom(Napi::Env env, gpointer ptr, GITransfer transfer) {
  if (ptr == nullptr) return env.Null();
  if (transfer == GI_TRANSFER_NOTHING) cairo_pattern_reference(static_cast<cairo_pattern_t*>(ptr));
  return CallWrapper(env, "pattern", MakeCairoHandle(env, ptr, CairoKind::Pattern));
}

static const ForeignStructOps kContextOps{ContextTo, ContextFrom};
static const ForeignStructOps kSurfaceOps{SurfaceTo, SurfaceFrom};
static const ForeignStructOps kPatternOps{PatternTo, PatternFrom};

// setup(wrappers): the L1 module hands its JS wrapper factories ({context, surface,
// pattern}) — each takes the `_ptr` External and returns the class instance. Stored
// per-env (a napi_ref is env-specific) so the foreign from_func can build wrappers.
static Napi::Value CairoSetup(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  NodeGiEnvData* d = EnvData(env);
  if (d == nullptr) return env.Undefined();
  if (!info[0].IsObject()) {
    Napi::TypeError::New(env, "cairo setup expects a wrappers object")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (d->cairoWrappers != nullptr) napi_delete_reference(env, d->cairoWrappers);
  napi_create_reference(env, info[0], 1, &d->cairoWrappers);
  return env.Undefined();
}

void InitCairo(Napi::Env env, Napi::Object exports) {
  // The foreign converters are static + JS-independent, so register them once at
  // module init (before any GI call marshals a cairo type). The JS wrapper
  // factories the from_func needs are supplied later by cairo.js's setup().
  RegisterForeignStruct("cairo", "Context", &kContextOps);
  RegisterForeignStruct("cairo", "Surface", &kSurfaceOps);
  RegisterForeignStruct("cairo", "Pattern", &kPatternOps);

  Napi::Object c = Napi::Object::New(env);
  c.Set("setup", Napi::Function::New(env, CairoSetup));

  // ---- constructors ----
  c.Set("imageSurfaceCreate", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_surface_t* s = cairo_image_surface_create(
              static_cast<cairo_format_t>(Int(info, 0)), Int(info, 1), Int(info, 2));
          if (!CheckStatus(env, cairo_surface_status(s), "surface")) {
            cairo_surface_destroy(s);
            return env.Undefined();
          }
          return MakeCairoHandle(env, s, CairoKind::Surface);
        }));
  c.Set("imageSurfaceCreateFromPNG", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          std::string path = info[0].ToString().Utf8Value();
          cairo_surface_t* s = cairo_image_surface_create_from_png(path.c_str());
          if (!CheckStatus(env, cairo_surface_status(s), "surface")) {
            cairo_surface_destroy(s);
            return env.Undefined();
          }
          return MakeCairoHandle(env, s, CairoKind::Surface);
        }));
  c.Set("contextCreate", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_surface_t* sp = SurfaceFromExt(env, info[0]);
          if (sp == nullptr) return env.Undefined();
          cairo_t* cr = cairo_create(sp);
          if (!CheckStatus(env, cairo_status(cr), "context")) {
            cairo_destroy(cr);
            return env.Undefined();
          }
          return MakeCairoHandle(env, cr, CairoKind::Context);
        }));
  c.Set("solidPatternCreateRGB", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_pattern_t* p = cairo_pattern_create_rgb(Num(info, 0), Num(info, 1), Num(info, 2));
          if (!CheckStatus(env, cairo_pattern_status(p), "pattern")) {
            cairo_pattern_destroy(p);
            return env.Undefined();
          }
          return MakeCairoHandle(env, p, CairoKind::Pattern);
        }));
  c.Set("solidPatternCreateRGBA", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_pattern_t* p =
              cairo_pattern_create_rgba(Num(info, 0), Num(info, 1), Num(info, 2), Num(info, 3));
          if (!CheckStatus(env, cairo_pattern_status(p), "pattern")) {
            cairo_pattern_destroy(p);
            return env.Undefined();
          }
          return MakeCairoHandle(env, p, CairoKind::Pattern);
        }));
  // patternGetType/patternStatus back the L1 pattern from_func subclass fan-out
  // (SolidPattern vs base Pattern), mirroring CairoPattern::from_c_ptr.
  c.Set("patternGetType", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_pattern_t* p = PatternFromExt(env, info[0]);
          if (p == nullptr) return env.Undefined();
          return Napi::Number::New(env, cairo_pattern_get_type(p));
        }));
  c.Set("patternStatus", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_pattern_t* p = PatternFromExt(env, info[0]);
          if (p == nullptr) return env.Undefined();
          return Napi::Number::New(env, cairo_pattern_status(p));
        }));

  // ---- surface methods ----
  c.Set("surfaceFlush", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_surface_t* s = SfcArg(env, info);
          if (s == nullptr) return env.Undefined();
          cairo_surface_flush(s);
          CheckStatus(env, cairo_surface_status(s), "surface");
          return env.Undefined();
        }));
  c.Set("surfaceFinish", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_surface_t* s = SfcArg(env, info);
          if (s == nullptr) return env.Undefined();
          cairo_surface_finish(s);
          CheckStatus(env, cairo_surface_status(s), "surface");
          return env.Undefined();
        }));
  c.Set("surfaceGetType", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_surface_t* s = SfcArg(env, info);
          if (s == nullptr) return env.Undefined();
          return Napi::Number::New(env, cairo_surface_get_type(s));
        }));
  c.Set("surfaceStatus", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_surface_t* s = SfcArg(env, info);
          if (s == nullptr) return env.Undefined();
          return Napi::Number::New(env, cairo_surface_status(s));
        }));
  c.Set("surfaceWriteToPNG", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_surface_t* s = SfcArg(env, info);
          if (s == nullptr) return env.Undefined();
          std::string path = info[1].ToString().Utf8Value();
          cairo_status_t st = cairo_surface_write_to_png(s, path.c_str());
          CheckStatus(env, st, "surface");
          return env.Undefined();
        }));
  c.Set("imageSurfaceGetWidth", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_surface_t* s = SfcArg(env, info);
          if (s == nullptr) return env.Undefined();
          return Napi::Number::New(env, cairo_image_surface_get_width(s));
        }));
  c.Set("imageSurfaceGetHeight", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_surface_t* s = SfcArg(env, info);
          if (s == nullptr) return env.Undefined();
          return Napi::Number::New(env, cairo_image_surface_get_height(s));
        }));
  c.Set("imageSurfaceGetStride", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_surface_t* s = SfcArg(env, info);
          if (s == nullptr) return env.Undefined();
          return Napi::Number::New(env, cairo_image_surface_get_stride(s));
        }));
  c.Set("imageSurfaceGetFormat", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_surface_t* s = SfcArg(env, info);
          if (s == nullptr) return env.Undefined();
          return Napi::Number::New(env, cairo_image_surface_get_format(s));
        }));
  // getData: net-new (GJS ships no getData). flush, then COPY the ARGB32 buffer
  // (stride*height) into a fresh Uint8Array — a copy is GC-safe (surface + array
  // then have independent lifetimes).
  c.Set("imageSurfaceGetData", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_surface_t* s = SfcArg(env, info);
          if (s == nullptr) return env.Undefined();
          cairo_surface_flush(s);
          unsigned char* data = cairo_image_surface_get_data(s);
          int stride = cairo_image_surface_get_stride(s);
          int height = cairo_image_surface_get_height(s);
          size_t len = static_cast<size_t>(stride) * static_cast<size_t>(height);
          Napi::Uint8Array out = Napi::Uint8Array::New(env, len);
          if (data != nullptr && len > 0) memcpy(out.Data(), data, len);
          return out;
        }));

  // ---- context methods ----
  c.Set("save", Napi::Function::New(env, CTX_0(cairo_save)));
  c.Set("restore", Napi::Function::New(env, CTX_0(cairo_restore)));
  c.Set("newPath", Napi::Function::New(env, CTX_0(cairo_new_path)));
  c.Set("closePath", Napi::Function::New(env, CTX_0(cairo_close_path)));
  c.Set("fill", Napi::Function::New(env, CTX_0(cairo_fill)));
  c.Set("fillPreserve", Napi::Function::New(env, CTX_0(cairo_fill_preserve)));
  c.Set("stroke", Napi::Function::New(env, CTX_0(cairo_stroke)));
  c.Set("strokePreserve", Napi::Function::New(env, CTX_0(cairo_stroke_preserve)));
  c.Set("paint", Napi::Function::New(env, CTX_0(cairo_paint)));
  c.Set("clip", Napi::Function::New(env, CTX_0(cairo_clip)));
  c.Set("clipPreserve", Napi::Function::New(env, CTX_0(cairo_clip_preserve)));

  c.Set("setLineWidth", Napi::Function::New(env, CTX_1D(cairo_set_line_width)));
  c.Set("paintWithAlpha", Napi::Function::New(env, CTX_1D(cairo_paint_with_alpha)));
  c.Set("rotate", Napi::Function::New(env, CTX_1D(cairo_rotate)));
  c.Set("setMiterLimit", Napi::Function::New(env, CTX_1D(cairo_set_miter_limit)));
  c.Set("setTolerance", Napi::Function::New(env, CTX_1D(cairo_set_tolerance)));

  c.Set("moveTo", Napi::Function::New(env, CTX_2D(cairo_move_to)));
  c.Set("lineTo", Napi::Function::New(env, CTX_2D(cairo_line_to)));
  c.Set("relMoveTo", Napi::Function::New(env, CTX_2D(cairo_rel_move_to)));
  c.Set("relLineTo", Napi::Function::New(env, CTX_2D(cairo_rel_line_to)));
  c.Set("translate", Napi::Function::New(env, CTX_2D(cairo_translate)));
  c.Set("scale", Napi::Function::New(env, CTX_2D(cairo_scale)));

  c.Set("setSourceRGB", Napi::Function::New(env, CTX_3D(cairo_set_source_rgb)));
  c.Set("setSourceRGBA", Napi::Function::New(env, CTX_4D(cairo_set_source_rgba)));
  c.Set("rectangle", Napi::Function::New(env, CTX_4D(cairo_rectangle)));
  c.Set("arc", Napi::Function::New(env, CTX_5D(cairo_arc)));
  c.Set("arcNegative", Napi::Function::New(env, CTX_5D(cairo_arc_negative)));
  c.Set("curveTo", Napi::Function::New(env, CTX_6D(cairo_curve_to)));

  c.Set("setOperator", Napi::Function::New(env, CTX_ENUM(cairo_set_operator, cairo_operator_t)));
  c.Set("setLineCap", Napi::Function::New(env, CTX_ENUM(cairo_set_line_cap, cairo_line_cap_t)));
  c.Set("setLineJoin", Napi::Function::New(env, CTX_ENUM(cairo_set_line_join, cairo_line_join_t)));
  c.Set("setFillRule", Napi::Function::New(env, CTX_ENUM(cairo_set_fill_rule, cairo_fill_rule_t)));
  c.Set("setAntialias", Napi::Function::New(env, CTX_ENUM(cairo_set_antialias, cairo_antialias_t)));

  c.Set("getLineWidth", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_t* cr = CtxArg(env, info);
          if (cr == nullptr) return env.Undefined();
          return Napi::Number::New(env, cairo_get_line_width(cr));
        }));
  // Deterministic state getters (font/zlib/display-independent) — mirror GJS's
  // Context getters + drive the cross-runtime conformance program.
  c.Set("getOperator", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_t* cr = CtxArg(env, info);
          if (cr == nullptr) return env.Undefined();
          return Napi::Number::New(env, cairo_get_operator(cr));
        }));
  c.Set("getLineCap", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_t* cr = CtxArg(env, info);
          if (cr == nullptr) return env.Undefined();
          return Napi::Number::New(env, cairo_get_line_cap(cr));
        }));
  c.Set("getLineJoin", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_t* cr = CtxArg(env, info);
          if (cr == nullptr) return env.Undefined();
          return Napi::Number::New(env, cairo_get_line_join(cr));
        }));
  c.Set("getFillRule", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_t* cr = CtxArg(env, info);
          if (cr == nullptr) return env.Undefined();
          return Napi::Number::New(env, cairo_get_fill_rule(cr));
        }));
  c.Set("getAntialias", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_t* cr = CtxArg(env, info);
          if (cr == nullptr) return env.Undefined();
          return Napi::Number::New(env, cairo_get_antialias(cr));
        }));
  c.Set("getMiterLimit", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_t* cr = CtxArg(env, info);
          if (cr == nullptr) return env.Undefined();
          return Napi::Number::New(env, cairo_get_miter_limit(cr));
        }));
  c.Set("getTolerance", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_t* cr = CtxArg(env, info);
          if (cr == nullptr) return env.Undefined();
          return Napi::Number::New(env, cairo_get_tolerance(cr));
        }));
  c.Set("hasCurrentPoint", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_t* cr = CtxArg(env, info);
          if (cr == nullptr) return env.Undefined();
          return Napi::Boolean::New(env, cairo_has_current_point(cr));
        }));
  c.Set("getCurrentPoint", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_t* cr = CtxArg(env, info);
          if (cr == nullptr) return env.Undefined();
          double x = 0, y = 0;
          cairo_get_current_point(cr, &x, &y);
          Napi::Array a = Napi::Array::New(env, 2);
          a.Set(0u, Napi::Number::New(env, x));
          a.Set(1u, Napi::Number::New(env, y));
          return a;
        }));
  // The 4-double extents getters (path/fill/stroke/clip) return [x1, y1, x2, y2].
#define CTX_EXTENTS(NAME, CFN)                                              \
  c.Set(NAME, Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value { \
          Napi::Env env = info.Env();                                       \
          cairo_t* cr = CtxArg(env, info);                                  \
          if (cr == nullptr) return env.Undefined();                        \
          double x1 = 0, y1 = 0, x2 = 0, y2 = 0;                            \
          CFN(cr, &x1, &y1, &x2, &y2);                                      \
          Napi::Array a = Napi::Array::New(env, 4);                         \
          a.Set(0u, Napi::Number::New(env, x1));                            \
          a.Set(1u, Napi::Number::New(env, y1));                            \
          a.Set(2u, Napi::Number::New(env, x2));                            \
          a.Set(3u, Napi::Number::New(env, y2));                            \
          return a;                                                         \
        }));
  CTX_EXTENTS("pathExtents", cairo_path_extents)
  CTX_EXTENTS("fillExtents", cairo_fill_extents)
  CTX_EXTENTS("strokeExtents", cairo_stroke_extents)
  CTX_EXTENTS("clipExtents", cairo_clip_extents)
  c.Set("status", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_t* cr = CtxArg(env, info);
          if (cr == nullptr) return env.Undefined();
          return Napi::Number::New(env, cairo_status(cr));
        }));
  c.Set("setSource", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_t* cr = CtxArg(env, info);
          if (cr == nullptr) return env.Undefined();
          cairo_pattern_t* p = PatternFromExt(env, info[1]);
          if (p == nullptr) return env.Undefined();
          cairo_set_source(cr, p);
          CheckStatus(env, cairo_status(cr), "context");
          return env.Undefined();
        }));
  c.Set("setSourceSurface", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          cairo_t* cr = CtxArg(env, info);
          if (cr == nullptr) return env.Undefined();
          cairo_surface_t* p = SurfaceFromExt(env, info[1]);
          if (p == nullptr) return env.Undefined();
          cairo_set_source_surface(cr, p, Num(info, 2), Num(info, 3));
          CheckStatus(env, cairo_status(cr), "context");
          return env.Undefined();
        }));

  // ---- $dispose (Context / Surface / Pattern) ----
  // Eagerly destroy the underlying cairo object + mark the handle so the finalizer
  // won't double-free and any further method call throws (a live-handle check).
  c.Set("dispose", Napi::Function::New(env, +[](const Napi::CallbackInfo& info) -> Napi::Value {
          Napi::Env env = info.Env();
          CairoHandle* h = HandleFromExternal(info[0]);
          if (h == nullptr) return env.Undefined();
          if (!h->disposed) {
            DestroyCairo(h);
            h->disposed = true;
            h->ptr = nullptr;
          }
          return env.Undefined();
        }));

  exports.Set("__cairo", c);
}

}  // namespace nodegi
