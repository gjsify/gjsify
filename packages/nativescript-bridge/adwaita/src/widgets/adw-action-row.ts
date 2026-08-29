// AdwActionRow — a Libadwaita-style action row for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` (columns `auto, *, auto`): a leading
// PREFIX slot in column 0, a title+subtitle `Label` stack in column 1, and a
// trailing SUFFIX slot in column 2 — matching `Adw.ActionRow`'s prefix / text /
// suffix layout (the prefix typically holds an `AdwIcon` symbolic icon). Styled
// via the `adw-row adw-action-row` CSS classes (see `src/theme/adwaita.css`) —
// NOT a webview.
//
// The label-visibility rule and the `activatable-widget` ↔ `activatable` coupling
// are HEADLESS and live in `@gjsify/adwaita-core` (ADR 0004); the NS mapping
// (`View.visibility`, `isUserInteractionEnabled`) is in the pure sibling
// `row-state.ts`, which the spec suite drives directly.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-action-row` / `_row.scss`.
// Reference: refs/libadwaita/src/adw-action-row.c, adw-action-row.ui
// Reference: refs/libadwaita/src/stylesheet/widgets/_lists.scss (AdwActionRow)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, StackLayout, Label, View, type EventData } from '@nativescript/core';
import { ActionRowState, isViewSensitive, rowLabelVisuals } from './row-state.js';
import { xmlBoolean } from './xml-values.js';
import { resolveBuilderSlot } from './builder-slots.js';

/** Event name emitted when the row is activated. Mirrors `Adw.ActionRow::activated`. */
export const ACTIVATED = 'activated';

/** The edges an XML child of an action row can ask for. */
const ACTION_ROW_SLOTS = ['prefix', 'suffix'] as const;

export class AdwActionRow extends GridLayout {
    /**
     * Whether libadwaita would answer `ADW_IS_ACTION_ROW` for this row, which decides
     * whether the preferences SEARCH consults its subtitle.
     *
     * A declared property, not an `instanceof` test, because this port's class tree
     * deliberately does NOT match the GObject one: `AdwEntryRow`, `AdwExpanderRow`
     * and `AdwButtonRow` extend this class to reuse the row chrome, while in C all
     * three derive from `AdwPreferencesRow`. They override this to `false`, so the
     * search behaves as GTK does.
     */
    readonly isActionRow: boolean = true;
    /** The text/value column (column 1). */
    protected readonly _textStack: StackLayout;
    protected readonly _titleLabel: Label;
    protected readonly _subtitleLabel: Label;
    /** The headless labels + activatable-widget coupling (ADR 0004). */
    protected readonly _rowState = new ActionRowState<View>();
    private _prefix: View | null = null;
    private _suffix: View | null = null;

    constructor() {
        super();

        this.className = 'adw-row adw-action-row';

        // Columns: `auto, *, auto` — prefix hugs, text expands, suffix hugs.
        this.addColumn(new ItemSpec(1, 'auto'));
        this.addColumn(new ItemSpec(1, 'star'));
        this.addColumn(new ItemSpec(1, 'auto'));
        this.addRow(new ItemSpec(1, 'auto'));

        // Column 1: a vertical stack holding title + subtitle.
        const textStack = new StackLayout();
        textStack.orientation = 'vertical';
        textStack.className = 'adw-row-text';
        GridLayout.setColumn(textStack, 1);

        const titleLabel = new Label();
        titleLabel.className = 'adw-row-title';
        titleLabel.textWrap = true;
        textStack.addChild(titleLabel);

        // Both labels live in the tree from the start and are COLLAPSED when empty,
        // so the visibility rule stays a repaint rather than a structural change.
        const subtitleLabel = new Label();
        subtitleLabel.className = 'adw-row-subtitle';
        subtitleLabel.textWrap = true;
        textStack.addChild(subtitleLabel);

        this.addChild(textStack);

        this._textStack = textStack;
        this._titleLabel = titleLabel;
        this._subtitleLabel = subtitleLabel;
        this._applyLabels();

        this.addEventListener('tap', () => this.activate());
    }

    /** Install a prefix widget in column 0. Replaces any previous one; `null` clears. */
    setPrefix(view: View | null): void {
        if (this._prefix) {
            this.removeChild(this._prefix);
            this._prefix = null;
        }
        if (view) {
            view.className = `${view.className ?? ''} adw-row-prefix`.trim();
            GridLayout.setColumn(view, 0);
            this.addChild(view);
            this._prefix = view;
        }
    }

    get prefix(): View | null {
        return this._prefix;
    }

    /** The row title (column 1, top line). */
    get title(): string {
        return this._rowState.title;
    }

