// DOM-level conformance tests for the action-row family — <adw-action-row>,
// <adw-switch-row>, <adw-button-row> and <adw-window-title> — driven by the SAME
// vectors the NativeScript renderer asserts against
// (`@gjsify/adwaita-core/conformance`).
//
// What this suite exists to catch, in the words of what it found:
//   - NEITHER renderer hid an empty TITLE. `string_is_not_empty` is bound to the
//     title label as much as to the subtitle (adw-action-row.ui:49-53 vs :71-75),
//     and the browser port hand-rolled the subtitle-only half of that block six
//     times over.
//   - a programmatic `switchRow.active = true` emitted nothing here, because the
//     DOM does not fire `change` for a scripted `.checked =` — while the
//     NativeScript port, whose `checkedChange` does fire, emitted. One C source,
//     two opposite answers, and nothing comparing them.
//   - clicking anywhere but the handle of a switch row did nothing, though
//     `adw_switch_row_init` makes the whole row the switch's activator.
//   - `<adw-button-row activatable="false">` was honoured, an opt-out libadwaita
//     does not have — and `<adw-action-row activatable="false">` meant the
//     OPPOSITE, because that element reads the attribute by presence.
import { describe, expect, it } from '@gjsify/unit';

import {
    ACTION_ROW_ACTIVATION_VECTORS,
    BUTTON_ROW_ACTIVATABLE_VECTORS,
    BUTTON_ROW_ICON_VECTORS,
    LABEL_VISIBILITY_VECTORS,
    SWITCH_ROW_NOTIFY_VECTORS,
    WINDOW_TITLE_VECTORS,
} from '@gjsify/adwaita-core/conformance';

import type { AdwActionRow } from './elements/adw-action-row.js';
import type { AdwSwitchRow } from './elements/adw-switch-row.js';
import type { AdwWindowTitle } from './elements/adw-window-title.js';

/**
 * Mount an element imperatively — never through parsed HTML, because several
 * label vectors hinge on exact whitespace (`' '`, `'\t'`) that an attribute
 * value in markup is not a reliable carrier for.
 */
function mount<T extends HTMLElement>(tag: string): { el: T; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement(tag) as T;
    host.appendChild(el);
    return { el, host };
}

/** Set an attribute, where `null` means "the property is unset". */
function setAttr(el: HTMLElement, name: string, value: string | null) {
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
}

/** Whether the label matching `selector` is rendered at all. */
function labelVisible(el: HTMLElement, selector: string): boolean {
    const label = el.querySelector(selector) as HTMLElement | null;
    return label !== null && !label.hidden;
}

/** Collect the `detail` of every `event` dispatched on `el`. */
function record(el: HTMLElement, event: string): unknown[] {
    const details: unknown[] = [];
    el.addEventListener(event, (e) => details.push((e as CustomEvent).detail));
    return details;
}

