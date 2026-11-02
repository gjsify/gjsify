// GtkCheckButton — a check indicator beside an optional label, for NativeScript.
//
// A tappable `GridLayout` in two columns: the INDICATOR (a rounded square that fills with
// the accent and shows a checkmark when `active`, a dash when `inconsistent`) and the
// CONTENT (the text `label`, or a `child` widget that replaces it). `Gtk.CheckButton` is NOT
// a `Gtk.ToggleButton` — it is a widget of its own that happens to toggle — so this extends
// `AdwStyledLayoutBase` and owns `active`, `inconsistent`, `toggled` and `notify::active`.
//
// DECLARED ON THE SEAM (route D, ADR 0122): `active`, `inconsistent`, `label` and `use-underline`
// are `withProperties` declarations over `AdwStyledLayoutBase`, which is meta-less — the
// "meta-less door" case #2488 made borrow its gi verbs — and `toggled` / `activate` are declared
// signals. `child` and the write-only `group` stay hand-written: neither has a scalar GType.
//
// MEASURED ON GJS (GTK 4.22, every line below) — the pspecs are all `explicit-notify`, read-write:
//   - `active = true` emits [notify::active, toggled]; an equal write is silent. null → false,
//     'x' and 1 → true (JS truthiness, which `normalize` reproduces for the pure-JS leg).
//   - `activate()` toggles and emits [notify::active, toggled, activate]. A tap is NOT that:
//     `click_released_cb` is `set_active (!active)` and emits no `activate`, so a tap here calls
//     `_toggle` directly. Nothing clears `inconsistent` — the docs say "this has to be done
//     manually" — so a tap no longer does either.
//   - `label` notifies on EVERY write, equal, null → null and '' included; '' reads back null.
//   - `inconsistent` and `use-underline` notify on change only.
//   - Grouped: `set_group` emits nothing and keeps the active states. `active = true` first
//     deactivates the other members (their notify + toggled) and only then notifies itself, with
//     `self.active` still false. `activate()` on the ACTIVE member of a group emits `activate`
//     alone: `real_activate` does not flip it.
// `_toggle` is the `activate` handler, as `AdwSplitButton` connects its own.
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
import { readDeclaredValue, withProperties, type GObjectNotify } from './signals.js';

/** Event name emitted when `active` changes. Mirrors `Gtk.CheckButton::toggled`. */
export const GTK_CHECK_BUTTON_TOGGLED = 'toggled';

/** Event name emitted when the button is activated. Mirrors `Gtk.CheckButton::activate`. */
export const GTK_CHECK_BUTTON_ACTIVATE = 'activate';

/** Event name emitted when `active` changes. Mirrors GObject `notify::active`. */
export const NOTIFY_CHECK_ACTIVE = 'notify::active';

/** Event name emitted when `inconsistent` changes. Mirrors GObject `notify::inconsistent`. */
export const NOTIFY_CHECK_INCONSISTENT = 'notify::inconsistent';

/** Event name emitted when `label` is written. Mirrors GObject `notify::label`. */
export const NOTIFY_CHECK_LABEL = 'notify::label';

/** Event name emitted when `use-underline` changes. Mirrors GObject `notify::use-underline`. */
export const NOTIFY_CHECK_USE_UNDERLINE = 'notify::use-underline';

/** The state classes the button wears, which the theme turns into the filled indicator. */
export const GTK_CHECK_BUTTON_CHECKED_CLASS = 'checked';
export const GTK_CHECK_BUTTON_INCONSISTENT_CLASS = 'inconsistent';

/** The check button a declared property's hooks read their siblings off; structural, as in `gtk-entry.ts`. */
interface CheckValues {
    readonly active: boolean;
}

