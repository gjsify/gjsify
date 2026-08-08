// Action-row family behaviour for the NativeScript renderer, against the SAME
// vectors the browser suite drives its real elements with.
//
// The widgets themselves cannot be imported here — `AdwActionRow extends
// GridLayout` evaluates the bare `@nativescript/core` specifier at module-eval,
// which is unresolvable on GJS/Node — so the pure half lives in
// `widgets/row-state.ts` and the widgets are thin appliers over it. What is
// asserted is the SHIPPING code, not a transcription of it.
//
// Every rule here was missing on this side. The port applied
// `string_is_not_empty` to the SUBTITLE only, and did it structurally (add /
// remove the Label), so a row with an empty title kept a full-height blank line
// and a window title showing only a subtitle reserved one above it.
// `Adw.ActionRow:activatable-widget` and `Adw.ButtonRow:end-icon-name` did not
// exist. And the switch row's notify came straight off `checkedChange`, so it
// could not express the equality early-return libadwaita puts in front of it
// (adw-switch-row.c:224-225): re-setting the value already held emitted anyway.

import { describe, expect, it } from '@gjsify/unit';

import {
    ACTION_ROW_ACTIVATION_VECTORS,
    BUTTON_ROW_ACTIVATABLE_VECTORS,
    BUTTON_ROW_ICON_VECTORS,
    LABEL_VISIBILITY_VECTORS,
    SWITCH_ROW_NOTIFY_VECTORS,
    WINDOW_TITLE_VECTORS,
} from '@gjsify/adwaita-core/conformance';

import {
    ActionRowState,
    ButtonRowState,
    SwitchRowState,
    WindowTitleState,
    buttonRowIconVisuals,
    isViewSensitive,
    nsVisibility,
    rowLabelVisuals,
    toLabelVisuals,
} from './widgets/row-state.js';

/** A stand-in for the only property of a `View` the binding reads. */
interface SensitiveView {
    isUserInteractionEnabled: boolean;
}

