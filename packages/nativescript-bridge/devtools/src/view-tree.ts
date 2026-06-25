// @gjsify/devtools-nativescript — NativeScript view-tree introspection
// (toplevels, tree dump, stable index paths, property read). Mirrors the GTK
// `@gjsify/devtools/src/widget-tree.ts` shape but walks the NativeScript View
// hierarchy via `view.eachChildView()` and the topmost page.
//
// Original implementation. Pure-TS: the NativeScript runtime globals are
// reached through a structural `NsView` interface (a duck-typed subset of
// `@nativescript/core` `View`) rather than a value import of `@nativescript/core`,
// so this module type-checks and unit-tests off-device (GJS + Node) against a
// mock view.

import type { NodeInfo } from '@gjsify/devtools-protocol';

/**
 * The structural subset of a NativeScript `View` the introspection needs. Kept
 * minimal + duck-typed so the walker works against a real `@nativescript/core`
 * View on-device AND a plain mock object in the unit tests. Every member is
 * optional because custom views and layout containers expose different subsets.
 */
export interface NsView {
    /** Registered component type name, e.g. `"StackLayout"`, `"Button"`. */
    readonly typeName?: string;
    /** NS automation id (the closest analogue to a DOM id / gtk widget name). */
    automationText?: string;
    id?: string;
    /** Text-bearing views (Label / Button / TextField) expose `text`. */
    text?: string;
    /** CSS classes applied to the view. */
    cssClasses?: Set<string> | string[];
    className?: string;
    /** Visibility — NS uses the `'visible' | 'collapse' | 'hidden'` enum. */
    visibility?: string;
    /** Whether the view is currently attached + laid out. */
    isLoaded?: boolean;
    getMeasuredWidth?(): number;
    getMeasuredHeight?(): number;
    /** Iterate the direct child views; the callback returns false to stop. */
    eachChildView?(callback: (child: NsView) => boolean): void;
    /** Index signature so {@link readViewProperty} can read arbitrary props. */
    [key: string]: unknown;
}

/**
 * The NS application surface used to find the root view (duck-typed).
 * `getRootView()` is typed as returning `unknown` (not `NsView`) so the real
 * `@nativescript/core` `Application` — whose `getRootView(): View` lacks the
 * internal `NsView` index signature — is assignable without a cast at the call
 * site. {@link rootView} narrows the result to `NsView` for the walk.
 */
export interface NsApplicationLike {
    getRootView?(): unknown;
}

/**
 * The NS `Frame.topmost()` surface used to find the current page (duck-typed).
 * `currentPage` is `unknown` for the same reason as {@link NsApplicationLike} —
 * so the real `@nativescript/core` `Frame` module is assignable without a cast.
 */
export interface NsFrameLike {
    topmost?(): { currentPage?: unknown } | null | undefined;
}

/** A parsed view path: a toplevel index + a chain of child indices. */
export interface ParsedViewPath {
    toplevel: number;
    children: number[];
}

/**
 * Parse a stable view path like `toplevel:0/child:2/child:0` into its indices.
 * Pure (no NS) so it is unit-testable on Node + GJS. Returns null for a
 * malformed path. Byte-identical grammar to the GTK widget-tree paths so the
 * same MCP `dump_tree` / `get_property` tooling addresses both runtimes.
 */
export function parseViewPath(path: string): ParsedViewPath | null {
    const parts = path.split('/').filter((p) => p.length > 0);
    if (parts.length === 0) return null;
    const head = parts[0].match(/^toplevel:(\d+)$/);
    if (!head) return null;
    const children: number[] = [];
    for (const part of parts.slice(1)) {
        const m = part.match(/^child:(\d+)$/);
        if (!m) return null;
        children.push(Number(m[1]));
    }
    return { toplevel: Number(head[1]), children };
}

/** Build a view path from a toplevel index + child-index chain. */
export function buildViewPath(toplevel: number, children: readonly number[]): string {
    return [`toplevel:${toplevel}`, ...children.map((i) => `child:${i}`)].join('/');
}

/** Best-effort registered type name of a NativeScript view. */
export function viewType(view: NsView): string {
    if (typeof view.typeName === 'string' && view.typeName) return view.typeName;
    const ctor = (view as { constructor?: { name?: string } }).constructor;
    return ctor?.name ?? 'View';
}

/** The NS automation id / element id of a view, if any. */
function viewName(view: NsView): string | null {
    return view.automationText || view.id || null;
}

