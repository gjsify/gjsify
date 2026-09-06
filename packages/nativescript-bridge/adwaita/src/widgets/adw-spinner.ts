// AdwSpinner — a Libadwaita-style busy spinner for NativeScript.
//
// A `GridLayout` BOX holding the platform's own `ActivityIndicator`, centred. The box
// is the requested size and the indicator is the RING, capped at 64 — the split
// `Adw.Spinner` makes: `adw_spinner_measure` reports MIN_SIZE as minimum AND natural
// with no upper bound, while the paintable caps only the radius and still centres on
// the box. Collapsing the two makes `size = 200` occupy 64 DIPs of layout.
//
// FIDELITY: the ARC is the platform's, deliberately. `ActivityIndicator` is the native
// spinner and the engine drives it, the one animation that fits the CSS-subset
// contract; hand-drawing libadwaita's breathing arc would mean a per-frame JS animation
// on a phone to replace one the OS already runs. Ported instead: the size split, the
// colour, the accessibility role and the map gating.
//
// The colour is the widget's TEXT colour, NOT the accent — the paintable strokes with
// `gtk_widget_get_color()`, and no conformance vector covers colour, so a renderer that
// picks accent blue drifts silently.
//
// Reference: refs/libadwaita/src/adw-spinner.c (MIN_SIZE, adw_spinner_measure, the a11y role)
// Reference: refs/libadwaita/src/adw-spinner-paintable.c (MAX_RADIUS, widget_map_cb)
// Reference: refs/libadwaita/src/stylesheet/widgets/_spinner.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { ActivityIndicator, GridLayout, ItemSpec } from '@nativescript/core';

import { resolveSpinnerSize, spinnerGeometry } from '@gjsify/adwaita-core';

import { DEFAULT_SPINNER_SIZE } from './chrome.js';
import { xmlBoolean } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';

export { DEFAULT_SPINNER_SIZE };

export class AdwSpinner extends GridLayout {
    /** The platform indicator — the RING, capped at 64 DIPs. */
    private readonly _indicator: ActivityIndicator;
    /** The requested BOX size, floored at the measured minimum 16. */
    private _size = DEFAULT_SPINNER_SIZE;
    /** Whether the consumer wants it spinning, independent of whether it is mapped. */
    private _spinning = true;

    constructor(props?: ConstructProps<AdwSpinner>) {
        super();

        this.className = 'adw-spinner';
        this.addRow(new ItemSpec(1, 'star'));
        this.addColumn(new ItemSpec(1, 'star'));

        const indicator = new ActivityIndicator();
        indicator.className = 'adw-spinner-ring';
        indicator.horizontalAlignment = 'center';
        indicator.verticalAlignment = 'center';
        this._indicator = indicator;
        this.addChild(indicator);

        // `gtk_widget_class_set_accessible_role (…, PROGRESS_BAR)`
        // (adw-spinner.c:124) plus `GTK_ACCESSIBLE_STATE_BUSY, TRUE` (:139-141).
        // A repo-wide grep for either found ZERO hits across both ports before
        // this, so screen readers announced nothing at all.
        this.accessibilityRole = 'progressbar';
        this.accessibilityState = 'busy';

        // `widget_map_cb` (adw-spinner-paintable.c:181-185, :542-543) plays the
        // animation on MAP and only then. This widget used to set `busy = true`
        // in its constructor, so an off-screen spinner burned its animation for
        // as long as it existed.
        this.addEventListener('loaded', () => this._applySpinning());
        this.addEventListener('unloaded', () => {
            this._indicator.busy = false;
        });

        this._applySize();
        this._applySpinning();

        applyConstructProps(this, props);
    }

    private _applySize(): void {
        // THE BOX: what was asked for.
        this.width = this._size;
        this.height = this._size;
        // THE RING: capped at 64, centred by the grid.
        const { diameter } = spinnerGeometry(this._size, this._size);
        this._indicator.width = diameter;
        this._indicator.height = diameter;
    }

    private _applySpinning(): void {
        // Off-device (`isLoaded` undefined in the mock view tree) the gate is
        // inert, so a spec still sees the requested state rather than a widget
        // that never maps.
        const mapped = this.isLoaded !== false;
        this._indicator.busy = this._spinning && mapped;
    }

    /** Whether the spinner is animating. Gated on being mapped, as in GTK. */
    get spinning(): boolean {
        return this._spinning;
    }

    set spinning(value: boolean | string) {
        this._spinning = xmlBoolean(value, false);
        this._applySpinning();
    }

    /**
     * The BOX size in DIPs — what was requested, floored at the measured
     * minimum 16 and NOT capped.
     *
     * Reading it back after `size = 200` reports 200, because that is what the
     * widget occupies. {@link ringDiameter} is the drawn ring, which is where
     * the 64 cap lives. The two used to be one number, so an oversized spinner
     * silently took 64 DIPs of layout instead of the 200 it was given.
     */
    get size(): number {
        return this._size;
    }

    set size(value: number | string) {
        this._size = resolveSpinnerSize(value);
        this._applySize();
    }

    /** The drawn ring diameter — `spinnerGeometry`, capped at 64. */
    get ringDiameter(): number {
        return spinnerGeometry(this._size, this._size).diameter;
    }
}
