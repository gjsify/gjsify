// AdwPreferencesGroup — a Libadwaita-style preferences group for NativeScript.
//
// Renders a REAL NativeScript `StackLayout`: a header row (a title + dimmed
// description label column, plus an optional trailing header-suffix view) above
// a `.boxed-list` container that holds rows (`AdwActionRow` / `AdwSwitchRow`).
// Styled like `Adw.PreferencesGroup` via the `adw-preferences-group` /
// `boxed-list` CSS classes (see `src/theme/adwaita.css`).
//
// Which of those parts is shown is NOT decided here: `preferencesGroupVisuals`
// (over `@gjsify/adwaita-core`'s `derivePreferencesGroupHeader`) answers it for
// this renderer and for the browser one alike, so the two cannot drift. This
// port previously derived only "the title is non-empty", and expressed it by
// adding and removing the `Label` from the tree — it had no description, no
// header suffix, no `single-line` state and no listbox rule.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-preferences-group` / `_preferences.scss`.
// Reference: refs/libadwaita/src/adw-preferences-group.c (add/remove, :91-156)
// Reference: refs/libadwaita/src/adw-preferences-group.ui (header_box layout)
// Reference: refs/libadwaita/src/stylesheet/widgets/_preferences.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { View } from '@nativescript/core';
import { GridLayout, ItemSpec, Label, StackLayout } from '@nativescript/core';
import { resolveBuilderSlot } from './builder-slots.js';
import { PREFERENCES_GROUP_HEADER_CLASS, preferencesGroupVisuals } from './preferences-group-state.js';
import type { NsSearchableGroup, NsSearchableRow } from './preferences-search.js';

/** The one slot a template may name — everything else is a row. */
const PREFERENCES_GROUP_SLOTS = ['headerSuffix'] as const;

export class AdwPreferencesGroup extends StackLayout implements NsSearchableGroup {
    /** The header box: labels on the leading edge, suffix on the trailing one. */
    protected readonly _header: GridLayout;
    /** The group header label. */
    protected readonly _titleLabel: Label;
    /** The dimmed description line below the title. */
    protected readonly _descriptionLabel: Label;
    /** Host for the optional `header-suffix` view. */
    protected readonly _suffixHost: StackLayout;
    /** The boxed-list container that actually holds the rows. */
    protected readonly _listbox: StackLayout;

    private _title = '';
    private _description = '';
    private _headerSuffix: View | null = null;

    constructor() {
        super();

        this.orientation = 'vertical';
        this.className = 'adw-preferences-group';

        // Header: labels (col 0, expanding) + suffix (col 1, auto).
        const header = new GridLayout();
        header.className = PREFERENCES_GROUP_HEADER_CLASS;
        header.addColumn(new ItemSpec(1, 'star'));
        header.addColumn(new ItemSpec(1, 'auto'));
        header.addRow(new ItemSpec(1, 'auto'));

        const labels = new StackLayout();
        labels.orientation = 'vertical';
        labels.className = 'adw-preferences-group-labels';
        labels.verticalAlignment = 'middle';
        GridLayout.setColumn(labels, 0);
        header.addChild(labels);

        const titleLabel = new Label();
        titleLabel.className = 'adw-preferences-group-title';
        titleLabel.textWrap = true;
        labels.addChild(titleLabel);

        const descriptionLabel = new Label();
        descriptionLabel.className = 'adw-preferences-group-description';
        descriptionLabel.textWrap = true;
        labels.addChild(descriptionLabel);

        const suffixHost = new StackLayout();
        suffixHost.orientation = 'horizontal';
        suffixHost.className = 'adw-preferences-group-suffix';
        suffixHost.verticalAlignment = 'middle';
        GridLayout.setColumn(suffixHost, 1);
        header.addChild(suffixHost);

        const listbox = new StackLayout();
        listbox.orientation = 'vertical';
        listbox.className = 'boxed-list adw-preferences-group-listbox';

        this.addChild(header);
        this.addChild(listbox);

        this._header = header;
        this._titleLabel = titleLabel;
        this._descriptionLabel = descriptionLabel;
        this._suffixHost = suffixHost;
        this._listbox = listbox;

        this._applyVisuals();
    }