/** Normalise NS `cssClasses` (`Set<string>` on-device) to a plain string array. */
function viewCssClasses(view: NsView): string[] {
    const raw = view.cssClasses;
    if (raw instanceof Set) return [...raw];
    if (Array.isArray(raw)) return [...raw];
    if (typeof view.className === 'string' && view.className) return view.className.split(/\s+/).filter(Boolean);
    return [];
}

/** Whether the view is currently rendered (NS `visibility !== 'collapse'/'hidden'`). */
function viewVisible(view: NsView): boolean {
    if (typeof view.visibility === 'string') return view.visibility === 'visible';
    return true;
}

/** Collect the direct child views of a NS view via `eachChildView()`. */
function childViews(view: NsView): NsView[] {
    const out: NsView[] = [];
    if (typeof view.eachChildView === 'function') {
        view.eachChildView((child) => {
            out.push(child);
            return true; // keep iterating
        });
    }
    return out;
}

/** Text content of a text-bearing view (Label/Button/TextField), if any. */
function viewText(view: NsView): string | null {
    return typeof view.text === 'string' && view.text !== '' ? view.text : null;
}

/**
 * Resolve the topmost root view of the running NS app. Prefers
 * `Application.getRootView()`; falls back to `Frame.topmost()?.currentPage`.
 * Returns null when neither is available (app not yet bootstrapped).
 */
export function rootView(app: NsApplicationLike | null, frame: NsFrameLike | null): NsView | null {
    const fromApp = app?.getRootView?.() as NsView | null | undefined;
    if (fromApp) return fromApp;
    const page = frame?.topmost?.()?.currentPage as NsView | null | undefined;
    return page ?? null;
}

/**
 * Enumerate live "toplevels". NativeScript has a single window with one root
 * view, so this returns a one-element list (`toplevel:0`) describing the root —
 * matching the GTK adapter's `ListToplevels` shape so the same MCP tool renders
 * both runtimes.
 */
export function listToplevels(root: NsView | null): Array<{ path: string; type: string; title: string | null; mapped: boolean; focused: boolean }> {
    if (!root) return [];
    return [
        {
            path: 'toplevel:0',
            type: viewType(root),
            title: viewText(root),
            mapped: root.isLoaded ?? true,
            focused: true,
        },
    ];
}

/** Resolve a view path to its live view, or null if it no longer exists. */
export function resolveViewPath(root: NsView | null, path: string): NsView | null {
    const parsed = parseViewPath(path);
    if (!parsed || parsed.toplevel !== 0 || !root) return null;
    let node: NsView | null = root;
    for (const idx of parsed.children) {
        const kids = childViews(node);
        node = kids[idx] ?? null;
        if (!node) return null;
    }
    return node;
}

/** Dump a view subtree to {@link NodeInfo}, bounded by `maxDepth`. */
export function dumpTree(root: NsView, maxDepth: number, basePath: string): NodeInfo {
    const text = viewText(root);
    const node: NodeInfo = {
        path: basePath,
        type: viewType(root),
        name: viewName(root),
        cssClasses: viewCssClasses(root),
        mapped: root.isLoaded ?? true,
        visible: viewVisible(root),
        children: [],
    };
    if (text !== null) {
        node.props = { text };
    }
    if (maxDepth <= 0) return node;
    const kids = childViews(root);
    for (let i = 0; i < kids.length; i++) {
        node.children.push(dumpTree(kids[i], maxDepth - 1, `${basePath}/child:${i}`));
    }
    return node;
}

/** Coerce a marshalled value to a JSON-safe representation. */
function jsonSafe(value: unknown): unknown {
    const t = typeof value;
    if (value === null || value === undefined || t === 'string' || t === 'number' || t === 'boolean') {
        return value ?? null;
    }
    return `[${t}]`;
}

/**
 * Read a view property by name, trying the original, snake_case and camelCase
 * forms NativeScript exposes (NS uses camelCase JS properties). Returns a
 * JSON-safe value (non-scalars become a `[type]` marker), or `undefined` when
 * the property is absent.
 */
export function readViewProperty(view: NsView, prop: string): unknown {
    const obj = view as Record<string, unknown>;
    const snake = prop.replace(/-/g, '_');
    const camel = prop.replace(/[-_]([a-z])/g, (_, c: string) => c.toUpperCase());
    for (const key of [prop, snake, camel]) {
        if (key in obj) return jsonSafe(obj[key]);
    }
    return undefined;
}
