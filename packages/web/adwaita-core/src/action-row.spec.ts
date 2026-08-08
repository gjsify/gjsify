// Action-row family specs — driven by the shared conformance vectors, so this
// suite and the two renderer suites assert the SAME table.

import { describe, expect, it } from '@gjsify/unit';

import {
    ActionRowState,
    BUTTON_ROW_ACTIVATABLE,
    ButtonRowState,
    SwitchRowState,
    WindowTitleState,
    deriveRowLabels,
} from './action-row.js';
import {
    ACTION_ROW_ACTIVATION_VECTORS,
    BUTTON_ROW_ACTIVATABLE_VECTORS,
    BUTTON_ROW_ICON_VECTORS,
    LABEL_VISIBILITY_VECTORS,
    SWITCH_ROW_NOTIFY_VECTORS,
    WINDOW_TITLE_VECTORS,
} from './conformance/action-row.js';
import { stringIsNotEmpty } from './glib.js';

export default async () => {
    await describe('stringIsNotEmpty (libadwaita string_is_not_empty)', async () => {
        for (const { text, visible, rule } of LABEL_VISIBILITY_VECTORS) {
            await it(`${JSON.stringify(text)} → ${visible} — ${rule}`, () => {
                expect(stringIsNotEmpty(text)).toBe(visible);
            });
        }

        await it('is undefined-safe, so an optional property needs no `?? ""` at the call', () => {
            expect(stringIsNotEmpty(undefined)).toBe(false);
        });
    });

    await describe('deriveRowLabels (the same rule on BOTH labels)', async () => {
        for (const { text, visible, rule } of LABEL_VISIBILITY_VECTORS) {
            await it(`title ${JSON.stringify(text)} → visible ${visible} — ${rule}`, () => {
                expect(deriveRowLabels({ title: text, subtitle: 'x' })).toStrictEqual({
                    title: text ?? '',
                    titleVisible: visible,
                    subtitle: 'x',
                    subtitleVisible: true,
                });
            });

            await it(`subtitle ${JSON.stringify(text)} → visible ${visible} — ${rule}`, () => {
                expect(deriveRowLabels({ title: 'x', subtitle: text })).toStrictEqual({
                    title: 'x',
                    titleVisible: true,
                    subtitle: text ?? '',
                    subtitleVisible: visible,
                });
            });
        }

        await it('normalises an omitted property to the empty string', () => {
            expect(deriveRowLabels({})).toStrictEqual({
                title: '',
                titleVisible: false,
                subtitle: '',
                subtitleVisible: false,
            });
        });
    });

    await describe('ActionRowState (Adw.ActionRow activatable-widget)', async () => {
        for (const vector of ACTION_ROW_ACTIVATION_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const row = new ActionRowState<string>();
                for (const step of vector.steps) {
                    switch (step.op) {
                        case 'set-activatable-widget':
                            row.setActivatableWidget(step.widget, step.sensitive ?? true);
                            break;
                        case 'set-widget-sensitive':
                            row.setActivatableWidgetSensitive(step.sensitive);
                            break;
                        case 'set-activatable':
                            row.setActivatable(step.activatable);
                            break;
                    }
                }
                expect(row.activatable).toBe(vector.activatable);
                expect(row.activatableWidget).toBe(vector.activatableWidget);
            });
        }

        await it('gates notify::activatable-widget on a real change (C:706-707)', () => {
            const row = new ActionRowState<string>();
            expect(row.setActivatableWidget('switch')).toBe(true);
            expect(row.setActivatableWidget('switch')).toBe(false);
            expect(row.setActivatableWidget(null)).toBe(true);
            expect(row.setActivatableWidget(null)).toBe(false);
        });

        await it('re-syncs activatable on an identity-changing re-set, not on a repeat', () => {
            const row = new ActionRowState<string>();
            row.setActivatableWidget('switch', false);
            expect(row.activatable).toBe(false);
            // Same widget, now claimed sensitive: the C early-returns on identity
            // BEFORE it would rebind, so nothing happens.
            expect(row.setActivatableWidget('switch', true)).toBe(false);
            expect(row.activatable).toBe(false);
        });

        await it('carries the labels with the same rule the rest of the family uses', () => {
            const row = new ActionRowState();
            row.setTitle('');
            row.setSubtitle('Connected');
            expect(row.state).toStrictEqual({
                title: '',
                titleVisible: false,
                subtitle: 'Connected',
                subtitleVisible: true,
                activatable: false,
            });
        });

        await it('gates notify::title / notify::subtitle on a real change', () => {
            const row = new ActionRowState();
            expect(row.setTitle('Wi-Fi')).toBe(true);
            expect(row.setTitle('Wi-Fi')).toBe(false);
            expect(row.setSubtitle(null)).toBe(false); // already ''
            expect(row.setSubtitle('On')).toBe(true);
        });

        await it('forwards an activation to the activatable widget, or to nothing', () => {
            const row = new ActionRowState<string>();
            expect(row.activate()).toBe(null);
            row.setActivatableWidget('switch');
            expect(row.activate()).toBe('switch');
        });
    });

    await describe('SwitchRowState (Adw.SwitchRow notify::active)', async () => {
        for (const vector of SWITCH_ROW_NOTIFY_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const row = new SwitchRowState();
                const emitted: boolean[] = [];
                for (const step of vector.steps) {
                    const changed = step.op === 'set-active' ? row.setActive(step.active) : row.activate();
                    // The renderer emits `notify::active` exactly when the C's
                    // slider notify would have run — i.e. on a real change.
                    if (changed) emitted.push(row.active);
                }
                expect(row.active).toBe(vector.active);
                expect(emitted).toStrictEqual([...vector.emitted]);
            });
        }

        await it('normalises a truthy non-boolean, like `!!is_active` (C:222)', () => {
            const row = new SwitchRowState();
            expect(row.setActive(1 as unknown as boolean)).toBe(true);
            expect(row.active).toBe(true);
            expect(row.setActive(true)).toBe(false);
        });
    });

    await describe('ButtonRowState (Adw.ButtonRow icons + activatability)', async () => {
        for (const vector of BUTTON_ROW_ICON_VECTORS) {
            await it(`${JSON.stringify([vector.startIconName, vector.endIconName])} — ${vector.rule}`, () => {
                const row = new ButtonRowState();
                row.setStartIconName(vector.startIconName);
                row.setEndIconName(vector.endIconName);
                expect(row.state).toStrictEqual({
                    title: '',
                    titleVisible: false,
                    startIconName: vector.startIconName ?? '',
                    startIconVisible: vector.startIconVisible,
                    endIconName: vector.endIconName ?? '',
                    endIconVisible: vector.endIconVisible,
                    activatable: true,
                });
            });
        }

        for (const vector of BUTTON_ROW_ACTIVATABLE_VECTORS) {
            await it(`activatable=${JSON.stringify(vector.declared)} — ${vector.rule}`, () => {
                // There is nothing to feed the declaration INTO: the state has no
                // input for it, which is the whole point of the vector.
                expect(new ButtonRowState().state.activatable).toBe(vector.activatable);
                expect(BUTTON_ROW_ACTIVATABLE).toBe(vector.activatable);
            });
        }

        await it('gates both icon notifies on a real change (g_set_str, C:309-312/:348-351)', () => {
            const row = new ButtonRowState();
            expect(row.setStartIconName('list-add-symbolic')).toBe(true);
            expect(row.setStartIconName('list-add-symbolic')).toBe(false);
            expect(row.setEndIconName(null)).toBe(false); // already ''
            expect(row.setEndIconName('go-next-symbolic')).toBe(true);
            expect(row.setEndIconName('')).toBe(true);
        });

        await it('hides an empty title like every other Adwaita label', () => {
            const row = new ButtonRowState();
            expect(row.state.titleVisible).toBe(false);
            row.setTitle('Delete');
            expect(row.state.titleVisible).toBe(true);
            row.setTitle(' ');
            expect(row.state.titleVisible).toBe(true);
        });
    });

    await describe('WindowTitleState (Adw.WindowTitle)', async () => {
        for (const vector of WINDOW_TITLE_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const title = new WindowTitleState();
                const notified: ('title' | 'subtitle')[] = [];
                for (const step of vector.steps) {
                    if (step.op === 'set-title') {
                        if (title.setTitle(step.value)) notified.push('title');
                    } else if (title.setSubtitle(step.value)) {
                        notified.push('subtitle');
                    }
                }
                expect(title.state).toStrictEqual({
                    title: vector.title,
                    titleVisible: vector.titleVisible,
                    subtitle: vector.subtitle,
                    subtitleVisible: vector.subtitleVisible,
                });
                expect(notified).toStrictEqual([...vector.notified]);
            });
        }
    });
};
