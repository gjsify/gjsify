// GtkPopover — a card of arbitrary content shown next to a widget, for NativeScript.
//
// NOT A WINDOW AND NOT A NATIVE MENU. `GtkPopoverMenu` runs through the platform's own
// `PopupMenu` (ADR 0097 § 2) because a menu is a list the platform already draws; a popover
// takes ANY child (`Gtk.Box { Label, Label }` is what the Steuererklärung's glossary help
// puts in one), and the platform has no positioned overlay that is not a modal. So this is the
// overlay `AdwDialog` is, with a different card: `popup()` finds the window the anchor sits in
// (`findDialogHost`) and mounts a transparent full-window view above its content, holding a
// DISMISS view and the CARD. The dismiss view is a sibling UNDER the card, not the card's
// parent, so a tap on the card never reaches it; the card carries a no-op `tap` listener so
// the platform has a handler there to stop at. THE DISMISS PATH IS UNVERIFIED ON A DEVICE: the
// spec proves the wiring, and whether Android's touch dispatch stops at the card (rather than
// falling through to the dismiss view below it) is a measurement the Android port owes.
//
// `closed` is emitted on every way out — `popdown()`, `close()` (the Back button reaches an
// open popover the way it reaches an open dialog: `open` + `close()`), and an outside tap.
//
// MEASURED ON GTK 4.22 / GJS: `autohide` defaults to true and notifies on change only;
// `position` defaults to `Gtk.PositionType.BOTTOM` (3); a popover that was never shown does
// not emit `closed` on `popdown()`; css class `background`, css name `popover`.
//
// PLACEMENT is `popover-placement.ts`: centred on the anchor, on the preferred side, flipped
// when it does not fit, slid back onto the window.
//
// DIFFERENCES, all refused or ledgered rather than approximated: only `top` and `bottom`
// are placed (`left`/`right` throw naming the member); there is no arrow (`has-arrow` is
// not a property here and `pointing-to` is not accepted); `cascade-popdown`,
// `mnemonics-visible` and `default-widget` have no keyboard to act on; and a popover shows
// once its anchor sits in a window — one that does not is refused by name.
//
// Reference: refs/gtk gtk/gtkpopover.c (GtkPopover)
// Reference: web/adwaita-web/src/elements/gtk-popover.ts
// Copyright (c) The GTK Team. LGPLv2.1+.

import { GridLayout, ItemSpec, type View } from '@nativescript/core';

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { builderSlotsOf } from './builder-slots.js';
import { popoverPlacement, type PopoverSide } from './popover-placement.js';
import { withProperties } from './signals.js';
import { AdwSingleChildBase } from './single-child-base.js';
import { findDialogHost, type DialogHost } from './window-state.js';
import { gtkBuilderInteger } from './xml-values.js';

/** `GtkPopover::closed`. */
export const GTK_POPOVER_CLOSED = 'closed';

/** The scrim class; the card is `${GTK_POPOVER_CLASS}-card`. */
export const GTK_POPOVER_CLASS = 'gtk-popover';

/** `Gtk.PositionType`: LEFT, RIGHT, TOP, BOTTOM. */
const POSITION_NICKS = ['left', 'right', 'top', 'bottom'] as const;
const POSITION_TOP = 2;
const POSITION_BOTTOM = 3;

/** The `Gtk.PositionType` a write means, as the number GJS reads back — or throw naming why not. */
function positionValue(value: unknown): number {
    const nick = typeof value === 'string' ? POSITION_NICKS.indexOf(value as (typeof POSITION_NICKS)[number]) : -1;
    const number = nick >= 0 ? nick : gtkBuilderInteger(value);
    if (number === undefined || !Number.isInteger(number) || number < 0 || number > 3) {
        throw new TypeError(
            `'${String(value)}' is not a Gtk.PositionType. The members are ${POSITION_NICKS.join(', ')}.`,
        );
    }
    if (number !== POSITION_TOP && number !== POSITION_BOTTOM) {
        throw new Error(
            `Gtk.Popover.position '${POSITION_NICKS[number]}' is not supported: this surface places a ` +
                'popover above or below its anchor only (`top` or `bottom`).',
        );
    }
    return number;
}

/** What the anchor answers for its place — both optional, as on the other tree members. */
interface Located {
    getLocationInWindow?(): { x: number; y: number };
    getActualSize?(): { width: number; height: number };
}

