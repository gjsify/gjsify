// @gjsify/devtools-nativescript — wire the generic devtools method handlers to
// the NativeScript runtime. Mirrors the GTK `@gjsify/devtools` DevtoolsService
// method bodies but resolves the live root view per call (so it survives page
// navigation) and reuses the `@gjsify/devtools-protocol` MethodRegistry verbatim.
//
// `@nativescript/core` is an OPTIONAL peer — it is reached lazily + structurally
// so this module type-checks + unit-tests off-device. On-device the install
// entry point passes the real `Application` / `Frame` surfaces in.
//
// Original implementation.

import {
    DevtoolsError,
    GENERIC_METHODS,
    type MethodKind,
    MethodRegistry,
    type DevtoolsStatus,
} from '@gjsify/devtools-protocol';
import { captureViewPng } from './screenshot.js';
import {
    buildViewPath,
    dumpTree,
    listToplevels,
    type NsApplicationLike,
    type NsFrameLike,
    type NsView,
    readViewProperty,
    resolveViewPath,
    rootView,
    viewType,
} from './view-tree.js';

/**
 * The `Screenshot` result shape for the NativeScript transport. The GTK adapter
 * returns raw PNG `ay` bytes over DBus; the NS agent travels over the V8 CDP
 * `Runtime.evaluate` JSON channel where a `Uint8Array` cannot survive
 * `returnByValue`, so the PNG is base64-encoded here and the host profile
 * decodes it. `format` documents the encoding so the host need not guess.
 */
export interface ScreenshotResult {
    format: 'png-base64';
    /** base64-encoded PNG, or `null` when the root view is not laid out yet. */
    data: string | null;
}

/**
 * One app-specific devtools method an extension contributes — a name, a pause
 * classification, and a handler over the registry's named-`params` record (the
 * NS transport sends `{ method, params }`, so the extension maps the params it
 * needs; e.g. the storybook adapter reads `params.title` / `params.name`).
 */
export interface NsDevtoolsMethod {
    /** Method name (unique across the registry). */
    name: string;
    /** Pause classification (`'mutating'` methods reject while paused). */
    kind: MethodKind;
    /** Implementation — receives the request's params, returns the result value. */
    handler: (params: Record<string, unknown>) => unknown | Promise<unknown>;
}

/**
 * An app-specific devtools surface merged into the registry (e.g. the storybook
 * `ListStories`/`OpenStory`/… methods from
 * `buildStorybookDevtoolsExtension(controller)`). Structurally compatible with
 * `@gjsify/storybook-core`'s `StorybookDevtoolsExtension`.
 */
export interface NsDevtoolsExtension {
    /** Extra methods registered alongside the generic ones. */
    methods: NsDevtoolsMethod[];
    /** Extra keys merged into `GetStatus()`. */
    contributeStatus?: () => Record<string, unknown>;
}

/** Wiring inputs — the live NS application + frame surfaces (duck-typed). */
export interface NsDevtoolsContext {
    /** A label for this devtools instance (multi-instance side-by-side). */
    readonly instance?: string;
    /** The NS `Application` module (for `getRootView()`). */
    readonly application: NsApplicationLike | null;
    /** The NS `Frame` module (for `topmost()?.currentPage` fallback). */
    readonly frame: NsFrameLike | null;
    /** Predicate the pause guard consults; mutating methods reject when true. */
    readonly paused?: () => boolean;
    /** App id reported by `GetStatus` (defaults to the NS bundle id when known). */
    readonly appId?: string;
    /**
     * App-specific devtools surfaces merged into the registry — extra methods +
     * `GetStatus` keys (e.g. the storybook control surface). Backward-compatible:
     * omitted by the spike showcase install.
     */
    readonly extensions?: readonly NsDevtoolsExtension[];
}

function rootOf(ctx: NsDevtoolsContext): NsView | null {
    return rootView(ctx.application, ctx.frame);
}

function requireRoot(ctx: NsDevtoolsContext): NsView {
    const root = rootOf(ctx);
    if (!root) throw new DevtoolsError('unavailable', 'no root view — the NativeScript app is not bootstrapped yet');
    return root;
}

