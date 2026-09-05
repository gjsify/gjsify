// Renders each `@gjsify/stories` ControlType as an `@gjsify/adwaita-web` row, wired
// two-way to a StoryElement's args. Per-kind value coercion (initial-value seeding,
// SELECT index↔value, RANGE/NUMBER formatting + guards, the refresh "set only if
// differs" guard) belongs to `bindControl` in `@gjsify/storybook-core`; this file
// supplies ONLY the adwaita-web leaf-widget factory, the single renderer seam.

import type { StoryControl, StoryNumberControl, StorySelectControl } from '@gjsify/stories';
import {
    bindControl,
    type ControlRow as CoreControlRow,
    type ControlWidget,
    type ControlWidgetFactory,
} from '@gjsify/storybook-core';
import type { StoryElement } from './story-element.js';

/** A built control: the row element plus a refresher that re-syncs it from args. */
export type ControlRow = CoreControlRow<HTMLElement>;

/** Build the row for a single control, or null if it cannot be rendered. */
export function createControlRow(story: StoryElement, control: StoryControl): ControlRow | null {
    return bindControl(story, control, ADWAITA_WEB_FACTORY);
}

/**
 * One `adw-*` (or range/color) element per control kind, with get/set/onChange over the
 * DOM events those widgets emit. The only renderer-specific seam.
 */
const ADWAITA_WEB_FACTORY: ControlWidgetFactory<HTMLElement> = {
    text(label: string): ControlWidget<HTMLElement, string> {
        const row = document.createElement('adw-entry-row') as HTMLElement & { text: string };
        row.setAttribute('title', label);
        let cb: (v: string) => void = () => {};
        row.addEventListener('changed', (e) => cb((e as CustomEvent<{ text: string }>).detail.text));
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

    color(label: string, desc: string | undefined): ControlWidget<HTMLElement, string> {
        const row = document.createElement('adw-action-row');
        row.setAttribute('title', label);
        if (desc) row.setAttribute('subtitle', desc);

        const input = document.createElement('input');
        input.type = 'color';
        input.className = 'sb-color-input';
        input.slot = 'suffix';
        row.appendChild(input);

        let cb: (v: string) => void = () => {};
        input.addEventListener('input', () => cb(input.value));
        return {
            node: row,
            get: () => input.value,
            set: (v) => {
                input.value = v;
            },
            onChange: (fn) => {
                cb = fn;
            },
        };
    },

    boolean(label: string): ControlWidget<HTMLElement, boolean> {
        const row = document.createElement('adw-switch-row');
        row.setAttribute('title', label);
        let cb: (v: boolean) => void = () => {};
        row.addEventListener('notify::active', (e) => cb((e as CustomEvent<{ active: boolean }>).detail.active));
        return {
            node: row,
            get: () => row.hasAttribute('active'),
            set: (v) => {
                row.toggleAttribute('active', v);
            },
            onChange: (fn) => {
                cb = fn;
            },
        };
    },

    number(control: StoryNumberControl): ControlWidget<HTMLElement, number> {
        const row = document.createElement('adw-spin-row') as HTMLElement & { value: number };
        row.setAttribute('title', label(control));
        // A STORY CONTROL keeps `min`/`max`/`step` — that is `Adw.SpinRow.new_with_range`'s
        // own vocabulary, which the GTK storybook calls directly — and the ELEMENT takes one
        // `adjustment` (ADR 0047). This line is the map between the two.
        row.setAttribute(
            'adjustment',
            JSON.stringify({
                lower: control.min ?? 0,
                upper: control.max ?? 100,
                stepIncrement: control.step ?? 1,
            }),
        );
        let cb: (v: number) => void = () => {};
        row.addEventListener('notify::value', (e) => cb((e as CustomEvent<{ value: number }>).detail.value));
        return {
            node: row,
            get: () => row.value ?? 0,
            set: (v) => {
                row.value = v;
            },
            onChange: (fn) => {
                cb = fn;
            },
        };
    },

    select(control: StorySelectControl): ControlWidget<HTMLElement, number> {
        const options = control.options ?? [];
        const row = document.createElement('adw-combo-row') as HTMLElement & { selected: number };
        row.setAttribute('title', label(control));
        row.setAttribute('model', JSON.stringify(options.map((o) => o.label)));
        let cb: (v: number) => void = () => {};
        row.addEventListener('notify::selected', (e) => cb((e as CustomEvent<{ selected: number }>).detail.selected));
        return {
            node: row,
            get: () => row.selected ?? 0,
            set: (v) => {
                row.selected = v;
            },
            onChange: (fn) => {
                cb = fn;
            },
        };
    },

    range(control: StoryNumberControl): ControlWidget<HTMLElement, number> {
        const min = control.min ?? 0;
        const max = control.max ?? 100;
        const step = control.step ?? 1;
        const asInteger = Number.isInteger(step);
        const format = (v: number): string => (asInteger ? String(Math.round(v)) : v.toFixed(2));

        const row = document.createElement('div');
        row.className = 'sb-range-row';

        const header = document.createElement('div');
        header.className = 'sb-range-header';
        const titleEl = document.createElement('span');
        titleEl.className = 'sb-range-title';
        titleEl.textContent = label(control);
        const valueEl = document.createElement('span');
        valueEl.className = 'sb-range-value';
        header.append(titleEl, valueEl);

        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'sb-range-input';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);

        if (control.description) {
            const descEl = document.createElement('span');
            descEl.className = 'sb-range-description';
            descEl.textContent = control.description;
            row.append(header, descEl, input);
        } else {
            row.append(header, input);
        }

        let cb: (v: number) => void = () => {};
        input.addEventListener('input', () => {
            const value = parseFloat(input.value);
            valueEl.textContent = format(value);
            cb(value);
        });

        return {
            node: row,
            get: () => parseFloat(input.value),
            set: (v) => {
                input.value = String(v);
                valueEl.textContent = format(v);
            },
            onChange: (fn) => {
                cb = fn;
            },
        };
    },
};

/** A control's display label — explicit `label` else its `name`. */
function label(control: StoryControl): string {
    return control.label || control.name;
}
