// AdwBottomSheet — a Libadwaita-style bottom sheet for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` overlaying a content layer (row-spanned)
// with a bottom-anchored sheet panel that is shown/hidden. Mirrors
// `Adw.BottomSheet`: `set_content()` (the always-visible body), `set_sheet()` (the
// panel that slides up), `open`, `can-close` and the `close-attempt` signal.
//
// The open state and the dismissal gate are NOT implemented here: they live in
// `@gjsify/adwaita-core` (`BottomSheetPresentation` + `resolveBottomSheetClose`,
// ADR 0004), ported from the C source and shared with `@gjsify/adwaita-web`. The
// NS half is `widgets/bottom-sheet-state.ts`, which is where the spec drives it
// from — this module cannot be imported off-device (`extends GridLayout`).
//
// `requestClose(source)` is the INTERACTIVE entry point, so a host can route the
// Android back button or an in-sheet close button through the same gate the browser
// port uses; writing `open` is the PROGRAMMATIC path and deliberately ignores
// `can-close`, as upstream says outright. The drag handle does NOT close on tap:
// libadwaita builds it `can_focus = FALSE`, `can_target = FALSE`, a decorative pill
// whose only behavioural role is `allow_mouse_drag = show_drag_handle || bottom_bar`.
//
// THE BOTTOM BAR IS THE WAY IN. `set_bottom_bar()` gives the sheet the collapsed form it
// morphs out of, and a tap on it is the ONLY affordance libadwaita offers a user for
// opening a sheet (`bottom_bar_released_cb`, adw-bottom-sheet.c:263-284). Without one, a
// sheet can be opened by its host and by nobody on the device — which is what this port
// shipped, and what left easy6502's quick help unreachable on Android while its GNOME
// original (whose `editor.blp` declares `bottom-bar` and writes `open` nowhere) worked.
//
// MODAL IS THE DEFAULT, AS UPSTREAM. A modal sheet lays libadwaita's `dimming` layer over
// the content while it is open: a view painted between the content and the panel, so a tap
// on the dimmed area reaches the scrim — which routes it through the dismissal gate as the
// `'dimming'` source — and never the content the sheet blocks. When the scrim is on screen
// is `@gjsify/adwaita-core`'s answer (`BottomSheetChrome.dimmed`), the same one the web
// sheet paints.
//
// FIDELITY: compromised on the slide. This CSS subset has no z-index, box-shadow or
// translate transition, so the sheet is bottom-aligned in the grid and toggled by
// `visibility`: instant show/hide, no upward slide, and the scrim appears at full strength
// rather than fading in with the sheet's progress. The look and the state machine are
// faithful; an app wanting the slide wraps the `open` write in `view.animate({ translate })`.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-bottom-sheet`.
// Reference: refs/libadwaita/src/adw-bottom-sheet.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_bottom-sheet.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { View } from '@nativescript/core';
import { GridLayout, ItemSpec, Label, ScrollView, StackLayout } from '@nativescript/core';
import type { TouchGestureEventData } from '@nativescript/core';
import type {
    BottomSheetCloseOutcome,
    BottomSheetCloseSource,
    BottomSheetOpenOutcome,
    BottomSheetOpenSource,
} from '@gjsify/adwaita-core';

import {
    BOTTOM_BAR_CLASS,
    CLOSE_ATTEMPT,
    DIMMING_CLASS,
    NOTIFY_OPEN,
    SHEET_CLOSE,
    addMarkerClass,
    applyBottomSheetChrome,
    createBottomSheetPresentation,
    removeMarkerClass,
    requestBottomSheetClose,
    type BottomSheetPanes,
    type NotifyOpenEventData,
} from './bottom-sheet-state.js';
import { bottomSheetInsetPadding } from './bottom-sheet-insets.js';
import {
    GRIP_HEIGHT,
    NestedDragTracker,
    type DragSample,
    type SheetRest,
    dragOffset,
    dragProgress,
    releaseVelocity,
    settle,
    sheetHeight,
    sheetTravel,
} from './bottom-sheet-drag.js';
import { builderSlotsOf, resolveBuilderSlot } from './builder-slots.js';
import { xmlBoolean } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { attachRowPressFeedback } from './row-press.js';
import { withSignals } from './signals.js';

