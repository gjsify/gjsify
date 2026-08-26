// SPDX-License-Identifier: MIT
// registerClass: subtype registration, custom properties/signals, vfunc overrides + chain-up.

#include "common.h"

namespace nodegi {

// ---- subclassing (registerClass — minimal: subtype + construct) ----
//
// Register a new GObject subclass of `parentNamespace.parentTypeName` named
// `name`, inheriting the parent's class/instance layout. Supports custom
// properties + signals (installed in class_init — see below) and vfunc overrides.
// A dynamic subtype's instances are ordinary GObjects owned through the canonical
// toggle-ref bridge (so a JS-subclassed instance kept by C stays rooted, keeping
// its overridden-vfunc wrapper + JS state alive). Returns an opaque type handle
// (the GType) for constructType().

// GTypes are process-stable and never freed (static registration), so the
// handle carries no finalizer. registerClass returns a kGTypeHandleTag External,
// so validate the tag (a GObject/boxed handle is also an External, but holds a
// non-GType pointer — reinterpreting it as a GType would be type-confusion).
static GType UnwrapGType(Napi::Env env, Napi::Value v) {
  GType gt = ReadGTypeHandle(v);
  if (gt == 0) {
    Napi::TypeError::New(env, "expected a node-gi type handle from registerClass()")
        .ThrowAsJavaScriptException();
    return 0;
  }
  return gt;
}

// ---- registerClass custom properties + signals (class_init) ----
//
// A registered subclass can declare custom GObject properties and signals.
// In class_init we install the GParamSpecs + override get/set_property (routing
// custom props to a per-instance value store) and g_signal_newv each signal.
// Inherited (introspected-parent) properties still flow through the parent's
// vfuncs — a property is "ours" iff its owner GType carries node-gi class-data.
// Backing the values with a per-instance store (not C struct fields) keeps a
// plain dynamic subtype's instances ordinary GObjects, owned through the
// canonical toggle-ref bridge above.

// Map a JS type-name to a GType (shared by property + signal specs).
static GType TypeNameToGType(const std::string& t) {
  if (t == "string" || t == "utf8") return G_TYPE_STRING;
  if (t == "boolean" || t == "bool") return G_TYPE_BOOLEAN;
  if (t == "int") return G_TYPE_INT;
  if (t == "uint") return G_TYPE_UINT;
  if (t == "int64") return G_TYPE_INT64;
  if (t == "uint64") return G_TYPE_UINT64;
  if (t == "double") return G_TYPE_DOUBLE;
  if (t == "float") return G_TYPE_FLOAT;
  if (t == "object") return G_TYPE_OBJECT;
  if (t == "void" || t == "none") return G_TYPE_NONE;
  // The GByteArray boxed type (a byte-array signal param / property). Named
  // explicitly (not just via g_type_from_name) so referencing G_TYPE_BYTE_ARRAY
  // also REGISTERS it — g_type_from_name returns 0 for a type never yet touched.
  if (t == "GByteArray" || t == "bytearray") return G_TYPE_BYTE_ARRAY;
  // General fallback: any already-registered GType by its canonical name (e.g.
  // "GBytes", "GdkRGBA", an enum/boxed/object type). Keeps the fast-path names
  // above (they're the common shorthands) while letting a fully-qualified GType
  // name resolve — matching gjs, which accepts a GType for a signal param type.
  GType named = g_type_from_name(t.c_str());
  if (named != G_TYPE_INVALID) return named;
  return G_TYPE_INVALID;
}

// Build a floating GParamSpec from a JS spec `{ name, type, flags?, default?,
// minimum?, maximum? }`. Returns nullptr + sets *err on an unsupported type.
static GParamSpec* BuildParamSpec(Napi::Env env, Napi::Object spec, std::string* err) {
  if (!spec.Has("name") || !spec.Get("name").IsString()) {
    *err = "property requires a string 'name'";
    return nullptr;
  }
  std::string name = spec.Get("name").As<Napi::String>().Utf8Value();
  std::string type = (spec.Has("type") && spec.Get("type").IsString())
                         ? spec.Get("type").As<Napi::String>().Utf8Value()
                         : std::string("string");
  GParamFlags flags = (spec.Has("flags") && spec.Get("flags").IsNumber())
                          ? static_cast<GParamFlags>(spec.Get("flags").As<Napi::Number>().Int32Value())
                          : G_PARAM_READWRITE;
  Napi::Value def = spec.Get("default");
  bool hasMin = spec.Has("minimum") && spec.Get("minimum").IsNumber();
  bool hasMax = spec.Has("maximum") && spec.Get("maximum").IsNumber();
  double mn = hasMin ? spec.Get("minimum").As<Napi::Number>().DoubleValue() : 0;
  double mx = hasMax ? spec.Get("maximum").As<Napi::Number>().DoubleValue() : 0;
  const char* nm = name.c_str();

  if (type == "string" || type == "utf8") {
    std::string d = def.IsString() ? def.As<Napi::String>().Utf8Value() : std::string();
    return g_param_spec_string(nm, nm, nm, def.IsString() ? d.c_str() : nullptr, flags);
  }
  if (type == "boolean" || type == "bool") {
    gboolean d = def.IsBoolean() ? def.As<Napi::Boolean>().Value()
                                 : (def.IsNumber() ? NodeGiToBool(def) : FALSE);
    return g_param_spec_boolean(nm, nm, nm, d, flags);
  }
  if (type == "int") {
    return g_param_spec_int(nm, nm, nm, hasMin ? static_cast<gint>(mn) : G_MININT,
                            hasMax ? static_cast<gint>(mx) : G_MAXINT,
                            def.IsNumber() ? def.As<Napi::Number>().Int32Value() : 0, flags);
  }
  if (type == "uint") {
    return g_param_spec_uint(nm, nm, nm, hasMin ? static_cast<guint>(mn) : 0,
                             hasMax ? static_cast<guint>(mx) : G_MAXUINT,
                             def.IsNumber() ? def.As<Napi::Number>().Uint32Value() : 0, flags);
  }
  if (type == "int64") {
    return g_param_spec_int64(nm, nm, nm, hasMin ? static_cast<gint64>(mn) : G_MININT64,
                              hasMax ? static_cast<gint64>(mx) : G_MAXINT64,
                              def.IsNumber() ? def.As<Napi::Number>().Int64Value() : 0, flags);
  }
  if (type == "uint64") {
    return g_param_spec_uint64(nm, nm, nm, hasMin ? static_cast<guint64>(mn) : 0,
                               hasMax ? static_cast<guint64>(mx) : G_MAXUINT64,
                               def.IsNumber() ? static_cast<guint64>(def.As<Napi::Number>().Int64Value())
                                              : 0,
                               flags);
  }
  if (type == "double") {
    return g_param_spec_double(nm, nm, nm, hasMin ? mn : -G_MAXDOUBLE, hasMax ? mx : G_MAXDOUBLE,
                               def.IsNumber() ? def.As<Napi::Number>().DoubleValue() : 0, flags);
  }
  if (type == "float") {
    return g_param_spec_float(nm, nm, nm, hasMin ? static_cast<gfloat>(mn) : -G_MAXFLOAT,
                              hasMax ? static_cast<gfloat>(mx) : G_MAXFLOAT,
                              def.IsNumber() ? static_cast<gfloat>(def.As<Napi::Number>().DoubleValue())
                                             : 0,
                              flags);
  }
  if (type == "object" || type == "boxed") {
    // An object- or boxed-typed property (GObject.ParamSpec.object / .boxed). The
    // value GType comes from the spec's `gtype` field — a node-gi GType handle
    // (the L1 resolves a class ctor's `$gtype` to it). g_param_spec_object/boxed
    // own no default beyond NULL, so `default`/`minimum`/`maximum` are ignored.
    GType valueGType = spec.Has("gtype") ? ReadGTypeHandle(spec.Get("gtype")) : 0;
    if (valueGType == 0) {
      *err = "a '" + type + "' property requires a gtype (a class or GType handle)";
      return nullptr;
    }
    if (type == "object") {
      if (!g_type_is_a(valueGType, G_TYPE_OBJECT)) {
        *err = std::string("an 'object' property gtype must be a GObject type, got ") +
               g_type_name(valueGType);
        return nullptr;
      }
      return g_param_spec_object(nm, nm, nm, valueGType, flags);
    }
    if (!G_TYPE_IS_BOXED(valueGType)) {
      *err = std::string("a 'boxed' property gtype must be a boxed type, got ") +
             g_type_name(valueGType);
      return nullptr;
    }
    return g_param_spec_boxed(nm, nm, nm, valueGType, flags);
  }
  *err = "unsupported property type '" + type + "'";
  return nullptr;
}

// ---- registerClass vfunc overrides (class-level refs; no toggle-ref) ----
//
// A registered subclass can override a parent GObject vfunc with a JS function.
// Each override is held by a per-CLASS record carrying a STRONG napi_ref to the
// JS impl plus the ffi closure written into the class vtable. Both live for the
// class lifetime and are NEVER freed — a GType is process-permanent, so this is
// the same ownership model as the signal class-handler (the override fn is
// class-level, not per-instance). The INSTANCE the trampoline passes as `this`
// goes through WrapGObject, so it resolves to the canonical toggle-ref wrapper —
// the same handle construct returns (and that vfunc `this` keeps that wrapper +
// its JS state alive while C owns a JS-subclassed instance).
//
// In class_init the vfunc info is resolved by walking the parent object-info
// chain (gi_object_info_find_vfunc), the vtable slot is located via the matching
// class-struct FIELD offset (gi_vfunc_info_get_offset is GI_UNKNOWN/0xFFFF for
// GObject's own vfuncs, so the GJS field-offset approach is authoritative), and
// the closure's native address is written into the class struct at that offset.
//
// CHAIN-UP: immediately BEFORE the trampoline address is written, the value
// currently in the vtable slot is captured in `parentPtr` — at class_init time
// the new type's class struct is a memcpy of the parent's, so the slot holds the
// parent's implementation (the C default, or a JS override further up the chain).
// That captured pointer is the `super.vfunc_<name>(...)` target: callParentVfunc
// ffi_call's it through `cif` (which already describes the exact instance+args→ret
// signature). Mirrors GJS's gi/object.cpp, where the introspected base's vfunc
// thunk calls the actual C parent vtable entry.
struct NodeGiVFunc {
  napi_env env;
  std::string name;
  napi_ref fn;           // strong ref to the JS impl (class lifetime; never freed)
  GIVFuncInfo* info;     // resolved vfunc info (owned; kept alive for the closure)
  ffi_cif cif;           // stable storage for the closure's cif (also used to call up)
  ffi_closure* closure;  // ffi closure (class lifetime; never freed)
  gpointer parentPtr;    // parent vtable fn captured pre-override (chain-up target)
};

// The ffi closure entry point invoked when C calls the overridden vfunc. For a
// method vfunc the ffi args are [instance, declared-arg-0, declared-arg-1, ...];
// the instance is passed as the JS receiver (`this`, GJS-faithful: vfunc impls
// are methods on the instance) and the declared args become the JS arguments.
// The return is marshalled into `result` exactly like NodeGiCallbackTrampoline.
static void NodeGiVFuncTrampoline(ffi_cif* /*cif*/, void* result, void** args,
                                  gpointer user_data) {
  NodeGiVFunc* vf = static_cast<NodeGiVFunc*>(user_data);
  napi_env env = vf->env;
  // ENV-TEARDOWN GATE: a dispose cascade can invoke this vfunc while the env may
  // no longer enter JS — e.g. a queued idle teardown dispatched by RunCleanup's
  // CleanupHandles() (after can_call_into_js=false), or a terminating worker's
  // finalizer unref. Re-entering N-API then aborts the process via node-addon-api's
  // noexcept throw path. Degrade to a no-op with a zeroed return slot — GJS-faithful
  // (GJS never runs JS during GC/context teardown).
  if (!NodeGiJsAvailable(env)) {
    if (result != nullptr) static_cast<GIArgument*>(result)->v_uint64 = 0;
    if (NodeGiToggleDebugEnabled())
      NodeGiToggleDebugLog("vfunc '%s' skipped: JS unavailable on env %p (teardown/terminate)",
                           vf->name.c_str(), static_cast<void*>(env));
    return;
  }
  Napi::Env napiEnv(env);
  Napi::HandleScope scope(napiEnv);
  // JS dispatched from a pump-driven context iteration must not inherit the
  // pump's in-iteration flag (see NodeGiPumpJsDispatchScope in common.h).
  NodeGiPumpJsDispatchScope pumpWindow;

  GICallableInfo* ci = reinterpret_cast<GICallableInfo*>(vf->info);
  // args[0] is the instance; declared args follow at args[1..].
  Napi::Value recv = WrapGObject(
      napiEnv, static_cast<GObject*>(static_cast<GIArgument*>(args[0])->v_pointer),
      GI_TRANSFER_NOTHING);

  unsigned int n = gi_callable_info_get_n_args(ci);
  std::vector<napi_value> jsArgs;
  jsArgs.reserve(n);
  bool ok = true;
  for (unsigned int i = 0; i < n; i++) {
    GIArgInfo* ai = gi_callable_info_get_arg(ci, i);
    GITypeInfo* ti = gi_arg_info_get_type_info(ai);
    Napi::Value v =
        GIArgumentToJs(napiEnv, ti, static_cast<GIArgument*>(args[i + 1]), GI_TRANSFER_NOTHING);
    gi_base_info_unref(ti);
    gi_base_info_unref(ai);
    if (napiEnv.IsExceptionPending()) {
      ok = false;
      break;
    }
    jsArgs.push_back(v);
  }

  // Zero the result slot first (it is >= ffi_arg wide; narrow returns leave the
  // upper bytes indeterminate otherwise).
  if (result != nullptr) static_cast<GIArgument*>(result)->v_uint64 = 0;

  GITypeInfo* retType = gi_callable_info_get_return_type(ci);
  if (ok) {
    napi_value fn = nullptr;
    if (napi_get_reference_value(env, vf->fn, &fn) == napi_ok && fn != nullptr) {
      napi_value ret = nullptr;
      // napi_make_callback drains nextTick/microtasks around the call (Node; on
      // Bun/Deno the checkpoint is run by NodeGiMaybeDrainMicrotasks below); the
      // wrapped instance is the receiver (`this`).
      g_loopDispatchDepth++;
      napi_status st =
          napi_make_callback(env, nullptr, recv, fn, jsArgs.size(), jsArgs.data(), &ret);
      g_loopDispatchDepth--;
      if (st == napi_ok && result != nullptr) {
        GITypeTag rtag = gi_type_info_get_tag(retType);
        if (rtag == GI_TYPE_TAG_UTF8 || rtag == GI_TYPE_TAG_FILENAME) {
          // Hand the caller an owned copy — a JsToGIArgument string would point
          // into a std::string that dies with this frame.
          Napi::Value rv(env, ret);
          static_cast<GIArgument*>(result)->v_string =
              rv.IsString() ? g_strdup(rv.As<Napi::String>().Utf8Value().c_str()) : nullptr;
        } else if (rtag != GI_TYPE_TAG_VOID) {
          std::string held;
          JsToGIArgument(napiEnv, Napi::Value(env, ret), retType, static_cast<GIArgument*>(result),
                         &held);
        }
      }
    }
  }
  gi_base_info_unref(retType);
  // A pending JS exception surfaces at the next N-API boundary (e.g. when the
  // constructType / method call that triggered this vfunc returns).
  //
  // Cross-runtime microtask checkpoint (Bun/Deno — no-op on Node, see loop.cc):
  // an outermost vfunc boundary drains queued promise continuations, matching
  // Node's napi_make_callback checkpoint (which fires here for BOTH a
  // loop-dispatched vfunc — a GTK measure/snapshot during a blocking run — and
  // one under a synchronous JS caller). Skipped while an exception is pending
  // (NodeGiMaybeDrainMicrotasks gates on NodeGiJsAvailable), so the
  // leave-pending contract above is unaffected.
  if (g_loopDispatchDepth == 0) NodeGiMaybeDrainMicrotasks(env);
}

static GQuark NodeGiClassDataQuark() {
  static GQuark q = g_quark_from_static_string("node-gi-class-data");
  return q;
}
static GQuark NodeGiInstancePropsQuark() {
  static GQuark q = g_quark_from_static_string("node-gi-instance-props");
  return q;
}

static void FreeStoredGValue(gpointer p) {
  GValue* v = static_cast<GValue*>(p);
  g_value_unset(v);
  g_free(v);
}

// Nearest ancestor (incl. self) carrying node-gi class-data.
NodeGiClassData* FindClassData(GType type) {
  for (GType t = type; t != 0; t = g_type_parent(t)) {
    NodeGiClassData* cd = static_cast<NodeGiClassData*>(g_type_get_qdata(t, NodeGiClassDataQuark()));
    if (cd != nullptr) return cd;
  }
  return nullptr;
}

// Find the DEEPEST vfunc override record named `name` walking up from the instance
// type — the registered level CLOSEST to the introspected base (the last matching
// record before the ancestry runs out of node-gi class-data). This is the correct
// chain-up target for `super.vfunc_<name>()` on a multi-level registered chain:
// `super` between two REGISTERED levels resolves via the JS PROTOTYPE chain (the
// ancestor's `vfunc_<name>` is a real JS method, called directly), so every
// registered level's JS impl has already run by the time the chain bottoms out at
// the introspected base's prototype and hits the chain-up thunk → callParentVfunc.
// At that single point we must invoke the C-side default below the deepest
// registered level — exactly the deepest record's captured `parentPtr` (its parent
// is introspected, so the captured slot is the C vtable entry, never another JS
// trampoline). Returning the NEAREST record instead would point parentPtr back at
// an intermediate level's trampoline and re-run that level (a double-run, or an
// infinite loop when it chains up again). Single-level chains have exactly one
// record, so deepest == nearest and behaviour is unchanged.
static NodeGiVFunc* FindDeepestVFuncRecord(GType type, const std::string& name) {
  NodeGiVFunc* deepest = nullptr;
  for (GType t = type; t != 0; t = g_type_parent(t)) {
    NodeGiClassData* cd = static_cast<NodeGiClassData*>(g_type_get_qdata(t, NodeGiClassDataQuark()));
    if (cd != nullptr) {
      for (NodeGiVFunc* vf : cd->vfuncs) {
        if (vf->name == name) deepest = vf;  // keep the last (deepest) match
      }
    }
  }
  return deepest;
}

// A property is custom iff its owner GType carries node-gi class-data; otherwise
// it is inherited from the introspected parent and chains to the parent vfunc.
static void NodeGiGetProperty(GObject* obj, guint prop_id, GValue* value, GParamSpec* pspec) {
  NodeGiClassData* ownerCd =
      static_cast<NodeGiClassData*>(g_type_get_qdata(pspec->owner_type, NodeGiClassDataQuark()));
  if (ownerCd != nullptr) {
    GHashTable* store = static_cast<GHashTable*>(g_object_get_qdata(obj, NodeGiInstancePropsQuark()));
    GValue* stored = store ? static_cast<GValue*>(g_hash_table_lookup(store, pspec->name)) : nullptr;
    if (stored != nullptr && G_IS_VALUE(stored)) {
      g_value_copy(stored, value);
    } else {
      g_param_value_set_default(pspec, value);
    }
    return;
  }
  NodeGiClassData* cd = FindClassData(G_OBJECT_TYPE(obj));
  if (cd != nullptr && cd->parentGet != nullptr) cd->parentGet(obj, prop_id, value, pspec);
}

static void NodeGiSetProperty(GObject* obj, guint prop_id, const GValue* value, GParamSpec* pspec) {
  NodeGiClassData* ownerCd =
      static_cast<NodeGiClassData*>(g_type_get_qdata(pspec->owner_type, NodeGiClassDataQuark()));
  if (ownerCd != nullptr) {
    GHashTable* store = static_cast<GHashTable*>(g_object_get_qdata(obj, NodeGiInstancePropsQuark()));
    if (store == nullptr) {
      store = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, FreeStoredGValue);
      g_object_set_qdata_full(obj, NodeGiInstancePropsQuark(), store,
                              reinterpret_cast<GDestroyNotify>(g_hash_table_destroy));
    }
    GValue* copy = g_new0(GValue, 1);
    g_value_init(copy, G_VALUE_TYPE(value));
    g_value_copy(value, copy);
    g_hash_table_replace(store, g_strdup(pspec->name), copy);
    g_object_notify_by_pspec(obj, pspec);
    return;
  }
  NodeGiClassData* cd = FindClassData(G_OBJECT_TYPE(obj));
  if (cd != nullptr && cd->parentSet != nullptr) cd->parentSet(obj, prop_id, value, pspec);
}

