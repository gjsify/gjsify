// Control-row builders — render each @gjsify/stories ControlType as an
// @gjsify/adwaita-nativescript row, wired two-way to a StoryView's args. The NS
// counterpart of @gjsify/adwaita-storybook's createControlRow and
// @gjsify/storybook's StorybookWindow._createControlRow family.
//
// All the per-kind value coercion (initial-value seeding, SELECT index↔value,
// RANGE/NUMBER formatting + type guards, the refresh "set only if differs"
// guard) now lives in @gjsify/storybook-core's bindControl. This file supplies
// ONLY the adwaita-nativescript leaf-widget factory — the single renderer seam.
//
// Mapping:
//   TEXT        -> Adw.EntryRow
//   BOOLEAN     -> Adw.SwitchRow
//   NUMBER      -> Adw.SpinRow   (stepper)
//   RANGE       -> AdwSliderRow (real slider — matches the GTK Gtk.Scale / browser
//                                input[type=range] RANGE card)
//   SELECT      -> Adw.ComboRow
//   COLOR       -> Adw.EntryRow (hex fallback — NS has no native color row)

import { GjsifyOptionList } from '@gjsify/adwaita-core';
import type { StoryControl, StoryNumberControl, StorySelectControl } from '@gjsify/stories';
import {
    bindControl,
    type ControlRow as CoreControlRow,
    type ControlWidget,
    type ControlWidgetFactory,
} from '@gjsify/storybook-core';
import {
    Adw,
    AdwSliderRow,
    NOTIFY_ACTIVE,
    NOTIFY_SELECTED,
    NOTIFY_SLIDER_VALUE,
    NOTIFY_TEXT,
    NOTIFY_VALUE,
    type NotifySliderValueEventData,
    type NotifyValueEventData,
} from '@gjsify/adwaita-nativescript';
import type { View } from '@nativescript/core';
import type { StoryView } from './story-view.js';

/** A built control: the row view plus a refresher that re-syncs it from args. */
export type ControlRow = CoreControlRow<View>;

/** Build the row for a single control, or null if it cannot be rendered. */
export function createControlRow(story: StoryView, control: StoryControl): ControlRow | null {
    return bindControl(story, control, ADWAITA_NS_FACTORY);
}

/**
 * The @gjsify/adwaita-nativescript leaf-widget factory — builds one native
 * Adwaita row per control kind with get/set/onChange over the `NOTIFY_*` events
 * the widgets emit. The only renderer-specific seam; all coercion is in
 * bindControl.
 */
