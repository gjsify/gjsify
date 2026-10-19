// GtkCheckButton — a check indicator beside an optional label, for NativeScript.
//
// A tappable `GridLayout` in two columns: the INDICATOR (a rounded square that fills with
// the accent and shows a checkmark when `active`, a dash when `inconsistent`) and the
// CONTENT (the text `label`, or a `child` widget that replaces it). `Gtk.CheckButton` is NOT
// a `Gtk.ToggleButton` — it is a widget of its own that happens to toggle — so this extends
// `AdwStyledLayoutBase` and owns `active`, `inconsistent`, `toggled` and `notify::active`.
//
// A TAP TOGGLES AND CLEARS `inconsistent`, as `gtk_check_button_real_clicked` does, then
// emits `toggled` and `activate`. THE LOOK IS STATE CLASSES (`checked`, `inconsistent`)
// the style list never reports, as `Gtk.ToggleButton`'s `checked` is.
//
// `group` (write-only, as in GTK) joins another check button's group over the core's
// `check-group.ts`: activating one member deactivates the others, the active member cannot be
// tapped off, and a grouped button's indicator wears `radio`, as GTK names the node. A `.blp`
// writes the group as an id, resolved like any object reference (`builderReferences`).
//
// Reference: refs/gtk gtk/gtkcheckbutton.c (GtkCheckButton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_checks.scss
// Copyright (c) The GTK Team and GNOME contributors. LGPLv2.1+.

import { GridLayout, ItemSpec, Label, type View } from '@nativescript/core';
import {
    checkActivationFlips,
    checkGroupNeighbours,
    isRadioCheck,
    labelDisplayText,
    setCheckGroup,
} from '@gjsify/adwaita-core';
import { objectSelectSymbolic } from '@gjsify/adwaita-icons/actions';
import { builderSlotsOf } from './builder-slots.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { GtkImage } from './gtk-image.js';
import { resolveIdReference, type ViewId } from './id-reference.js';
import { attachRowPressFeedback } from './row-press.js';
import { AdwStyledLayoutBase } from './styled-layout-base.js';
import { classNameWith } from './style-classes.js';
import { xmlBoolean } from './xml-values.js';

/** Event name emitted when `active` changes. Mirrors `Gtk.CheckButton::toggled`. */
export const GTK_CHECK_BUTTON_TOGGLED = 'toggled';

/** Event name emitted when the button is activated. Mirrors `Gtk.CheckButton::activate`. */
export const GTK_CHECK_BUTTON_ACTIVATE = 'activate';

/** Event name emitted when `active` changes. Mirrors GObject `notify::active`. */
export const NOTIFY_CHECK_ACTIVE = 'notify::active';

/** The state classes the button wears, which the theme turns into the filled indicator. */
export const GTK_CHECK_BUTTON_CHECKED_CLASS = 'checked';
export const GTK_CHECK_BUTTON_INCONSISTENT_CLASS = 'inconsistent';

export class GtkCheckButton extends AdwStyledLayoutBase {
    static readonly GTypeName: string = 'GtkCheckButton';

    /** The GTK signals this widget emits through `connect` — read by the shared-tree builder (ADR 0093). */
    static readonly emittedSignals: readonly string[] = [
        GTK_CHECK_BUTTON_TOGGLED,
        GTK_CHECK_BUTTON_ACTIVATE,
        NOTIFY_CHECK_ACTIVE,
    ];

    static readonly builderSlots: readonly string[] = builderSlotsOf(['child'], 'child');

    /** `group` names another check button of the same tree — see `./builder-slots.ts`. */
    static readonly builderReferences: readonly string[] = ['group'];

    private readonly _indicator: GridLayout;
    private readonly _mark: GtkImage;
    private readonly _text: Label;
    private _active = false;
    private _inconsistent = false;
    private _label: string | null = null;
    private _useUnderline = false;
    private _child: View | null = null;
    /** A `group` written as an id before the button was in a loaded tree. */
    private _groupId: string | null = null;
    /** The content column's unit, which {@link _syncContent} keeps. */
    private _contentUnit: 'auto' | 'star' = 'auto';

    constructor(props?: ConstructProps<GtkCheckButton>) {
        super();
        this.addColumn(new ItemSpec(1, 'auto'));
        this.addColumn(new ItemSpec(1, 'auto'));
        this.addRow(new ItemSpec(1, 'auto'));

        const indicator = new GridLayout();
        indicator.className = 'adw-check-indicator';
        indicator.addColumn(new ItemSpec(1, 'star'));
        indicator.addRow(new ItemSpec(1, 'star'));
        indicator.verticalAlignment = 'middle';
        GridLayout.setColumn(indicator, 0);
        GridLayout.setRow(indicator, 0);

        const mark = new GtkImage();
        mark.iconName = objectSelectSymbolic;
        mark.pixelSize = 14;
        // White on the accent fill in both schemes, so it must not follow the theme.
        mark.iconColor = '#ffffff';
        mark.horizontalAlignment = 'center';
        mark.verticalAlignment = 'middle';
        mark.visibility = 'collapse';
        indicator.addChild(mark);
        this.addChild(indicator);
        this._indicator = indicator;
        this._mark = mark;

        const text = new Label();
        text.className = 'adw-check-label';
        text.verticalAlignment = 'middle';
        text.visibility = 'collapse';
        GridLayout.setColumn(text, 1);
        GridLayout.setRow(text, 0);
        this.addChild(text);
        this._text = text;

        this.addEventListener('loaded', () => this._resolveGroupId());
        attachRowPressFeedback(this);
        this.addEventListener('tap', () => {
            // The active member of a group cannot be tapped off (gtkcheckbutton.c:395-396).
            if (!checkActivationFlips(this, this._active)) return;
            this._inconsistent = false;
            this.active = !this._active;
            this._restyle();
            this.notify({ eventName: GTK_CHECK_BUTTON_ACTIVATE, object: this });
        });

        this._restyle();
        applyConstructProps(this, props);
    }