/** Let a MutationObserver callback (the sensitivity binding) be delivered. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

export const AdwActionRowsTest = async () => {
    await describe('<adw-action-row> label visibility (libadwaita conformance vectors)', async () => {
        for (const { text, visible, rule } of LABEL_VISIBILITY_VECTORS) {
            await it(`title ${JSON.stringify(text)} → ${visible} — ${rule}`, () => {
                const { el, host } = mount<AdwActionRow>('adw-action-row');
                setAttr(el, 'title', text);
                expect(labelVisible(el, '.adw-row-title')).toBe(visible);
                host.remove();
            });

            await it(`subtitle ${JSON.stringify(text)} → ${visible} — ${rule}`, () => {
                const { el, host } = mount<AdwActionRow>('adw-action-row');
                setAttr(el, 'subtitle', text);
                expect(labelVisible(el, '.adw-row-subtitle')).toBe(visible);
                host.remove();
            });
        }

        await it('renders the text it was given, whitespace included', () => {
            const { el, host } = mount<AdwActionRow>('adw-action-row');
            el.setAttribute('title', ' ');
            expect((el.querySelector('.adw-row-title') as HTMLElement).textContent).toBe(' ');
            host.remove();
        });
    });

    await describe('<adw-action-row> activatable-widget (libadwaita conformance vectors)', async () => {
        for (const vector of ACTION_ROW_ACTIVATION_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, async () => {
                const { el: row, host } = mount<AdwActionRow>('adw-action-row');
                const widgets = new Map<string, HTMLButtonElement>();
                let last: HTMLButtonElement | null = null;

                for (const step of vector.steps) {
                    switch (step.op) {
                        case 'set-activatable-widget': {
                            if (step.widget === null) {
                                row.activatableWidget = null;
                                break;
                            }
                            let widget = widgets.get(step.widget);
                            if (!widget) {
                                widget = document.createElement('button');
                                widget.slot = 'suffix';
                                row.suffixSection.appendChild(widget);
                                widgets.set(step.widget, widget);
                            }
                            // `GtkWidget:sensitive` — `disabled` is its DOM name.
                            widget.disabled = step.sensitive === false;
                            row.activatableWidget = widget;
                            last = widget;
                            break;
                        }
                        case 'set-widget-sensitive':
                            if (last) last.disabled = !step.sensitive;
                            // The binding runs through a MutationObserver.
                            await tick();
                            break;
                        case 'set-activatable':
                            row.toggleAttribute('activatable', step.activatable);
                            break;
                    }
                }

                expect(row.activatable).toBe(vector.activatable);
                expect(row.classList.contains('activatable')).toBe(vector.activatable);
                const expectedWidget = vector.activatableWidget === null ? null : widgets.get(vector.activatableWidget);
                expect(row.activatableWidget).toBe(expectedWidget ?? null);
                host.remove();
            });
        }

        await it('reads `activatable` by PRESENCE, like every other boolean attribute here', () => {
            const { el: row, host } = mount<AdwActionRow>('adw-action-row');
            row.setAttribute('activatable', 'false');
            // The HTML boolean-attribute convention (`<input disabled="false">`
            // is disabled), which is how every other boolean attribute in this
            // package is read. NOT a libadwaita rule — libadwaita has a typed
            // gboolean and no attribute parsing at all — so it is pinned here
            // rather than in the cross-renderer vectors. Pinned so the next
            // reader does not "fix" it into the string comparison
            // <adw-button-row> used to carry, which gave one markup two
            // opposite meanings inside one package.
            expect(row.activatable).toBe(true);
            host.remove();
        });

        await it('forwards an activation to the activatable widget, then emits `activated`', () => {
            const { el: row, host } = mount<AdwActionRow>('adw-action-row');
            const widget = document.createElement('button');
            row.suffixSection.appendChild(widget);
            let widgetClicks = 0;
            widget.addEventListener('click', () => widgetClicks++);
            row.activatableWidget = widget;

            const activations = record(row, 'activated');
            row.click();

            expect(widgetClicks).toBe(1);
            expect(activations.length).toBe(1);
            host.remove();
        });

        await it('leaves a click that came from the widget itself to the widget', () => {
            const { el: row, host } = mount<AdwActionRow>('adw-action-row');
            const widget = document.createElement('button');
            row.suffixSection.appendChild(widget);
            let widgetClicks = 0;
            widget.addEventListener('click', () => widgetClicks++);
            row.activatableWidget = widget;
            const activations = record(row, 'activated');

            widget.click();

            // One click, and no row activation: GtkListBox does not emit
            // `row-activated` for a click a child widget claimed. Re-clicking the
            // widget here would also bounce back into the row's own listener.
            expect(widgetClicks).toBe(1);
            expect(activations.length).toBe(0);
            host.remove();
        });

        await it('stays silent while unactivatable', () => {
            const { el: row, host } = mount<AdwActionRow>('adw-action-row');
            const activations = record(row, 'activated');
            row.click();
            expect(activations.length).toBe(0);
            host.remove();
        });
    });

    await describe('<adw-switch-row> notify::active (libadwaita conformance vectors)', async () => {
        for (const vector of SWITCH_ROW_NOTIFY_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const { el: row, host } = mount<AdwSwitchRow>('adw-switch-row');
                const events = record(row, 'notify::active');

                for (const step of vector.steps) {
                    if (step.op === 'set-active') row.active = step.active;
                    else row.click();
                }

                expect(row.active).toBe(vector.active);
                expect((row.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(vector.active);
                expect(events.map((detail) => (detail as { active: boolean }).active)).toStrictEqual([
                    ...vector.emitted,
                ]);
                host.remove();
            });
        }

        await it('toggles from a click on the handle, without double-toggling', () => {
            const { el: row, host } = mount<AdwSwitchRow>('adw-switch-row');
            const events = record(row, 'notify::active');
            const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;

            checkbox.click();

            expect(row.active).toBe(true);
            expect(events.length).toBe(1);
            host.remove();
        });

        await it('keeps aria-checked in step with the state (adw-switch-row.c:71-74)', () => {
            const { el: row, host } = mount<AdwSwitchRow>('adw-switch-row');
            expect(row.getAttribute('aria-checked')).toBe('false');
            row.active = true;
            expect(row.getAttribute('aria-checked')).toBe('true');
            host.remove();
        });

        for (const { text, visible, rule } of LABEL_VISIBILITY_VECTORS) {
            await it(`title ${JSON.stringify(text)} → ${visible} — ${rule}`, () => {
                const { el, host } = mount<AdwSwitchRow>('adw-switch-row');
                setAttr(el, 'title', text);
                expect(labelVisible(el, '.adw-row-title')).toBe(visible);
                host.remove();
            });
        }
    });

    await describe('<adw-button-row> (libadwaita conformance vectors)', async () => {
        for (const vector of BUTTON_ROW_ICON_VECTORS) {
            await it(`${JSON.stringify([vector.startIconName, vector.endIconName])} — ${vector.rule}`, () => {
                const { el: row, host } = mount<HTMLElement>('adw-button-row');
                setAttr(row, 'start-icon-name', vector.startIconName);
                setAttr(row, 'end-icon-name', vector.endIconName);

                const icons = Array.from(row.querySelectorAll('span[aria-hidden="true"]')) as HTMLElement[];
                expect(icons.length).toBe(2);
                expect(!icons[0]!.hidden).toBe(vector.startIconVisible);
                expect(!icons[1]!.hidden).toBe(vector.endIconVisible);
                if (vector.startIconVisible) {
                    expect(icons[0]!.classList.contains(`adw-icon--${vector.startIconName}`)).toBe(true);
                }
                if (vector.endIconVisible) {
                    expect(icons[1]!.classList.contains(`adw-icon--${vector.endIconName}`)).toBe(true);
                }
                host.remove();
            });
        }

        for (const vector of BUTTON_ROW_ACTIVATABLE_VECTORS) {
            await it(`activatable=${JSON.stringify(vector.declared)} — ${vector.rule}`, () => {
                const { el: row, host } = mount<HTMLElement>('adw-button-row');
                setAttr(row, 'activatable', vector.declared);
                const activations = record(row, 'activated');
                row.click();

                expect(row.classList.contains('activatable')).toBe(vector.activatable);
                expect(activations.length).toBe(1);
                host.remove();
            });
        }

        for (const { text, visible, rule } of LABEL_VISIBILITY_VECTORS) {
            await it(`title ${JSON.stringify(text)} → ${visible} — ${rule}`, () => {
                const { el: row, host } = mount<HTMLElement>('adw-button-row');
                setAttr(row, 'title', text);
                expect(labelVisible(row, '.adw-button-row-title')).toBe(visible);
                host.remove();
            });
        }
    });

    await describe('<adw-window-title> (libadwaita conformance vectors)', async () => {
        for (const vector of WINDOW_TITLE_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const { el, host } = mount<AdwWindowTitle>('adw-window-title');
                const notified: string[] = [];
                el.addEventListener('notify::title', () => notified.push('title'));
                el.addEventListener('notify::subtitle', () => notified.push('subtitle'));

                for (const step of vector.steps) {
                    setAttr(el, step.op === 'set-title' ? 'title' : 'subtitle', step.value);
                }

                const title = el.querySelector('.adw-window-title-title') as HTMLElement;
                const subtitle = el.querySelector('.adw-window-title-subtitle') as HTMLElement;
                expect(title.textContent).toBe(vector.title);
                expect(!title.hidden).toBe(vector.titleVisible);
                expect(subtitle.textContent).toBe(vector.subtitle);
                expect(!subtitle.hidden).toBe(vector.subtitleVisible);
                expect(notified).toStrictEqual([...vector.notified]);
                host.remove();
            });
        }

        await it('adopts a declared title without calling it a change', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            host.innerHTML = '<adw-window-title title="Documents"></adw-window-title>';
            const el = host.querySelector('adw-window-title') as AdwWindowTitle;
            const title = el.querySelector('.adw-window-title-title') as HTMLElement;

            expect(title.textContent).toBe('Documents');
            expect(title.hidden).toBe(false);
            host.remove();
        });
    });
};
