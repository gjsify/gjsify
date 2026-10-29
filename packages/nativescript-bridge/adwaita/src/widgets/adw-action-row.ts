// AdwActionRow — a Libadwaita-style action row for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` (columns `auto, *, auto`): a leading
// PREFIX slot in column 0, a title+subtitle `Label` stack in column 1, and a
// trailing SUFFIX slot in column 2 — matching `Adw.ActionRow`'s prefix / text /
// suffix layout (the prefix typically holds an `GtkImage` symbolic icon). Styled
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
//
// FOUR OF ITS PROPERTIES ARE A REAL GObject's (ADR 0105 § 2, route D). `title`, `subtitle`,
// `icon-name` and `activatable` are DECLARED at the `extends` and built by the seam: on Android
// this class is a GType registered over `GridLayout`, and `AdwSwitchRow` then registers over THIS
// GType — the first derived registration in the port, and the reason node-gi learned to walk a
// chain with a plain NativeScript class sitting between two registered ones. Off-device the seam
// installs its own accessors with the same names, notifies and equal-write rule.
//
// WHAT THAT COSTS THIS FILE, beyond the four accessors becoming `declare` lines:
//   - `_applyLabels()` and `_applyIconName()` hang off `notify::` instead of a setter, because
//     node-gi reads a declared property out of the GObject's store and never calls a JS getter.
//   - NOTHING MAY REFUSE A WRITE FROM A `notify::` HANDLER. A handler that throws is logged and
//     the next one still runs — GJS's own rule (measured), node-gi's (gi.js:431), and now the
//     seam's on both legs — while the property keeps the written value. A TypeError there would
//     therefore reject nothing. `iconName` used to throw when `add_prefix` already held the
//     slot; it now REPLACES, which is `add_prefix`'s own rule.
//   - `activated` is still a NativeScript event rather than a declared signal. Declaring it is
//     the eventual shape (a declared member lives behind `connect` alone, see `signals.ts`), and
//     it waits for the first widget that needs a signal ON the real leg to carry the node-gi
//     side of it; nothing here is kept as it is for a consumer's sake.
//   - `ActionRowState` keeps only the activatable-widget ↔ sensitivity BINDING (ADR 0004); the
//     labels' change detection is the property's now, and the binding's result is mirrored into
//     the declared `activatable` using the "changed" booleans, so an unchanged re-assert cannot
//     undo a direct write.

import type { View } from '@nativescript/core';
import { GridLayout, ItemSpec, StackLayout, Label, type EventData } from '@nativescript/core';
import { adwSubtitleWriteNotifies } from '@gjsify/adwaita-core';
import { ActionRowState, isViewSensitive, rowLabelVisuals } from './row-state.js';
import { builderSlotsOf, resolveBuilderSlot } from './builder-slots.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';
import type { GObjectNotify } from './signals.js';
import { GtkImage } from './gtk-image.js';

/** Event name emitted when the row is activated. Mirrors `Adw.ActionRow::activated`. */
export const ACTIVATED = 'activated';

/** Event name emitted when {@link AdwActionRow.title} changes. */
export const NOTIFY_TITLE = 'notify::title';

/** Event name emitted when {@link AdwActionRow.subtitle} changes. */
export const NOTIFY_SUBTITLE = 'notify::subtitle';

/** Event name emitted when {@link AdwActionRow.iconName} changes. */
export const NOTIFY_ICON_NAME = 'notify::icon-name';

/** Event name emitted when {@link AdwActionRow.activatable} changes. */
export const NOTIFY_ACTIVATABLE = 'notify::activatable';

/** The edges an XML child of an action row can ask for. */
const ACTION_ROW_SLOTS = ['prefix', 'suffix'] as const;

