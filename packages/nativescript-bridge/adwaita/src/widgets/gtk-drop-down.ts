// GtkDropDown — the Adwaita-styled GTK dropdown selector for NativeScript.
//
// NAMED FOR THE LIBRARY THAT OWNS THE GTYPE (ADR 0034 clause 1): libadwaita vendors no
// `adw-drop-down.c` and ships no dropdown type, as the FIDELITY note below says while
// listing what it therefore cannot reproduce. `AdwComboRow` is the boxed-list row form
// and IS a genuine Adw type; this one is `Gtk.DropDown`.
//
// The toolbar/inline twin of {@link AdwComboRow}: the same selection, without the
// boxed-list row around it. A button-shaped horizontal box showing the selected
// option's label plus a `pan-down` chevron; tapping it opens the chooser and the
// pick updates the label and emits `notify::selected`. Reach for this one when a
// dropdown sits in a header bar or a toolbar, and for `AdwComboRow` when it
// belongs to a preferences list.
//
// The selection STATE MACHINE is the row's: `ComboState` from `@gjsify/adwaita-core`
// (ADR 0004), held to its `COMBO_SELECTION_VECTORS`. This class is the render half only,
// so the standalone control and the row cannot drift apart.
//
// FIDELITY: approximated for the popover — the NS subset has none, so the options open
// in the platform `action()` sheet, the same substitution `AdwComboRow`,
// `AdwSplitButton` and `GtkMenuButton` make. Two unhideable consequences: the sheet has
// no search field, so `Gtk.DropDown:enable-search` is deliberately ABSENT rather than
// accepted-and-ignored; and the sheet marks nothing as selected, so the current option
// is visible only on the button (libadwaita vendors no `adw-drop-down.c`, so GtkDropDown's
// own factory model and selected-row check are not reproduced here).
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_dropdowns.scss
//   (`dropdown > button > box` border-spacing, the 16px `arrow`)
// Reference: refs/libadwaita/src/adw-combo-row.c (the shared selection semantics)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { panDownSymbolic } from '@gjsify/adwaita-icons/ui';
import { action, Label, StackLayout, type View } from '@nativescript/core';
import {
    ADW_COMBO_NO_SELECTION,
    ComboState,
    GjsifyOptionList,
    ListModel,
    TYPE_OBJECT,
    readModelWrite,
} from '@gjsify/adwaita-core';
import type { AdwComboOption, ComboNotify, ComboWatchableModel } from '@gjsify/adwaita-core';
import { GtkImage } from './gtk-image.js';
import { attachRowPressFeedback } from './row-press.js';
import { builderSlotsOf, resolveBuilderSlot } from './builder-slots.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { pushDeclared, readDeclaredValue, withSignals, type GObjectNotify } from './signals.js';

/** Event name emitted when {@link GtkDropDown.selected} changes. Mirrors GObject `notify::selected`. */
export const NOTIFY_SELECTED = 'notify::selected';

/** Mirrors GObject `notify::selected-item`; fired right after the one above, on the same change. */
export const NOTIFY_SELECTED_ITEM = 'notify::selected-item';

/**
 * What a declared property's {@link DeclaredProperty.normalize} reads off the widget. Structural,
 * because `normalize` is handed a bare `object` while the instance may still be constructing (the
 * `EntryRowValues` precedent) — and because these members are private to the class, which a cast
 * to `GtkDropDown` could not reach. The twin of `ComboRowValues`, as the two widgets are twins.
 */
interface DropDownValues {
    readonly _state: ComboState;
    readonly _authored: GjsifyOptionList;
    _pendingSelected: number | null;
    readonly model: ComboWatchableModel | null;
    readonly selected: number;
}

