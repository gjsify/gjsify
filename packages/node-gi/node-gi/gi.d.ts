// SPDX-License-Identifier: MIT
// @gjsify/node-gi/gi — L1 GJS-compatibility layer type surface.
//
// The runtime returns a Proxy whose members are resolved dynamically from
// introspection, so the precise per-namespace shape is not statically known
// here. Under gjsify's bundler integration the call site
// `import Ns from 'gi://Ns?version=X'` is typed by the platform-neutral ambient
// `@girs/*` module declarations; this declaration types the bare runtime entry.

/** A GJS-shaped namespace object (members resolved dynamically). */
export type GiNamespace = Record<string, unknown>;

/**
 * A plain descriptor produced by a `GObject.ParamSpec.*` factory and consumed by
 * the {@link GObjectNamespace.registerClass} decorator (mapped to the native
 * property spec). Not used directly.
 */
export interface ParamSpecDescriptor {
  $paramSpec: true;
  type: 'string' | 'boolean' | 'int' | 'uint' | 'int64' | 'uint64' | 'double' | 'float';
  name: string;
  nick?: string;
  blurb?: string;
  flags?: number;
  default?: string | number | boolean;
  minimum?: number;
  maximum?: number;
}

/** The `GObject.ParamSpec.*` factories surfaced on the GObject namespace. */
export interface ParamSpecFactories {
  string(name: string, nick: string, blurb: string, flags: number, defaultValue?: string): ParamSpecDescriptor;
  boolean(name: string, nick: string, blurb: string, flags: number, defaultValue?: boolean): ParamSpecDescriptor;
  int(name: string, nick: string, blurb: string, flags: number, minimum: number, maximum: number, defaultValue?: number): ParamSpecDescriptor;
  uint(name: string, nick: string, blurb: string, flags: number, minimum: number, maximum: number, defaultValue?: number): ParamSpecDescriptor;
  int64(name: string, nick: string, blurb: string, flags: number, minimum: number, maximum: number, defaultValue?: number): ParamSpecDescriptor;
  uint64(name: string, nick: string, blurb: string, flags: number, minimum: number, maximum: number, defaultValue?: number): ParamSpecDescriptor;
  double(name: string, nick: string, blurb: string, flags: number, minimum: number, maximum: number, defaultValue?: number): ParamSpecDescriptor;
  float(name: string, nick: string, blurb: string, flags: number, minimum: number, maximum: number, defaultValue?: number): ParamSpecDescriptor;
}

/** A `meta.Signals` entry for {@link GObjectNamespace.registerClass}. */
export interface SignalDeclaration {
  /** Parameter types in the node-gi vocabulary (e.g. `'int'`, `'string'`, `'object'`). */
  param_types?: string[];
  /** Return type (default `'void'`). */
  return_type?: string;
  /** `GSignalFlags` bitfield (default `RUN_LAST`). */
  flags?: number;
}

/** The class-registration metadata accepted by {@link GObjectNamespace.registerClass}. */
export interface RegisterClassMeta {
  GTypeName?: string;
  Properties?: Record<string, ParamSpecDescriptor>;
  Signals?: Record<string, SignalDeclaration>;
  [key: string]: unknown;
}

/**
 * The extra statics the `GObject` namespace carries on top of its introspected
 * members (reached via `requireGi('GObject')`) — the GJS-shaped class-registration
 * surface.
 */
export interface GObjectNamespace extends GiNamespace {
  /**
   * Register a GObject subclass declared as a JS class. Supports both
   * `registerClass(class)` and `registerClass(meta, class)`. Returns a
   * constructor whose `new`-ed instances are usable as GObjects (property get/set,
   * `.connect/.emit/.disconnect`) and expose the user class's own prototype
   * methods. `vfunc_<name>` prototype methods override the parent GObject vfuncs.
   */
  registerClass(klass: Function): Function;
  registerClass(meta: RegisterClassMeta, klass: Function): Function;
  ParamSpec: ParamSpecFactories;
  /**
   * The FULL introspected `GParamFlags` bitfield (READABLE/WRITABLE/READWRITE/
   * CONSTRUCT/CONSTRUCT_ONLY/LAX_VALIDATION/STATIC_*/EXPLICIT_NOTIFY/DEPRECATED/
   * …) — the named members below are the common convenience bits; the index
   * signature covers the remaining introspected members.
   */
  ParamFlags: {
    READABLE: number;
    WRITABLE: number;
    READWRITE: number;
    CONSTRUCT: number;
    CONSTRUCT_ONLY: number;
    [member: string]: number;
  };
  /** The FULL introspected `GSignalFlags` bitfield (RUN_FIRST/RUN_LAST/RUN_CLEANUP/NO_RECURSE/DETAILED/ACTION/NO_HOOKS/MUST_COLLECT/DEPRECATED/…). */
  SignalFlags: { RUN_FIRST: number; RUN_LAST: number; RUN_CLEANUP: number; [member: string]: number };
}

/**
 * Require a GObject-Introspection namespace and return a GJS-shaped namespace
 * object. The Node twin of `import Ns from 'gi://Ns?version=X'` /
 * `imports.gi.Ns`. Members are resolved lazily from introspection: namespace
 * functions become callables, GObject types become constructors whose instances
 * expose `.method(...)`, `.prop` get/set and `.connect()/.emit()/.disconnect()`.
 *
 * The `GObject` namespace additionally carries the GJS runtime statics
 * (`registerClass`, `ParamSpec`, `ParamFlags`, `SignalFlags`) — see
 * {@link GObjectNamespace}.
 */
export function requireGi(namespace: string, version?: string): GiNamespace;

/**
 * Extract the raw native GObject handle from a wrapped instance (advanced /
 * interop use). Returns the value unchanged if it is not a wrapped instance.
 */
export function unwrap(value: unknown): unknown;

export default requireGi;
