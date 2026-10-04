// AdwDialog — a modal dialog with one `child`, for NativeScript.
//
// A REAL `GridLayout` overlay, like `AdwAboutDialog` and `AdwPreferencesDialog`: a dimmed
// scrim over the whole cell holding a card, and the card holds the child. It is NOT a
// second OS window — this platform has none (`window-state.ts`) — so `present (parent)`
// finds the window the parent sits in (`findDialogHost`) and shows the overlay there, above
// its content; a dialog the caller already mounted in its own layout is revealed in place.
//
// THE CARD HAS NO HEADER OF ITS OWN, and that is libadwaita's: `AdwDialog` is only the
// surface, and the title bar a dialog shows is the `Adw.HeaderBar` its `child` brings
// (`Adw.ToolbarView { [top] Adw.HeaderBar }` is every shipped dialog's shape). `title` is
// held, and read by assistive technology as the card's label.
//
// WHAT IS HELD AND NOT RENDERED. `presentation-mode` accepts `auto`, `floating` and
// `bottom-sheet`; `bottom-sheet` pins the card to the bottom edge at full width, `floating`
// centres it, and `auto` is `floating` — libadwaita chooses between them by window width
// and this port has no layout pass to ask. `follows-content-size` is held: the card is
// content-sized unless `content-width` / `content-height` say otherwise, so the default
// `true` is what it does. No scrim animation and no focus trap — the CSS subset has no
// transition and the platform has no focus chain to confine.
//
// `close()` honours `can-close` as `adw_dialog_close` does: a dialog that cannot close emits
// `close-attempt` and stays; `force_close()` closes regardless.
//
// Reference: refs/libadwaita/src/adw-dialog.c (AdwDialog)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, type EventData, type View } from '@nativescript/core';

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { builderSlotsOf } from './builder-slots.js';
import { AdwSingleChildBase } from './single-child-base.js';
import {
    type AdwDialogPresentationNick,
    DEFAULT_DIALOG_PRESENTATION_MODE,
    dialogPresentationMode,
    findDialogHost,
    surfaceSize,
    type DialogHost,
} from './window-state.js';
import { xmlBoolean, xmlNumber } from './xml-values.js';

/** `AdwDialog::closed`. */
export const ADW_DIALOG_CLOSED = 'closed';

/** `AdwDialog::close-attempt` — `close()` on a dialog whose `can-close` is false. */
export const ADW_DIALOG_CLOSE_ATTEMPT = 'close-attempt';

/** The scrim class; the card is `${ADW_DIALOG_CLASS}-card`. */
export const ADW_DIALOG_CLASS = 'adw-dialog';

export class AdwDialog extends AdwSingleChildBase {
    /** `child` is the one destination, so it is also the fallback. */
    static readonly builderSlots: readonly string[] = builderSlotsOf(['child'], 'child');

    protected readonly _card: GridLayout;
    private _title = '';
    private _contentWidth = -1;
    private _contentHeight = -1;
    private _followsContentSize = true;
    private _canClose = true;
    private _presentationMode: AdwDialogPresentationNick = DEFAULT_DIALOG_PRESENTATION_MODE;
    /** The window `present (parent)` mounted this in, so closing can take it back out. */
    private _host: DialogHost | null = null;

    constructor(props?: ConstructProps<AdwDialog>) {
        super();
        this._restyle();
        this.visibility = 'collapse';

        const card = new GridLayout();
        card.className = `${ADW_DIALOG_CLASS}-card`;
        card.addColumn(new ItemSpec(1, 'star'));
        card.addRow(new ItemSpec(1, 'star'));
        GridLayout.setColumn(card, 0);
        GridLayout.setRow(card, 0);
        this.addChild(card);
        this._card = card;
        this._layoutCard();

        applyConstructProps(this, props);
    }

