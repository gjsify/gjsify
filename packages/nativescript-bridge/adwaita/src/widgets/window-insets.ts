// Which slot of a toolbar view absorbs which system-bar inset.
//
// WHY THIS IS A PURE MODULE. Android draws edge-to-edge from API 35 on, and the
// APIs that used to colour the bars instead are deprecated and disabled there
// (`statusBarColor`, `setDecorFitsSystemWindows`, …), so the only route is to apply
// window insets as padding. The decision — which of the three slots pays for the
// top inset, and which for the bottom — is arithmetic over four booleans, and the
// widget that consumes it (`AdwToolbarView extends GridLayout`) cannot be imported
// off-device. Keeping the decision here is what lets a Linux runner check it.
//
// The rule follows what a bar IS: chrome pinned to an edge. Whatever sits at an edge
// owns that edge's inset, because it is the thing the status bar or the gesture area
// would otherwise cover:
//
//   - a top bar exists      → the TOP BAR takes the top inset
//   - none                  → the CONTENT takes it, or it sits under the clock
//   - mirrored at the bottom for the navigation / gesture inset
//
// `extend-content-to-*-edge` does NOT move the inset. That flag means "the content
// spans the full height and the bar is drawn OVER it" — the bar is still the thing at
// the edge, so it still pays, and the content going under the bar is the point of the
// flag. Moving the inset to the content there would push the content down and undo it.
//
// Left/right insets are carried but unassigned: they are non-zero only in landscape
// with a cutout or a side gesture area, and NS's `padding` on a GridLayout row box
// would apply them to the bar box rather than to the window. Recorded rather than
// silently dropped, so the next reader knows it was considered.

/** The four window insets, in device-independent pixels. */
export interface WindowInsets {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
    /**
     * The on-screen keyboard's height, when it is up (the field is absent while it is not). The
     * Android host that stays clear of the gesture area on its own needs it to tell the two
     * cases apart: only the page's own padding also moves the window up for the keyboard.
     */
    readonly ime?: number;
}

/** What the toolbar view looks like, as far as inset assignment cares. */
export interface ToolbarViewShape {
    readonly hasTopBar: boolean;
    readonly hasBottomBar: boolean;
    /**
     * Whether the bottom bar is on screen. A bar that exists but is collapsed (a view switcher
     * bar on a wide window) still owns the bottom edge, so the content does not take its
     * inset: it runs under the gesture area, and whatever must not sit there pads itself
     * ({@link padWithInset}) — the keyboard excepted, see {@link toolbarViewInsetPadding}.
     * Defaults to `true`.
     */
    readonly bottomBarShown?: boolean;
}

/** Extra padding each slot must add on top of whatever the theme gives it. */
export interface InsetPadding {
    readonly topBarTop: number;
    readonly contentTop: number;
    readonly bottomBarBottom: number;
    readonly contentBottom: number;
}

export const NO_INSETS: WindowInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * The edges a HOST layout already pays, so the widget must not pay them again.
 *
 * Declared here rather than beside the platform files that answer it, so this module
 * stays the one place the inset arithmetic lives and keeps importing nothing.
 */
export interface HostPaidEdges {
    readonly top: boolean;
    readonly bottom: boolean;
}

/** Nothing above the widget pays anything — it owes every edge. */
export const NO_HOST_PAYMENT: HostPaidEdges = { top: false, bottom: false };

/**
 * Drop the edges a host layout already paid, leaving what the widget still owes.
 *
 * Separate from {@link toolbarViewInsetPadding} because it answers a different question:
 * that one splits an owed inset between the slots of ONE widget, this one decides
 * whether the inset is owed at all. Which edges a host pays is a per-platform fact
 * (`host-insets.{android,ios}.ts`); how much of it lands on which slot is not.
 *
 * Left and right pass through: no host in this tree pays them, and dropping an edge
 * nobody paid is how an inset silently goes missing.
 */
export function insetsOwedBy(insets: WindowInsets, paidByHost: HostPaidEdges): WindowInsets {
    return {
        top: paidByHost.top ? 0 : insets.top,
        bottom: paidByHost.bottom ? 0 : insets.bottom,
        left: insets.left,
        right: insets.right,
    };
}

/**
 * Assign `insets` to the slots of a toolbar view of `shape`.
 *
 * Total per edge is always exactly the inset — never doubled across two slots, which
 * would leave a visible gap the width of the status bar, and never dropped.
 *
 * THE KEYBOARD IS NOT AN EDGE TO DRAW UNDER, and that is the one case where a collapsed
 * bottom bar does not keep the edge. Running under the gesture area is the point of
 * edge-to-edge; running under the keyboard means the field being typed into is hidden.
 * So while `ime` is up the payer is whoever is actually ON the edge — a shown bar, else
 * the content — and never a slot with nothing in it.
 *
 * MEASURED, and the reason this rule exists: with the keyboard up over a wide Learn6502
 * window, whose view switcher bar is collapsed, the EMPTY bar slot was handed the whole
 * 368 dip of keyboard. An empty slot paints the page background, so the app sat on a band
 * of it; and because nothing re-reads a payment a shown bar never made, the band outlived
 * the keyboard — 32 dip of page background under the editor, the sheet and the columns,
 * with the quick help clipped above it.
 */
