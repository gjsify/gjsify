// AdwHeaderBar — a Libadwaita-style header bar for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` (columns `auto, *, auto`): a start
// slot, a centered title widget, and an end slot. The centered title defaults to
// an {@link AdwWindowTitle} (so `title`/`subtitle` work out of the box) but can be
// replaced with any custom widget via {@link setTitleWidget}. Mirrors
// `Adw.HeaderBar`: start/end packing + a centered title-widget. The `flat` STYLE CLASS
// (`cssClasses="flat"`, ADR 0049) drops the bottom hairline / background fill.
//
// CORE-VIA: ./adw-window-title.js — the centred title IS that widget, and title/subtitle run in its WindowTitleState.
//
// FIDELITY: faithful for the structural layout (start / center / end + flat).
// The NS CSS subset has no box-shadow, so the non-flat header's bottom separator
// is a 1px bottom border rather than libadwaita's subtle shadow — a close visual
// approximation. And the DERIVED CENTRE diverges: `construct_title_label`
// (refs/libadwaita/src/adw-header-bar.c:512) builds a plain `gtk_label_new (NULL)`
// with no subtitle at all, where this bar defaults to an {@link AdwWindowTitle} —
// the same divergence `@gjsify/adwaita-web` carries, recorded as
// `HeaderBarRenderState.derivedSubtitle` in `@gjsify/adwaita-core`. It was absent
// from this ledger, which reads as "no divergence here".
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-header-bar` / `_headerbar.scss`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_header-bar.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { View } from '@nativescript/core';
import { GridLayout, ItemSpec, StackLayout } from '@nativescript/core';
import { AdwWindowTitle } from './adw-window-title.js';
import { resolveBuilderSlot } from './builder-slots.js';
import { classNameWith, normalizeCssClasses } from './css-classes.js';

/**
 * The slots a template may name, spelled as this widget's own properties —
 * `<AdwHeaderBar.titleWidget>`, `<AdwHeaderBar.startBox>`, `<AdwHeaderBar.endBox>`.
 */
const HEADER_BAR_SLOTS = ['titleWidget', 'startBox', 'endBox'] as const;

export class AdwHeaderBar extends GridLayout {
    /** The start (left) slot — a horizontal stack. */
    protected readonly _startBox: StackLayout;
    /** The end (right) slot — a horizontal stack. */
    protected readonly _endBox: StackLayout;
    /** The centered title widget (default {@link AdwWindowTitle}). */
    private _titleWidget: View;
    private _cssClasses: string[] = [];

    constructor() {
        super();

        this.className = 'adw-header-bar';

        // Columns: `auto, *, auto` — start hugs, center expands, end hugs.
        this.addColumn(new ItemSpec(1, 'auto'));
        this.addColumn(new ItemSpec(1, 'star'));
        this.addColumn(new ItemSpec(1, 'auto'));
        this.addRow(new ItemSpec(1, 'auto'));

        const startBox = new StackLayout();
        startBox.orientation = 'horizontal';
        startBox.className = 'adw-header-bar-start';
        GridLayout.setColumn(startBox, 0);
        this.addChild(startBox);
        this._startBox = startBox;

        const title = new AdwWindowTitle();
        title.horizontalAlignment = 'center';
        title.verticalAlignment = 'middle';
        GridLayout.setColumn(title, 1);
        this.addChild(title);
        this._titleWidget = title;

        const endBox = new StackLayout();
        endBox.orientation = 'horizontal';
        endBox.className = 'adw-header-bar-end';
        endBox.horizontalAlignment = 'right';
        GridLayout.setColumn(endBox, 2);
        this.addChild(endBox);
        this._endBox = endBox;
    }

    /** The header title — forwarded to the default {@link AdwWindowTitle}. */
    get title(): string {
        return this._titleWidget instanceof AdwWindowTitle ? this._titleWidget.title : '';
    }

    set title(value: string) {
        if (this._titleWidget instanceof AdwWindowTitle) {
            this._titleWidget.title = value ?? '';
        }
    }

    /** The header subtitle — forwarded to the default {@link AdwWindowTitle}. */
    get subtitle(): string {
        return this._titleWidget instanceof AdwWindowTitle ? this._titleWidget.subtitle : '';
    }

    set subtitle(value: string) {
        if (this._titleWidget instanceof AdwWindowTitle) {
            this._titleWidget.subtitle = value ?? '';
        }
    }

    /**
     * The style classes this header bar carries (`GtkWidget:css-classes`), without the
     * `adw-header-bar` class that makes it one — GTK's own rule for the property.
     *
     * IT WAS `flat`, A BOOLEAN (ADR 0049), and the port's own doc said what it really was:
     * "matching `Adw.HeaderBar`'s `.flat` style. Toggling swaps the `flat` class." A style
     * class is `GtkWidget:css-classes` on GTK, which is a LIST — so `flat` was one look
     * with a property of its own while every other look had none.
     *
     * `header.cssClasses = 'flat'` replaces `header.flat = true`, and from XML
     * `cssClasses="flat"` replaces `flat="true"`.
     */
    get cssClasses(): string[] {
        return [...this._cssClasses];
    }

    set cssClasses(value: string | null | undefined) {
        this._cssClasses = normalizeCssClasses(value);
        this.className = classNameWith('adw-header-bar', this._cssClasses);
    }

    /** Pack a widget at the start (left) of the bar — `gtk_box_append`. */
    packStart(view: View): void {
        // adw-header-bar.c:1083 — appended, so successive children run left to
        // right and the first one packed sits furthest from the centre.
        this._startBox.addChild(view);
    }

    /**
     * Pack a widget at the end (right) of the bar.
     *
     * `adw_header_bar_pack_end` PREPENDS (`gtk_box_prepend`,
     * adw-header-bar.c:1106): "packed with reference to the end" means the FIRST
     * widget packed is the one nearest the end of the bar, and each later one
     * goes in front of it. The port appended instead, so every end slot came out
     * mirrored — `packEnd(menu); packEnd(search)` drew `menu | search` where
     * libadwaita draws `search | menu`, with the menu button in the corner.
     */
    packEnd(view: View): void {
        this._endBox.insertChild(view, 0);
    }

    /** Replace the centered title widget with a custom one (e.g. a URL entry). */
    setTitleWidget(view: View): void {
        if (this._titleWidget) {
            this.removeChild(this._titleWidget);
        }
        view.horizontalAlignment = 'center';
        view.verticalAlignment = 'middle';
        GridLayout.setColumn(view, 1);
        this.addChild(view);
        this._titleWidget = view;
    }

    /**
     * XML inflation — route a template's child through the packing API.
     *
     * NativeScript spells a slot as a complex property, so `<AdwHeaderBar.endBox>`
     * arrives here as `endBox`; a bare child arrives under its element name and
     * takes the fallback, `packStart`. Without this the `GridLayout` default added
     * the view straight to the grid at column 0: measured on Android, a header bar
     * written in markup left `startBox` and `endBox` empty while the button still
     * appeared, so it LOOKED packed and was not — a second one would have been
     * drawn on top of the first rather than beside it.
     */
    _addChildFromBuilder(name: string, view: View): void {
        switch (resolveBuilderSlot(name, HEADER_BAR_SLOTS, 'startBox')) {
            case 'titleWidget':
                this.setTitleWidget(view);
                return;
            case 'endBox':
                this.packEnd(view);
                return;
            default:
                this.packStart(view);
        }
    }

    /** The centered title widget. */
    get titleWidget(): View {
        return this._titleWidget;
    }

    /** The start (left) slot container. */
    get startBox(): StackLayout {
        return this._startBox;
    }

    /** The end (right) slot container. */
    get endBox(): StackLayout {
        return this._endBox;
    }
}
