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
 * What a widget WAS GIVEN beside what it ASKED FOR — the pair that says whether a
 * layout is right, and the one an introspection tree could not previously answer.
 *
 * `mapped` says a widget is on screen and a property read says its properties are what
 * the code set; neither distinguishes a label allocated the width it asked for from one
 * allocated less and now showing two thirds of its text. The workaround was to
 * rasterise the widget through `Screenshot(<path>)` and read the PNG header, which is
 * three round trips per widget and answers only the allocation — never the request, so
 * it says THAT a widget is the wrong size and never whose arithmetic made it so.
 *
 * The measured case: a `Gtk.Label` in a `flex-row` masthead came out 170x23 at every
 * window width from 700 to 1400, while one line of its text needs 206. Everything
 * readable about it was correct — `wrap: true`, `max-width-chars: -1`, `hexpand: false`
 * — and the defect is entirely in the two numbers that were not readable.
 *
 * NO POSITION. `width`/`height` come off `get_width()`/`get_height()`; x/y would need
 * `compute_bounds()` and a `Graphene.Rect` across the bridge, and the question this
 * exists for is answered without it. `Screenshot(<path>)` already says where a widget
 * is by showing it.
 */
export interface NodeGeometry {
    /**
     * Allocation in logical pixels, in the MARGIN box — content plus CSS padding, border
     * and margin.
     *
     * That box and not another one because it is the box a size request speaks, so these
     * two numbers and the two below are comparable. GTK has three: `get_width()` answers
     * the content box, `compute_bounds()` the border box, and `measure()` the margin box,
     * and mixing them is not a rounding error. Measured on GTK 4.22.4, a `Gtk.Label` with
     * `padding: 3px 5px` over a 68x17 content box asks 78x23; asked for its height at 68
     * — its content width read as a margin-box width — it answers 40, because 58 is left
     * for text that then wraps.
     */
    width: number;
    height: number;
    /** [minimum, natural] width, measured with no height given. */
    widthRequest: [number, number];
    /**
     * [minimum, natural] height, measured AT THE ALLOCATED WIDTH.
     *
     * At the allocated width and not at `-1`, because that is the whole question. A
     * wrapping label asked for its height at its natural width answers one line; asked
     * at the width it actually got, it answers two. A parent that measured the first
     * and allocated the second is exactly the bug, and the two numbers differ only when
     * it happened.
     */
    heightRequest: [number, number];
    /**
     * The allocation is below the minimum the widget asked for, so it is CLIPPED.
     *
     * Present only when true, like {@link NodeInfo.truncated}: a caller sweeping a tree
     * for this key finds the defective widgets without a hypothesis about which one to
     * suspect, which is the difference between an instrument and a readout.
     */
    short?: true;
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
    /**
     * Allocation and size request. Present for a MAPPED widget only — an unmapped one
     * has no allocation, and measuring it reports what it would ask for in a place it
     * is not, which is a number that reads like an answer and is not one.
     */
    geometry?: NodeGeometry;
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
