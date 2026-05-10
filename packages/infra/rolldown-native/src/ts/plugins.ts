// @gjsify/rolldown-native — high-level facade over `BundlerSession`.
//
// Translates a list of "plugin objects" (rolldown-shaped subset)
// into hook_requested / context_response signal handling, and waits
// for `completed` / `error_occurred`. The end result is a Promise<BundleResult>.
//
// This file does NOT mirror rolldown's full Plugin surface — only the
// hooks the gjsify CLI's own plugin set actually uses today
// (load, transform, resolveId, renderChunk, banner, footer, intro,
// outro, buildStart, buildEnd, generateBundle, writeBundle, closeBundle).
// Hooks the JS plugin doesn't define are silently skipped on the
// Rust side via `register_hook_usage()`.

import type { GjsifyRolldown as GjsifyRolldownNS } from 'gi://GjsifyRolldown?version=1.0';
import type GLib from '@girs/glib-2.0';
import { loadNativeRolldown, type BundleOptions, type BundleResult } from './index.js';

type SessionInstance = GjsifyRolldownNS.BundlerSession;

function getGLib(): typeof GLib {
  const gi = (globalThis as unknown as { imports?: { gi?: { GLib?: typeof GLib } } }).imports?.gi;
  if (!gi || !gi.GLib) throw new Error('@gjsify/rolldown-native: GLib not available (not running under GJS?)');
  return gi.GLib;
}

const enc = (s: string): GLib.Bytes => getGLib().Bytes.new(new TextEncoder().encode(s));
const dec = (b: GLib.Bytes): string => new TextDecoder().decode(b.get_data() ?? new Uint8Array(0));

// --------------------------------------------------------------------
// Plugin shape — the JS surface a user plugin authors against.
// --------------------------------------------------------------------

/**
 * Per-hook id-regex filter. Matches rolldown's `HookFilter.id`-only
 * subset that we natively short-circuit on the Rust side. Full
 * token-tree boolean expressions stay JS-side: just leave `idFilter`
 * unset and gate inside the hook handler.
 */
export interface PluginIdFilter {
  load?: string;
  transform?: string;
  resolveId?: string;
}

export interface NativePluginContext {
  /**
   * Re-enter the resolve pipeline mid-hook, mirrors rolldown's
   * `this.resolve(source, importer, opts?)`. Returns null when the
   * specifier doesn't resolve (rolldown returns `null`); returns the
   * resolved id otherwise.
   */
  resolve(specifier: string, importer?: string, opts?: { skipSelf?: boolean; isEntry?: boolean }): Promise<{ id: string; external: boolean } | null>;
  /** Append a warning to the bundle's warnings list. */
  warn(message: string): void;
  /** Throw with `message` — caught at the dispatch boundary and
   *  converted into a build-failing diagnostic. Convenience wrapper. */
  error(message: string): never;
}

export type LoadHookHandler = (this: NativePluginContext, id: string) =>
  string | { code: string; moduleType?: string } | null | undefined |
  Promise<string | { code: string; moduleType?: string } | null | undefined>;

export type TransformHookHandler = (this: NativePluginContext, code: string, id: string, moduleType: string) =>
  string | { code: string; moduleType?: string } | null | undefined |
  Promise<string | { code: string; moduleType?: string } | null | undefined>;

export type ResolveIdHookHandler = (this: NativePluginContext, specifier: string, importer: string | undefined, opts: { isEntry: boolean }) =>
  string | { id: string; external?: boolean } | null | undefined |
  Promise<string | { id: string; external?: boolean } | null | undefined>;

export type RenderChunkHookHandler = (this: NativePluginContext, code: string, chunk: { fileName: string; name: string; isEntry: boolean }) =>
  string | { code: string } | null | undefined |
  Promise<string | { code: string } | null | undefined>;

export type AddonHookHandler = (this: NativePluginContext, chunk: { fileName: string; name: string; isEntry: boolean }) =>
  string | { text: string } | null | undefined |
  Promise<string | { text: string } | null | undefined>;

export type LifecycleHookHandler = (this: NativePluginContext) => void | Promise<void>;

export interface NativePlugin {
  name: string;
  idFilter?: PluginIdFilter;
  load?: LoadHookHandler;
  transform?: TransformHookHandler;
  resolveId?: ResolveIdHookHandler;
  renderChunk?: RenderChunkHookHandler;
  banner?: AddonHookHandler;
  footer?: AddonHookHandler;
  intro?: AddonHookHandler;
  outro?: AddonHookHandler;
  buildStart?: LifecycleHookHandler;
  buildEnd?: LifecycleHookHandler;
  generateBundle?: LifecycleHookHandler;
  writeBundle?: LifecycleHookHandler;
  closeBundle?: LifecycleHookHandler;
}

