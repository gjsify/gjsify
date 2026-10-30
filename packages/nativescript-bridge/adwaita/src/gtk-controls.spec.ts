// `Gtk.CheckButton`, `Gtk.Separator`, `Gtk.Frame`, `Gtk.TextView` and `Gtk.DrawingArea`
// (ADR 0034 § Amendment 23) against the platform double — the tree and the state, never
// pixels: the double has no layout pass and no CSS engine.

import { describe, expect, it } from '@gjsify/unit';
import { driveCheckGroupVectors, type CheckButtonLike } from '@gjsify/adwaita-core/conformance';

import { DRAWING_AREA_REFUSAL } from './widgets/gtk-drawing-area.js';
import * as Gtk from './namespace/gtk.js';
import { type GridLayout, Label } from './testing/ns-core.mjs';

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

        await it('stretches its content column only while it has a label or child', () => {
            // An empty `star` column filled an `Adw.WrapBox` line, one swatch per line.
            const units = (check: Gtk.CheckButton) =>
                (check as unknown as GridLayout).getColumns().map((spec) => spec.gridUnitType);
            const check = new Gtk.CheckButton();
            expect(units(check)).toStrictEqual(['auto', 'auto']);
            check.label = 'Blue';
            expect(units(check)).toStrictEqual(['auto', 'star']);
            check.label = null;
            expect(units(check)).toStrictEqual(['auto', 'auto']);
            check.set_child(new Label() as never);
            expect(units(check)).toStrictEqual(['auto', 'star']);
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

        await it('a grouped button wears `radio` on its indicator, as GTK names the node', () => {
            const [a, b] = [new Gtk.CheckButton(), new Gtk.CheckButton()];
            b.set_group(a);
            const indicator = (check: Gtk.CheckButton) =>
                (check as unknown as { _indicator: { className: string } })._indicator.className;
            expect([indicator(a), indicator(b)]).toStrictEqual([
                'adw-check-indicator radio',
                'adw-check-indicator radio',
            ]);
            b.set_group(null);
            expect(indicator(b)).toBe('adw-check-indicator');
        });
    });

    await driveCheckGroupVectors(
        {
            name: 'adwaita-nativescript',
            isOracle: false,
            make: () => new Gtk.CheckButton() as unknown as CheckButtonLike,
            activate: (button) => tap(button),
            countToggled(button) {
                let count = 0;
                (button as unknown as Gtk.CheckButton).connect('toggled', () => void (count += 1));
                return () => count;
            },
        },
        { describe, it, expect },
    );

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
            view.wrapMode = '2' as never;
            expect(view.wrapMode).toBe('word');
            view.wrapMode = 3 as never;
            expect(view.wrapMode).toBe('word-char');
            view.wrapMode = 'none';
            view.wrapMode = 'word_char' as never;
            expect(view.wrapMode).toBe('word-char');
            expect(() => {
                view.wrapMode = 'sideways' as never;
            }).toThrow();
        });

        await it('offers a buffer subset whose inserts advance the cursor', () => {
            const view = new Gtk.TextView();
            expect(view.buffer.cursor_position).toBe(0);
            view.buffer.insert_at_cursor('a', -1);
            view.buffer.insert_at_cursor('\nb', -1);
            expect(view.text).toBe('a\nb');
            expect(view.buffer.cursor_position).toBe(3);
            view.buffer.set_text('', 0);
            expect(view.text).toBe('');
            expect(view.buffer.cursor_position).toBe(0);
        });

        await it('holds the four margins as padding on the inner field', () => {
            const view = new Gtk.TextView();
            view.topMargin = 1;
            view.bottomMargin = 12;
            view.leftMargin = '8' as never;
            view.rightMargin = 4;
            expect(view.topMargin).toBe(1);
            expect(view.bottomMargin).toBe(12);
            expect(view.leftMargin).toBe(8);
            expect(view.rightMargin).toBe(4);
        });
    });

    await describe('Gtk.Label selectable', async () => {
        await it('is false by default and holds what it is given, as a boolean or an XML string', () => {
            const label = new Gtk.Label();
            expect(label.selectable).toBe(false);
            label.selectable = true;
            expect(label.selectable).toBe(true);
            label.selectable = 'false' as never;
            expect(label.selectable).toBe(false);
        });
    });

    await describe('Gtk.Label label accessors', async () => {
        await it('reads and writes the label through get_label and set_label', () => {
            const label = new Gtk.Label();
            label.set_label('R0');
            expect(label.get_label()).toBe('R0');
            expect(label.get_text()).toBe('R0');
        });
    });

    await describe('Gtk.Label justify beside xalign', async () => {
        const rtl = (label: Gtk.Label): void => {
            (label.style as { direction: string | null }).direction = 'rtl';
        };
        const nativeModes = (label: Gtk.Label): number[] => {
            const modes: number[] = [];
            (label as unknown as { nativeViewProtected: unknown }).nativeViewProtected = {
                setJustificationMode: (mode: number) => modes.push(mode),
            };
            return modes;
        };

        await it('reads back left by default and leaves the platform alignment alone', () => {
            const label = new Gtk.Label();
            expect(label.justify).toBe('left');
            expect(label.textAlignment).toBe('initial');
        });

        await it('takes the nick, the Gtk.Justification constant and its XML string, and reads the nick', () => {
            const label = new Gtk.Label();
            label.justify = 2;
            expect(label.justify).toBe('center');
            label.justify = '1';
            expect(label.justify).toBe('right');
            label.justify = 'fill';
            expect(label.justify).toBe('fill');
        });

        await it('refuses what is not a Gtk.Justification and keeps the old value', () => {
            const label = new Gtk.Label();
            label.justify = 'center';
            expect(() => {
                label.justify = 4;
            }).toThrow('is not a Gtk.Justification');
            expect(() => {
                label.justify = 'middle';
            }).toThrow('is not a Gtk.Justification');
            expect(label.justify).toBe('center');
        });

        await it('centres a wrapping label with justify center and the default xalign', () => {
            const label = new Gtk.Label({ label: 'Learn 6502 assembly', wrap: true });
            label.justify = 'center';
            expect(label.textAlignment).toBe('center');
        });

        await it('renders justify center + wrap + xalign 0.5 in any write order', () => {
            const first = new Gtk.Label();
            first.justify = 'center';
            first.wrap = true;
            first.xalign = 0.5;
            const second = new Gtk.Label();
            second.xalign = 0.5;
            second.wrap = true;
            second.justify = 'center';
            expect(first.textAlignment).toBe('center');
            expect(second.textAlignment).toBe('center');
        });

        await it('lets xalign alone decide a single line, where justify has no effect in GTK', () => {
            const label = new Gtk.Label({ label: 'one line' });
            label.justify = 'right';
            label.xalign = 0;
            expect(label.textAlignment).toBe('left');
            expect(label.justify).toBe('right');
        });

        await it('keeps the default justify off a several-line label, as before', () => {
            const label = new Gtk.Label({ wrap: true });
            label.xalign = 1;
            expect(label.textAlignment).toBe('right');
        });

        await it('maps justify right and xalign 1 to the end edge, mirrored in RTL', () => {
            const label = new Gtk.Label({ wrap: true });
            label.justify = 'right';
            label.xalign = 1;
            expect(label.textAlignment).toBe('right');
            const mirrored = new Gtk.Label({ wrap: true });
            rtl(mirrored);
            mirrored.justify = 'right';
            mirrored.xalign = 1;
            expect(mirrored.textAlignment).toBe('left');
        });

        await it('refuses a several-line label whose xalign and justify name different edges', () => {
            const label = new Gtk.Label({ wrap: true });
            label.xalign = 0;
            expect(() => {
                label.justify = 'center';
            }).toThrow('textAlignment is one alignment for both');
            expect(label.justify).toBe('left');
            expect(label.textAlignment).toBe('left');
        });

        await it('refuses turning wrap on, or a newline, when that makes the edges disagree', () => {
            const label = new Gtk.Label({ label: 'one line' });
            label.justify = 'center';
            label.xalign = 1;
            expect(label.textAlignment).toBe('right');
            expect(() => {
                label.wrap = true;
            }).toThrow('textAlignment is one alignment for both');
            expect(label.wrap).toBe(false);
            expect(() => {
                label.label = 'two\nlines';
            }).toThrow('textAlignment is one alignment for both');
            expect(label.get_text()).toBe('one line');
        });

        await it('maps fill to the platform justify word in LTR', () => {
            const label = new Gtk.Label({ wrap: true });
            label.justify = 'fill';
            expect(label.textAlignment).toBe('justify');
            label.xalign = 0;
            expect(label.textAlignment).toBe('justify');
        });

        await it('sets inter-word justification on the TextView for fill in RTL, and clears it after', () => {
            const label = new Gtk.Label({ wrap: true });
            rtl(label);
            const modes = nativeModes(label);
            label.justify = 'fill';
            expect(label.textAlignment).toBe('right');
            expect(modes.at(-1)).toBe(1);
            label.justify = 'right';
            expect(label.textAlignment).toBe('left');
            expect(modes.at(-1)).toBe(0);
        });
    });

    await describe('Gtk.DropDown selected accessors', async () => {
        await it('reads and writes the selection through get_selected and set_selected', () => {
            const drop = new Gtk.DropDown({ model: new Gtk.StringList({ strings: ['a', 'b', 'c'] }) });
            expect(drop.get_selected()).toBe(0);
            drop.set_selected(2);
            expect(drop.get_selected()).toBe(2);
            expect(drop.selected).toBe(2);
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
