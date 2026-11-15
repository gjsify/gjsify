// GtkProgressBar — a horizontal bar that fills as work gets done, for NativeScript.
//
// A `GridLayout` holding a TROUGH (a second `GridLayout`, 8 DIPs high) and, under it, the
// text row. The filled part is one view whose COLUMN the trough moves: the trough's columns
// are `fraction*, (1 - fraction)*`, so the fill takes its share of whatever width the bar
// is given and no `layoutChanged` measuring is needed. Pulse mode uses the same trick with
// three columns, `position*, block*, rest*`.
//
// MEASURED on GTK 4.22: a new progress bar has css-classes `horizontal` and the css name
// `progressbar`; `fraction` defaults to 0 and EVERY write notifies, an equal one included;
// the value is clamped to [0, 1]; `pulse-step` defaults to 0.1 and is not clamped; `pulse()`
// notifies nothing and leaves `fraction` where it was, while a `set_fraction` call ends the
// pulse mode; `text` defaults to NULL.
//
// DIFFERENCES: the bar is horizontal only (`orientation` and `ellipsize` are left out — a
// phone form has no use for a vertical bar), and the pulse block moves by `pulse-step` of
// the trough per `pulse()` call, bouncing at the ends, with no animation between two calls.
//
// Reference: refs/gtk gtk/gtkprogressbar.c (GtkProgressBar)
// Reference: web/adwaita-web/scss/_progress_bar.scss
// Copyright (c) The GTK Team. LGPLv2.1+.

import { GridLayout, ItemSpec, Label, View } from '@nativescript/core';

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { AdwStyledLayoutBase } from './styled-layout-base.js';
import { withProperties, type GObjectNotify } from './signals.js';

/** How wide the pulse block is, as a share of the trough. */
const PULSE_BLOCK = 0.2;

/** `CLAMP (value, 0, 1)` with a non-number reading as 0, as the browser element reads one. */
function unitInterval(value: unknown): number {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(1, Math.max(0, number));
}

