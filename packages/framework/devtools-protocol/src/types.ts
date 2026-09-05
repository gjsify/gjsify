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
    /**
     * This node HAS children the dump did not walk, because the depth bound
     * stopped it here.
     *
     * Present only when true, so a full dump carries nothing extra. Without it a
     * truncated node and a leaf are byte-identical in the JSON, and a caller that
     * walks the result and finds nothing cannot tell "there is nothing there"
     * from "I stopped looking" (#1553). Measured on a routed application window:
     * a vector counting `AdwHeaderBar` read 0 for a window that plainly drew one,
     * because the header bar sits below the default bound — a confident wrong
     * number rather than an error, which is the expensive half of the pair.
     */
    truncated?: true;
}
