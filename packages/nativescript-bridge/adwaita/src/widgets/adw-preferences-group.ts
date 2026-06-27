// AdwPreferencesGroup — a Libadwaita-style preferences group for NativeScript.
//
// Renders a REAL NativeScript `StackLayout` containing an optional dim,
// uppercase header `Label` and a `.boxed-list` container that holds rows
// (`AdwActionRow` / `AdwSwitchRow`). Styled like `Adw.PreferencesGroup` via the
// `adw-preferences-group` / `boxed-list` CSS classes (see `src/theme/adwaita.css`).
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-preferences-group` / `_preferences.scss`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_preferences.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { StackLayout, Label, View } from '@nativescript/core';

export class AdwPreferencesGroup extends StackLayout {
    /** The group header label (created lazily — only in the tree when a title is set). */
    protected readonly _titleLabel: Label;
    private _hasTitle = false;
    /** The boxed-list container that actually holds the rows. */
    protected readonly _listbox: StackLayout;

    constructor() {
        super();

        this.orientation = 'vertical';
        this.className = 'adw-preferences-group';

        const titleLabel = new Label();
        titleLabel.className = 'adw-preferences-group-title';
        titleLabel.textWrap = true;

        const listbox = new StackLayout();
        listbox.orientation = 'vertical';
        listbox.className = 'boxed-list adw-preferences-group-listbox';

        this.addChild(listbox);

        this._titleLabel = titleLabel;
        this._listbox = listbox;
    }

    /**
     * The group title (dim, uppercase header above the boxed list). Setting a
     * non-empty value inserts the header label above the list; setting empty
     * removes it — so a titleless group has no blank header, matching
     * `Adw.PreferencesGroup`.
     */
    get title(): string {
        return this._hasTitle ? (this._titleLabel.text ?? '') : '';
    }

    set title(value: string) {
        const text = value ?? '';
        this._titleLabel.text = text;
        const wantTitle = text.length > 0;
        if (wantTitle && !this._hasTitle) {
            // Header goes ABOVE the listbox (index 0).
            this.removeChild(this._listbox);
            this.addChild(this._titleLabel);
            this.addChild(this._listbox);
            this._hasTitle = true;
        } else if (!wantTitle && this._hasTitle) {
            this.removeChild(this._titleLabel);
            this._hasTitle = false;
        }
    }

    /** Append a row (or any view) to the boxed list. */
    addRow(view: View): void {
        this._listbox.addChild(view);
        this._refreshRowEdges();
    }

    /** Remove a previously-added row from the boxed list. */
    removeRow(view: View): void {
        this._listbox.removeChild(view);
        this._refreshRowEdges();
    }

    /**
     * Mark the FIRST row so it draws no top separator. Adwaita draws hairline
     * separators BETWEEN rows only; the `.boxed-list .adw-row` top-border rule
     * would otherwise also stroke above the first row (NS does not clip it under
     * the card's rounded corner), reading as a stray line. NS has no
     * `:first-child`, so toggle an `adw-row-flush-top` class. Recomputes from the
     * live children, so it stays correct after a `listbox.removeChildren()` +
     * re-add (the controls panel's refresh path). */
    private _refreshRowEdges(): void {
        const n = this._listbox.getChildrenCount();
        for (let i = 0; i < n; i++) {
            const child = this._listbox.getChildAt(i);
            if (child) this._setFlushTop(child, i === 0);
        }
    }

    private _setFlushTop(view: View, flush: boolean): void {
        const base = (view.className ?? '').replace(/\s*\badw-row-flush-top\b/g, '');
        view.className = flush ? `${base} adw-row-flush-top`.trim() : base.trim();
    }

    /** The boxed-list container (column of rows). */
    get listbox(): StackLayout {
        return this._listbox;
    }
}