// ---- run the JS constructor for C/GtkBuilder-instantiated instances ----
//
// node-gi runs a registered class's JS constructor ONLY on a JS-side `new Sub()`
// (the makeClass new.target path in gi.js routes it to constructType, and ES
// super-substitution runs the ctor body). A GObject built from C — a GtkBuilder
// composite-template InternalChild is the common case — never reaches that path,
// so its ctor body (e.g. `this._x = …`) never runs. GJS solves this by overriding
// the GObjectClass `constructor` vfunc so BOTH paths funnel through it
// (refs/gjs/gi/gobject.cpp gjs_object_constructor). We mirror that: NodeGiConstructor
// chains to the first non-node-gi C constructor to create the instance, then — only
// for the C-driven path — runs the JS ctor on the canonical wrapper via the L1
// construct callback. The JS-`new` path is unchanged (the latch NodeGiJsConstructing
// is raised by ConstructGObject, so we return the instance and let makeClass run it).

// Thread-local so a worker_threads env has its own latch (GtkBuilder construction
// runs on the same thread as the ConstructGObject that raised it).
static thread_local bool g_nodegiJsConstructing = false;
bool NodeGiJsConstructing() { return g_nodegiJsConstructing; }
void NodeGiSetJsConstructing(bool v) { g_nodegiJsConstructing = v; }