export class AdwActionRow extends withSignals(GridLayout, {
    GTypeName: 'AdwActionRow',
    Properties: {
        title: { kind: 'string', default: '', blurb: 'The title of the row' },
        // `adw_action_row_set_subtitle` (adw-action-row.c:571) guards on `g_strcmp0 (label text,
        // subtitle)`, and the label text is never NULL: a `null` write is never the early
        // return, notifies every time and reads `""` back. `''` against `''` is silent.
        subtitle: {
            kind: 'string',
            default: '',
            blurb: 'The subtitle of the row',
            normalize: (value) => (value === null || value === undefined ? '' : String(value)),
            changed: (next, held, written) =>
                adwSubtitleWriteNotifies(String(held), written === null || written === undefined ? null : String(next)),
        },
        // Canonical and dashed, as GObject spells it; the seam generates all three spellings.
        'icon-name': { kind: 'string', default: '', blurb: 'The icon name for this row' },
        activatable: { kind: 'boolean', default: false, blurb: 'Whether this row can be activated' },
    },
}) {
    static readonly GTypeName: string = 'AdwActionRow';

    /** The names this widget's `_addChildFromBuilder` honours — see `./builder-slots.ts`. */
    static readonly builderSlots: readonly string[] = builderSlotsOf(ACTION_ROW_SLOTS, 'suffix');

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

    /** The row title (column 1, top line). Empty collapses its label. */
    declare title: string;

    /**
     * The row subtitle (column 1, dim second line). Empty collapses its label so it
     * leaves no blank gap — `string_is_not_empty`, the rule the title follows too.
     */
    declare subtitle: string;

    /**
     * `AdwActionRow:icon-name` — an icon in the prefix slot, before the title.
     *
     * It TAKES that slot: setting it over a widget `add_prefix` put there replaces it, the same
     * one-slot rule `add_prefix` applies to itself. The twin threw instead, which a declared
     * property cannot (see the header).
     */
    declare iconName: string;

    /** `GtkListBoxRow:activatable` — whether a tap activates this row at all. */
    declare activatable: boolean;

    /** `notify('title')` beside NativeScript's `notify({ eventName })` — see {@link GObjectNotify}. */
    declare notify: GObjectNotify;

    /** The text/value column (column 1). */
    protected readonly _textStack: StackLayout;
    protected readonly _titleLabel: Label;
    protected readonly _subtitleLabel: Label;
    /**
     * The activatable-widget ↔ sensitivity binding (ADR 0004). No longer the labels' store:
     * `title` and `subtitle` are the declared properties', and their change detection with them.
     */
    protected readonly _rowState = new ActionRowState<View>();
    private _prefix: View | null = null;
    private _iconImage: GtkImage | null = null;
    private _suffix: View | null = null;

    constructor(props?: ConstructProps<AdwActionRow>) {
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

        // The property is the source of truth now, and a notification is what says it moved — on
        // either leg. The handler reads the EMITTER rather than an enclosing `this`, the idiom
        // `tests/integration/nativescript-gi/app/specs/foreign-parent.ts` settled on.
        this.connect(NOTIFY_TITLE, (self) => self._applyLabels());
        this.connect(NOTIFY_SUBTITLE, (self) => self._applyLabels());
        this.connect(NOTIFY_ICON_NAME, (self) => self._applyIconName());
        // The other direction of the binding mirror, so the two halves cannot drift: a direct
        // write to `activatable` is also what `ActionRowState` holds, and the next unchanged
        // sensitivity re-assert therefore stays the no-op `gtk_widget_set_sensitive` makes it.
        this.connect(NOTIFY_ACTIVATABLE, (self) => {
            self._rowState.setActivatable(self.activatable);
        });

        this._applyLabels();

        this.addEventListener('tap', () => this.activate());

        applyConstructProps(this, props);
    }

    /**
     * Install a prefix widget in column 0 — `adw_action_row_add_prefix`.
     *
     * ONE slot per edge on this port, where libadwaita keeps a box: a second call
     * REPLACES the first. The verb converges (a widget goes in, on both sides) and the
     * cardinality is the declared remainder — the method ledger in
     * `scripts/check-vocabulary-alignment.mjs` compares names, and ADR 0034 § Amendment 14
     * names this as the divergence a name cannot carry. `remove()` clears the slot.
     *
     * INSERTED FIRST, NOT APPENDED, and on a `GridLayout` that is about the COMPOSED TREE
     * rather than the layout: the column decides where it draws either way, so appending
     * looked free — until an authored tree put a prefix on a row and the port realised it
     * AFTER the disclosure's own rows, where `gtk_widget_get_first_child` and
     * `<div class="adw-entry-row-prefixes">` both put it first. `adwaita-web`'s own slot
     * binding already records the rule ("`addPrefix` PREPENDS, mirroring `gtk_box_prepend`");
     * this is the third renderer joining it.
     *
     * An icon {@link AdwActionRow.iconName} put there is displaced like any other prefix, and
     * clearing the property is part of that — see `remove()`.
     */
    add_prefix(view: View): void {
        if (this._prefix) this.remove(this._prefix);
        view.className = `${view.className ?? ''} adw-row-prefix`.trim();
        GridLayout.setColumn(view, 0);
        this.insertChild(view, 0);
        this._prefix = view;
    }

    get prefix(): View | null {
        return this._prefix;
    }

    /** Install a suffix widget in column 2 — `adw_action_row_add_suffix`. Same one-slot rule as {@link add_prefix}. */
    add_suffix(view: View): void {
        if (this._suffix) this.remove(this._suffix);
        view.className = `${view.className ?? ''} adw-row-suffix`.trim();
        GridLayout.setColumn(view, 2);
        this.addChild(view);
        this._suffix = view;
    }

    /**
     * Remove a prefix or suffix previously added — `adw_action_row_remove`.
     *
     * A view in neither slot throws, where C logs a critical and returns: a silent
     * no-op here is the failure the construct-props bag refuses one door over.
     */
    remove(view: View): void {
        if (view === this._prefix) this._prefix = null;
        else if (view === this._suffix) this._suffix = null;
        else {
            throw new TypeError(
                `${this.constructor.name}.remove(): the view is neither this row's prefix nor its suffix. ` +
                    'add_prefix()/add_suffix() are the only two slots remove() clears.',
            );
        }
        this.removeChild(view);
        // The icon leaving the slot is what clears `icon-name` — whether it was removed outright
        // or displaced by `add_prefix`, which removes the held prefix on its way in. Keeping the
        // clear HERE is what makes `_iconImage !== null` imply `_prefix === _iconImage`, so the
        // property and the tree cannot disagree about which widget the icon is.
        if (view === this._iconImage) {
            this._iconImage = null;
            this.iconName = '';
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
     * builds its own `Switch` as the suffix in its constructor, and `add_suffix` on this
     * one-slot port REPLACES. An explicit `<adw:SwitchRow.suffix>` therefore takes the
     * switch's place, which is what "the suffix" has to mean here.
     */
    _addChildFromBuilder(name: string, view: View): void {
        if (resolveBuilderSlot(name, ACTION_ROW_SLOTS, 'suffix') === 'prefix') this.add_prefix(view);
        else this.add_suffix(view);
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
        if (!this._rowState.setActivatableWidget(widget, isViewSensitive(widget))) return;
        // `G_BINDING_SYNC_CREATE` copies the widget's sensitivity across on the spot; unsetting
        // leaves `activatable` alone, which is why only a non-null widget mirrors.
        if (widget !== null) this.activatable = this._rowState.activatable;
    }

    /** Re-read the activatable widget's sensitivity — the live half of the binding. */
    syncActivatableWidgetSensitivity(): void {
        const widget = this._rowState.activatableWidget;
        if (!widget) return;
        // The returned boolean is the gate: it is false both when nothing is bound and when the
        // sensitivity is unchanged, and mirroring unconditionally would let the binding re-assert
        // itself over a direct `activatable` write that GTK's one-way binding lets stand.
        if (this._rowState.setActivatableWidgetSensitive(isViewSensitive(widget))) {
            this.activatable = this._rowState.activatable;
        }
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
        if (!this.activatable) return;
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
        const visuals = rowLabelVisuals({ title: this.title, subtitle: this.subtitle });
        this._titleLabel.text = visuals.title;
        if (this._managesTitleVisibility) this._titleLabel.visibility = visuals.titleVisibility;
        this._subtitleLabel.text = visuals.subtitle;
        this._subtitleLabel.visibility = visuals.subtitleVisibility;
    }

    /**
     * Put the named icon in the prefix slot, or take it out again — the render half of
     * `icon-name`, run from `notify::icon-name`.
     *
     * Everything that can refuse happens BEFORE the write reaches here: an unparseable value is
     * the seam's throw, and there is nothing left for this to reject (see the header on why it
     * could not throw anyway). `remove()` is what clears the field on the way out.
     */
    private _applyIconName(): void {
        const name = this.iconName;
        if (name === '') {
            if (this._iconImage !== null) this.remove(this._iconImage);
            return;
        }
        if (this._iconImage === null) {
            this._iconImage = new GtkImage();
            this.add_prefix(this._iconImage);
        }
        this._iconImage.iconName = name;
    }
}