/** Resolve a `root` param ('' / 'window' / 'active' → root view; else a path). */
function resolveRoot(ctx: NsDevtoolsContext, root: string): { view: NsView; path: string } {
    const live = requireRoot(ctx);
    if (!root || root === 'window' || root === 'active' || root === 'toplevel:0') {
        return { view: live, path: 'toplevel:0' };
    }
    const view = resolveViewPath(live, root);
    if (!view) throw new DevtoolsError('not-found', `no view at '${root}'`);
    return { view, path: root };
}

/**
 * Build a {@link MethodRegistry} populated with the generic devtools handlers
 * bound to the NativeScript runtime. The mutating-method pause policy is
 * enforced by the registry's dispatcher (`paused` option) — the same policy the
 * GTK adapter applies — so no per-handler guard is needed here.
 */
export function createNativescriptRegistry(ctx: NsDevtoolsContext): MethodRegistry {
    const registry = new MethodRegistry();
    const kind = (name: keyof typeof GENERIC_METHODS): MethodKind => GENERIC_METHODS[name];

    registry.register({
        name: 'GetStatus',
        kind: kind('GetStatus'),
        handler: () => {
            const root = rootOf(ctx);
            const status: DevtoolsStatus = {
                appId: ctx.appId ?? 'nativescript',
                instance: ctx.instance ?? 'default',
                platform: 'nativescript',
                devtools: true,
                activeWindow: root ? { id: 'root', title: viewType(root), mapped: root.isLoaded ?? true } : null,
                toplevelCount: root ? 1 : 0,
                focusedWidget: null,
                paused: ctx.paused?.() ?? false,
            };
            // Extensions (e.g. the storybook surface) merge extra status keys.
            for (const ext of ctx.extensions ?? []) {
                const extra = ext.contributeStatus?.();
                if (extra) Object.assign(status, extra);
            }
            return status;
        },
    });

    registry.register({
        name: 'Screenshot',
        kind: kind('Screenshot'),
        handler: (): ScreenshotResult => {
            const root = rootOf(ctx);
            return { format: 'png-base64', data: root ? captureViewPng(root) : null };
        },
    });

    registry.register({
        name: 'ListToplevels',
        kind: kind('ListToplevels'),
        handler: () => listToplevels(rootOf(ctx)),
    });

    registry.register({
        name: 'DumpTree',
        kind: kind('DumpTree'),
        handler: (params) => {
            const root = typeof params.root === 'string' ? params.root : '';
            const depth = typeof params.depth === 'number' && params.depth > 0 ? params.depth : 8;
            const resolved = resolveRoot(ctx, root);
            return dumpTree(resolved.view, depth, resolved.path);
        },
    });

    registry.register({
        name: 'GetProperty',
        kind: kind('GetProperty'),
        handler: (params) => {
            const path = typeof params.path === 'string' ? params.path : '';
            const prop = typeof params.prop === 'string' ? params.prop : '';
            if (!prop) throw new DevtoolsError('invalid-params', 'GetProperty requires a `prop` name');
            const resolved = resolveRoot(ctx, path);
            const value = readViewProperty(resolved.view, prop);
            if (value === undefined) throw new DevtoolsError('not-found', `view has no property '${prop}'`);
            return value;
        },
    });

    // --- Mutating: ActivateAction (best-effort tap) ---
    // NativeScript has no GAction model; the closest analogue is firing a view's
    // `tap` gesture. Registered so the pause policy classifies it correctly; the
    // dispatcher rejects it while paused. A no-target call is a typed failure.
    registry.register({
        name: 'ActivateAction',
        kind: kind('ActivateAction'),
        handler: (params) => {
            const path = typeof params.path === 'string' ? params.path : (typeof params.name === 'string' ? params.name : '');
            const resolved = resolveRoot(ctx, path);
            const view = resolved.view as NsView & { notify?: (e: { eventName: string; object: NsView }) => void };
            if (typeof view.notify !== 'function') {
                throw new DevtoolsError('unsupported', `view at '${resolved.path}' cannot receive a tap`);
            }
            view.notify({ eventName: 'tap', object: view });
            return { tapped: resolved.path };
        },
    });

    // --- App-specific extension methods (e.g. the storybook control surface). ---
    for (const ext of ctx.extensions ?? []) {
        for (const method of ext.methods) {
            registry.register({
                name: method.name,
                kind: method.kind,
                handler: (params) => method.handler(params),
            });
        }
    }

    return registry;
}

/** Build the stable path of a child index list (re-exported for callers/tests). */
export { buildViewPath };