    /** `Gtk.CheckButton:active` — whether the box is ticked. Defaults to `false`. */
    get active(): boolean {
        return this._active;
    }

    set active(raw: boolean | string) {
        const next = xmlBoolean(raw, this._active);
        if (next === this._active) return;
        // `set_active (TRUE)` deactivates every member of the group first (gtkcheckbutton.c:955-968).
        if (next) for (const other of checkGroupNeighbours<GtkCheckButton>(this)) other.active = false;
        this._active = next;
        this._restyle();
        this.notify({ eventName: GTK_CHECK_BUTTON_TOGGLED, object: this });
        this.notify({ eventName: NOTIFY_CHECK_ACTIVE, object: this });
    }

    /** `Gtk.CheckButton:group` — WRITE-ONLY, as in GTK (`G_PARAM_WRITABLE`). */
    set group(value: GtkCheckButton | ViewId | null) {
        if (typeof value === 'string') {
            // The XML door: an id, resolved once the tree it names into is loaded.
            this._groupId = value;
            if (this.isLoaded) this.set_group(resolveIdReference(this, 'group', value, GtkCheckButton));
            return;
        }
        this._groupId = null;
        this.set_group(value);
    }

    /** `gtk_check_button_set_group`. */
    set_group(group: GtkCheckButton | null): void {
        setCheckGroup(this, group);
        this._restyle();
        group?._restyle();
    }

    private _resolveGroupId(): void {
        const id = this._groupId;
        if (id === null) return;
        this._groupId = null;
        this.set_group(resolveIdReference(this, 'group', id, GtkCheckButton));
    }

    /** `Gtk.CheckButton:inconsistent` — the "partly on" dash. Defaults to `false`. */
    get inconsistent(): boolean {
        return this._inconsistent;
    }

    set inconsistent(raw: boolean | string) {
        const next = xmlBoolean(raw, this._inconsistent);
        if (next === this._inconsistent) return;
        this._inconsistent = next;
        this._restyle();
        this.notify({ eventName: 'notify::inconsistent', object: this });
    }

    /** `Gtk.CheckButton:label` — the text beside the box, `null` for none. */
    get label(): string | null {
        return this._label;
    }

    set label(value: string | null) {
        this._label = value ?? null;
        this._paintLabel();
    }

    /** `Gtk.CheckButton:use-underline` — an `_` in the label marks a mnemonic, which is not drawn. */
    get useUnderline(): boolean {
        return this._useUnderline;
    }

    set useUnderline(raw: boolean | string) {
        this._useUnderline = !!xmlBoolean(raw, this._useUnderline);
        this._paintLabel();
    }

    private _paintLabel(): void {
        this._text.text = labelDisplayText(this._label ?? '', false, this._useUnderline);
        this._syncContent();
    }

    /** `Gtk.CheckButton:child` — a widget in place of the text label. */
    get child(): View | null {
        return this._child;
    }

    set child(view: View | null) {
        const next = view ?? null;
        if (next === this._child) return;
        if (this._child) this.removeChild(this._child);
        this._child = next;
        if (next) {
            GridLayout.setColumn(next, 1);
            GridLayout.setRow(next, 0);
            this.addChild(next);
        }
        this._syncContent();
    }

    set_child(view: View | null): void {
        this.child = view;
    }

    get_child(): View | null {
        return this._child;
    }

    /** `gtk_check_button_get_active`. */
    get_active(): boolean {
        return this._active;
    }

    /** `gtk_check_button_set_active`. */
    set_active(active: boolean): void {
        this.active = active;
    }

    _addChildFromBuilder(_name: string, view: View): void {
        this.child = view;
    }

    /**
     * The text shows only while there is a label and no child widget replacing it.
     *
     * The content column is `star` only while it holds content. An empty `star` column still
     * takes the whole width a parent offers at most, so a bare check button in an
     * `Adw.WrapBox` (a flexbox, which measures `AT_MOST`) filled its line and the swatches of
     * Learn6502's colour selectors stacked one per line.
     */
    private _syncContent(): void {
        const hasContent = !!this._child || !!this._label;
        this._text.visibility = !this._child && this._label ? 'visible' : 'collapse';
        const unit = hasContent ? 'star' : 'auto';
        if (unit === this._contentUnit) return;
        this._contentUnit = unit;
        this.removeColumns();
        this.addColumn(new ItemSpec(1, 'auto'));
        this.addColumn(new ItemSpec(1, unit));
    }

    protected get _ownClass(): string {
        return 'adw-check-button';
    }

    protected _restyle(): void {
        const state: string[] = [];
        if (this._active) state.push(GTK_CHECK_BUTTON_CHECKED_CLASS);
        if (this._inconsistent) state.push(GTK_CHECK_BUTTON_INCONSISTENT_CLASS);
        this.className = classNameWith(this._ownClass, [...this.styleClasses, ...state]);
        this._indicator.className = classNameWith(
            'adw-check-indicator',
            isRadioCheck(this) ? [...state, 'radio'] : state,
        );
        this._mark.visibility = this._active || this._inconsistent ? 'visible' : 'collapse';
    }
}
