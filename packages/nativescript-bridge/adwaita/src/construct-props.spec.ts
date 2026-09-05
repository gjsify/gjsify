// The construct-props bag and the `Gtk.Align` table, off-device.
//
// Both modules are free of `@nativescript/core` VALUE imports on purpose, so this suite
// exercises the SHIPPING code rather than a transcription of it — the widget classes
// themselves cannot be imported here at all (`extends GridLayout` evaluates the bare
// specifier at module-eval, and the workspace install has no `@nativescript/core`).
//
// What stands in for a widget is a class with the same SHAPE: a private field behind a
// validating setter, a getter with no setter, an own field assigned in the constructor.
// That is the whole surface `settableDoor` reads.

import { describe, expect, it } from '@gjsify/unit';

import { applyConstructProps, nsAlignment } from './widgets/construct-props.js';
import { GTK_ALIGN, GTK_ALIGN_REFUSALS, NS_HORIZONTAL_ALIGNMENT, NS_VERTICAL_ALIGNMENT } from './widgets/gtk-align.js';

/**
 * The `@nativescript/core` half — the two alignment properties, where a real `View` keeps
 * them: prototype accessors installed by `Property.register`
 * (`ui/core/properties/index.ts:342-348`), one class up from the widget.
 */
class NsViewShape {
    private _horizontal = 'stretch';
    private _vertical = 'stretch';

    get horizontalAlignment(): string {
        return this._horizontal;
    }

    set horizontalAlignment(value: string) {
        this._horizontal = value;
    }

    get verticalAlignment(): string {
        return this._vertical;
    }

    set verticalAlignment(value: string) {
        this._vertical = value;
    }
}

/** A widget-shaped target: the three descriptor kinds a bag can meet, and nothing else. */
class WidgetShape extends NsViewShape {
    /** An own writable data property — what a widget assigns to itself in its constructor. */
    closeHandler: (() => void) | null = null;
    private _size = 48;
    private _text = '';

    get size(): number {
        return this._size;
    }

    /** Validating like a real one, so "the bag went through the setter" is observable. */
    set size(value: number | string) {
        const parsed = typeof value === 'number' ? value : Number(value);
        this._size = Number.isFinite(parsed) && parsed > 0 ? parsed : 48;
    }

    get text(): string {
        return this._text;
    }

    set text(value: string) {
        this._text = value ?? '';
    }

    /** A getter with no setter — `set: undefined` in the descriptor. */
    get textLength(): number {
        return this._text.length;
    }
}