    /**
     * The group title (dim, uppercase header above the boxed list).
     *
     * `null`/`undefined` is the empty string, as
     * `adw_preferences_group_set_title` normalises it
     * (adw-preferences-group.c:508).
     */
    get title(): string {
        return this._title;
    }

    set title(value: string) {
        this._title = value ?? '';
        this._titleLabel.text = this._title;
        this._applyVisuals();
    }

    /**
     * The dimmed description line below the title.
     *
     * Normalised here even though `adw_preferences_group_set_description` passes
     * NULL straight through (:555) where its own `set_title` and
     * `adw_preferences_page_set_title` both normalise — the visibility test
     * treats NULL and `""` alike, so the inconsistency has no consequence.
     */
    get description(): string {
        return this._description;
    }

    set description(value: string) {
        this._description = value ?? '';
        this._descriptionLabel.text = this._description;
        this._applyVisuals();
    }

    /**
     * The `header-suffix` view — displayed above the list, next to the title and
     * description; commonly a button or a spinner for the whole group
     * (`adw_preferences_group_set_header_suffix`, :597-625).
     *
     * A suffix keeps the header alive even with no title AND makes it
     * single-line, which is why it feeds the derivation rather than only the
     * tree.
     */
    get headerSuffix(): View | null {
        return this._headerSuffix;
    }

    set headerSuffix(view: View | null) {
        if (view === this._headerSuffix) return;
        if (this._headerSuffix) this._suffixHost.removeChild(this._headerSuffix);
        this._headerSuffix = view;
        if (this._headerSuffix) this._suffixHost.addChild(this._headerSuffix);
        this._applyVisuals();
    }

    /**
     * XML inflation — a template's children are ROWS, not stray layout children.
     *
     * `<AdwPreferencesGroup.headerSuffix>` reaches the suffix host; everything
     * else goes into the boxed list, which is where a row has to be to get the
     * card, the rounded ends and the separators. Without this the `StackLayout`
     * default appended each row NEXT TO the listbox: measured on Android, the
     * rows rendered — unboxed, on the page background, with no `.boxed-list`
     * around them — which is the failure that looks like a styling bug.
     */
    _addChildFromBuilder(name: string, view: View): void {
        if (resolveBuilderSlot(name, PREFERENCES_GROUP_SLOTS, 'row') === 'headerSuffix') {
            this.headerSuffix = view;
            return;
        }
        this.addRow(view);
    }

    /** Append a row (or any view) to the boxed list. */
    addRow(view: View): void {
        this._listbox.addChild(view);
        this._refreshRowEdges();
        this._applyVisuals();
    }

    /** Remove a previously-added row from the boxed list. */
    removeRow(view: View): void {
        this._listbox.removeChild(view);
        this._refreshRowEdges();
        this._applyVisuals();
    }

    /**
     * The rows this group contributes to a preferences search, in listbox order.
     *
     * Reads the live children rather than a parallel list, so a consumer that
     * empties the listbox directly (the storybook's controls panel does) cannot
     * leave a stale index behind.
     */
    searchRows(): readonly NsSearchableRow[] {
        const rows: NsSearchableRow[] = [];
        const count = this._listbox.getChildrenCount();
        for (let index = 0; index < count; index++) {
            rows.push(this._listbox.getChildAt(index) as unknown as NsSearchableRow);
        }
        return rows;
    }

    /**
     * Push the derived header/listbox state onto the views.
     *
     * Re-reads the live child count on every call — `update_listbox_visibility`
     * is wired to the row model's `items-changed`
     * (adw-preferences-group.c:335-339), so the rule has to hold after every
     * mutation and not only at construction.
     */
    private _applyVisuals(): void {
        const visuals = preferencesGroupVisuals({
            title: this._title,
            description: this._description,
            hasHeaderSuffix: this._headerSuffix !== null,
            rowCount: this._listbox.getChildrenCount(),
        });

        this._titleLabel.visibility = visuals.titleVisibility;
        this._descriptionLabel.visibility = visuals.descriptionVisibility;
        this._header.visibility = visuals.headerVisibility;
        this._header.className = visuals.headerClassName;
        this._listbox.visibility = visuals.listboxVisibility;
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
