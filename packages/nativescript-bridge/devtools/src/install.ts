// @gjsify/devtools-nativescript — the opt-in in-app agent entry point.
//
// Mirrors `@gjsify/devtools/src/install.ts` (the GTK adapter) but targets the
// NativeScript runtime: instead of exporting an `org.gjsify.Devtools` DBus
// object, it attaches `globalThis.__adwDevtools` — a tiny object with an async
// `dispatch(reqJson) => responseJson` method the host MCP bridge reaches via
// the V8 inspector's `Runtime.evaluate`. The dispatch routes every request
// through the SAME `@gjsify/devtools-protocol` MethodRegistry the GTK adapter
// uses, so the wire contract is identical across runtimes.
//
// Env-gated by `GJSIFY_DEVTOOLS` so it is safe to leave in production code.
//
// Original implementation.

import {
    type DevtoolsRequest,
    errResponse,
    type MethodRegistry,
} from '@gjsify/devtools-protocol';
import { assertNativeScript, isNativeScript } from '@gjsify/native-platform';
import { createNativescriptRegistry, type NsDevtoolsContext } from './handlers.js';
import type { NsApplicationLike, NsFrameLike } from './view-tree.js';

/** The agent object attached to `globalThis.__adwDevtools`. */
export interface NsDevtoolsAgent {
    /**
     * Dispatch a JSON-encoded {@link DevtoolsRequest} through the method
     * registry, returning a JSON-encoded `DevtoolsResponse`. Always resolves —
     * a malformed request or a handler failure becomes an error response. This
     * is the single entry point the host bridge evaluates over CDP.
     */
    dispatch(reqJson: string): Promise<string>;
    /** The instance label this agent reports. */
    readonly instance: string;
}

/** Options for {@link installDevtools}. */
export interface InstallNsDevtoolsOptions {
    /** Force-enable regardless of `GJSIFY_DEVTOOLS` (e.g. a dev-only build). */
    enabled?: boolean;
    /** Per-instance label (multi-instance side-by-side). Default: `'default'`. */
    instance?: string;
    /** App id reported by `GetStatus`. Default: `'nativescript'`. */
    appId?: string;
    /** Predicate the pause guard consults; mutating methods reject when true. */
    paused?: () => boolean;
    /**
     * The NS `Application` module (`getRootView()`). Pass it from the app
     * (`import { Application } from '@nativescript/core'`) so this package needs
     * no hard `@nativescript/core` dependency. Falls back to the global
     * `NativeScriptGlobals`/`require` lookup when omitted.
     */
    application?: NsApplicationLike;
    /** The NS `Frame` module (`topmost()?.currentPage`). Same rationale as `application`. */
    frame?: NsFrameLike;
}

/** GC/scope root: keep each installed agent reachable for the app's lifetime. */
const activeAgents = new Set<NsDevtoolsAgent>();

function envEnabled(): boolean {
    // NativeScript exposes process.env via @nativescript/core's polyfill; read
    // defensively so a missing `process` does not throw on a bare runtime.
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    const v = env?.GJSIFY_DEVTOOLS;
    if (v == null) return false;
    const t = String(v).toLowerCase();
    return t !== '' && t !== '0' && t !== 'false';
}

function envInstance(): string | undefined {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    const v = env?.GJSIFY_DEVTOOLS_INSTANCE;
    return v && v !== '' ? v : undefined;
}

/**
 * Build the agent object around a method registry. Exposed for the unit tests
 * (which drive `dispatch` directly against a mock view tree without touching
 * `globalThis`).
 */
export function createAgent(registry: MethodRegistry, ctx: NsDevtoolsContext): NsDevtoolsAgent {
    const instance = ctx.instance ?? 'default';
    return {
        instance,
        async dispatch(reqJson: string): Promise<string> {
            let req: DevtoolsRequest;
            try {
                req = JSON.parse(reqJson) as DevtoolsRequest;
            } catch {
                return JSON.stringify(
                    errResponse({ code: 'invalid-params', message: 'request is not valid JSON' }),
                );
            }
            const response = await registry.dispatch(req, { paused: ctx.paused?.() ?? false });
            return JSON.stringify(response);
        },
    };
}

/**
 * Install the in-app NativeScript devtools agent. A no-op returning `null`
 * unless `GJSIFY_DEVTOOLS` is set (or `options.enabled` is true), so it is safe
 * to leave in production code. Call once from the app's bootstrap (e.g. in
 * `app.ts` after `Application.run({...})` is wired).
 *
 * @example
 * ```ts
 * import { Application, Frame } from '@nativescript/core';
 * import { installDevtools } from '@gjsify/devtools-nativescript';
 * installDevtools({ application: Application, frame: Frame });
 * ```
 */
export function installDevtools(options: InstallNsDevtoolsOptions = {}): NsDevtoolsAgent | null {
    assertNativeScript();
    if (!(options.enabled ?? envEnabled())) return null;

    const ctx: NsDevtoolsContext = {
        instance: options.instance ?? envInstance() ?? 'default',
        appId: options.appId,
        paused: options.paused,
        application: options.application ?? null,
        frame: options.frame ?? null,
    };

    const registry = createNativescriptRegistry(ctx);
    const agent = createAgent(registry, ctx);

    // The host bridge reaches this via CDP `Runtime.evaluate`.
    (globalThis as { __adwDevtools?: NsDevtoolsAgent }).__adwDevtools = agent;
    activeAgents.add(agent);
    return agent;
}

/** Remove a previously-installed agent and release its scope root. */
export function uninstallDevtools(agent: NsDevtoolsAgent): void {
    const g = globalThis as { __adwDevtools?: NsDevtoolsAgent };
    if (g.__adwDevtools === agent) delete g.__adwDevtools;
    activeAgents.delete(agent);
}

/** Whether the current runtime is NativeScript (re-exported convenience). */
export { isNativeScript };