const HOOK_NAMES: ReadonlyArray<keyof NativePlugin> = [
  'load', 'transform', 'resolveId', 'renderChunk', 'banner', 'footer',
  'intro', 'outro', 'buildStart', 'buildEnd', 'generateBundle',
  'writeBundle', 'closeBundle',
] as const;

interface RustPluginMeta {
  name: string;
  hooks: string[];
  idFilter?: PluginIdFilter;
}

function pluginMeta(p: NativePlugin): RustPluginMeta {
  const hooks = HOOK_NAMES.filter((h) => typeof p[h] === 'function');
  const meta: RustPluginMeta = { name: p.name, hooks };
  if (p.idFilter) meta.idFilter = p.idFilter;
  return meta;
}

// --------------------------------------------------------------------
// Hook arg envelopes (mirror Rust's HookRequestPayload variants).
// --------------------------------------------------------------------

interface BaseEnvelope {
  hook: string;
  reqId: number;
  pluginIndex: number;
}

interface LoadArgs extends BaseEnvelope { hook: 'load'; id: string; }
interface ResolveIdArgs extends BaseEnvelope { hook: 'resolveId'; specifier: string; importer?: string; isEntry: boolean; }
interface TransformArgs extends BaseEnvelope { hook: 'transform'; id: string; code: string; moduleType: string; }
interface RenderChunkArgs extends BaseEnvelope { hook: 'renderChunk'; code: string; fileName: string; name: string; isEntry: boolean; }
interface AddonArgs extends BaseEnvelope { hook: 'banner' | 'footer' | 'intro' | 'outro'; fileName: string; name: string; isEntry: boolean; }
interface LifecycleArgs extends BaseEnvelope { hook: 'buildStart' | 'buildEnd' | 'generateBundle' | 'writeBundle' | 'closeBundle'; error?: string; }

type HookArgs = LoadArgs | ResolveIdArgs | TransformArgs | RenderChunkArgs | AddonArgs | LifecycleArgs;

// --------------------------------------------------------------------
// Public facade.
// --------------------------------------------------------------------

/**
 * Drive a `BundlerSession` through to completion against a list of
 * user plugins. Returns the standard `BundleResult` JSON envelope
 * shape that the synchronous `bundle()` facade also returns.
 *
 * Throws if the prebuild isn't loadable. Rejects the returned Promise
 * if the underlying build fails.
 */