export { CLOSE_ATTEMPT, NOTIFY_OPEN, SHEET_CLOSE };

const PANELS = new WeakMap<AdwBottomSheet, View>();

/**
 * The bin that holds a sheet's bottom bar AND its sheet page: the one view that sits on the
 * screen edge whether the sheet is closed or open, so it is what pads for the gesture area
 * (`padForSystemInsets`). Not a property of the widget because `Adw.BottomSheet` has none.
 */
export function bottomSheetPanel(sheet: AdwBottomSheet): View {
    const panel = PANELS.get(sheet);
    if (!panel) throw new Error('bottomSheetPanel: not an AdwBottomSheet');
    return panel;
}
export type { NotifyOpenEventData };

/** A drag in progress: where it began and what it has to move. */
interface SheetDrag {
    readonly start: SheetRest;
    readonly height: number;
    readonly travel: number;
    readonly samples: DragSample[];
    offset: number;
}

/** The `'pan'` gesture's payload: the distance since the finger went down, in DIPs. */
interface PanGestureEventData {
    readonly state: number;
    readonly deltaX: number;
    readonly deltaY: number;
}

/** GestureStateTypes: `began`, `changed`, `ended`, with `cancelled` as 0. */
const PAN_BEGAN = 1;
const PAN_CHANGED = 2;
/** How long the sheet takes to settle after a release, ms. */
const SETTLE_DURATION = 180;

/** Marker class applied to the view handed to {@link AdwBottomSheet.set_content}. */
const CONTENT_CLASS = 'adw-bottom-sheet-content';
/** Marker class applied to the view handed to {@link AdwBottomSheet.set_sheet}. */
const SHEET_CLASS = 'adw-bottom-sheet-sheet';

/** The layers an XML child of a bottom sheet can ask for, the bottom bar under both its spellings. */
const BOTTOM_SHEET_SLOTS = ['sheet', 'bottomBar', 'bottom-bar', 'content'] as const;

export class AdwBottomSheet extends withSignals(GridLayout) {
    /** The names this widget's `_addChildFromBuilder` honours — see `./builder-slots.ts`. */
    static readonly builderSlots: readonly string[] = builderSlotsOf(BOTTOM_SHEET_SLOTS, 'content');

    /** The always-visible content layer. */
    private _content: View | null = null;
    /** The scrim over the content while a modal sheet is open — libadwaita's `dimming`. */
    private readonly _dimming: GridLayout;
    /** The bottom-anchored bin holding both layers — libadwaita's `sheet_bin`. */
    protected readonly _sheetPanel: StackLayout;
    /** The sheet page inside the bin: drag handle over the sheet child, which takes the rest. */
    private readonly _sheetPage: GridLayout;
    private _drag: SheetDrag | null = null;
    private readonly _nested = new NestedDragTracker();
    /**
     * Every scrolling view inside the sheet child. Held by STRONG reference, unlike the
     * `WeakSet` that only had to answer "watched already?": the bottom inset has to be
     * re-applied to each of them on a later reading, so they have to be enumerable.
     * `set_sheet` empties it, which is the same lifetime the views themselves have.
     */
    private readonly _scrolls = new Set<ScrollView>();
    /** The bottom window inset this sheet owes — {@link applyBottomInset}. */
    private _bottomInset = 0;
    /** The height the panel has with the bar in it, what a drag that closes the sheet falls to. */
    private _barHeight = 0;
    /** The bottom-bar bin — the bin's other layer, tapped to open the sheet. */
    private readonly _bottomBarBin: StackLayout;
    private _sheetChild: View | null = null;
    private _bottomBar: View | null = null;
    /** The shared open/can-close model — the single source of truth for both. */
    private readonly _state = createBottomSheetPresentation();

