// `Gtk.ProgressBar` — a horizontal bar that fills — against the platform double.

import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import * as Gtk from './namespace/gtk.js';

/** The trough's column shares, as the bar cut them. */
const columns = (bar: Gtk.ProgressBar): number[] =>
    (bar as unknown as { _trough: { getColumns(): { value: number }[] } })._trough
        .getColumns()
        .map((spec) => Math.round(spec.value * 1e6) / 1e6);

export const GtkProgressBarNsTest = async () => {
    await describe('Gtk.ProgressBar', async () => {
        await it('starts empty, horizontal, with GTK defaults', () => {
            const bar = new Gtk.ProgressBar();
            expect(bar.fraction).toBe(0);
            expect(bar.pulseStep).toBe(0.1);
            expect(bar.inverted).toBe(false);
            expect(bar.showText).toBe(false);
            expect(bar.text).toBe(null);
            expect(bar.get_css_classes()).toStrictEqual(['horizontal']);
            expect(bar.className).toBe('adw-progress-bar horizontal');
        });

        await it('clamps fraction to [0, 1] and notifies on every write, an equal one included', () => {
            const bar = new Gtk.ProgressBar();
            let notified = 0;
            bar.connect('notify::fraction', () => notified++);
            bar.set_fraction(0.5);
            bar.set_fraction(0.5);
            bar.set_fraction(2);
            expect(bar.get_fraction()).toBe(1);
            bar.fraction = -1;
            expect(bar.fraction).toBe(0);
            expect(notified).toBe(4);
        });

        await it('splits the trough at the fraction and draws no fill at 0', () => {
            const bar = new Gtk.ProgressBar({ fraction: 0.25 });
            expect(columns(bar)).toStrictEqual([0.25, 0.75]);
            bar.fraction = 1;
            expect(columns(bar)).toStrictEqual([1]);
            bar.fraction = 0;
            expect(columns(bar)).toStrictEqual([1]);
            expect((bar as unknown as { _fill: { visibility: string } })._fill.visibility).toBe('collapse');
        });

        await it('grows from the other end when inverted', () => {
            const bar = new Gtk.ProgressBar({ fraction: 0.25 });
            bar.inverted = true;
            expect(columns(bar)).toStrictEqual([0.75, 0.25]);
        });

        await it('shows the percentage with show-text unless a text was set', () => {
            const bar = new Gtk.ProgressBar({ fraction: 0.5 });
            const label = (bar as unknown as { _label: { text: string; visibility: string } })._label;
            expect(label.visibility).toBe('collapse');
            bar.showText = true;
            expect(label.text).toBe('50%');
            bar.fraction = 0.756;
            expect(label.text).toBe('76%');
            bar.text = 'Uploading';
            expect(label.text).toBe('Uploading');
            bar.text = null;
            expect(label.text).toBe('76%');
        });

        await it('pulse() moves a block, bounces, and leaves fraction alone', () => {
            const bar = new Gtk.ProgressBar({ fraction: 0.3, pulseStep: 0.5 });
            let notified = 0;
            bar.connect('notify::fraction', () => notified++);
            bar.pulse();
            expect(bar.pulsing).toBe(true);
            expect(columns(bar)).toStrictEqual([0.2, 0.8]);
            bar.pulse();
            expect(columns(bar)).toStrictEqual([0.5, 0.2, 0.3]);
            bar.pulse();
            expect(columns(bar)).toStrictEqual([0.8, 0.2]);
            bar.pulse();
            expect(columns(bar)).toStrictEqual([0.3, 0.2, 0.5]);
            expect(bar.fraction).toBe(0.3);
            expect(notified).toBe(0);
        });

        await it('a fraction write ends the pulse', () => {
            const bar = new Gtk.ProgressBar();
            bar.pulse();
            bar.pulse();
            bar.set_fraction(0.4);
            expect(bar.pulsing).toBe(false);
            expect(columns(bar)).toStrictEqual([0.4, 0.6]);
        });

        await it('reads the strings an XML attribute hands the setters', () => {
            const bar = build({
                tag: 'GtkProgressBar',
                props: { fraction: '0.5', 'show-text': 'true', inverted: 'true', 'pulse-step': '0.2' },
            }) as unknown as Gtk.ProgressBar;
            expect(bar.fraction).toBe(0.5);
            expect(bar.showText).toBe(true);
            expect(bar.inverted).toBe(true);
            expect(bar.pulseStep).toBe(0.2);
        });
    });
};