export default async () => {
    await describe('applyConstructProps — the door', async () => {
        await it('routes each key through the setter rather than past it', () => {
            const widget = new WidgetShape();
            applyConstructProps(widget, { size: '96', text: 'Ada Lovelace' });
            // `'96'` came out a number: the setter ran. A raw assignment would have left
            // the string, and the widget would have laid itself out at a string width.
            expect(widget.size).toBe(96);
            expect(widget.text).toBe('Ada Lovelace');
        });

        await it('refuses a key nothing declares instead of leaving a dead own-property', () => {
            const widget = new WidgetShape();
            expect(() => applyConstructProps(widget, { showInitals: true })).toThrow('has no settable');
            expect(() => applyConstructProps(widget, { showInitals: true })).toThrow('WidgetShape');
            expect(Object.hasOwn(widget, 'showInitals')).toBe(false);
        });

        await it('refuses a getter with no setter, which assignment cannot reach either', () => {
            expect(() => applyConstructProps(new WidgetShape(), { textLength: 3 })).toThrow('textLength');
        });

        await it('accepts an own writable field, because assignment does land there', () => {
            const widget = new WidgetShape();
            const handler = () => undefined;
            applyConstructProps(widget, { closeHandler: handler });
            expect(widget.closeHandler).toBe(handler);
        });

        await it('skips an undefined VALUE but still refuses an unknown KEY carrying one', () => {
            const widget = new WidgetShape();
            widget.text = 'kept';
            applyConstructProps(widget, { text: undefined });
            expect(widget.text).toBe('kept');
            expect(() => applyConstructProps(widget, { nope: undefined })).toThrow('has no settable');
        });

        await it('is a no-op without a bag — which is what the XML builder always passes', () => {
            const widget = new WidgetShape();
            expect(() => applyConstructProps(widget, undefined)).not.toThrow();
            expect(widget.size).toBe(48);
        });
    });

    await describe('Gtk.Align — the value table', async () => {
        await it('holds the GIR constants, which are not the positions in the nick list', () => {
            // Gtk-4.0.gir (gtk4, org.gnome.Sdk/50) and the installed typelib read through
            // `gjs -m` agree on these. `baseline` is the deprecated ALIAS of `baseline-fill`,
            // so the seven nicks carry six values and everything after the pair is one below
            // its position — which is why this table is authored and pinned rather than
            // derived from the nick order.
            expect(GTK_ALIGN).toStrictEqual({
                fill: 0,
                start: 1,
                end: 2,
                center: 3,
                'baseline-fill': 4,
                baseline: 4,
                'baseline-center': 5,
            });
        });

        await it('translates the nick per axis, where NativeScript spells it differently', () => {
            expect(nsAlignment('fill', 'horizontal')).toBe('stretch');
            expect(nsAlignment('center', 'horizontal')).toBe('center');
            // The vertical axis has no `center` and no `start`/`end` at all.
            expect(nsAlignment('center', 'vertical')).toBe('middle');
            expect(nsAlignment('start', 'vertical')).toBe('top');
            expect(nsAlignment('end', 'vertical')).toBe('bottom');
        });

        await it('accepts the constant a ported GJS snippet carries', () => {
            expect(nsAlignment(GTK_ALIGN.center, 'horizontal')).toBe('center');
            expect(nsAlignment(GTK_ALIGN.fill, 'vertical')).toBe('stretch');
        });

        await it('leaves a NativeScript-native spelling alone', () => {
            for (const value of ['left', 'right', 'stretch']) expect(nsAlignment(value, 'horizontal')).toBe(value);
            for (const value of ['top', 'middle', 'bottom']) expect(nsAlignment(value, 'vertical')).toBe(value);
        });

        await it('refuses the baselines with the reason, on both axes', () => {
            for (const nick of Object.keys(GTK_ALIGN_REFUSALS)) {
                for (const axis of ['horizontal', 'vertical'] as const) {
                    expect(() => nsAlignment(nick, axis)).toThrow('has no');
                    expect(() => nsAlignment(nick, axis)).toThrow('baseline');
                }
            }
        });

        await it('refuses a number that is no member — 6 is past the end after the alias', () => {
            expect(() => nsAlignment(6, 'horizontal')).toThrow('not a Gtk.Align constant');
        });

        await it('declares every member exactly once: mapped on an axis, or refused', () => {
            for (const nick of Object.keys(GTK_ALIGN)) {
                const horizontal = Object.hasOwn(NS_HORIZONTAL_ALIGNMENT, nick);
                const vertical = Object.hasOwn(NS_VERTICAL_ALIGNMENT, nick);
                const refused = Object.hasOwn(GTK_ALIGN_REFUSALS, nick);
                expect([nick, horizontal === vertical]).toStrictEqual([nick, true]);
                expect([nick, horizontal !== refused]).toStrictEqual([nick, true]);
            }
        });
    });

    await describe('applyConstructProps — the alignment widening', async () => {
        await it('translates a Gtk.Align on the NativeScript alignment properties', () => {
            const widget = new WidgetShape();
            applyConstructProps(widget, { horizontalAlignment: 'fill', verticalAlignment: GTK_ALIGN.center });
            expect(widget.horizontalAlignment).toBe('stretch');
            expect(widget.verticalAlignment).toBe('middle');
        });

        await it('does not touch a value NativeScript already owns', () => {
            const widget = new WidgetShape();
            applyConstructProps(widget, { horizontalAlignment: 'right', verticalAlignment: 'top' });
            expect(widget.horizontalAlignment).toBe('right');
            expect(widget.verticalAlignment).toBe('top');
        });
    });
};