export function toolbarViewInsetPadding(insets: WindowInsets, shape: ToolbarViewShape): InsetPadding {
    // `withKeyboard` has already folded the keyboard into `bottom`; `ime` says whether it did.
    const keyboardUp = (insets.ime ?? 0) > 0;
    const barOnEdge = shape.hasBottomBar && shape.bottomBarShown !== false;
    return {
        topBarTop: shape.hasTopBar ? insets.top : 0,
        contentTop: shape.hasTopBar ? 0 : insets.top,
        bottomBarBottom: barOnEdge ? insets.bottom : 0,
        contentBottom: barOnEdge || (shape.hasBottomBar && !keyboardUp) ? 0 : insets.bottom,
    };
}

/**
 * The insets with the keyboard folded into the bottom edge — `max(systemBars, ime)`, which is
 * what the page's own padding paid before the app drew behind the gesture area.
 */
export function withKeyboard(insets: WindowInsets): WindowInsets {
    const ime = insets.ime ?? 0;
    return ime > insets.bottom ? { ...insets, bottom: ime } : insets;
}

/**
 * A widget's own padding plus the inset it must clear.
 *
 * The base is read once off the view, and can be anything a native read hands back — a
 * missing value must not turn a `padding` write into `NaN`, which NativeScript renders as
 * zero padding and no error.
 */
export function padWithInset(base: number | undefined, inset: number): number {
    const own = typeof base === 'number' && Number.isFinite(base) && base > 0 ? base : 0;
    return own + (Number.isFinite(inset) && inset > 0 ? inset : 0);
}

/**
 * Read the four values off whatever the platform handed over, clamping to ≥ 0.
 *
 * Defensive because the source is a native object across the NS bridge: a missing
 * field arrives as `undefined` and would poison a `padding` assignment with `NaN`,
 * which NS renders as zero padding on one edge and no error anywhere.
 */
export function normaliseInsets(raw: Partial<WindowInsets> | null | undefined): WindowInsets {
    const at = (value: number | undefined): number =>
        typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
    const ime = at(raw?.ime);
    return {
        top: at(raw?.top),
        bottom: at(raw?.bottom),
        left: at(raw?.left),
        right: at(raw?.right),
        ...(ime > 0 ? { ime } : {}),
    };
}

/** Notified whenever the window's insets change. */
export type WindowInsetsListener = (insets: WindowInsets) => void;

/**
 * One inset reading, many widgets.
 *
 * The platform hands insets to ONE listener — `setOnApplyWindowInsetsListener`
 * REPLACES whatever was there — while an app has as many toolbar views as it has
 * panes (the storybook has two, sidebar and content). So the native listener is
 * installed once and this fans the reading out.
 *
 * Two behaviours are load-bearing and both are checked from a Linux runner:
 *
 *   - a subscriber gets the LAST reading immediately. Insets are dispatched once,
 *     early; a pane built afterwards would otherwise sit un-inset until the next
 *     rotation, which is the shape of bug that looks like "sometimes it works".
 *   - an unchanged reading is dropped. Android re-dispatches insets on every
 *     layout pass, and a `padding` write schedules another layout pass.
 */
export class WindowInsetsBroadcast {
    private readonly _listeners = new Set<WindowInsetsListener>();
    private _last: WindowInsets = NO_INSETS;

    /** The most recent reading — {@link NO_INSETS} until the platform reports one. */
    get last(): WindowInsets {
        return this._last;
    }

    /** Subscribe, receiving {@link last} at once. Returns the unsubscribe. */
    subscribe(listener: WindowInsetsListener): () => void {
        this._listeners.add(listener);
        listener(this._last);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /** Publish a platform reading. Normalised first; a no-change is not published. */
    publish(raw: Partial<WindowInsets> | null | undefined): boolean {
        const next = normaliseInsets(raw);
        if (
            next.top === this._last.top &&
            next.bottom === this._last.bottom &&
            next.left === this._last.left &&
            next.right === this._last.right &&
            next.ime === this._last.ime
        ) {
            return false;
        }
        this._last = next;
        // COPIED, and the reason is narrower than "mutation during iteration": a Set
        // iterator is live, so deleting an entry mid-dispatch is already safe. What is
        // not safe is ADDING one — `subscribe()` replays the last reading immediately,
        // and a live iterator would then reach that same listener again in this very
        // dispatch. It would be called twice with one reading, and the second call
        // writes padding, which schedules the layout pass `publish`'s dedupe exists to
        // avoid. A toolbar view built from another view's inset handler does exactly
        // this. Pinned by the "a listener subscribed during a dispatch" test.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy is the invariant, not a style choice
        for (const listener of [...this._listeners]) listener(next);
        return true;
    }
}