    constructor(props?: ConstructProps<AdwBottomSheet>) {
        super();

        this.className = 'adw-bottom-sheet';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));

        // Painted after the content and before the panel, which is the whole of its
        // placement: NativeScript stacks a cell's children in child order. The tap is the
        // `'dimming'` source, and the gate decides — a locked sheet signals instead.
        const dimming = new GridLayout();
        dimming.className = DIMMING_CLASS;
        GridLayout.setColumn(dimming, 0);
        GridLayout.setRow(dimming, 0);
        dimming.addEventListener('tap', () => this.requestClose('dimming'));
        this.addChild(dimming);
        this._dimming = dimming;

        // The sheet panel is bottom-anchored within the (single-cell) grid and
        // painted last so it sits on top of the content.
        const sheetPanel = new StackLayout();
        sheetPanel.orientation = 'vertical';
        sheetPanel.className = 'adw-bottom-sheet-panel';
        sheetPanel.verticalAlignment = 'bottom';
        GridLayout.setColumn(sheetPanel, 0);
        GridLayout.setRow(sheetPanel, 0);

        // The bin's two layers. In libadwaita they are one `GtkStack`; here they are two
        // siblings whose visibility {@link applyBottomSheetChrome} drives together, because
        // toggling them separately is how a port paints a bar over an open sheet.
        const bottomBarBin = new StackLayout();
        bottomBarBin.orientation = 'vertical';
        bottomBarBin.className = BOTTOM_BAR_CLASS;
        // The tap is the affordance. `requestOpen` still runs the gate, so `can-open` off
        // keeps the bar tappable and refuses, exactly as the C handler does.
        bottomBarBin.addEventListener('tap', () => this.requestOpen('bottom-bar'));
        attachRowPressFeedback(bottomBarBin);
        sheetPanel.addChild(bottomBarBin);

        // Two rows, so that the sheet child gets the height the panel was given and a scrolled
        // window in it scrolls, rather than being measured at its whole content and clipped.
        const sheetPage = new GridLayout();
        sheetPage.className = 'adw-bottom-sheet-page';
        sheetPage.addRow(new ItemSpec(1, 'star'));
        sheetPanel.addChild(sheetPage);

        const handle = new Label();
        handle.className = 'adw-bottom-sheet-handle';
        handle.horizontalAlignment = 'center';
        // can_target = FALSE (adw-bottom-sheet.c:1198) — the handle is decorative
        // and must not swallow (or act on) a tap. The drag it invites lands on the panel.
        handle.isUserInteractionEnabled = false;
        // An overlay in the same cell as the sheet child, painted after it and with no
        // background or row of its own: the content scrolls visibly behind the pill, as it does
        // under `Adw.BottomSheet`'s drag handle.
        handle.verticalAlignment = 'top';
        GridLayout.setRow(handle, 0);
        sheetPage.addChild(handle);

        // The grip: a transparent strip over the top of the content that takes the touch away
        // from the scroll view there, so a drag on the handle moves the sheet and never scrolls
        // the text under it. It takes no room: it shares the cell with the content.
        const grip = new StackLayout();
        grip.className = 'adw-bottom-sheet-grip';
        grip.verticalAlignment = 'top';
        grip.height = GRIP_HEIGHT;
        // A view with no listener is not clickable on Android and hands the touch on to the
        // scroll view under it; a tap listener makes it take the touch. The pan lands on the panel.
        grip.addEventListener('tap', () => {});
        GridLayout.setRow(grip, 0);
        sheetPage.addChild(grip);

        // The whole panel is the grip: the bar, the handle and any part of the sheet that is
        // not itself scrolling. `allow_mouse_drag = show_drag_handle || bottom_bar`.
        sheetPanel.addEventListener('pan', (args) => this._onPan(args as unknown as PanGestureEventData));
        dimming.addEventListener('pan', (args) => this._onPan(args as unknown as PanGestureEventData));

        this.addChild(sheetPanel);
        this._sheetPanel = sheetPanel;
        PANELS.set(this, sheetPanel);
        this._sheetPage = sheetPage;
        this._bottomBarBin = bottomBarBin;
        this._paintChrome();
        this._applyInsetPadding();

        this.addEventListener('layoutChanged', () => {
            this._syncHeight();
            if (!this._state.open && !this._drag) this._barHeight = this._sheetPanel.getActualSize().height;
        });

        this._state.subscribe((open) => {
            this._paintChrome();
            this._syncHeight();
            const data: NotifyOpenEventData = { eventName: NOTIFY_OPEN, object: this, open };
            this.notify(data);
        });

        applyConstructProps(this, props);
    }

    /**
     * Pay `inset` dip of bottom window inset — the gesture area a sheet on the screen's bottom
     * edge sits on. Call it with `0` to stop paying; off Android every reading is `0` anyway.
     *
     * The WIDGET pays rather than the host, because only the widget knows which of its parts is
     * at the edge in which state, and the two forms of payment are not interchangeable: see
     * `bottom-sheet-insets.ts`. A host that wires this to a live reading uses
     * `padSheetForSystemInsets` (`system-insets.ts`).
     */
    applyBottomInset(inset: number): void {
        this._bottomInset = inset;
        this._applyInsetPadding();
    }

    /** Split {@link applyBottomInset}'s reading over the bar, the scrolling content and the page. */
    private _applyInsetPadding(): void {
        const padding = bottomSheetInsetPadding(this._bottomInset, { sheetScrolls: this._scrolls.size > 0 });
        this._bottomBarBin.paddingBottom = padding.bar;
        // The page's own bottom padding is written from here and NOWHERE else — the stylesheet
        // states the other three edges. One writer, because a `padding` in the CSS would be the
        // viewport-shortening half of the very split this is making.
        this._sheetPage.paddingBottom = padding.page;
        for (const scroll of this._scrolls) {
            // The padding goes on the CONTENT, not on the `ScrollView`: Android's ScrollView
            // clips to its own padding (`clipToPadding` defaults to true), so padding it is the
            // hard clip this exists to remove. Inside the content the same number scrolls.
            const content = scroll.content;
            if (content) content.paddingBottom = padding.scrollEnd;
        }
    }

    /** Push the current chrome onto the three views — the widget's whole rendering step. */
    private _paintChrome(): void {
        const panes: BottomSheetPanes = {
            dimming: this._dimming,
            panel: this._sheetPanel,
            page: this._sheetPage,
            bottomBar: this._bottomBarBin,
        };
        applyBottomSheetChrome(panes, this._state.chrome);
    }

    /**
     * The open sheet takes a share of the container, not all of it, and the bar stays its natural
     * height: libadwaita sizes the sheet to its child, which on GNOME is a bit under half of the
     * editor. A pane measured at its whole content would fill the container instead.
     */
    private _syncHeight(): void {
        const panel = this._sheetPanel;
        if (this._drag) return;
        if (!this._state.open) {
            if (panel.height !== 'auto') panel.height = 'auto';
            return;
        }
        const wanted = sheetHeight(this.getActualSize().height);
        if (wanted > 0 && panel.height !== wanted) panel.height = wanted;
    }

    /**
     * Content that scrolls owns the touch, so a pan never reaches the sheet from it. Reading the
     * touch alongside the scroll gives the nested-scroll rule: at the top of the content, a
     * finger that keeps going down closes the sheet (see {@link NestedDragTracker}).
     */
    private _watchScrolling(view: View): void {
        if (view instanceof ScrollView) {
            if (this._scrolls.has(view)) return;
            this._scrolls.add(view);
            view.addEventListener('touch', (args) => this._onNestedTouch(view, args as TouchGestureEventData));
            // The sheet child arrives after the constructor, and whether it scrolls is what
            // decides where the bottom inset goes — so the split is re-taken here.
            this._applyInsetPadding();
            return;
        }
        const layout = view as unknown as { getChildrenCount?(): number; getChildAt?(i: number): View; content?: View };
        if (layout.content) this._watchScrolling(layout.content);
        const count = layout.getChildrenCount?.() ?? 0;
        for (let i = 0; i < count; i++) this._watchScrolling(layout.getChildAt!(i));
    }

    private _onNestedTouch(scroll: ScrollView, args: TouchGestureEventData): void {
        if (!this._state.open && !this._nested.dragging) return;
        // Off the sheet's own frame: the view moves with the sheet while it is pulled.
        const y = args.getY() + (this._sheetPanel.translateY || 0);
        let step;
        if (args.action === 'down') {
            if (this._drag) return;
            this._nested.down(y);
            return;
        }
        if (args.action === 'move') step = this._nested.move(y, scroll.verticalOffset);
        else step = this._nested.up(args.action === 'cancel');
        if (step.kind === 'begin') this._beginDrag();
        else if (step.kind === 'move') this._moveDrag(step.dy);
        else if (step.kind === 'end') this._endDrag(step.dy, false);
    }

    private _onPan(args: PanGestureEventData): void {
        // The pan fires on the panel even while a scroll view inside it consumes the touch. A
        // gesture that began in scrolling content belongs to the nested tracker alone.
        if (this._nested.ignorePan(args.state)) return;
        if (args.state === PAN_BEGAN) this._beginDrag();
        else if (args.state === PAN_CHANGED) this._moveDrag(args.deltaY);
        else this._endDrag(args.deltaY, args.state === 0);
    }

    /**
     * A drag from the bar opens, a drag on the open sheet closes: the sheet is laid out at its
     * open height and slid by `translateY`, the way a finger moves it, so the bar's place is the
     * sheet's top edge at the start. Whether the gate lets the drag through is asked at release.
     */
    private _beginDrag(): void {
        if (this._drag) return;
        const open = this._state.open;
        if (!open && !this._bottomBar) return;
        const height = sheetHeight(this.getActualSize().height);
        if (height <= 0) return;
        const travel = sheetTravel(height, this._barHeight);
        const panel = this._sheetPanel;
        this._drag = { start: open ? 'open' : 'closed', height, travel, samples: [], offset: open ? 0 : travel };
        panel.height = height;
        if (open) return;
        this._dimming.visibility = 'visible';
        this._dimming.opacity = 0;
        this._bottomBarBin.visibility = 'collapse';
        this._sheetPage.visibility = 'visible';
        panel.visibility = 'visible';
        panel.translateY = travel;
    }

    private _moveDrag(dy: number): void {
        const drag = this._drag;
        if (!drag) return;
        drag.samples.push({ dy, time: Date.now() });
        drag.offset = dragOffset(drag.start, dy, drag.travel);
        this._sheetPanel.translateY = drag.offset;
        if (drag.start === 'closed' || this._state.modal)
            this._dimming.opacity = dragProgress(drag.offset, drag.travel);
    }

    private _endDrag(dy: number, cancelled: boolean): void {
        const drag = this._drag;
        if (!drag) return;
        drag.samples.push({ dy, time: Date.now() });
        drag.offset = dragOffset(drag.start, dy, drag.travel);
        const rest = cancelled ? drag.start : settle(drag.offset, drag.travel, releaseVelocity(drag.samples));
        const target = rest === 'open' ? 0 : drag.travel;
        const done = () => {
            this._drag = null;
            this._sheetPanel.translateY = 0;
            this._dimming.opacity = 1;
            if (rest !== drag.start) {
                if (rest === 'open') this.requestOpen('swipe');
                else this.requestClose('swipe');
            }
            this._paintChrome();
            this._syncHeight();
        };
        this._sheetPanel
            .animate({ translate: { x: 0, y: target }, duration: SETTLE_DURATION, curve: 'easeOut' })
            .then(done, done);
    }

    /** Set (or replace) the always-visible content layer (painted under the sheet) — `adw_bottom_sheet_set_content`. */
    set_content(view: View | null): void {
        // `adw_bottom_sheet_set_content` early-returns on an unchanged widget
        // (adw-bottom-sheet.c:1497-1498); without that guard the marker class
        // was appended again on every call.
        if (this._content === view) return;
        if (this._content) {
            this._content.className = removeMarkerClass(this._content.className, CONTENT_CLASS);
            this.removeChild(this._content);
        }
        this._content = view;
        if (view) {
            view.className = addMarkerClass(view.className, CONTENT_CLASS);
            GridLayout.setColumn(view, 0);
            GridLayout.setRow(view, 0);
            // Insert BELOW the sheet panel so the panel paints on top.
            this.insertChild(view, 0);
        }
    }

    /** Set (or replace) the sheet panel's child (shown when open) — `adw_bottom_sheet_set_sheet`. */
    set_sheet(view: View | null): void {
        // adw_bottom_sheet_set_sheet, adw-bottom-sheet.c:1547-1556.
        if (this._sheetChild === view) return;
        if (this._sheetChild) {
            this._sheetChild.className = removeMarkerClass(this._sheetChild.className, SHEET_CLASS);
            this._sheetPage.removeChild(this._sheetChild);
            this._scrolls.clear();
        }
        this._sheetChild = view;
        if (view) {
            view.className = addMarkerClass(view.className, SHEET_CLASS);
            GridLayout.setRow(view, 0);
            // Under the handle, which is the last child and so paints on top.
            this._sheetPage.insertChild(view, 0);
            this._watchScrolling(view);
            view.addEventListener('loaded', () => this._watchScrolling(view));
        }
        // A sheet child with nothing scrolling in it reaches no `_watchScrolling` branch that
        // re-splits, and neither does a cleared one — so the split is re-taken either way.
        this._applyInsetPadding();
    }

    /**
     * Set (or replace) the bottom bar — `adw_bottom_sheet_set_bottom_bar`, shown in the
     * sheet's place while it is closed.
     *
     * Presence is an INPUT to the open gate, not decoration: taking the bar away takes every
     * on-device way of opening this sheet with it, which is why the state hears about it
     * (upstream re-runs `update_swipe_tracker` from the same setter, adw-bottom-sheet.c:1629).
     */
    set_bottom_bar(view: View | null): void {
        if (this._bottomBar === view) return;
        // No marker class on the bar's own child: the bin carries the styling, and the two
        // markers above exist only because `set_content`/`set_sheet` hand their view to a
        // node this theme does not paint. One fewer class to keep the stylesheet honest about.
        if (this._bottomBar) this._bottomBarBin.removeChild(this._bottomBar);
        this._bottomBar = view;
        if (view) this._bottomBarBin.addChild(view);
        this._state.setHasBottomBar(view !== null);
        this._paintChrome();
    }

    /**
     * An XML child asks for the sheet, the bottom bar or the content, and a bare one is
     * CONTENT — the always-visible layer, which is what a sheet with nothing behind it
     * would be missing. `LayoutBase`'s inherited default would put any of them into the
     * grid alongside the sheet panel, where it neither paints under the sheet nor moves
     * with it.
     */
    _addChildFromBuilder(name: string, view: View): void {
        const slot = resolveBuilderSlot(name, BOTTOM_SHEET_SLOTS, 'content');
        if (slot === 'sheet') this.set_sheet(view);
        // `bottomBar` is the XML complex-property spelling, `bottom-bar` the one a `.blp`
        // property writes (`bottom-bar: Label { … }`), and the shared-tree builder hands it as is.
        else if (slot === 'bottomBar' || slot === 'bottom-bar') this.set_bottom_bar(view);
        else this.set_content(view);
    }

    /**
     * The always-visible content layer, or `null`.
     *
     * A read-back for `set_content`: a write-only pane cannot be asserted, and the XML
     * door made that concrete — the gallery probe has to ask the widget where the
     * child it declared actually went.
     */
    get content(): View | null {
        return this._content;
    }

    /**
     * `Adw.BottomSheet:content` — {@link set_content} under the property spelling the
     * counterpart declares, so a construct-props bag can carry the pane and a snippet
     * ported off GJS keeps the assignment it was written as.
     */
    set content(view: View | null) {
        this.set_content(view);
    }

    /** The sheet panel's child, or `null` — the read-back for `set_sheet`. */
    get sheet(): View | null {
        return this._sheetChild;
    }

    /** `Adw.BottomSheet:sheet` — {@link set_sheet} under the counterpart's spelling. */
    set sheet(view: View | null) {
        this.set_sheet(view);
    }

    /** The bottom bar's child, or `null` — the read-back for `set_bottom_bar`. */
    get bottomBar(): View | null {
        return this._bottomBar;
    }

    /** `Adw.BottomSheet:bottom-bar` — {@link set_bottom_bar} under the counterpart's spelling. */
    set bottomBar(view: View | null) {
        this.set_bottom_bar(view);
    }

    /**
     * Whether the sheet is open (`AdwBottomSheet:open`). Toggling shows/hides the panel
     * and emits `notify::open`.
     *
     * Like the GTK property this ignores `can-close`; a user-driven dismissal belongs in
     * {@link requestClose}.
     *
     * BREAKING: was `openState`, and `sheet.open = true` / `= false` replace the port's
     * own `open()` / `close()` methods, which libadwaita has no counterpart for. Why the
     * collision with them was not a reason to keep the divergent name is ADR 0034
     * § Amendment 11.
     */
    get open(): boolean {
        return this._state.open;
    }

    set open(value: boolean | string) {
        this._state.setOpen(xmlBoolean(value, false));
    }

    /**
     * Whether the sheet dims the content and blocks it while open (`AdwBottomSheet:modal`,
     * default `true`). Changing it on an open sheet adds or removes the scrim at once, as
     * `adw_bottom_sheet_set_modal` does; `open` does not move.
     */
    get modal(): boolean {
        return this._state.modal;
    }

    set modal(raw: boolean | string) {
        if (!this._state.setModal(xmlBoolean(raw, this.modal))) return;
        this._paintChrome();
    }

    /**
     * Whether the user may dismiss the sheet (`AdwBottomSheet:can-close`). When
     * off, a refused dismissal emits `close-attempt` instead of closing.
     */
    get canClose(): boolean {
        return this._state.canClose;
    }

    set canClose(raw: boolean | string) {
        const value = xmlBoolean(raw, this.canClose);
        this._state.setCanClose(value);
    }

    /**
     * Whether the user may open the sheet from its bottom bar (`AdwBottomSheet:can-open`).
     *
     * Off, the bar STAYS on screen and only gains the inert marker: libadwaita refuses the
     * click in the handler rather than disabling the button (adw-bottom-sheet.c:2031-2038).
     * There is no `open-attempt` signal to answer with, so a refused tap is silent.
     */
    get canOpen(): boolean {
        return this._state.canOpen;
    }

    set canOpen(raw: boolean | string) {
        if (!this._state.setCanOpen(xmlBoolean(raw, this.canOpen))) return;
        this._paintChrome();
    }

    /** Whether the bottom bar is shown while the sheet is closed (`AdwBottomSheet:reveal-bottom-bar`). */
    get revealBottomBar(): boolean {
        return this._state.revealBottomBar;
    }

    set revealBottomBar(raw: boolean | string) {
        if (!this._state.setRevealBottomBar(xmlBoolean(raw, this.revealBottomBar))) return;
        this._paintChrome();
    }

    /**
     * Route a dismissal affordance through the shared gate and act on the
     * verdict: close, emit `close-attempt`, emit `sheet.close` for the host to
     * forward, or do nothing.
     *
     * NativeScript has no Escape key and no widget-level back handling, so the
     * HOST routes what it has here — typically Android's back button as
     * `requestClose('escape')` and an in-sheet close button as
     * `requestClose('close-button')`.
     */
    requestClose(source: BottomSheetCloseSource): BottomSheetCloseOutcome {
        const { outcome, eventName } = requestBottomSheetClose(this._state, source);
        if (eventName) this.notify({ eventName, object: this });
        return outcome;
    }

    /**
     * Route an open affordance through the shared gate — the bar's own tap goes through
     * here, and a host with a gesture of its own passes `'swipe'`.
     *
     * Unlike {@link requestClose} there is nothing to emit on a refusal: libadwaita has no
     * `open-attempt` counterpart to `close-attempt`, so `'ignored'` is silent.
     */
    requestOpen(source: BottomSheetOpenSource): BottomSheetOpenOutcome {
        return this._state.requestOpen(source);
    }
}