export class GtkCheckButton extends withProperties(AdwStyledLayoutBase, {
    GTypeName: 'GtkCheckButton',
    Properties: {
        active: {
            kind: 'boolean',
            default: false,
            explicitNotify: true,
            blurb: 'If the check button is active',
            // `set_active (TRUE)` deactivates every other member BEFORE this one notifies, while
            // this one still reads false (gtkcheckbutton.c:955-968).
            normalize: (value, self) => {
                const next = !!readDeclaredValue('active', 'boolean', value);
                if (next && !(self as CheckValues).active) {
                    for (const other of checkGroupNeighbours<GtkCheckButton>(self as GtkCheckButton))
                        other.active = false;
                }
                return next;
            },
            // Explicit notify: the property owes its own `notify::active`, and `toggled` follows it.
            afterNotify: (self) => {
                const button = self as GtkCheckButton;
                button._restyle();
                button.notify('active');
                button.emit(GTK_CHECK_BUTTON_TOGGLED);
            },
        },
        inconsistent: {
            kind: 'boolean',
            default: false,
            explicitNotify: true,
            blurb: 'If the check button is in an "in between" state',
            afterNotify: (self) => {
                const button = self as GtkCheckButton;
                button._restyle();
                button.notify('inconsistent');
            },
        },
        label: {
            kind: 'string',
            default: null,
            explicitNotify: true,
            blurb: 'Text of the label inside the check button',
            normalize: (value) => (value === null || value === undefined || value === '' ? null : String(value)),
            changed: () => true,
            afterNotify: (self) => {
                const button = self as GtkCheckButton;
                button._paintLabel();
                button.notify('label');
            },
        },
        'use-underline': {
            kind: 'boolean',
            default: false,
            explicitNotify: true,
            blurb: 'If set, an underline in the text indicates a mnemonic',
            afterNotify: (self) => {
                const button = self as GtkCheckButton;
                button._paintLabel();
                button.notify('use-underline');
            },
        },
    },
    Signals: { toggled: {}, activate: {} },
}) {
    static readonly GTypeName: string = 'GtkCheckButton';

    static readonly builderSlots: readonly string[] = builderSlotsOf(['child'], 'child');

    /** `group` names another check button of the same tree — see `./builder-slots.ts`. */
    static readonly builderReferences: readonly string[] = ['group'];

    private readonly _indicator: GridLayout;
    private readonly _mark: GtkImage;
    private readonly _text: Label;

    /** `Gtk.CheckButton:active` — whether the box is ticked. Defaults to `false`. */
    declare active: boolean;

    /** `Gtk.CheckButton:inconsistent` — the "partly on" dash. Defaults to `false`. */
    declare inconsistent: boolean;

    /** `Gtk.CheckButton:label` — the text beside the box, `null` for none. */
    declare label: string | null;

    /** `Gtk.CheckButton:use-underline` — an `_` in the label marks a mnemonic, which is not drawn. */
    declare useUnderline: boolean;

    /** GJS's `notify('<prop>')` beside NativeScript's `notify({ eventName })`; see the seam. */
    declare notify: GObjectNotify;

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
        // A tap is `set_active (!active)` and no more (gtkcheckbutton.c `click_released_cb`).
        this.addEventListener('tap', () => this._toggle());
        // `emit('activate')` is `real_activate`, which toggles the same way.
        this.connect('activate', (self) => self._toggle());

        this._restyle();
        applyConstructProps(this, props);
    }

    /** The active member of a group cannot be toggled off (gtkcheckbutton.c:395-396). */
    private _toggle(): void {
        if (!checkActivationFlips(this, this.active)) return;
        this.active = !this.active;
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

    private _paintLabel(): void {
        this._text.text = labelDisplayText(this.label ?? '', false, this.useUnderline);
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
        return this.active;
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
        const hasContent = !!this._child || !!this.label;
        this._text.visibility = !this._child && this.label ? 'visible' : 'collapse';
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
        if (this.active) state.push(GTK_CHECK_BUTTON_CHECKED_CLASS);
        if (this.inconsistent) state.push(GTK_CHECK_BUTTON_INCONSISTENT_CLASS);
        this.className = classNameWith(this._ownClass, [...this.styleClasses, ...state]);
        this._indicator.className = classNameWith(
            'adw-check-indicator',
            isRadioCheck(this) ? [...state, 'radio'] : state,
        );
        this._mark.visibility = this.active || this.inconsistent ? 'visible' : 'collapse';
    }
}