static void RunJsConstructorForCObject(napi_env env, GObject* obj) {
  // Teardown/terminate: never enter JS during GC/context teardown (GJS-faithful;
  // same gate as the vfunc trampoline). The C object is still fully constructed.
  if (!NodeGiJsAvailable(env)) return;
  Napi::Env napiEnv(env);
  Napi::HandleScope scope(napiEnv);
  // JS dispatched from a pump-driven iteration must not inherit the in-iteration
  // flag (mirrors the vfunc trampoline).
  NodeGiPumpJsDispatchScope pumpWindow;

  // Build this instance's OWN composite template first (a no-op unless it carries
  // one), so the JS ctor's assignTemplateChildren sees bound children — the JS-`new`
  // path does this in ConstructGObject before makeClass reads them.
  MaybeInitTemplate(napiEnv, obj);

  NodeGiEnvData* d = EnvData(env);
  napi_value cb = nullptr;
  if (d == nullptr || d->constructCallback == nullptr ||
      napi_get_reference_value(env, d->constructCallback, &cb) != napi_ok || cb == nullptr) {
    return;  // L1 hasn't registered the callback (nothing to run)
  }
  napi_value handleVal = WrapGObject(napiEnv, obj, GI_TRANSFER_NOTHING);
  napi_value nameVal = nullptr;
  napi_create_string_utf8(env, g_type_name(G_OBJECT_TYPE(obj)), NAPI_AUTO_LENGTH, &nameVal);
  napi_value args[2] = {handleVal, nameVal};
  napi_value undef = nullptr;
  napi_get_undefined(env, &undef);
  napi_value ret = nullptr;
  // A plain call (not napi_make_callback): the ctor is synchronous and we must not
  // drain the microtask queue mid-g_object_new. Matches GJS's template-callback
  // resolver + gjs_object_constructor's JS::Construct (no checkpoint).
  napi_status st = napi_call_function(env, undef, cb, 2, args, &ret);
  if (st != napi_ok) {
    // The ctor threw. Never leave a pending JS exception across the return into C
    // (GObject/GtkBuilder can't handle it) — clear it and fold the message into a
    // g_warning (GJS logs the uncaught exception here too).
    napi_value ex = nullptr;
    if (napi_get_and_clear_last_exception(env, &ex) == napi_ok && ex != nullptr) {
      napi_value msg = nullptr;
      std::string detail;
      if (napi_get_named_property(env, ex, "message", &msg) == napi_ok) {
        size_t len = 0;
        if (napi_get_value_string_utf8(env, msg, nullptr, 0, &len) == napi_ok) {
          detail.resize(len);
          napi_get_value_string_utf8(env, msg, detail.data(), len + 1, &len);
        }
      }
      g_warning("node-gi: JS constructor for %s threw: %s", g_type_name(G_OBJECT_TYPE(obj)),
                detail.empty() ? "(no message)" : detail.c_str());
    }
  }
}

// The overridden GObjectClass `constructor` vfunc (installed on every registered
// type in NodeGiClassInit). GJS parity: gi/gobject.cpp gjs_object_constructor.
static GObject* NodeGiConstructor(GType type, guint n_construct_properties,
                                  GObjectConstructParam* construct_properties) {
  // Chain to the first non-node-gi (C) constructor UP the hierarchy, skipping our
  // own — that actually allocates + constructs the instance (running the real C
  // construction chain). GJS does the identical skip-walk (gobject.cpp:155).
  GType parent = g_type_parent(type);
  while (parent != 0) {
    gpointer pk = g_type_class_peek(parent);
    if (pk == nullptr || G_OBJECT_CLASS(pk)->constructor != NodeGiConstructor) break;
    parent = g_type_parent(parent);
  }
  gpointer pk = parent != 0 ? g_type_class_peek(parent) : nullptr;
  GObject* obj = (pk != nullptr && G_OBJECT_CLASS(pk)->constructor != nullptr)
                     ? G_OBJECT_CLASS(pk)->constructor(type, n_construct_properties,
                                                       construct_properties)
                     : nullptr;
  if (obj == nullptr) return nullptr;

  // JS-`new` path: the makeClass super-substitution runs the user ctor after
  // g_object_new returns — do NOT run it here (would double-run).
  if (NodeGiJsConstructing()) return obj;

  // C/GtkBuilder-driven: the user ctor has no other driver. Run it on the leaf
  // registered class's env (correct across worker envs).
  NodeGiClassData* cd = FindClassData(G_OBJECT_TYPE(obj));
  if (cd != nullptr && cd->env != nullptr) RunJsConstructorForCObject(cd->env, obj);
  return obj;
}

