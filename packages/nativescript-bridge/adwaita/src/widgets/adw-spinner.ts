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
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';
import type { GObjectNotify } from './signals.js';

export { DEFAULT_SPINNER_SIZE };

/** Event name emitted when {@link AdwSpinner.spinning} changes. */
export const NOTIFY_SPINNING = 'notify::spinning';

/** Event name emitted when {@link AdwSpinner.size} changes. */
export const NOTIFY_SIZE = 'notify::size';

// THE SECOND WIDGET WHOSE PROPERTIES ARE A REAL GObject's (ADR 0105 § 2, route D), and the first
// whose properties are not strings. `spinning` and `size` are DECLARED at the `extends` and built
// by the seam (`signals.ts`): properties of a GType registered over `GridLayout` on Android, the
// seam's own accessors everywhere else. There is no `get spinning()` / `set size()` here any more,
// for the reason `adw-window-title.ts` gives — node-gi reads the GObject's store, never a JS
// getter — and the two `_apply*` methods hang off `notify::` instead of a setter.
//
// XML hands `spinning="false"` and `size="96"` over as strings. The seam parses `spinning` to the
// boolean it declares on both legs; `size` keeps its own lenient reading through `normalize`,
// because `size="24px"` is a length and the floor at 16 is part of the property, not of a setter.
export class AdwSpinner extends withSignals(GridLayout, {
    GTypeName: 'AdwSpinner',
    Properties: {
        spinning: { kind: 'boolean', default: true, blurb: 'Whether the spinner is animating' },
        size: {
            kind: 'double',
            default: DEFAULT_SPINNER_SIZE,
            blurb: 'The box size in DIPs, floored at the measured minimum',
            normalize: (value) => resolveSpinnerSize(value as number | string | null | undefined),
        },
    },
}) {
    static readonly GTypeName: string = 'AdwSpinner';

    /**
     * Whether the spinner is animating. Gated on being mapped, as in GTK. A string from XML is
     * parsed to a boolean by the seam; anything but `'true'` / `'false'` throws.
     */
    declare spinning: boolean;

    /**
     * The BOX size in DIPs — what was requested, floored at the measured
     * minimum 16 and NOT capped.
     *
     * Reading it back after `size = 200` reports 200, because that is what the
     * widget occupies. {@link ringDiameter} is the drawn ring, which is where
     * the 64 cap lives. The two used to be one number, so an oversized spinner
     * silently took 64 DIPs of layout instead of the 200 it was given.
     */
    declare size: number;

    /** `notify('size')` beside NativeScript's `notify({ eventName })` — see {@link GObjectNotify}. */
    declare notify: GObjectNotify;

    /** The platform indicator — the RING, capped at 64 DIPs. */
    private readonly _indicator: ActivityIndicator;

    constructor(props?: ConstructProps<AdwSpinner>) {
        super();

        this.className = 'adw-spinner';
        this.addRow(new ItemSpec(1, 'star'));
        this.addColumn(new ItemSpec(1, 'star'));

        const indicator = new ActivityIndicator();
        indicator.className = 'adw-spinner-ring';
        indicator.horizontalAlignment = 'center';
        // `'middle'`, not `'center'`: `CoreTypes.VerticalAlignmentType` is
        // `'top' | 'middle' | 'bottom' | 'stretch'`. Both behave the same at runtime —
        // NativeScript aliases the one to the other in `VerticalAlignmentText.parse`
        // (`core-types/index.js:112`) — but only `'middle'` type-checks against the
        // real `@nativescript/core`. The horizontal axis DOES spell it `'center'`.
        indicator.verticalAlignment = 'middle';
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

        // The property is the source of truth and a notification is what says it moved, on either
        // leg. The handlers read the EMITTER, the idiom `adw-window-title.ts` settled on.
        this.connect(NOTIFY_SIZE, (self) => self._applySize());
        this.connect(NOTIFY_SPINNING, (self) => self._applySpinning());

        this._applySize();
        this._applySpinning();

        applyConstructProps(this, props);
    }

    private _applySize(): void {
        // THE BOX: what was asked for.
        this.width = this.size;
        this.height = this.size;
        // THE RING: capped at 64, centred by the grid.
        const { diameter } = spinnerGeometry(this.size, this.size);
        this._indicator.width = diameter;
        this._indicator.height = diameter;
    }

    private _applySpinning(): void {
        // Off-device (`isLoaded` undefined in the mock view tree) the gate is
        // inert, so a spec still sees the requested state rather than a widget
        // that never maps.
        const mapped = this.isLoaded !== false;
        this._indicator.busy = this.spinning && mapped;
    }

    /** The drawn ring diameter — `spinnerGeometry`, capped at 64. */
    get ringDiameter(): number {
        return spinnerGeometry(this.size, this.size).diameter;
    }
}