export class GtkDropDown extends withSignals(StackLayout, {
    GTypeName: 'GtkDropDown',
    // THE SAME THREE DECLARATIONS AS `AdwComboRow`, deliberately verbatim: the two widgets are
    // one selection (`ComboState`) behind two renderers, held to one conformance table, and a
    // declaration that differed between them would be a drift the table cannot catch. Why each
    // is `explicitNotify`, why two are object-kind, and why `selected` is `int` where GTK says
    // `guint` — see `adw-combo-row.ts`, which states it once.
    Properties: {
        model: {
            kind: 'object',
            valueType: ListModel,
            explicitNotify: true,
            blurb: 'Model for the displayed items',
            normalize: (value, self) => readModelWrite(value, (self as DropDownValues)._authored),
            afterNotify: (self) => {
                const dropDown = self as DropDownValues;
                dropDown._state.setModel(dropDown.model);
                const pending = dropDown._pendingSelected;
                if (pending !== null && dropDown._state.hasIndex(pending)) {
                    dropDown._pendingSelected = null;
                    dropDown._state.setSelectedIndex(pending);
                }
            },
        },
        selected: {
            kind: 'int',
            default: ADW_COMBO_NO_SELECTION,
            explicitNotify: true,
            blurb: 'Position of the selected item',
            normalize: (value, self) => {
                const dropDown = self as DropDownValues;
                const next = readDeclaredValue('selected', 'int', value) as number;
                if (dropDown._state.count === 0) {
                    dropDown._pendingSelected = next;
                    return dropDown.selected;
                }
                return dropDown._state.hasIndex(next) ? next : dropDown.selected;
            },
            afterNotify: (self) => {
                const dropDown = self as DropDownValues;
                dropDown._state.setSelectedIndex(dropDown.selected);
            },
        },
        'selected-item': {
            kind: 'object',
            valueType: TYPE_OBJECT,
            explicitNotify: true,
            blurb: 'The selected item',
            normalize: (_value, self) => (self as DropDownValues)._state.selectedItem,
        },
    },
}) {
    static readonly GTypeName: string = 'GtkDropDown';

    /**
     * `model` only: `model: Gtk.StringList { strings [ … ] }` in a `.blp` places the list at
     * the property it sets (ADR 0072). `GtkDropDown` takes no child widget in GTK.
     */
    static readonly builderSlots: readonly string[] = builderSlotsOf(['model'], 'model');

    /** The button label — the selected option. */
    protected readonly _label: Label;
    /** The down-chevron — a real Adwaita `pan-down-symbolic` icon. */
    protected readonly _chevron: GtkImage;
    /** The headless options list + selectedIndex↔selectedValue state machine (ADR 0004). */
    private readonly _state = new ComboState();
    /**
     * The list the MARKUP door fills — `<gtk:DropDown model='[…]'>` is JSON text, and a real
     * `Gio.ListModel` has no attribute spelling (ADR 0122 § 5). Held for the widget's whole life
     * so re-parsing the attribute splices the list it already points at rather than replacing
     * it, which would reset the selection.
     */
    private readonly _authored = GjsifyOptionList.new(null);
    /** Title shown atop the substituted `action()` sheet. */
    private _chooserTitle = '';
    /**
     * A `selected` written while the widget has no model yet — the twin of
     * {@link AdwComboRow}'s. NativeScript's XML builder assigns every attribute before it adds
     * the children, so `<gtk:DropDown selected="1">` reached this widget before its
     * `<gtk:DropDown.model>` list did and the index was DROPPED; the row has held it since it
     * was written and the drop-down does now too.
     */
    private _pendingSelected: number | null = null;

    /** `Gtk.DropDown:model` — the list, by identity. Declared above; the seam installs it. */
    declare model: ComboWatchableModel | null;

    /**
     * `Gtk.DropDown:selected` — the selected position, or {@link ADW_COMBO_NO_SELECTION}.
     * Declared above; not `readonly` in TypeScript because the seam installs one accessor pair
     * per declared property and this widget is what writes the derived value.
     */
    declare selected: number;

    /**
     * `Gtk.DropDown:selected-item` — the model's OWN object at {@link selected}, so the identity
     * comparison a `selected-item` consumer writes holds. `null` for the sentinel and for no
     * model. Read-only by derivation (see the declaration).
     */
    declare selectedItem: unknown;

    /** GJS's `notify('<prop>')` beside NativeScript's `notify({ eventName })`; see the seam. */
    declare notify: GObjectNotify;

    constructor(props?: ConstructProps<GtkDropDown>) {
        super();

        this.orientation = 'horizontal';
        this.className = 'adw-drop-down';

        const label = new Label();
        label.className = 'adw-drop-down-label';
        label.text = '';

        // `dropdown arrow { min-height: 16px; min-width: 16px }`
        // (_dropdowns.scss:10-13) — which is exactly `DEFAULT_GTK_IMAGE_SIZE`, so
        // no size is set here. The colour is likewise left alone: an unpinned
        // GtkImage follows the light/dark scheme, and GTK draws this arrow in the
        // button's own foreground.
        const chevron = new GtkImage();
        chevron.className = 'adw-drop-down-chevron';
        chevron.iconName = panDownSymbolic;

        this.addChild(label);
        this.addChild(chevron);
        this._label = label;
        this._chevron = chevron;

        // The core state drives the button label on every change, and PUSHES the derived
        // properties silently — see `AdwComboRow`'s constructor for why the push and the
        // emission have to be two channels.
        this._state.subscribe((change) => {
            pushDeclared(this, 'selected', change.selected);
            pushDeclared(this, 'selected-item', this._state.selectedItem);
            this._label.text = change.label;
        });

        // ...and this is the one that emits, in the measured order, one `notify::` at a time.
        this._state.subscribeNotify((property: ComboNotify) => {
            pushDeclared(this, property, this._valueOf(property));
            this.notify(property);
        });

        this.addEventListener('tap', () => {
            void this._openChooser();
        });
        // ...and the button darkens while held, like an Adwaita button `:active`.
        attachRowPressFeedback(this);

        applyConstructProps(this, props);
    }

    /** What the relay pushes for each of the three — the state's reading, never the store's. */
    private _valueOf(property: ComboNotify): unknown {
        if (property === 'model') return this._state.model;
        return property === 'selected' ? this._state.selectedIndex : this._state.selectedItem;
    }

    /** Open the native chooser and apply the picked option. */
    private async _openChooser(): Promise<void> {
        if (this._state.count === 0) return;
        const labels = this._state.options.map((o) => o.label);
        const chosen = await action({
            title: this._chooserTitle || undefined,
            cancelButtonText: 'Cancel',
            actions: labels,
        });
        // A user pick — the core `select` guards the dismissed sheet (`indexOf`
        // returns -1 for the cancel label) and the no-op re-pick, and notifies
        // `interactive`, so the subscriber re-emits `notify::selected`.
        this._state.select(labels.indexOf(chosen));
    }

    /** The held model's items as `{ value, label }` descriptors. */
    get options(): AdwComboOption[] {
        return this._state.options;
    }

    /** `gtk_drop_down_set_model`. */
    set_model(model: ComboWatchableModel | null): void {
        this.model = model;
    }

    /** `gtk_drop_down_get_model`. */
    get_model(): ComboWatchableModel | null {
        return this.model;
    }

    /**
     * XML inflation: a child at `model` is the list, written through the property's setter.
     * Anything else is refused, as GTK refuses a child widget on a `GtkDropDown`.
     */
    _addChildFromBuilder(name: string, child: View): void {
        if (resolveBuilderSlot(name, ['model'], 'child') !== 'model') {
            throw new Error(`Gtk.DropDown takes no child widget; <${name}> is placed nowhere.`);
        }
        this.model = child as unknown as ComboWatchableModel;
    }

    /** `gtk_drop_down_get_selected`. */
    get_selected(): number {
        return this.selected;
    }

    /** `gtk_drop_down_set_selected`. */
    set_selected(position: number): void {
        this.selected = position;
    }

    /** The selected option's `value`, or `''` when out of range. */
    get selectedValue(): string {
        return this._state.selectedValue;
    }

    set selectedValue(value: string) {
        this._state.setSelectedValue(value);
    }

    /** `gtk_drop_down_get_selected_item`. */
    get_selected_item(): unknown {
        return this.selectedItem;
    }

    /**
     * Optional title shown atop the chooser sheet. A SUBSTITUTION affordance:
     * GTK's popover has no title, but a bare native sheet gives no clue what is
     * being chosen — the same reason `GtkMenuButton` carries `menuTitle`.
     */
    get chooserTitle(): string {
        return this._chooserTitle;
    }

    set chooserTitle(value: string) {
        this._chooserTitle = value ?? '';
    }
}
