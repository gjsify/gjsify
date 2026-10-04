// `Gtk.CheckButton`, `Gtk.Separator`, `Gtk.Frame`, `Gtk.TextView` and `Gtk.DrawingArea`
// (ADR 0034 § Amendment 23) against the platform double — the tree and the state, never
// pixels: the double has no layout pass and no CSS engine.

import { describe, expect, it } from '@gjsify/unit';

import { DRAWING_AREA_REFUSAL } from './widgets/gtk-drawing-area.js';
import * as Gtk from './namespace/gtk.js';

const tap = (view: object): void => (view as Gtk.CheckButton).notify({ eventName: 'tap', object: view as never });

export const GtkControlsNsTest = async () => {
    await describe('Gtk.CheckButton', async () => {
        await it('is inactive and unlabelled by default, wearing only its own class', () => {
            const check = new Gtk.CheckButton();
            expect(check.active).toBe(false);
            expect(check.inconsistent).toBe(false);
            expect(check.label).toBe(null);
            expect(check.className).toBe('adw-check-button');
        });

        await it('wears `checked` and `inconsistent` as state classes the style list never reports', () => {
            const check = new Gtk.CheckButton({ active: true });
            check.add_css_class('selection-mode');
            check.inconsistent = true;
            expect(check.styleClasses).toStrictEqual(['selection-mode']);
            expect(check.className).toBe('adw-check-button selection-mode checked inconsistent');
        });

        await it('emits toggled and notify::active once per real change', () => {
            const check = new Gtk.CheckButton();
            const seen: string[] = [];
            check.connect('toggled', () => seen.push('toggled'));
            check.connect('notify::active', () => seen.push('notify'));
            check.active = true;
            check.active = true;
            expect(seen).toStrictEqual(['toggled', 'notify']);
        });

        await it('a tap toggles, clears inconsistent and emits activate', () => {
            const check = new Gtk.CheckButton({ inconsistent: true });
            let activated = 0;
            check.connect('activate', () => activated++);
            tap(check);
            expect(check.active).toBe(true);
            expect(check.inconsistent).toBe(false);
            expect(activated).toBe(1);
            tap(check);
            expect(check.active).toBe(false);
        });

        await it('shows its text only while there is a label and no child replacing it', () => {
            const check = new Gtk.CheckButton({ label: 'Remember me' });
            expect(check.label).toBe('Remember me');
            const child = new Gtk.Label();
            check.child = child;
            expect(check.child).toBe(child);
            check.child = null;
            expect(check.child).toBe(null);
        });

        await it('reads the string a template writes', () => {
            const check = new Gtk.CheckButton();
            (check as unknown as { active: string }).active = 'true';
            expect(check.active).toBe(true);
        });
    });

    await describe('Gtk.Separator', async () => {
        await it('is horizontal by default', () => {
            const separator = new Gtk.Separator();
            expect(separator.orientation).toBe('horizontal');
            expect(separator.className).toBe('adw-separator horizontal');
        });

        await it('takes the orientation as a nick or as Gtk.Orientation.VERTICAL', () => {
            const separator = new Gtk.Separator({ orientation: 'vertical' });
            expect(separator.className).toBe('adw-separator vertical');
            separator.orientation = 'horizontal';
            expect(separator.className).toBe('adw-separator horizontal');
            separator.orientation = 1 as never;
            expect(separator.orientation).toBe('vertical');
        });

        await it('keeps the caller style classes beside its own', () => {
            const separator = new Gtk.Separator();
            separator.add_css_class('spacer');
            expect(separator.className).toBe('adw-separator horizontal spacer');
        });
    });

    await describe('Gtk.Frame', async () => {
        await it('holds one child, replacing its predecessor', () => {
            const frame = new Gtk.Frame();
            const first = new Gtk.Label();
            const second = new Gtk.Label();
            frame.child = first;
            frame.child = second;
            expect(frame.child).toBe(second);
            expect(frame.get_child()).toBe(second);
            expect(frame.className).toBe('adw-frame');
        });

        await it('takes a text label, and a label-widget takes its place', () => {
            const frame = new Gtk.Frame({ label: 'Registers' });
            expect(frame.label).toBe('Registers');
            const widget = new Gtk.Label();
            frame.set_label_widget(widget);
            expect(frame.labelWidget).toBe(widget);
            frame.labelWidget = null;
            expect(frame.labelWidget).toBe(null);
        });

        await it('routes builder slots: `label-widget` to the label, anything else to the child', () => {
            const frame = new Gtk.Frame();
            const label = new Gtk.Label();
            const body = new Gtk.Label();
            frame._addChildFromBuilder('label-widget', label);
            frame._addChildFromBuilder('child', body);
            expect(frame.labelWidget).toBe(label);
            expect(frame.child).toBe(body);
        });
    });

    await describe('Gtk.TextView', async () => {
        await it('holds the text and notifies once per change', () => {
            const view = new Gtk.TextView();
            const seen: string[] = [];
            view.connect('notify::text', () => seen.push(view.text));
            view.text = 'lda #$01';
            view.text = 'lda #$01';
            expect(view.text).toBe('lda #$01');
            expect(seen).toStrictEqual(['lda #$01']);
        });

        await it('follows edits made in the inner field', () => {
            const view = new Gtk.TextView();
            view.field.text = 'brk';
            expect(view.text).toBe('brk');
        });

        await it('wears `monospace` as a class', () => {
            const view = new Gtk.TextView({ monospace: true });
            expect(view.className).toBe('adw-text-view monospace');
            view.monospace = false;
            expect(view.className).toBe('adw-text-view');
        });

        await it('reads wrap-mode as a nick or a Gtk.WrapMode constant and refuses anything else', () => {
            const view = new Gtk.TextView();
            expect(view.wrapMode).toBe('none');
            view.wrapMode = 'word';
            expect(view.wrapMode).toBe('word');
            view.wrapMode = 3 as never;
            expect(view.wrapMode).toBe('word-char');
            expect(() => {
                view.wrapMode = 'sideways' as never;
            }).toThrow();
        });
    });

    await describe('Gtk.DrawingArea', async () => {
        await it('constructs, so a template that places one still builds', () => {
            const area = new Gtk.DrawingArea({ contentWidth: 320, contentHeight: 240 });
            expect(area.contentWidth).toBe(320);
            expect(area.contentHeight).toBe(240);
        });

        await it('REFUSES set_draw_func by name rather than drawing nothing', () => {
            const area = new Gtk.DrawingArea();
            let message = '';
            try {
                area.set_draw_func(() => {});
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toBe(DRAWING_AREA_REFUSAL);
            expect(message.includes('set_draw_func')).toBe(true);
        });

        await it('queue_draw is a no-op', () => {
            expect(() => new Gtk.DrawingArea().queue_draw()).not.toThrow();
        });
    });
};