export class GtkPopover extends withProperties(AdwSingleChildBase, {
    GTypeName: 'GtkPopover',
    Properties: {
        autohide: {
            kind: 'boolean',
            default: true,
            blurb: 'Whether to dismiss the popover on outside clicks',
        },
        position: {
            kind: 'int',
            default: POSITION_BOTTOM,
            blurb: 'The preferred place to position the popover',
            normalize: (value) => positionValue(value),
        },
    },
    Signals: {
        closed: {},
    },
}) {
    static readonly GTypeName: string = 'GtkPopover';

    /** `child` is the one destination, so it is also the fallback. */
    static readonly builderSlots: readonly string[] = builderSlotsOf(['child'], 'child');

    /** `Gtk.Popover:autohide` — whether a tap outside the card dismisses it. */
    declare autohide: boolean;

    /** `Gtk.Popover:position` — a `Gtk.PositionType`; only `top` (2) and `bottom` (3) are placed. */
    declare position: number;

    protected readonly _card: GridLayout;
    private readonly _dismiss: GridLayout;
    private _anchor: View | null = null;
    private _host: DialogHost | null = null;
    /** The card's margins as last written, so a layout pass that changes nothing writes nothing. */
    private _placed: { left: number; top: number } | null = null;

    constructor(props?: ConstructProps<GtkPopover>) {
        super();
        this._restyle();
        this.visibility = 'collapse';

        const dismiss = new GridLayout();
        dismiss.className = `${GTK_POPOVER_CLASS}-dismiss`;
        dismiss.addEventListener('tap', () => {
            if (this.autohide) this.popdown();
        });
        GridLayout.setColumn(dismiss, 0);
        GridLayout.setRow(dismiss, 0);
        this.addChild(dismiss);
        this._dismiss = dismiss;

        const card = new GridLayout();
        card.className = `${GTK_POPOVER_CLASS}-card`;
        card.addColumn(new ItemSpec(1, 'star'));
        card.addRow(new ItemSpec(1, 'star'));
        card.horizontalAlignment = 'left';
        card.verticalAlignment = 'top';
        // A handler at the card, so a tap on it ends there instead of falling to the dismiss view.
        card.addEventListener('tap', () => undefined);
        GridLayout.setColumn(card, 0);
        GridLayout.setRow(card, 0);
        this.addChild(card);
        this._card = card;

        this.addEventListener('layoutChanged', () => this._place());
        card.addEventListener('layoutChanged', () => this._place());

        applyConstructProps(this, props);
    }

    /** `gtk_popover_new`. */
    static new_(): GtkPopover {
        return new GtkPopover();
    }

    protected override get _ownClass(): string {
        return GTK_POPOVER_CLASS;
    }

    // The child lives in the card, not in the scrim's own cell.
    protected override _adopt(view: View): void {
        GridLayout.setColumn(view, 0);
        GridLayout.setRow(view, 0);
        this._card.addChild(view);
    }

    protected override _release(view: View): void {
        this._card.removeChild(view);
    }

    // --- anchor ---

    /** `gtk_widget_set_parent` — the widget the popover points at. It is not added to its children. */
    set_parent(widget: View): void {
        if (this._anchor !== null && this._anchor !== widget && this.open) this.popdown();
        this._anchor = widget;
    }

    /** `gtk_widget_unparent`. */
    unparent(): void {
        if (this.open) this.popdown();
        this._anchor = null;
    }

    // --- showing ---

    /** Whether the popover is on screen. */
    get open(): boolean {
        return this.visibility === 'visible';
    }

    /**
     * `gtk_popover_popup` — show the card next to its anchor.
     *
     * The window comes from the anchor, or from a popover the caller already mounted in a
     * layout (revealed in place). A popover with neither has no surface to appear on and is
     * refused by name rather than left collapsed at exit 0.
     */
    popup(): void {
        if (this.open) return;
        if (this.parent === null || this.parent === undefined) {
            const host = findDialogHost(this._anchor);
            if (host === null) {
                throw new Error(
                    'Gtk.Popover has no window to appear in: set_parent() a widget that sits inside an ' +
                        'Adw.Window / Adw.ApplicationWindow first, or add the popover to a layout.',
                );
            }
            host._hostDialog(this);
            this._host = host;
        }
        // Hidden until the first placement, so the card is never seen at the corner it is laid
        // out in before its size is known.
        this._card.opacity = 0;
        this._placed = null;
        this.visibility = 'visible';
    }

    /** `gtk_popover_popdown`. */
    popdown(): void {
        if (!this.open) return;
        this.visibility = 'collapse';
        if (this._host !== null) {
            this._host._unhostDialog(this);
            this._host = null;
        }
        this.emit(GTK_POPOVER_CLOSED);
    }

    /** The host's Back handling closes the topmost open overlay by this name (`window-base.ts`). */
    close(): void {
        this.popdown();
    }

    // --- placement ---

    /** Put the card where `popoverPlacement` says, once it and the window have a size. */
    private _place(): void {
        if (!this.open) return;
        const card = this._card.getActualSize?.();
        const window = this.getActualSize?.();
        const anchor = this._anchorRect();
        if (!card || !window || anchor === null) return;
        if (card.width <= 0 || card.height <= 0 || window.width <= 0 || window.height <= 0) return;

        const side: PopoverSide = this.position === POSITION_TOP ? 'top' : 'bottom';
        const { left, top } = popoverPlacement(anchor, card, window, side);
        const last = this._placed;
        if (last !== null && last.left === left && last.top === top) return;
        this._placed = { left, top };
        this._card.marginLeft = left;
        this._card.marginTop = top;
        this._card.opacity = 1;
    }

    /** The anchor's rectangle relative to this overlay (which covers the window), or `null`. */
    private _anchorRect(): { x: number; y: number; width: number; height: number } | null {
        const anchor = this._anchor as (View & Located) | null;
        const origin = this as Located;
        const at = anchor?.getLocationInWindow?.();
        const size = anchor?.getActualSize?.();
        const base = origin.getLocationInWindow?.();
        if (!at || !size || !base) return null;
        return { x: at.x - base.x, y: at.y - base.y, width: size.width, height: size.height };
    }
}