const ADWAITA_NS_FACTORY: ControlWidgetFactory<View> = {
    text(label: string): ControlWidget<View, string> {
        const row = new Adw.EntryRow();
        row.title = label;
        let cb: (v: string) => void = () => {};
        // Declared property, so `connect` and the emitter — same as `boolean` below.
        row.connect(NOTIFY_TEXT, (self) => cb(self.text));
        return {
            node: row,
            get: () => row.text ?? '',
            set: (v) => {
                row.text = v;
            },
            onChange: (fn) => {
                cb = fn;
            },
        };
    },

    // COLOR has no native NativeScript Adwaita row, so we fall back to an
    // Adw.EntryRow holding the `#rrggbb` hex string — the same intent the browser
    // renderer's color row exposes, minus the swatch picker.
    color(label: string, desc: string | undefined): ControlWidget<View, string> {
        const row = new Adw.EntryRow();
        row.title = `${label} (hex)`;
        if (desc) row.subtitle = desc;
        let cb: (v: string) => void = () => {};
        row.connect(NOTIFY_TEXT, (self) => cb(self.text));
        return {
            node: row,
            get: () => row.text ?? '',
            set: (v) => {
                row.text = v;
            },
            onChange: (fn) => {
                cb = fn;
            },
        };
    },

    boolean(label: string, desc: string | undefined): ControlWidget<View, boolean> {
        const row = new Adw.SwitchRow();
        row.title = label;
        if (desc) row.subtitle = desc;
        let cb: (v: boolean) => void = () => {};
        // A declared property's notification comes from GObject on Android, where only `connect`
        // hears it, and carries no value of its own — so it is read off the emitter.
        row.connect(NOTIFY_ACTIVE, (self) => cb(self.active));
        return {
            node: row,
            get: () => row.active,
            set: (v) => {
                row.active = v;
            },
            onChange: (fn) => {
                cb = fn;
            },
        };
    },

    number(control: StoryNumberControl): ControlWidget<View, number> {
        return spinRow(control);
    },

    // RANGE renders as a real slider card (matching the GTK Gtk.Scale + browser
    // input[type=range]), not the stepper used for plain NUMBER.
    range(control: StoryNumberControl): ControlWidget<View, number> {
        return sliderRow(control);
    },

    select(control: StorySelectControl): ControlWidget<View, number> {
        const options = control.options ?? [];
        const row = new Adw.ComboRow();
        row.title = label(control);
        if (control.description) row.subtitle = control.description;
        // A real list model and not the array this line used to assign: `model` is an object
        // property over `Gio.ListModel` since ADR 0122 § 4. `GjsifyOptionList` and not
        // `Gtk.StringList`, because a `Gtk.StringObject` holds a string alone and a story
        // control's option carries a `value` beside its `label`.
        row.model = GjsifyOptionList.new(options.map((o) => ({ label: o.label, value: String(o.value) })));
        let cb: (v: number) => void = () => {};
        // `connect` and not `addEventListener`: `selected` sits on the declared seam since ADR
        // 0122 § 4, so on Android the emission belongs to the GObject and no NativeScript
        // listener is on that path — measured on a Galaxy S9, where this was the one case the
        // off-device suite could not have caught, because there both doors reach the same bus.
        // The handler carries no payload beyond the sender and reads the value off the row.
        row.connect(NOTIFY_SELECTED, () => cb(row.selected));
        return {
            node: row,
            get: () => row.selected,
            set: (v) => {
                row.selected = v;
            },
            onChange: (fn) => {
                cb = fn;
            },
        };
    },
};

/** Build an Adw.SpinRow leaf widget for NUMBER + RANGE controls. */
function spinRow(control: StoryNumberControl): ControlWidget<View, number> {
    const row = new Adw.SpinRow();
    row.title = label(control);
    if (control.description) row.subtitle = control.description;
    // A STORY CONTROL keeps `min`/`max`/`step` and the WIDGET takes an `adjustment`, which
    // is not an inconsistency: `Adw.SpinRow.new_with_range(min, max, step)` is GTK's own
    // convenience constructor, and the GTK storybook calls exactly that one door up
    // (`framework/storybook/src/window.ts`). The three numbers are the AUTHOR's vocabulary;
    // the adjustment is the widget's (ADR 0047), and this line is the map between them.
    row.adjustment = { lower: control.min ?? 0, upper: control.max ?? 100, stepIncrement: control.step ?? 1 };
    let cb: (v: number) => void = () => {};
    row.addEventListener(NOTIFY_VALUE, (e) => cb((e as NotifyValueEventData).value));
    return {
        node: row,
        get: () => row.value,
        set: (v) => {
            row.value = v;
        },
        onChange: (fn) => {
            cb = fn;
        },
    };
}

/** Build an AdwSliderRow leaf widget for RANGE controls (a real slider card). */
function sliderRow(control: StoryNumberControl): ControlWidget<View, number> {
    const row = new AdwSliderRow();
    row.title = label(control);
    // The same map as `spinRow` above, onto the same portable value.
    row.adjustment = { lower: control.min ?? 0, upper: control.max ?? 100, stepIncrement: control.step ?? 1 };
    let cb: (v: number) => void = () => {};
    row.addEventListener(NOTIFY_SLIDER_VALUE, (e) => cb((e as NotifySliderValueEventData).value));
    return {
        node: row,
        get: () => row.value,
        set: (v) => {
            row.value = v;
        },
        onChange: (fn) => {
            cb = fn;
        },
    };
}

/** A control's display label — explicit `label` else its `name`. */
function label(control: StoryControl): string {
    return control.label || control.name;
}