export function bundleWithPlugins(
  options: BundleOptions,
  plugins: NativePlugin[],
): Promise<BundleResult> {
  const native = loadNativeRolldown();
  if (!native) {
    return Promise.reject(new Error('@gjsify/rolldown-native: prebuild not available'));
  }
  const NativeMod = native as unknown as { BundlerSession: { new(): SessionInstance } };

  const session = new NativeMod.BundlerSession();
  const ctxResolveSlots = new Map<number, { resolve: (v: { id: string; external: boolean } | null) => void; reject: (e: Error) => void }>();

  session.connect('context_response', (_self: SessionInstance, childId: number, json: GLib.Bytes) => {
    const slot = ctxResolveSlots.get(childId);
    if (!slot) return;
    ctxResolveSlots.delete(childId);
    let parsed: { childId: number; id?: string; external?: boolean; error?: string };
    try {
      parsed = JSON.parse(dec(json)) as { childId: number; id?: string; external?: boolean; error?: string };
    } catch (e) {
      slot.reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    if (parsed.error) {
      slot.reject(new Error(parsed.error));
    } else if (parsed.id) {
      slot.resolve({ id: parsed.id, external: parsed.external ?? false });
    } else {
      slot.resolve(null);
    }
  });

  function makeContext(reqId: number): NativePluginContext {
    return {
      resolve(specifier, importer, opts) {
        return new Promise((resolve, reject) => {
          const childId = session.context_resolve(reqId, enc(JSON.stringify({
            specifier,
            importer,
            skipSelf: opts?.skipSelf ?? true,
            isEntry: opts?.isEntry ?? false,
          })));
          if (childId === 0) {
            reject(new Error(`@gjsify/rolldown-native: ctx.resolve('${specifier}') failed — parent req_id ${reqId} unknown`));
            return;
          }
          ctxResolveSlots.set(childId, { resolve, reject });
        });
      },
      warn(message) {
        session.context_warn(enc(message));
      },
      error(message) {
        throw new Error(message);
      },
    };
  }

  session.connect('hook_requested', (_self: SessionInstance, hookName: string, reqId: number, pluginIndex: number, argsBytes: GLib.Bytes) => {
    void dispatchHook(hookName, reqId, pluginIndex, argsBytes);
  });

  async function dispatchHook(hookName: string, reqId: number, pluginIndex: number, argsBytes: GLib.Bytes): Promise<void> {
    let args: HookArgs;
    try {
      args = JSON.parse(dec(argsBytes)) as HookArgs;
    } catch (e) {
      respondError(reqId, e);
      return;
    }
    const plugin = plugins[pluginIndex];
    if (!plugin) {
      respondError(reqId, new Error(`@gjsify/rolldown-native: unknown plugin index ${pluginIndex}`));
      return;
    }
    const ctx = makeContext(reqId);
    try {
      const result = await runHook(plugin, hookName, args, ctx);
      respondOk(reqId, result);
    } catch (e) {
      respondError(reqId, e);
    }
  }

  function respondOk(reqId: number, value: unknown): void {
    const payload = value === undefined || value === null
      ? { kind: 'skip' as const }
      : { kind: 'ok' as const, value };
    session.respond(reqId, enc(JSON.stringify(payload)));
  }

  function respondError(reqId: number, e: unknown): void {
    const err = e instanceof Error ? e : new Error(String(e));
    session.respond(reqId, enc(JSON.stringify({
      kind: 'error',
      message: err.message,
      stack: err.stack,
    })));
  }

  return new Promise<BundleResult>((resolve, reject) => {
    session.connect('completed', (_self: SessionInstance, output: GLib.Bytes) => {
      try {
        resolve(JSON.parse(dec(output)) as BundleResult);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    session.connect('error_occurred', (_self: SessionInstance, msg: string) => {
      reject(new Error(msg));
    });

    try {
      session.start(enc(JSON.stringify({
        options,
        plugins: plugins.map(pluginMeta),
      })));
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

async function runHook(p: NativePlugin, hookName: string, args: HookArgs, ctx: NativePluginContext): Promise<unknown> {
  switch (hookName) {
    case 'load':
      if (!p.load) return null;
      return normalizeLoadResult(await p.load.call(ctx, (args as LoadArgs).id));
    case 'transform': {
      if (!p.transform) return null;
      const a = args as TransformArgs;
      return normalizeTransformResult(await p.transform.call(ctx, a.code, a.id, a.moduleType));
    }
    case 'resolveId': {
      if (!p.resolveId) return null;
      const a = args as ResolveIdArgs;
      return normalizeResolveIdResult(await p.resolveId.call(ctx, a.specifier, a.importer, { isEntry: a.isEntry }));
    }
    case 'renderChunk': {
      if (!p.renderChunk) return null;
      const a = args as RenderChunkArgs;
      return normalizeRenderChunkResult(await p.renderChunk.call(ctx, a.code, { fileName: a.fileName, name: a.name, isEntry: a.isEntry }));
    }
    case 'banner':
    case 'footer':
    case 'intro':
    case 'outro': {
      const handler = p[hookName];
      if (!handler) return null;
      const a = args as AddonArgs;
      return normalizeAddonResult(await handler.call(ctx, { fileName: a.fileName, name: a.name, isEntry: a.isEntry }));
    }
    case 'buildStart':
    case 'buildEnd':
    case 'generateBundle':
    case 'writeBundle':
    case 'closeBundle': {
      const handler = p[hookName];
      if (!handler) return null;
      await handler.call(ctx);
      return null;
    }
    default:
      throw new Error(`@gjsify/rolldown-native: unknown hook '${hookName}'`);
  }
}

function normalizeLoadResult(r: string | { code: string; moduleType?: string } | null | undefined): unknown {
  if (r == null) return null;
  if (typeof r === 'string') return { code: r };
  return { code: r.code, moduleType: r.moduleType };
}

function normalizeTransformResult(r: string | { code: string; moduleType?: string } | null | undefined): unknown {
  if (r == null) return null;
  if (typeof r === 'string') return { code: r };
  return { code: r.code, moduleType: r.moduleType };
}

function normalizeResolveIdResult(r: string | { id: string; external?: boolean } | null | undefined): unknown {
  if (r == null) return null;
  if (typeof r === 'string') return { id: r };
  return { id: r.id, external: r.external };
}

function normalizeRenderChunkResult(r: string | { code: string } | null | undefined): unknown {
  if (r == null) return null;
  if (typeof r === 'string') return { code: r };
  return { code: r.code };
}

function normalizeAddonResult(r: string | { text: string } | null | undefined): unknown {
  if (r == null) return null;
  if (typeof r === 'string') return r;
  return r.text;
}