static void NodeGiClassInit(gpointer g_class, gpointer class_data) {
  NodeGiClassData* cd = static_cast<NodeGiClassData*>(class_data);
  GObjectClass* oc = G_OBJECT_CLASS(g_class);
  g_type_set_qdata(G_TYPE_FROM_CLASS(g_class), NodeGiClassDataQuark(), cd);

  // Route construction through NodeGiConstructor so a C/GtkBuilder-instantiated
  // instance (a composite-template InternalChild) gets its JS constructor run —
  // GJS parity (gi/gobject.cpp). The JS-`new` path is unaffected: NodeGiConstructor
  // returns early while the NodeGiJsConstructing() latch is raised.
  oc->constructor = NodeGiConstructor;

  if (!cd->properties.empty()) {
    cd->parentGet = oc->get_property;  // capture before override (chain target)
    cd->parentSet = oc->set_property;
    oc->get_property = NodeGiGetProperty;
    oc->set_property = NodeGiSetProperty;
    guint id = 1;
    for (GParamSpec* p : cd->properties) {
      g_object_class_install_property(oc, id++, p);
    }
  }
  for (const NodeGiSignalDef& s : cd->signals) {
    g_signal_newv(s.name.c_str(), G_TYPE_FROM_CLASS(g_class), s.flags, nullptr, nullptr, nullptr,
                  nullptr, s.returnType, static_cast<guint>(s.paramTypes.size()),
                  s.paramTypes.empty() ? nullptr : const_cast<GType*>(s.paramTypes.data()));
  }

  if (!cd->vfuncs.empty()) {
    GType newType = G_TYPE_FROM_CLASS(g_class);
    GType parentType = g_type_parent(newType);
    GIRepository* repo = gi_repository_dup_default();
    for (NodeGiVFunc* vf : cd->vfuncs) {
      // Resolve the vfunc info by walking the parent object-info chain; the
      // declarer's class struct holds the vtable slot we write into.
      GIVFuncInfo* vi = nullptr;
      GIObjectInfo* declarer = nullptr;
      for (GType t = parentType; t != 0 && vi == nullptr; t = g_type_parent(t)) {
        GIBaseInfo* bi = gi_repository_find_by_gtype(repo, t);
        if (bi != nullptr) {
          if (GI_IS_OBJECT_INFO(bi)) {
            vi = gi_object_info_find_vfunc(reinterpret_cast<GIObjectInfo*>(bi), vf->name.c_str());
            if (vi != nullptr)
              declarer = reinterpret_cast<GIObjectInfo*>(gi_base_info_ref(bi));
          }
          gi_base_info_unref(bi);
        }
      }
      if (vi == nullptr) {
        g_warning("node-gi: registerClass vfunc '%s' not found on any ancestor of %s",
                  vf->name.c_str(), g_type_name(newType));
        continue;
      }

      // Locate the vtable slot. gi_vfunc_info_get_offset is GI_UNKNOWN (0xFFFF)
      // for GObject's own vfuncs, so match the vfunc name to a class-struct field
      // and use that field's offset (the GJS approach); fall back to the recorded
      // offset only when the field lookup fails.
      int offset = -1;
      GIStructInfo* cs = gi_object_info_get_class_struct(declarer);
      if (cs != nullptr) {
        unsigned int nf = gi_struct_info_get_n_fields(cs);
        for (unsigned int fi = 0; fi < nf && offset < 0; fi++) {
          GIFieldInfo* f = gi_struct_info_get_field(cs, fi);
          const char* fn = gi_base_info_get_name(reinterpret_cast<GIBaseInfo*>(f));
          if (fn != nullptr && vf->name == fn) offset = gi_field_info_get_offset(f);
          gi_base_info_unref(reinterpret_cast<GIBaseInfo*>(f));
        }
        gi_base_info_unref(reinterpret_cast<GIBaseInfo*>(cs));
      }
      if (offset < 0) {
        size_t off = gi_vfunc_info_get_offset(vi);
        if (off != 0 && off != 0xFFFF) offset = static_cast<int>(off);
      }
      if (offset < 0) {
        g_warning("node-gi: could not resolve a vtable slot for vfunc '%s' on %s",
                  vf->name.c_str(), g_type_name(newType));
        gi_base_info_unref(reinterpret_cast<GIBaseInfo*>(vi));
        gi_base_info_unref(reinterpret_cast<GIBaseInfo*>(declarer));
        continue;
      }

      // Create the ffi closure and write its native address into the class vtable.
      // The vfunc info + closure + cif are kept alive for the class lifetime.
      vf->info = vi;  // retained (kept alive); never unref'd — class is permanent
      vf->closure = gi_callable_info_create_closure(reinterpret_cast<GICallableInfo*>(vi), &vf->cif,
                                                    NodeGiVFuncTrampoline, vf);
      gpointer native =
          gi_callable_info_get_closure_native_address(reinterpret_cast<GICallableInfo*>(vi),
                                                      vf->closure);
      if (native == nullptr) native = vf->closure;
      // Capture the parent implementation BEFORE overwriting the slot: at this
      // point g_class is a memcpy of the parent class struct, so the slot holds
      // the parent's vfunc pointer (the C default, or a JS override further up).
      // That is the super.vfunc_<name>() chain-up target (see callParentVfunc).
      gpointer* slotAddr = reinterpret_cast<gpointer*>(reinterpret_cast<guint8*>(g_class) + offset);
      vf->parentPtr = *slotAddr;
      *slotAddr = native;
      gi_base_info_unref(reinterpret_cast<GIBaseInfo*>(declarer));
    }
    g_object_unref(repo);
  }

  // ---- Gtk.Widget composite template ----
  // Install the template + bind the declared children on the new GtkWidgetClass.
  // g_class is the new type's class struct, which derives from GtkWidgetClass for
  // any Gtk.Widget subtype — exactly the pointer gtk_widget_class_set_template*
  // expects. Done in class_init, the idiomatic GTK lifecycle point (C widgets
  // call set_template in their class_init too). get_template_child / init_template
  // run later, per instance.
  if (cd->hasTemplate) {
    const GtkTemplateApi* gtk = GetGtkTemplateApi();
    GType widgetType = g_type_from_name("GtkWidget");
    bool isWidget = widgetType != 0 && g_type_is_a(G_TYPE_FROM_CLASS(g_class), widgetType);
    if (gtk->ok && isWidget) {
      if (!cd->cssName.empty()) gtk->set_css_name(g_class, cd->cssName.c_str());
      if (cd->templateBytes != nullptr) {
        gtk->set_template(g_class, cd->templateBytes);
      } else if (!cd->templateResource.empty()) {
        gtk->set_template_from_resource(g_class, cd->templateResource.c_str());
      }
      for (const std::string& c : cd->children)
        gtk->bind_template_child_full(g_class, c.c_str(), FALSE, 0);
      for (const std::string& c : cd->internalChildren)
        gtk->bind_template_child_full(g_class, c.c_str(), TRUE, 0);
      // Install a generic template-callback scope so any `<signal handler="…">` in
      // the template resolves to the instance's JS method (mirrors GJS's
      // set_template_scope path). Must follow set_template; used during
      // init_template. Independent of the child binding above — Children /
      // InternalChildren behaviour is unchanged.
      NodeGiInstallTemplateScopeOnClass(cd, g_class);
    } else if (widgetType == 0) {
      // GtkWidget is not registered in the type registry THIS addon calls into. The
      // class in hand descends from one (registerClass resolved its parent), so the
      // honest reading is not "your class is wrong" but "there are two GObject copies
      // in this process" — the addon bound one libgobject and GTK registered its types
      // in another. Reported separately because the subclass wording below sent #1120
      // hunting a JS bug for a dyld one: an unrelocated darwin prebuild kept the build
      // host's absolute Homebrew paths and bound Homebrew's libgobject while the
      // batteries-included bundle's libgtk used its own.
      g_warning(
          "node-gi: GtkWidget is not registered in this process's GObject type registry, "
          "so the Template on %s cannot be installed. This means TWO GLib/GObject copies "
          "are loaded — check that the addon and GTK resolve to the same libgobject "
          "(otool -L on the addon; DYLD_PRINT_LIBRARIES=1 to list what loaded)",
          g_type_name(G_TYPE_FROM_CLASS(g_class)));
    } else if (!isWidget) {
      g_warning(
          "node-gi: a Template was set on %s, which is not a Gtk.Widget subclass — "
          "composite templates require a Gtk.Widget ancestor; ignoring the template",
          g_type_name(G_TYPE_FROM_CLASS(g_class)));
    } else {
      g_warning(
          "node-gi: a Gtk.Widget Template was requested but the libgtk-4 template "
          "API could not be resolved (is GTK 4 installed?)");
    }
  }
}