export default async () => {
    await describe('rowLabelVisuals (string_is_not_empty → View.visibility)', async () => {
        for (const { text, visible, rule } of LABEL_VISIBILITY_VECTORS) {
            const expected = visible ? 'visible' : 'collapse';

            await it(`title ${JSON.stringify(text)} → ${expected} — ${rule}`, () => {
                expect(rowLabelVisuals({ title: text, subtitle: 'x' })).toStrictEqual({
                    title: text ?? '',
                    titleVisibility: expected,
                    subtitle: 'x',
                    subtitleVisibility: 'visible',
                });
            });

            await it(`subtitle ${JSON.stringify(text)} → ${expected} — ${rule}`, () => {
                expect(rowLabelVisuals({ title: 'x', subtitle: text })).toStrictEqual({
                    title: 'x',
                    titleVisibility: 'visible',
                    subtitle: text ?? '',
                    subtitleVisibility: expected,
                });
            });
        }

        await it("uses 'collapse', never 'hidden' — a hidden NS view still takes its space", () => {
            expect(nsVisibility(false)).toBe('collapse');
            expect(nsVisibility(true)).toBe('visible');
        });
    });

    await describe('ActionRowState through the NativeScript sensitivity mapping', async () => {
        for (const vector of ACTION_ROW_ACTIVATION_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const row = new ActionRowState<SensitiveView>();
                const views = new Map<string, SensitiveView>();
                let last: SensitiveView | null = null;

                for (const step of vector.steps) {
                    switch (step.op) {
                        case 'set-activatable-widget': {
                            if (step.widget === null) {
                                row.setActivatableWidget(null);
                                break;
                            }
                            let view = views.get(step.widget);
                            if (!view) {
                                view = { isUserInteractionEnabled: true };
                                views.set(step.widget, view);
                            }
                            view.isUserInteractionEnabled = step.sensitive !== false;
                            row.setActivatableWidget(view, isViewSensitive(view));
                            last = view;
                            break;
                        }
                        case 'set-widget-sensitive':
                            if (last) last.isUserInteractionEnabled = step.sensitive;
                            // The widget's own write is not observable in NS, so
                            // the widget drives the binding's live half by hand.
                            row.setActivatableWidgetSensitive(isViewSensitive(row.activatableWidget));
                            break;
                        case 'set-activatable':
                            row.setActivatable(step.activatable);
                            break;
                    }
                }

                expect(row.activatable).toBe(vector.activatable);
                const expectedView = vector.activatableWidget === null ? null : views.get(vector.activatableWidget);
                expect(row.activatableWidget).toBe(expectedView ?? null);
            });
        }

        await it('treats a never-touched view as sensitive, like GTK does', () => {
            expect(isViewSensitive(null)).toBe(true);
            expect(isViewSensitive(undefined)).toBe(true);
            expect(isViewSensitive({ isUserInteractionEnabled: true })).toBe(true);
            expect(isViewSensitive({ isUserInteractionEnabled: false })).toBe(false);
        });

        await it('collapses an empty title, which this port never did', () => {
            const row = new ActionRowState();
            row.setSubtitle('Connected');
            expect(toLabelVisuals(row.state).titleVisibility).toBe('collapse');
            row.setTitle('Wi-Fi');
            expect(toLabelVisuals(row.state).titleVisibility).toBe('visible');
        });
    });

    await describe('SwitchRowState (the notify the checkedChange re-emit could not express)', async () => {
        for (const vector of SWITCH_ROW_NOTIFY_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const row = new SwitchRowState();
                const sw = { checked: false };
                const emitted: boolean[] = [];

                // Exactly what `AdwSwitchRow._apply` does: write the Switch and
                // emit `notify::active`, but only for a real change.
                const apply = (changed: boolean) => {
                    if (!changed) return;
                    sw.checked = row.active;
                    emitted.push(row.active);
                };

                for (const step of vector.steps) {
                    apply(step.op === 'set-active' ? row.setActive(step.active) : row.activate());
                }

                expect(row.active).toBe(vector.active);
                expect(sw.checked).toBe(vector.active);
                expect(emitted).toStrictEqual([...vector.emitted]);
            });
        }

        await it('coerces a truthy non-boolean, as the old accessor did (C:222)', () => {
            const row = new SwitchRowState();
            expect(row.setActive(1 as unknown as boolean)).toBe(true);
            expect(row.active).toBe(true);
        });
    });

    await describe('ButtonRowState through the NativeScript icon mapping', async () => {
        for (const vector of BUTTON_ROW_ICON_VECTORS) {
            await it(`${JSON.stringify([vector.startIconName, vector.endIconName])} — ${vector.rule}`, () => {
                const row = new ButtonRowState();
                row.setStartIconName(vector.startIconName);
                row.setEndIconName(vector.endIconName);

                expect(buttonRowIconVisuals(row.state)).toStrictEqual({
                    startIcon: vector.startIconName ?? '',
                    startIconVisibility: vector.startIconVisible ? 'visible' : 'collapse',
                    endIcon: vector.endIconName ?? '',
                    endIconVisibility: vector.endIconVisible ? 'visible' : 'collapse',
                });
            });
        }

        for (const vector of BUTTON_ROW_ACTIVATABLE_VECTORS) {
            await it(`activatable=${JSON.stringify(vector.declared)} — ${vector.rule}`, () => {
                // A button row sets `activatable = true` in its constructor and
                // has nothing that could turn it off — there is no input for the
                // declaration to enter through, which is the point.
                const row = new ActionRowState();
                row.setActivatable(true);
                expect(row.activatable).toBe(vector.activatable);
                expect(new ButtonRowState().state.activatable).toBe(vector.activatable);
            });
        }
    });

    await describe('WindowTitleState through the NativeScript mapping', async () => {
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

                expect(toLabelVisuals(title.state)).toStrictEqual({
                    title: vector.title,
                    titleVisibility: vector.titleVisible ? 'visible' : 'collapse',
                    subtitle: vector.subtitle,
                    subtitleVisibility: vector.subtitleVisible ? 'visible' : 'collapse',
                });
                expect(notified).toStrictEqual([...vector.notified]);
            });
        }
    });
};