    protected override get _ownClass(): string {
        return ADW_DIALOG_CLASS;
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

    // --- properties ---

    /** `AdwDialog:title`. */
    get title(): string {
        return this._title;
    }

    set title(value: string | null) {
        this._title = value ?? '';
        this._card.accessibilityLabel = this._title === '' ? undefined : this._title;
    }

    /** `AdwDialog:content-width` — `-1` follows the content. */
    get contentWidth(): number {
        return this._contentWidth;
    }

    set contentWidth(value: number | string) {
        this._contentWidth = surfaceSize(xmlNumber(value, Number.NaN), value, this._contentWidth, 'contentWidth');
        this._layoutCard();
    }

    /** `AdwDialog:content-height` — `-1` follows the content. */
    get contentHeight(): number {
        return this._contentHeight;
    }

    set contentHeight(value: number | string) {
        this._contentHeight = surfaceSize(xmlNumber(value, Number.NaN), value, this._contentHeight, 'contentHeight');
        this._layoutCard();
    }

    /** `AdwDialog:follows-content-size` — held; the card is content-sized by default. */
    get followsContentSize(): boolean {
        return this._followsContentSize;
    }

    set followsContentSize(value: boolean | string) {
        this._followsContentSize = xmlBoolean(value, this._followsContentSize);
    }

    /** `AdwDialog:can-close`. */
    get canClose(): boolean {
        return this._canClose;
    }

    set canClose(value: boolean | string) {
        this._canClose = xmlBoolean(value, this._canClose);
    }

    /** `AdwDialog:presentation-mode` — a nick, or the constant. */
    get presentationMode(): AdwDialogPresentationNick {
        return this._presentationMode;
    }

    set presentationMode(value: AdwDialogPresentationNick) {
        this._presentationMode = dialogPresentationMode(value);
        this._layoutCard();
    }

    /** Whether the dialog is on screen. */
    get open(): boolean {
        return this.visibility === 'visible';
    }

    // --- presenting ---

    /**
     * Show the dialog — `adw_dialog_present`.
     *
     * With a `parent` it is shown in the window that parent sits in. Without one it must
     * already be mounted somewhere (the caller added it to a layout) and is revealed in
     * place; a dialog with neither has no surface to appear on, which is refused by name
     * rather than left collapsed at exit 0.
     */
    present(parent?: View | null): void {
        if (this.open) return;
        if (this.parent === null || this.parent === undefined) {
            const host = findDialogHost(parent ?? null);
            if (host === null) {
                throw new Error(
                    `${this.constructor.name} has no window to appear in: pass a widget that sits inside an ` +
                        'Adw.Window / Adw.ApplicationWindow to present(), or add the dialog to a layout first.',
                );
            }
            host._hostDialog(this);
            this._host = host;
        }
        this.visibility = 'visible';
    }

    /** `adw_dialog_close` — honours `can-close`, and takes a presented dialog back out of its window. */
    close(): void {
        if (!this._canClose) {
            this.notify({ eventName: ADW_DIALOG_CLOSE_ATTEMPT, object: this } as EventData);
            return;
        }
        this.force_close();
    }

    /** `adw_dialog_force_close` — closes whatever `can-close` says. */
    force_close(): void {
        if (!this.open) return;
        this.visibility = 'collapse';
        if (this._host !== null) {
            this._host._unhostDialog(this);
            this._host = null;
        }
        this.notify({ eventName: ADW_DIALOG_CLOSED, object: this } as EventData);
    }

    /** The card's size and place, from `content-*` and `presentation-mode`. */
    private _layoutCard(): void {
        const card = this._card;
        card.width = this._contentWidth > 0 ? this._contentWidth : 'auto';
        card.height = this._contentHeight > 0 ? this._contentHeight : 'auto';
        if (this._presentationMode === 'bottom-sheet') {
            card.horizontalAlignment = 'stretch';
            card.verticalAlignment = 'bottom';
            card.width = 'auto';
        } else {
            card.horizontalAlignment = 'center';
            card.verticalAlignment = 'middle';
        }
    }
}