// ---- the shared vfunc CALL-OUT: marshal, ffi_call, assemble the GJS return ----
//
// One body, two callers: `super.vfunc_x(...)` chaining to a captured parent slot
// (CallParentVfunc) and a plain introspected `inst.vfunc_x(...)` dispatching to the
// class's own slot (CallClassVfunc). Both have the same three inputs — the vfunc's
// GICallableInfo, an ffi_cif describing [instance, declared args, GError**] and the
// function pointer — so the ~300 lines of IN/OUT/INOUT marshalling below are shared
// rather than copied. `where` prefixes every diagnostic, so each caller names the
// spelling the program actually used.
static Napi::Value InvokeVFuncPointer(Napi::Env env, GObject* obj, GICallableInfo* ci,
                                      ffi_cif* cif, gpointer fnPtr, const std::string& where,
                                      Napi::Array args) {
  unsigned int nDeclared = gi_callable_info_get_n_args(ci);
  bool canThrow = gi_callable_info_can_throw_gerror(ci);

  // Per-arg direction (used both to marshal IN/INOUT input and to read OUT/INOUT
  // back after the call).
  std::vector<GIDirection> dirs(nDeclared);
  for (unsigned int i = 0; i < nDeclared; i++) {
    GIArgInfo* ai = gi_callable_info_get_arg(ci, i);
    dirs[i] = gi_arg_info_get_direction(ai);
    gi_base_info_unref(ai);
  }

  // Array-length args (of an arg array OR of the return array) are engine-managed:
  // never JS-consumed, never surfaced on their own. An OUT/INOUT length slot is
  // wired so the callee writes the count we then size the array with; an IN length
  // is autofilled from the array's element count. Mirrors InvokeFunctionInfo.
  std::vector<bool> skip(nDeclared, false);
  std::vector<bool> isLenArg(nDeclared, false);
  for (unsigned int i = 0; i < nDeclared; i++) {
    GIArgInfo* ai = gi_callable_info_get_arg(ci, i);
    GITypeInfo* ti = gi_arg_info_get_type_info(ai);
    if (gi_type_info_get_tag(ti) == GI_TYPE_TAG_ARRAY) {
      unsigned int L = 0;
      if (gi_type_info_get_array_length_index(ti, &L) && L < nDeclared) {
        skip[L] = true;
        isLenArg[L] = true;
      }
    }
    gi_base_info_unref(ti);
    gi_base_info_unref(ai);
  }
  {
    GITypeInfo* rt = gi_callable_info_get_return_type(ci);
    if (gi_type_info_get_tag(rt) == GI_TYPE_TAG_ARRAY) {
      unsigned int L = 0;
      if (gi_type_info_get_array_length_index(rt, &L) && L < nDeclared) {
        skip[L] = true;
        isLenArg[L] = true;
      }
    }
    gi_base_info_unref(rt);
  }

  // ffi argument value array: [instance, declared-arg-0 .., (GError** if can-throw)].
  // Each entry points at the value's storage; for the GIArgument union, &arg is the
  // address of every member (they overlap at offset 0), so &giArgs[i] works for any
  // primitive/pointer-typed argument. An OUT/INOUT arg's ffi param is a POINTER, so
  // its giArgs entry holds &slots[i] — the stable per-arg storage (arg-indexed, as
  // ReadOutOrReturn expects) the C parent writes THROUGH.
  std::vector<GIArgument> giArgs(1 + nDeclared);
  std::vector<GIArgument> slots(nDeclared);  // OUT/INOUT storage (zero-initialised)
  std::vector<std::string> holds(nDeclared);
  std::vector<gpointer> callerAllocBlob(nDeclared, nullptr);
  std::vector<GType> callerAllocGType(nDeclared, 0);
  std::vector<InContainer> inContainers;   // IN containers to free after the reads
  std::vector<gpointer> ownedInStrings;     // transfer-full IN/INOUT strings (#658 model)
  std::vector<void*> avalue;
  avalue.reserve(1 + nDeclared + (canThrow ? 1 : 0));
  giArgs[0].v_pointer = obj;
  avalue.push_back(&giArgs[0]);

  // The JS caller passes IN + INOUT args positionally; OUT params are engine-managed
  // (jsCursor bridges the declared-vs-positional gap once an OUT precedes an IN). For
  // an all-IN vfunc jsCursor == i, so the IN-only path is byte-identical to before.
  bool ok = true;
  size_t jsCursor = 0;
  for (unsigned int i = 0; i < nDeclared && ok; i++) {
    if (skip[i]) {
      // An OUT/INOUT array-length arg: wire its slot so the callee writes the count.
      if (isLenArg[i] && (dirs[i] == GI_DIRECTION_OUT || dirs[i] == GI_DIRECTION_INOUT))
        giArgs[1 + i].v_pointer = &slots[i];
      avalue.push_back(&giArgs[1 + i]);
      continue;
    }
    GIArgInfo* ai = gi_callable_info_get_arg(ci, i);
    GIDirection dir = dirs[i];
    GITypeInfo* ti = gi_arg_info_get_type_info(ai);
    GITypeTag tg = gi_type_info_get_tag(ti);

    if (dir == GI_DIRECTION_OUT || dir == GI_DIRECTION_INOUT) {
      std::string why;
      if (gi_arg_info_is_caller_allocates(ai)) {
        // Caller-allocates: the callee fills storage WE provide (a single pointer,
        // not a **) — the ffi param is that blob pointer directly. Supported: a
        // fixed-size C array (fundamental elements) and a boxed struct/union.
        // Mirrors InvokeFunctionInfo / refs/gjs arg-cache CALLER_ALLOCATES.
        size_t size = 0;
        GType boxedGType = 0;
        if (tg == GI_TYPE_TAG_ARRAY && gi_type_info_get_array_type(ti) == GI_ARRAY_TYPE_C) {
          size_t fixed = 0;
          if (gi_type_info_get_array_fixed_size(ti, &fixed) && fixed > 0) {
            GITypeInfo* el = gi_type_info_get_param_type(ti, 0);
            if (el != nullptr && gi_type_info_get_tag(el) != GI_TYPE_TAG_INTERFACE)
              size = CElementSize(el) * fixed;
            if (el != nullptr) gi_base_info_unref(el);
          }
        } else if (tg == GI_TYPE_TAG_INTERFACE) {
          GIBaseInfo* si = gi_type_info_get_interface(ti);
          if (si != nullptr && GI_IS_STRUCT_INFO(si)) {
            size = gi_struct_info_get_size(reinterpret_cast<GIStructInfo*>(si));
          } else if (si != nullptr && GI_IS_UNION_INFO(si)) {
            size = gi_union_info_get_size(reinterpret_cast<GIUnionInfo*>(si));
          }
          if (si != nullptr) {
            GType gt = gi_registered_type_info_get_g_type(
                reinterpret_cast<GIRegisteredTypeInfo*>(si));
            if (gt != G_TYPE_INVALID && G_TYPE_IS_BOXED(gt)) boxedGType = gt;
            gi_base_info_unref(si);
          }
          if (boxedGType == 0) size = 0;  // non-boxed struct OUT needs field access
        }
        if (size == 0) {
          Napi::TypeError::New(
              env, where + ": caller-allocates OUT parameter type is not yet supported")
              .ThrowAsJavaScriptException();
          ok = false;
        } else {
          gpointer blob = g_malloc0(size);
          callerAllocBlob[i] = blob;
          callerAllocGType[i] = boxedGType;
          giArgs[1 + i].v_pointer = blob;
        }
      } else if (!IsSupportedOutType(ti, &why)) {
        Napi::TypeError::New(env, where + ": OUT " + why +
                                      " parameters are not yet supported")
            .ThrowAsJavaScriptException();
        ok = false;
      } else if (dir == GI_DIRECTION_INOUT &&
                 (tg == GI_TYPE_TAG_ARRAY || tg == GI_TYPE_TAG_GLIST ||
                  tg == GI_TYPE_TAG_GSLIST || tg == GI_TYPE_TAG_GHASH)) {
        // INOUT container: same read-modify-write model as the function path. The ffi
        // param is a single `container**` the parent reads (in) then reassigns (out);
        // we stash the in-container in slots[i] and point giArgs[1+i] at &slots[i].
        // OWNERSHIP: JsToInContainer records the ORIGINAL in-container in inContainers,
        // so FreeInContainer (after the reads) releases it per the IN transfer; the
        // out-container the parent wrote into slots[i] is read + freed per the OUT
        // transfer by ReadOutOrReturn below.
        Napi::Value v = jsCursor < args.Length() ? args.Get(jsCursor) : env.Undefined();
        jsCursor++;
        if (!IsSupportedContainerType(ti, &why)) {
          Napi::TypeError::New(env, where + ": INOUT " + why +
                                        " parameters are not yet supported")
              .ThrowAsJavaScriptException();
          ok = false;
        } else {
          GITransfer tr = gi_arg_info_get_ownership_transfer(ai);
          gpointer cptr = nullptr;
          long ccount = 0;
          if ((v.IsNull() || v.IsUndefined()) && gi_arg_info_may_be_null(ai)) {
            ok = true;  // nullable INOUT container → NULL in-container (count 0)
          } else {
            ok = JsToInContainer(env, v, ti, tr, &cptr, &ccount, &inContainers);
          }
          if (ok) {
            slots[i].v_pointer = cptr;
            giArgs[1 + i].v_pointer = &slots[i];
            if (tg == GI_TYPE_TAG_ARRAY) {
              unsigned int L = 0;
              if (gi_type_info_get_array_length_index(ti, &L) && L < nDeclared) {
                GIArgInfo* la = gi_callable_info_get_arg(ci, L);
                GITypeInfo* lt = gi_arg_info_get_type_info(la);
                // An INOUT length's slot is what the parent reads+writes (giArgs[1+L]
                // already points at &slots[L] via the skip-branch); a plain IN length
                // takes the value directly in its ffi slot.
                if (dirs[L] == GI_DIRECTION_INOUT) WriteLengthValue(lt, &slots[L], ccount);
                else if (dirs[L] == GI_DIRECTION_IN) WriteLengthValue(lt, &giArgs[1 + L], ccount);
                gi_base_info_unref(lt);
                gi_base_info_unref(la);
              }
            }
          }
        }
      } else if (dir == GI_DIRECTION_INOUT) {
        // INOUT scalar: marshal the JS input into the slot (like IN); the parent
        // reads + writes it through &slots[i].
        Napi::Value v = jsCursor < args.Length() ? args.Get(jsCursor) : env.Undefined();
        jsCursor++;
        GITransfer tr = gi_arg_info_get_ownership_transfer(ai);
        if (JsToGIArgument(env, v, ti, &slots[i], &holds[i], tr, &ownedInStrings, nullptr,
                           nullptr, nullptr, gi_base_info_get_name(reinterpret_cast<GIBaseInfo*>(ai))))
          giArgs[1 + i].v_pointer = &slots[i];
        else
          ok = false;  // JsToGIArgument already threw
      } else {
        // Pure OUT: the callee writes into the slot; no JS arg is consumed.
        giArgs[1 + i].v_pointer = &slots[i];
      }
    } else if (tg == GI_TYPE_TAG_ARRAY || tg == GI_TYPE_TAG_GLIST ||
               tg == GI_TYPE_TAG_GSLIST || tg == GI_TYPE_TAG_GHASH) {
      // IN container: build the C container, autofill an IN length arg.
      std::string why;
      Napi::Value v = jsCursor < args.Length() ? args.Get(jsCursor) : env.Undefined();
      jsCursor++;
      if (!IsSupportedContainerType(ti, &why)) {
        Napi::TypeError::New(env, where + ": IN " + why +
                                      " parameters are not yet supported")
            .ThrowAsJavaScriptException();
        ok = false;
      } else {
        GITransfer tr = gi_arg_info_get_ownership_transfer(ai);
        gpointer cptr = nullptr;
        long ccount = 0;
        ok = JsToInContainer(env, v, ti, tr, &cptr, &ccount, &inContainers);
        if (ok) {
          giArgs[1 + i].v_pointer = cptr;
          if (tg == GI_TYPE_TAG_ARRAY) {
            unsigned int L = 0;
            if (gi_type_info_get_array_length_index(ti, &L) && L < nDeclared &&
                dirs[L] == GI_DIRECTION_IN) {
              GIArgInfo* la = gi_callable_info_get_arg(ci, L);
              GITypeInfo* lt = gi_arg_info_get_type_info(la);
              WriteLengthValue(lt, &giArgs[1 + L], ccount);
              gi_base_info_unref(lt);
              gi_base_info_unref(la);
            }
          }
        }
      }
    } else {
      // IN scalar/object/string: marshal by value into giArgs[1+i].
      Napi::Value v = jsCursor < args.Length() ? args.Get(jsCursor) : env.Undefined();
      jsCursor++;
      GITransfer tr = gi_arg_info_get_ownership_transfer(ai);
      ok = JsToGIArgument(env, v, ti, &giArgs[1 + i], &holds[i], tr, &ownedInStrings, nullptr,
                          nullptr, nullptr, gi_base_info_get_name(reinterpret_cast<GIBaseInfo*>(ai)));
    }

    avalue.push_back(&giArgs[1 + i]);
    gi_base_info_unref(ti);
    gi_base_info_unref(ai);
  }
  if (!ok) {
    for (const InContainer& c : inContainers) FreeInContainer(c);
    for (gpointer s : ownedInStrings) g_free(s);  // never reached the callee (#658)
    for (gpointer b : callerAllocBlob)
      if (b != nullptr) g_free(b);
    return env.Null();
  }

  // can-throw vfuncs take a trailing GError** the parent writes the error into.
  // libffi reads each argument's VALUE from the location avalue[i] points at, so
  // for the GError** slot avalue must point at a variable holding &error (a
  // GError**) — i.e. one extra level of indirection (&errorPtr), NOT &error
  // (which would pass NULL as the GError** and silently swallow the parent error).
  GError* error = nullptr;
  GError** errorPtr = &error;
  if (canThrow) avalue.push_back(&errorPtr);

  GITypeInfo* retType = gi_callable_info_get_return_type(ci);
  GIFFIReturnValue ffiRet;
  ffiRet.v_uint64 = 0;
  ffi_call(cif, reinterpret_cast<void (*)(void)>(fnPtr), &ffiRet, avalue.data());

  if (canThrow && error != nullptr) {
    gi_base_info_unref(retType);
    for (const InContainer& c : inContainers) FreeInContainer(c);
    for (gpointer s : ownedInStrings) g_free(s);  // callee did not adopt them on error
    for (gpointer b : callerAllocBlob)
      if (b != nullptr) g_free(b);
    ThrowGError(env, error, where);
    return env.Null();
  }

  // Assemble the JS return per the GJS convention: the (non-void) return value leads,
  // followed by each OUT/INOUT value in argument order. Exactly one element → return
  // it bare; many → a JS Array; none → undefined. Matches what a JS override of this
  // vfunc receives as its call args and hands back.
  std::vector<Napi::Value> results;
  GITransfer retTransfer = gi_callable_info_get_caller_owns(ci);
  if (gi_type_info_get_tag(retType) != GI_TYPE_TAG_VOID) {
    // Extract the (possibly narrowed) ffi return into a normalised GIArgument, then
    // marshal it to JS — the portable, endianness-safe path. ReadOutOrReturn honours
    // an array-length slot / container element type, and the declared transfer so a
    // transfer-full parent return is owned by JS rather than leaked.
    GIArgument retArg;
    retArg.v_uint64 = 0;
    gi_type_info_extract_ffi_return_value(retType, &ffiRet, &retArg);
    results.push_back(ReadOutOrReturn(env, ci, retType, &retArg, retTransfer, &slots));
  }
  gi_base_info_unref(retType);

  for (unsigned int i = 0; i < nDeclared && !env.IsExceptionPending(); i++) {
    if (dirs[i] != GI_DIRECTION_OUT && dirs[i] != GI_DIRECTION_INOUT) continue;
    if (skip[i]) continue;  // an array-length arg — surfaced via its array, not alone
    GIArgInfo* ai = gi_callable_info_get_arg(ci, i);
    GITypeInfo* ti = gi_arg_info_get_type_info(ai);
    GITransfer transfer = gi_arg_info_get_ownership_transfer(ai);
    if (callerAllocBlob[i] != nullptr) {
      // Caller-allocated OUT: the callee filled the blob IN PLACE (the blob is the
      // data, not a pointer to it). Wrap it, then release the blob — mirroring
      // InvokeFunctionInfo / gjs CallerAllocatesOut.
      gpointer blob = callerAllocBlob[i];
      if (gi_type_info_get_tag(ti) == GI_TYPE_TAG_ARRAY) {
        GIArgument a;
        memset(&a, 0, sizeof(a));
        a.v_pointer = blob;
        results.push_back(ReadOutOrReturn(env, ci, ti, &a, GI_TRANSFER_NOTHING, &slots));
        g_free(blob);
      } else {
        GType gt = callerAllocGType[i];
        gpointer owned = g_boxed_copy(gt, blob);
        results.push_back(MakeBoxedHandle(env, owned, gt, true));
        g_boxed_free(gt, blob);
      }
      callerAllocBlob[i] = nullptr;
      gi_base_info_unref(ti);
      gi_base_info_unref(ai);
      continue;
    }
    results.push_back(ReadOutOrReturn(env, ci, ti, &slots[i], transfer, &slots));
    gi_base_info_unref(ti);
    gi_base_info_unref(ai);
  }

  // A transfer-none IN container may back a transfer-none OUT/return, so free the IN
  // containers only AFTER the reads above (transfer-full ones were adopted). The
  // transfer-full IN/INOUT strings were adopted by the parent on this success path, so
  // they are intentionally NOT freed here (the callee owns them now).
  for (const InContainer& c : inContainers) FreeInContainer(c);

  if (env.IsExceptionPending()) return env.Null();
  if (results.empty()) return env.Undefined();
  if (results.size() == 1) return results[0];
  Napi::Array arr = Napi::Array::New(env, results.size());
  for (size_t k = 0; k < results.size(); k++) arr.Set(static_cast<uint32_t>(k), results[k]);
  return arr;
}

