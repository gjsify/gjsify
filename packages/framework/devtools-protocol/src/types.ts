// @gjsify/devtools-protocol — shared result shapes (status, actions, introspection nodes).
// Original implementation.

/** Snapshot returned by `GetStatus`. Extensions merge extra keys in. */
export interface DevtoolsStatus {
    appId: string;
    instance: string;
    activeWindow: { id: string; title: string; mapped: boolean } | null;
    toplevelCount: number;
    focusedWidget: string | null;
    /** Whether external (AI/automation) control is paused by the host. */
    paused: boolean;
    /** Extension-contributed keys. */
    [key: string]: unknown;
}

/** One GAction (GTK) or named command (web) descriptor. */
export interface ActionDescriptor {
    name: string;
    enabled: boolean;
    parameterType: string | null;
    stateType: string | null;
    state?: unknown;
}

/**
 * Result of `ListActions`. `app`/`win` mirrors GTK's two action scopes; web
 * adapters list global commands under `app` and leave `win` empty.
 */
export interface ActionList {
    app: ActionDescriptor[];
    win: ActionDescriptor[];
}

/**
 * A node in an introspection tree — a GTK widget or a DOM element. The
 * shape is shared so the same MCP tools render both runtimes.
 */
export interface NodeInfo {
    /** Stable path from a toplevel, e.g. "toplevel:0/child:2/child:0". */
    path: string;
    /** GType name (GTK) or tagName (DOM). */
    type: string;
    /** gtk widget name / DOM id, if any. */
    name: string | null;
    cssClasses: string[];
    mapped: boolean;
    visible: boolean;
    /** Shallow scalar properties, when requested. */
    props?: Record<string, unknown>;
    children: NodeInfo[];
}