export class GtkProgressBar extends withProperties(AdwStyledLayoutBase, {
    GTypeName: 'GtkProgressBar',
    Properties: {
        fraction: {
            kind: 'double',
            default: 0,
            blurb: 'The fraction of total work that has been completed',
            normalize: (value) => unitInterval(value),
            // `gtk_progress_bar_set_fraction` notifies on every write (measured).
            changed: () => true,
            // A written fraction ends the pulse mode.
            afterNotify: (self) => (self as GtkProgressBar)._endPulse(),
        },
        'pulse-step': {
            kind: 'double',
            default: 0.1,
            blurb: 'The fraction of total progress to move the bouncing block when pulsed',
            normalize: (value) => {
                const number = typeof value === 'number' ? value : Number(value);
                return Number.isFinite(number) ? number : 0;
            },
        },
        inverted: {
            kind: 'boolean',
            default: false,
            blurb: 'Invert the direction in which the progress bar grows',
            afterNotify: (self) => (self as GtkProgressBar)._layoutTrough(),
        },
        'show-text': {
            kind: 'boolean',
            default: false,
            blurb: 'Sets whether the progress bar will show text in the trough',
            afterNotify: (self) => (self as GtkProgressBar)._paintText(),
        },
        text: {
            kind: 'string',
            default: null,
            blurb: 'Text to be displayed in the progress bar',
            normalize: (value) => (value === null || value === undefined ? null : String(value)),
            afterNotify: (self) => (self as GtkProgressBar)._paintText(),
        },
    },
}) {
    static readonly GTypeName: string = 'GtkProgressBar';

    /** `Gtk.ProgressBar:fraction` — how much is done, in [0, 1]. Defaults to `0`. */
    declare fraction: number;

    /** `Gtk.ProgressBar:pulse-step` — how far the block moves per {@link pulse}. Defaults to `0.1`. */
    declare pulseStep: number;

    /** `Gtk.ProgressBar:inverted` — the fill grows from the end. Defaults to `false`. */
    declare inverted: boolean;

    /** `Gtk.ProgressBar:show-text` — draw a text under the bar. Defaults to `false`. */
    declare showText: boolean;

    /** `Gtk.ProgressBar:text` — the text shown, `null` for the percentage. */
    declare text: string | null;

    /** GJS's `notify('<prop>')` beside NativeScript's `notify({ eventName })`; see the seam. */
    declare notify: GObjectNotify;

    private readonly _trough: GridLayout;
    private readonly _fill: View;
    private readonly _label: Label;

    private _pulsing = false;
    private _pulsePosition = 0;
    private _pulseDirection = 1;

    constructor(props?: ConstructProps<GtkProgressBar>) {
        super();
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'auto'));
        this.addRow(new ItemSpec(1, 'auto'));

        const trough = new GridLayout();
        trough.className = 'adw-progress-bar-trough';
        GridLayout.setRow(trough, 0);
        GridLayout.setColumn(trough, 0);
        this.addChild(trough);
        this._trough = trough;

        const fill = new View();
        fill.className = 'adw-progress-bar-progress';
        trough.addChild(fill);
        this._fill = fill;

        const label = new Label();
        label.className = 'adw-progress-bar-text dimmed';
        label.visibility = 'collapse';
        GridLayout.setRow(label, 1);
        GridLayout.setColumn(label, 0);
        this.addChild(label);
        this._label = label;

        // `gtk_widget_class_set_accessible_role (…, PROGRESS_BAR)`.
        this.accessibilityRole = 'progressbar';

        this.add_css_class('horizontal');
        this._layoutTrough();
        applyConstructProps(this, props);
    }

    /** `gtk_progress_bar_get_fraction`. */
    get_fraction(): number {
        return this.fraction;
    }

    /** `gtk_progress_bar_set_fraction` — clamped to [0, 1], and it ends a pulse. */
    set_fraction(fraction: number): void {
        this.fraction = fraction;
    }

    /** `gtk_progress_bar_get_pulse_step`. */
    get_pulse_step(): number {
        return this.pulseStep;
    }

    /** `gtk_progress_bar_set_pulse_step`. */
    set_pulse_step(fraction: number): void {
        this.pulseStep = fraction;
    }

    /** `gtk_progress_bar_get_inverted`. */
    get_inverted(): boolean {
        return this.inverted;
    }

    /** `gtk_progress_bar_set_inverted`. */
    set_inverted(inverted: boolean): void {
        this.inverted = inverted;
    }

    /** `gtk_progress_bar_get_show_text`. */
    get_show_text(): boolean {
        return this.showText;
    }

    /** `gtk_progress_bar_set_show_text`. */
    set_show_text(showText: boolean): void {
        this.showText = showText;
    }

    /** `gtk_progress_bar_get_text`. */
    get_text(): string | null {
        return this.text;
    }

    /** `gtk_progress_bar_set_text`. */
    set_text(text: string | null): void {
        this.text = text;
    }

    /**
     * `gtk_progress_bar_pulse` — move the activity block one step, bouncing at the ends. The
     * first call enters the pulse mode; `fraction` is left as it was and nothing is notified.
     */
    pulse(): void {
        const room = 1 - PULSE_BLOCK;
        if (!this._pulsing) {
            this._pulsing = true;
            this._pulsePosition = 0;
            this._pulseDirection = 1;
        } else {
            const step = Math.abs(this.pulseStep) * this._pulseDirection;
            let next = this._pulsePosition + step;
            if (next >= room) {
                next = room;
                this._pulseDirection = -1;
            } else if (next <= 0) {
                next = 0;
                this._pulseDirection = 1;
            }
            this._pulsePosition = next;
        }
        this._layoutTrough();
        this._paintText();
    }

    /** True from the first {@link pulse} until the next `fraction` write. */
    get pulsing(): boolean {
        return this._pulsing;
    }

    protected get _ownClass(): string {
        return 'adw-progress-bar';
    }

    /** @internal — the `fraction` hook: a written fraction leaves the pulse mode. */
    _endPulse(): void {
        this._pulsing = false;
        this._layoutTrough();
        this._paintText();
    }

    /**
     * Re-cut the trough's columns for the current mode. Zero-width segments are dropped, so a
     * bar at 0 draws no fill at all rather than a rounded sliver.
     */
    _layoutTrough(): void {
        // The seam can run a hook while the constructor is still building the parts.
        if (this._trough === undefined) return;
        let segments: { share: number; fill: boolean }[];
        if (this._pulsing) {
            const room = 1 - PULSE_BLOCK;
            const lead = Math.min(room, Math.max(0, this._pulsePosition));
            segments = [
                { share: lead, fill: false },
                { share: PULSE_BLOCK, fill: true },
                { share: room - lead, fill: false },
            ];
        } else {
            const done = this.fraction;
            segments = [
                { share: done, fill: true },
                { share: 1 - done, fill: false },
            ];
        }
        if (this.inverted) segments.reverse();
        const shown = segments.filter((segment) => segment.share > 0);

        this._trough.removeColumns();
        shown.forEach((segment, index) => {
            this._trough.addColumn(new ItemSpec(segment.share, 'star'));
            if (segment.fill) GridLayout.setColumn(this._fill, index);
        });
        this._fill.visibility = shown.some((segment) => segment.fill) ? 'visible' : 'collapse';
    }

    /** The text row: shown with `show-text`, the percentage unless a text was set. */
    _paintText(): void {
        if (this._label === undefined) return;
        if (!this.showText) {
            this._label.visibility = 'collapse';
            return;
        }
        const explicit = this.text;
        if (explicit !== null) this._label.text = explicit;
        else this._label.text = this._pulsing ? '' : `${Math.round(this.fraction * 100)}%`;
        this._label.visibility = 'visible';
    }
}