// callParentVfunc(handle, vfuncName, args?) -> unknown
//
// Chain up to the parent implementation of an overridden vfunc — the engine half
// of `super.vfunc_<name>(...)`. Resolves the NodeGiVFunc record for `vfuncName`
// nearest the instance's type (the record whose trampoline currently owns the
// vtable slot) and ffi_call's its captured parentPtr — the function that was in
// the slot BEFORE the override was installed (the C default, or a JS override
// further up the chain). The same `cif` the override's closure was built from
// describes the call signature (instance + declared args → return), so it is
// reused to call out. `this` (args[0]) goes back in as the instance, keeping the
// canonical toggle-ref wrapper identity. Marshals IN args (JsToGIArgument) +
// the return (gi_type_info_extract_ffi_return_value → GIArgumentToJs); throws a
// GLib.Error for a can-throw vfunc whose parent set the GError.
//
// OUT / INOUT args: routed through per-arg storage slots exactly like the
// function-invoke path (calls.cc InvokeFunctionInfo). The parent's ffi signature
// takes a POINTER for each OUT/INOUT param, so giArgs[1+i] carries &slots[i] (the
// stable storage the C parent writes THROUGH) — INOUT slots are pre-marshalled from
// the JS input, OUT slots start zeroed; a caller-allocates OUT (fixed C array /
// boxed struct) gets a g_malloc0 blob instead. The JS caller passes only IN + INOUT
// args positionally (OUT params are engine-managed), and the result follows the GJS
// return-tuple convention `[returnValue?, ...outArgs]` — one value bare, several as
// an Array, matching exactly what a JS override of that vfunc receives as its call
// args. Read-back reuses ReadOutOrReturn (array-length slots, containers, boxed).
//
// MULTI-LEVEL chain-up (registered chains, G2): chains to the DEEPEST registered
// override's captured parent (the C-side default below the whole registered chain),
// NOT the nearest. On a multi-level chain the level-to-level `super.vfunc_<name>()`
// hops are resolved by the JS PROTOTYPE chain (each registered ancestor's
// `vfunc_<name>` is a real JS method, invoked directly), so every level's JS impl
// has already run by the time the chain bottoms out at the introspected base's
// prototype and reaches this thunk — at which point the only thing left to call is
// the C default. Using the nearest record would re-enter an intermediate level's
// trampoline (a double-run / infinite loop). See FindDeepestVFuncRecord.
Napi::Value CallParentVfunc(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsString()) {
    Napi::TypeError::New(env, "callParentVfunc(handle, vfuncName: string, args?: unknown[])")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Null();  // UnwrapGObject threw or it was null
  std::string vname = info[1].As<Napi::String>().Utf8Value();
  Napi::Array args = (info.Length() >= 3 && info[2].IsArray()) ? info[2].As<Napi::Array>()
                                                              : Napi::Array::New(env, 0);

  NodeGiVFunc* vf = FindDeepestVFuncRecord(G_OBJECT_TYPE(obj), vname);
  if (vf == nullptr || vf->parentPtr == nullptr || vf->info == nullptr) {
    Napi::Error::New(env, "no parent vfunc '" + vname + "' to chain up to on " +
                              g_type_name(G_OBJECT_TYPE(obj)) +
                              " (is it overridden by a registerClass subclass?)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  return InvokeVFuncPointer(env, obj, reinterpret_cast<GICallableInfo*>(vf->info), &vf->cif,
                            vf->parentPtr, "super." + vname, args);
}

// ---- vfunc dispatch on an INTROSPECTED class (no registerClass involved) ----
//
// `new Gtk.Box().vfunc_add_child(builder, child, null)` works on gjs, and it is the
// only route to a GtkBuildable adder — `add_child` is introspected as a vfunc ONLY,
// so there is no plain method to call (measured on gjs 1.88.1; ADR 0027 § Context
// rests on it, and two React-for-GJS renderers route every insertion through it).
// node-gi had ONLY the chain-up thunk, which needs a registerClass override record
// to find a captured parent pointer, so every `vfunc_*` on a plain introspected
// instance threw "no parent vfunc … to chain up to".
//
// gjs resolves such a name against the prototype's own GIObjectInfo, its implemented
// interfaces and then its parents, and it resolves the ADDRESS at that prototype's
// GType (gi/object.cpp find_vfunc_on_parents). This mirrors that: walk the object-info
// parent chain, then ask girepository for the vtable slot of the class the prototype
// belongs to. A resolution that FAILS is not an error here — it is the signal for
// gi.js to fall back to the chain-up thunk, which is what keeps `super.vfunc_dispose()`
// working (GObject's own vfuncs report GI_UNKNOWN as their struct offset, so
// gi_vfunc_info_get_address cannot locate them).

// One resolved, immediately callable class vfunc. `usable` false = no such vfunc on
// this class, or girepository cannot locate its slot for this GType.
struct NodeGiClassVFunc {
  GIVFuncInfo* info = nullptr;  // owned; process lifetime (a GIBaseInfo is immutable)
  GIFunctionInvoker invoker{};  // cif + native_address, ffi_prep'd once
  GType gtype = G_TYPE_INVALID; // the implementor whose slot `invoker` points into
  bool usable = false;
};

// Cached per (namespace, typeName, vfuncName): the ffi cif behind an invoker costs a
// malloc to build and a renderer calls vfunc_add_child on every insertion. thread_local
// because GIBaseInfo refcounting is not thread-safe and a worker_threads env is its own
// JS world with its own repository handles.
static thread_local std::map<std::string, NodeGiClassVFunc> g_classVFuncs;

// Walk the object-info PARENT chain, searching each level's own vfuncs AND the
// interfaces that level implements (gi_object_info_find_vfunc_using_interfaces —
// `add_child` lives on the GtkBuildable INTERFACE, not on GtkBox). Returns a new
// ref, or nullptr when no ancestor declares `name`.
static GIVFuncInfo* FindVFuncOnClassOrParents(GIObjectInfo* start, const char* name) {
  GIObjectInfo* walk =
      reinterpret_cast<GIObjectInfo*>(gi_base_info_ref(reinterpret_cast<GIBaseInfo*>(start)));
  GIVFuncInfo* found = nullptr;
  while (walk != nullptr && found == nullptr) {
    // The declarer out-param is optional and we do not need it: the ADDRESS is resolved
    // against the class the PROTOTYPE belongs to, never against the declaring level.
    found = gi_object_info_find_vfunc_using_interfaces(walk, name, nullptr);
    GIObjectInfo* parent = found == nullptr ? gi_object_info_get_parent(walk) : nullptr;
    gi_base_info_unref(reinterpret_cast<GIBaseInfo*>(walk));
    walk = parent;
  }
  return found;
}

static NodeGiClassVFunc* ResolveClassVFunc(const std::string& ns, const std::string& tn,
                                           const std::string& vfuncName) {
  const std::string key = ns + "." + tn + "." + vfuncName;
  auto it = g_classVFuncs.find(key);
  if (it != g_classVFuncs.end()) return &it->second;

  NodeGiClassVFunc entry;
  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* base = gi_repository_find_by_name(repo, ns.c_str(), tn.c_str());
  if (base != nullptr) {
    if (GI_IS_OBJECT_INFO(base)) {
      GIObjectInfo* oi = reinterpret_cast<GIObjectInfo*>(base);
      GType gtype =
          gi_registered_type_info_get_g_type(reinterpret_cast<GIRegisteredTypeInfo*>(oi));
      GIVFuncInfo* vi = FindVFuncOnClassOrParents(oi, vfuncName.c_str());
      if (vi != nullptr && gtype != G_TYPE_INVALID && G_TYPE_IS_CLASSED(gtype)) {
        // gi_vfunc_info_get_address reads the slot out of the LIVE class struct, which
        // exists only once the class has been referenced — and the ref is KEPT so the
        // vtable the cached address points into cannot be torn down under us. gjs holds
        // classes the same way; an instantiable GObject class lives for the process.
        g_type_class_ref(gtype);
        GError* err = nullptr;
        void* addr = gi_vfunc_info_get_address(vi, gtype, &err);
        if (addr != nullptr &&
            gi_function_invoker_new_for_address(addr, reinterpret_cast<GICallableInfo*>(vi),
                                                &entry.invoker, &err)) {
          entry.info = reinterpret_cast<GIVFuncInfo*>(
              gi_base_info_ref(reinterpret_cast<GIBaseInfo*>(vi)));
          entry.gtype = gtype;
          entry.usable = true;
        }
        g_clear_error(&err);
      }
      if (vi != nullptr) gi_base_info_unref(reinterpret_cast<GIBaseInfo*>(vi));
    }
    gi_base_info_unref(base);
  }
  g_object_unref(repo);
  return &g_classVFuncs.emplace(key, entry).first->second;
}

// hasClassVfunc(namespace, typeName, vfuncName) -> boolean
//
// Whether `Ns.Type.prototype.vfunc_<name>` can be MATERIALIZED as a direct call — the
// gate gi.js asks before defining one, so a name that resolves to nothing stays
// `undefined` (gjs parity: an unknown vfunc is undefined, never a throw-on-call thunk)
// and a name we cannot address falls through to the chain-up thunk.
Napi::Value HasClassVfunc(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsString() || !info[1].IsString() || !info[2].IsString()) {
    Napi::TypeError::New(env,
                         "hasClassVfunc(namespace: string, typeName: string, vfuncName: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  NodeGiClassVFunc* entry = ResolveClassVFunc(info[0].As<Napi::String>().Utf8Value(),
                                              info[1].As<Napi::String>().Utf8Value(),
                                              info[2].As<Napi::String>().Utf8Value());
  return Napi::Boolean::New(env, entry->usable);
}

// callClassVfunc(handle, namespace, typeName, vfuncName, args?) -> unknown
//
// Invoke the vtable entry `Ns.Type` carries for `vfuncName`, with `handle` as the
// instance. Same marshalling and same GJS return-tuple convention as the chain-up
// path (InvokeVFuncPointer); the only difference is where the function pointer came
// from.
Napi::Value CallClassVfunc(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4 || !info[1].IsString() || !info[2].IsString() || !info[3].IsString()) {
    Napi::TypeError::New(
        env, "callClassVfunc(handle, namespace: string, typeName: string, vfuncName: string, "
             "args?: unknown[])")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  GObject* obj = UnwrapGObject(env, info[0]);
  if (obj == nullptr) return env.Null();  // UnwrapGObject threw or it was null
  const std::string ns = info[1].As<Napi::String>().Utf8Value();
  const std::string tn = info[2].As<Napi::String>().Utf8Value();
  const std::string vname = info[3].As<Napi::String>().Utf8Value();
  Napi::Array args = (info.Length() >= 5 && info[4].IsArray()) ? info[4].As<Napi::Array>()
                                                              : Napi::Array::New(env, 0);
  const std::string where = ns + "." + tn + ".prototype.vfunc_" + vname;

  NodeGiClassVFunc* entry = ResolveClassVFunc(ns, tn, vname);
  if (!entry->usable) {
    Napi::Error::New(env, where + ": no addressable virtual function on " + ns + "." + tn)
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  // The cif was prepared for THIS class's slot, so an instance of an unrelated type
  // would hand C a wrong `self` and crash the process rather than throw. A detached
  // `Ns.Type.prototype.vfunc_x.call(other)` is the reachable spelling.
  if (!g_type_is_a(G_OBJECT_TYPE(obj), entry->gtype)) {
    Napi::TypeError::New(env, where + ": `this` is a " +
                                  g_type_name(G_OBJECT_TYPE(obj)) + ", not a " +
                                  g_type_name(entry->gtype))
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  return InvokeVFuncPointer(env, obj, reinterpret_cast<GICallableInfo*>(entry->info),
                            &entry->invoker.cif, entry->invoker.native_address, where, args);
}


// Shared registration core: subclass `name` from an ALREADY-RESOLVED parent GObject
// GType, reading the optional { properties, signals, vfuncs, template, children, ... }
// from `optsValue` (a non-object → no options). Returns the tagged GType handle for
// the new type, or throws + returns env.Null(). Both entry points use it:
//   - RegisterClass        — parent resolved from introspection (namespace+typename),
//   - RegisterClassFromGType — parent given directly as a #667 GType handle (the
//     multi-level registered-of-registered path; the parent has no GIR entry).
// Everything past parent resolution is identical: g_type_register_static makes the
// child class struct a memcpy of the parent's, so a registered ancestor's installed
// properties/signals/vfunc slots compose for free via normal GObject inheritance.
static Napi::Value RegisterClassImpl(Napi::Env env, const std::string& name, GType parentType,
                                     Napi::Value optsValue) {
  if (g_type_from_name(name.c_str()) != 0) {
    Napi::Error::New(env, "a GType named '" + name + "' is already registered")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  if (!G_TYPE_IS_OBJECT(parentType)) {
    const char* pn = g_type_name(parentType);
    Napi::TypeError::New(env, std::string(pn != nullptr ? pn : "the parent type") +
                                  " is not a subclassable GObject type")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  GTypeQuery query;
  g_type_query(parentType, &query);
  if (query.type == 0) {
    const char* pn = g_type_name(parentType);
    Napi::Error::New(env, std::string("failed to query parent type ") + (pn != nullptr ? pn : "?"))
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  // Parse the optional { properties, signals } and build the class metadata.
  NodeGiClassData* cd = new NodeGiClassData();
  // Stamp the registering env so NodeGiConstructor (no user_data slot) can call
  // into JS from this class's cd for a C/GtkBuilder-instantiated instance.
  cd->env = env;
  cd->parentGet = nullptr;
  cd->parentSet = nullptr;
  if (optsValue.IsObject()) {
    Napi::Object opts = optsValue.As<Napi::Object>();
    if (opts.Has("properties") && opts.Get("properties").IsArray()) {
      Napi::Array props = opts.Get("properties").As<Napi::Array>();
      for (uint32_t i = 0; i < props.Length(); i++) {
        Napi::Value pv = props.Get(i);
        if (!pv.IsObject()) continue;
        std::string perr;
        GParamSpec* ps = BuildParamSpec(env, pv.As<Napi::Object>(), &perr);
        if (ps == nullptr) {
          for (GParamSpec* done : cd->properties) {
            g_param_spec_ref_sink(done);
            g_param_spec_unref(done);
          }
          delete cd;
          Napi::TypeError::New(env, "registerClass property: " + perr).ThrowAsJavaScriptException();
          return env.Null();
        }
        cd->properties.push_back(ps);
      }
    }
    if (opts.Has("signals") && opts.Get("signals").IsArray()) {
      Napi::Array sigs = opts.Get("signals").As<Napi::Array>();
      for (uint32_t i = 0; i < sigs.Length(); i++) {
        Napi::Value sv = sigs.Get(i);
        if (!sv.IsObject()) continue;
        Napi::Object so = sv.As<Napi::Object>();
        if (!so.Has("name") || !so.Get("name").IsString()) continue;
        NodeGiSignalDef sd;
        sd.name = so.Get("name").As<Napi::String>().Utf8Value();
        sd.returnType = G_TYPE_NONE;
        if (so.Has("returnType") && so.Get("returnType").IsString()) {
          GType rt = TypeNameToGType(so.Get("returnType").As<Napi::String>().Utf8Value());
          if (rt != G_TYPE_INVALID) sd.returnType = rt;
        }
        sd.flags = (so.Has("flags") && so.Get("flags").IsNumber())
                       ? static_cast<GSignalFlags>(so.Get("flags").As<Napi::Number>().Int32Value())
                       : G_SIGNAL_RUN_LAST;
        if (so.Has("paramTypes") && so.Get("paramTypes").IsArray()) {
          Napi::Array pts = so.Get("paramTypes").As<Napi::Array>();
          for (uint32_t j = 0; j < pts.Length(); j++) {
            // NodeGiToUtf8: terminate-safe (a swallowed Get/coercion failure must
            // not cascade into Error::New(nullptr) — see common.h).
            GType t = TypeNameToGType(NodeGiToUtf8(pts.Get(j)));
            if (t != G_TYPE_INVALID && t != G_TYPE_NONE) sd.paramTypes.push_back(t);
          }
        }
        cd->signals.push_back(sd);
      }
    }
    // vfuncs: an object { "<vfunc-name>": <jsFunction>, ... }. Each holds a strong
    // napi_ref for the class lifetime (resolved + hooked up in class_init).
    if (opts.Has("vfuncs") && opts.Get("vfuncs").IsObject()) {
      Napi::Object vf = opts.Get("vfuncs").As<Napi::Object>();
      Napi::Array keys = vf.GetPropertyNames();
      // Empty keys = swallowed napi failure (terminating env): keys.Length()
      // would abort via Error::New(nullptr) — skip the block cleanly.
      for (uint32_t i = 0; !keys.IsEmpty() && i < keys.Length(); i++) {
        std::string vname = NodeGiToUtf8(keys.Get(i));
        Napi::Value fnv = vf.Get(vname);
        if (!fnv.IsFunction()) continue;
        NodeGiVFunc* rec = new NodeGiVFunc();
        rec->env = env;
        rec->name = vname;
        rec->info = nullptr;
        rec->closure = nullptr;
        rec->fn = nullptr;
        rec->parentPtr = nullptr;
        napi_create_reference(env, fnv, 1, &rec->fn);
        cd->vfuncs.push_back(rec);
      }
    }
    // template: a Gtk.Widget composite template. Accepts a Uint8Array/Buffer of
    // inline UI-XML, a "resource:///…" path string (→ set_template_from_resource),
    // or a plain inline UI-XML string. Installed on the class in class_init.
    if (opts.Has("template")) {
      Napi::Value tv = opts.Get("template");
      if (tv.IsString()) {
        std::string s = tv.As<Napi::String>().Utf8Value();
        const std::string kResource = "resource://";
        if (s.rfind(kResource, 0) == 0) {
          // "resource:///path" → the resource PATH "/path" (strip the scheme +
          // authority "resource://"), matching gtk_widget_class_set_template_from_resource.
          cd->templateResource = s.substr(kResource.size());
          cd->hasTemplate = true;
        } else {
          // Inline UI-XML string → owned GBytes copy.
          cd->templateBytes = g_bytes_new(s.data(), s.size());
          cd->hasTemplate = true;
        }
      } else if (tv.IsBuffer()) {
        Napi::Buffer<uint8_t> b = tv.As<Napi::Buffer<uint8_t>>();
        cd->templateBytes = g_bytes_new(b.Data(), b.Length());
        cd->hasTemplate = true;
      } else if (tv.IsTypedArray()) {
        Napi::TypedArray ta = tv.As<Napi::TypedArray>();
        const uint8_t* data = static_cast<const uint8_t*>(ta.ArrayBuffer().Data()) + ta.ByteOffset();
        cd->templateBytes = g_bytes_new(data, ta.ByteLength());
        cd->hasTemplate = true;
      }
    }
    if (opts.Has("cssName") && opts.Get("cssName").IsString()) {
      cd->cssName = opts.Get("cssName").As<Napi::String>().Utf8Value();
    }
    if (opts.Has("children") && opts.Get("children").IsArray()) {
      Napi::Array arr = opts.Get("children").As<Napi::Array>();
      for (uint32_t i = 0; i < arr.Length(); i++) {
        if (arr.Get(i).IsString()) cd->children.push_back(arr.Get(i).As<Napi::String>().Utf8Value());
      }
    }
    if (opts.Has("internalChildren") && opts.Get("internalChildren").IsArray()) {
      Napi::Array arr = opts.Get("internalChildren").As<Napi::Array>();
      for (uint32_t i = 0; i < arr.Length(); i++) {
        if (arr.Get(i).IsString())
          cd->internalChildren.push_back(arr.Get(i).As<Napi::String>().Utf8Value());
      }
    }
  }

  GTypeInfo typeInfo = {};
  typeInfo.class_size = static_cast<guint16>(query.class_size);
  typeInfo.instance_size = static_cast<guint16>(query.instance_size);
  // class_init installs the custom properties + signals (and records the class
  // data even when there are none, so the property vfuncs can find it).
  typeInfo.class_init = NodeGiClassInit;
  typeInfo.class_data = cd;

  GType newType = g_type_register_static(parentType, name.c_str(), &typeInfo, (GTypeFlags)0);
  if (newType == 0) {
    for (NodeGiVFunc* vf : cd->vfuncs) {
      if (vf->fn != nullptr) napi_delete_reference(env, vf->fn);
      delete vf;
    }
    delete cd;
    Napi::Error::New(env, "g_type_register_static failed for '" + name + "'")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  // Tag the returned type handle as a GType handle so it doubles as the class's
  // `$gtype` (G4): the same External feeds constructType (UnwrapGType) AND the
  // GType marshalling (GObject.type_ensure, g_param_spec_object's value gtype, …).
  return MakeGTypeHandle(env, newType);
}

// registerClass(name, parentNamespace, parentTypeName, options?) -> typeHandle
//
// Subclass an INTROSPECTED parent, resolved by namespace + typename. Used when the
// parent class extends a `gi://`-introspected GObject (e.g. `class X extends Adw.Bin`).
Napi::Value RegisterClass(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsString() || !info[1].IsString() || !info[2].IsString()) {
    Napi::TypeError::New(
        env,
        "registerClass(name: string, parentNamespace: string, parentTypeName: string, options?: "
        "{ properties?, signals?, vfuncs? })")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string name = info[0].As<Napi::String>().Utf8Value();
  std::string pns = info[1].As<Napi::String>().Utf8Value();
  std::string ptn = info[2].As<Napi::String>().Utf8Value();

  // Resolve the parent GType from its introspection info.
  GIRepository* repo = DupDefaultRepository();
  GIBaseInfo* base = gi_repository_find_by_name(repo, pns.c_str(), ptn.c_str());
  bool isObject = base != nullptr && GI_IS_OBJECT_INFO(base);
  GType parentType =
      isObject ? gi_registered_type_info_get_g_type(reinterpret_cast<GIRegisteredTypeInfo*>(base))
               : G_TYPE_INVALID;
  if (base != nullptr) gi_base_info_unref(base);
  g_object_unref(repo);
  if (!isObject || !G_TYPE_IS_OBJECT(parentType)) {
    Napi::TypeError::New(env, pns + "." + ptn + " is not a subclassable GObject type")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  return RegisterClassImpl(env, name, parentType, info.Length() >= 4 ? info[3] : env.Undefined());
}

// registerClassFromGType(name, parentGType, options?) -> typeHandle
//
// Multi-level registered subclassing (G2): subclass directly from a parent GType
// HANDLE (the #667 kGTypeHandleTag External a previous registerClass returned),
// instead of resolving the parent through introspection. The parent is itself a
// registered (dynamic) type with no GIR entry, so the namespace+typename path
// (RegisterClass) cannot find it; the L1 layer (findParentGType) passes the parent's
// `$gtype` handle here. The shared core (RegisterClassImpl) then subclasses from the
// resolved GType identically, so a registered ancestor's properties/signals/vfunc
// slots compose for free via GObject inheritance.
Napi::Value RegisterClassFromGType(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString()) {
    Napi::TypeError::New(
        env, "registerClassFromGType(name: string, parentGType: handle, options?: object)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string name = info[0].As<Napi::String>().Utf8Value();
  GType parentType = UnwrapGType(env, info[1]);  // throws (returns 0) on a non-GType arg
  if (parentType == 0) return env.Null();
  return RegisterClassImpl(env, name, parentType, info.Length() >= 3 ? info[2] : env.Undefined());
}

// constructType(typeHandle, props?: Record<string, unknown>) -> External<GObject>
Napi::Value ConstructType(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1) {
    Napi::TypeError::New(env, "constructType(typeHandle, props?: object)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  GType gtype = UnwrapGType(env, info[0]);
  if (gtype == 0) return env.Null();
  if (!G_TYPE_IS_OBJECT(gtype)) {
    Napi::TypeError::New(env, "type handle is not a constructible GObject type")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Object props = (info.Length() >= 2 && info[1].IsObject()) ? info[1].As<Napi::Object>()
                                                                 : Napi::Object::New(env);
  return ConstructGObject(env, gtype, props, std::string(g_type_name(gtype)));
}

// setConstructCallback(cb) -> void. L1 registers the callback NodeGiConstructor
// invokes to run a registered class's JS constructor for a C/GtkBuilder-created
// instance: (instanceHandle, gtypeName) → Reflect.construct(class) in adopt mode
// (see gi.js runCtorForCObject). Mirrors setTemplateCallbackResolver.
Napi::Value SetConstructCallback(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "setConstructCallback(cb: function)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  NodeGiEnvData* d = EnvData(env);
  if (d == nullptr) return env.Undefined();
  if (d->constructCallback != nullptr) {
    napi_delete_reference(env, d->constructCallback);
    d->constructCallback = nullptr;
  }
  napi_create_reference(env, info[0], 1, &d->constructCallback);
  return env.Undefined();
}

}  // namespace nodegi
