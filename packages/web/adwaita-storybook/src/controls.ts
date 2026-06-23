// Control-row builders — render each @gjsify/stories ControlType as an
// @gjsify/adwaita-web row, wired two-way to a StoryElement's args. The web
// counterpart of StorybookWindow's _createControlRow family.

import {
    ControlType,
    type StoryColorControl,
    type StoryControl,
    type StoryNumberControl,
    type StorySelectControl,
    type StoryTextControl,
} from '@gjsify/stories';
import type { StoryElement } from './story-element.js';

/** A built control: the row element plus a refresher that re-syncs it from args. */
export interface ControlRow {
    element: HTMLElement;
    refresh: (args: Record<string, unknown>) => void;
}

/** Build the row for a single control, or null if it cannot be rendered. */
export function createControlRow(story: StoryElement, control: StoryControl): ControlRow | null {
    switch (control.type) {
        case ControlType.TEXT:
            return textRow(story, control);
        case ControlType.NUMBER:
            return numberRow(story, control);
        case ControlType.RANGE:
            return rangeRow(story, control);
        case ControlType.BOOLEAN:
            return booleanRow(story, control);
        case ControlType.SELECT:
            return selectRow(story, control);
        case ControlType.COLOR:
            return colorRow(story, control);
        default:
            console.warn(`Unsupported control type: ${(control as StoryControl).type}`);
            return null;
    }
}

function label(control: StoryControl): string {
    return control.label || control.name;
}

function textRow(story: StoryElement, control: StoryTextControl): ControlRow {
    const row = document.createElement('adw-entry-row');
    row.setAttribute('title', label(control));
    const current = story.args[control.name];
    row.setAttribute('text', typeof current === 'string' ? current : '');
    row.addEventListener('changed', (e) => {
        story.setArg(control.name, (e as CustomEvent<{ text: string }>).detail.text);
    });
    return {
        element: row,
        refresh: (args) => {
            const next = typeof args[control.name] === 'string' ? (args[control.name] as string) : '';
            if ((row as HTMLElement & { text: string }).text !== next) {
                (row as HTMLElement & { text: string }).text = next;
            }
        },
    };
}

function numberRow(story: StoryElement, control: StoryNumberControl): ControlRow {
    const row = document.createElement('adw-spin-row');
    row.setAttribute('title', label(control));
    row.setAttribute('min', String(control.min ?? 0));
    row.setAttribute('max', String(control.max ?? 100));
    row.setAttribute('step', String(control.step ?? 1));
    const current = story.args[control.name];
    row.setAttribute('value', String(typeof current === 'number' ? current : (control.min ?? 0)));
    row.addEventListener('notify::value', (e) => {
        story.setArg(control.name, (e as CustomEvent<{ value: number }>).detail.value);
    });
    return {
        element: row,
        refresh: (args) => {
            const next = typeof args[control.name] === 'number' ? (args[control.name] as number) : 0;
            if ((row as HTMLElement & { value: number }).value !== next) {
                (row as HTMLElement & { value: number }).value = next;
            }
        },
    };
}

function booleanRow(story: StoryElement, control: StoryControl): ControlRow {
    const row = document.createElement('adw-switch-row');
    row.setAttribute('title', label(control));
    if (story.args[control.name]) row.setAttribute('active', '');
    row.addEventListener('notify::active', (e) => {
        story.setArg(control.name, (e as CustomEvent<{ active: boolean }>).detail.active);
    });
    return {
        element: row,
        refresh: (args) => {
            row.toggleAttribute('active', Boolean(args[control.name]));
        },
    };
}

function selectRow(story: StoryElement, control: StorySelectControl): ControlRow | null {
    const options = control.options;
    if (!options?.length) {
        console.warn(`SELECT control "${control.name}" has no options`);
        return null;
    }
    const row = document.createElement('adw-combo-row');
    row.setAttribute('title', label(control));
    row.setAttribute('items', JSON.stringify(options.map((o) => o.label)));
    const current = story.args[control.name];
    const idx = Math.max(
        0,
        options.findIndex((o) => o.value === current),
    );
    row.setAttribute('selected', String(idx));
    row.addEventListener('notify::selected', (e) => {
        const sel = (e as CustomEvent<{ selected: number }>).detail.selected;
        if (sel >= 0 && sel < options.length) story.setArg(control.name, options[sel].value);
    });
    return {
        element: row,
        refresh: (args) => {
            const value = args[control.name];
            const i = options.findIndex((o) => o.value === value);
            if (i >= 0 && (row as HTMLElement & { selected: number }).selected !== i) {
                (row as HTMLElement & { selected: number }).selected = i;
            }
        },
    };
}

function rangeRow(story: StoryElement, control: StoryNumberControl): ControlRow {
    const min = control.min ?? 0;
    const max = control.max ?? 100;
    const step = control.step ?? 1;
    const asInteger = Number.isInteger(step);

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
    const current = story.args[control.name];
    const initial = typeof current === 'number' ? current : min;
    input.value = String(initial);

    const format = (v: number) => (asInteger ? String(Math.round(v)) : v.toFixed(2));
    valueEl.textContent = format(initial);

    if (control.description) {
        const desc = document.createElement('span');
        desc.className = 'sb-range-description';
        desc.textContent = control.description;
        row.append(header, desc, input);
    } else {
        row.append(header, input);
    }

    input.addEventListener('input', () => {
        const value = parseFloat(input.value);
        valueEl.textContent = format(value);
        story.setArg(control.name, value);
    });

    return {
        element: row,
        refresh: (args) => {
            const value = typeof args[control.name] === 'number' ? (args[control.name] as number) : initial;
            if (parseFloat(input.value) !== value) {
                input.value = String(value);
                valueEl.textContent = format(value);
            }
        },
    };
}

function colorRow(story: StoryElement, control: StoryColorControl): ControlRow {
    const row = document.createElement('adw-action-row');
    row.setAttribute('title', label(control));
    if (control.description) row.setAttribute('subtitle', control.description);

    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'sb-color-input';
    input.slot = 'suffix';
    const current = story.args[control.name];
    input.value = typeof current === 'string' ? current : '#000000';
    row.appendChild(input);

    input.addEventListener('input', () => {
        story.setArg(control.name, input.value);
    });

    return {
        element: row,
        refresh: (args) => {
            const next = typeof args[control.name] === 'string' ? (args[control.name] as string) : '#000000';
            if (input.value !== next) input.value = next;
        },
    };
}