    set title(value: string) {
        if (this._rowState.setTitle(value)) this._applyLabels();
    }

    /**
     * The row subtitle (column 1, dim second line). Empty collapses its label so it
     * leaves no blank gap — `string_is_not_empty`, the rule the title follows too.
     */
    get subtitle(): string {
        return this._rowState.subtitle;
    }

    set subtitle(value: string) {
        if (this._rowState.setSubtitle(value)) this._applyLabels();
    }

    /** Install a suffix widget in column 2. Replaces any previous one; `null` clears. */
    setSuffix(view: View | null): void {
        if (this._suffix) {
            this.removeChild(this._suffix);
            this._suffix = null;
        }
        if (view) {
            view.className = `${view.className ?? ''} adw-row-suffix`.trim();
            GridLayout.setColumn(view, 2);
            this.addChild(view);
            this._suffix = view;
        }
    }

    get suffix(): View | null {
        return this._suffix;
    }

    /**
     * An XML child goes to a named edge, and a bare one to the SUFFIX.
     *
     * The fallback is libadwaita's: `AdwActionRow`'s buildable adds an untyped child
     * with `adw_action_row_add_suffix`. Without this override, `LayoutBase`'s default
     * `addChild` drops the child into the grid with no `adw-row-prefix` /
     * `adw-row-suffix` class and no column, so it lands on top of the title.
     *
     * The subclasses inherit it, and that is deliberate but sharp-edged: a switch row
     * builds its own `Switch` as the suffix in its constructor, and `setSuffix`
     * REPLACES. An explicit `<AdwSwitchRow.suffix>` therefore takes the switch's
     * place, which is what "set the suffix" has to mean.
     */
    _addChildFromBuilder(name: string, view: View): void {
        if (resolveBuilderSlot(name, ACTION_ROW_SLOTS, 'suffix') === 'prefix') this.setPrefix(view);
        else this.setSuffix(view);
    }

    /** `Adw.ActionRow:activatable-widget` — the widget this row activates. */
    get activatableWidget(): View | null {
        return this._rowState.activatableWidget;
    }

    /**
     * Set the activatable widget. Its sensitivity is copied into `activatable`;
     * clearing it LEAVES the row activatable. Call
     * {@link syncActivatableWidgetSensitivity} when the widget's
     * `isUserInteractionEnabled` changes — NativeScript has no property-change
     * notification a plain `View` write goes through, so the live half of the binding
     * has to be driven, not observed.
     */
    set activatableWidget(widget: View | null) {
        this._rowState.setActivatableWidget(widget, isViewSensitive(widget));
    }

    /** Re-read the activatable widget's sensitivity — the live half of the binding. */
    syncActivatableWidgetSensitivity(): void {
        const widget = this._rowState.activatableWidget;
        if (widget) this._rowState.setActivatableWidgetSensitive(isViewSensitive(widget));
    }

    /** `GtkListBoxRow:activatable` — whether a tap activates this row at all. */
    get activatable(): boolean {
        return this._rowState.activatable;
    }

    set activatable(value: boolean | string) {
        this._rowState.setActivatable(xmlBoolean(value, false));
    }

    /**
     * `adw_action_row_activate`: forward to the activatable widget, then emit
     * `activated`. A no-op while unactivatable, because a tap on a non-activatable
     * `GtkListBoxRow` never reaches here.
     *
     * FORWARDING IS SUBCLASS BUSINESS here: GTK sends `mnemonic-activate` and every
     * widget knows what that means for itself, while NativeScript has no such
     * primitive on `View` — so `AdwSwitchRow` overrides this to toggle its slider and
     * a plain action row only emits.
     */
    activate(): void {
        if (!this._rowState.activatable) return;
        const data: EventData = { eventName: ACTIVATED, object: this };
        this.notify(data);
    }

    /**
     * Whether this row's own title visibility follows `string_is_not_empty`.
     *
     * `AdwEntryRow` sets it `false`: its two titles are the endpoints of libadwaita's
     * empty↔filled CROSS-FADE, so which shows is decided by `emptyTarget`, not by
     * whether the string is empty. Without the opt-out, setting a title on an entry
     * row reveals the small floating label on top of the large placeholder.
     */
    protected _managesTitleVisibility = true;

    /** Push the derived label text + visibility onto the two `Label`s. */
    protected _applyLabels(): void {
        const visuals = rowLabelVisuals({ title: this._rowState.title, subtitle: this._rowState.subtitle });
        this._titleLabel.text = visuals.title;
        if (this._managesTitleVisibility) this._titleLabel.visibility = visuals.titleVisibility;
        this._subtitleLabel.text = visuals.subtitle;
        this._subtitleLabel.visibility = visuals.subtitleVisibility;
    }
}
