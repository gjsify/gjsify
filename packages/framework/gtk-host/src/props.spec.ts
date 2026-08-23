// Property coercion — the layer that turns GObject's silent failures into loud ones.

import { expect, it, on } from '@gjsify/unit';

import Gtk from 'gi://Gtk?version=4.0';

import { installDiagnosticsGate } from './conformance/index.js';
import { gated } from './testing/gate.mjs';
import { GtkHostError } from './errors.js';
import { createElement, materialize, setProp } from './host.js';
import { constructOnlyNames, paramSpecs, toPropertyName } from './props.js';
import { registerBuiltinWidgets } from './descriptors/index.js';

export default async () => {
    await on('Gjs', async () => {
        Gtk.init();
        registerBuiltinWidgets();

        // Every vector below also asserts that GTK reported nothing. Without this
        // the whole mis-parenting class is invisible: it emits criticals and exits 0.
        const diagnostics = installDiagnosticsGate();

        await gated(diagnostics, 'toPropertyName', async () => {
            await it('maps camelCase to the GObject kebab name', async () => {
                expect(toPropertyName('cssName')).toBe('css-name');
                expect(toPropertyName('marginTop')).toBe('margin-top');
            });

            await it('leaves an already-kebab name alone', async () => {
                expect(toPropertyName('margin-top')).toBe('margin-top');
                expect(toPropertyName('label')).toBe('label');
            });
        });

        await gated(diagnostics, 'ParamSpec facts of the installed GTK', async () => {
            await it('reads every property of a class', async () => {
                const specs = paramSpecs(Gtk.Button, 'GtkButton');
                expect(specs.has('label')).toBe(true);
                expect(specs.has('sensitive')).toBe(true);
            });

            await it('separates construct-only properties', async () => {
                // Measured: `css-name` is writable+construct-only and inherited by
                // every widget, which is why a raw construct-only census reads ~3x
                // higher than the number of widgets that actually need a rebuild.
                expect(constructOnlyNames(Gtk.Button, 'GtkButton')).toStrictEqual(['css-name']);
            });
        });

        await gated(diagnostics, 'enum coercion', async () => {
            await it('resolves a string nick that GObject would have dropped', async () => {
                // The bug this prevents: `set_property('orientation','vertical')`
                // emits GLib-GObject-CRITICAL and leaves HORIZONTAL, and the JS
                // setter `box.orientation = 'vertical'` does the same with no
                // diagnostic at all. Both measured on gjs 1.88.1.
                const box = createElement('GtkBox', { orientation: 'vertical' });
                const widget = materialize(box) as unknown as Gtk.Box;
                expect(widget.orientation).toBe(Gtk.Orientation.VERTICAL);
            });

            await it('accepts the numeric value too', async () => {
                const box = createElement('GtkBox', { orientation: Gtk.Orientation.VERTICAL });
                const widget = materialize(box) as unknown as Gtk.Box;
                expect(widget.orientation).toBe(Gtk.Orientation.VERTICAL);
            });

            await it('throws on a nick the enum does not have, naming the type', async () => {
                const box = createElement('GtkBox');
                materialize(box);
                expect(() => setProp(box, 'orientation', 'sideways')).toThrow('GtkOrientation');
            });
        });

        await gated(diagnostics, 'coercion the review caught', async () => {
            await it('reads the string "false" as FALSE, where JS truthiness says TRUE', async () => {
                // `Boolean('false') === true`. A template or JSX attribute produces
                // exactly this string, so the two exact spellings are honoured …
                const label = createElement('GtkLabel');
                const widget = materialize(label) as unknown as Gtk.Label;
                setProp(label, 'visible', 'false');
                expect(widget.visible).toBe(false);
            });

            await it('refuses any other string for a boolean, by name', async () => {
                // … and everything else is refused rather than guessed at.
                const label = createElement('GtkLabel');
                materialize(label);
                expect(() => setProp(label, 'visible', 'nope')).toThrow('boolean');
            });

            await it('accepts real booleans and the two exact strings', async () => {
                const label = createElement('GtkLabel');
                const widget = materialize(label) as unknown as Gtk.Label;
                setProp(label, 'visible', false);
                expect(widget.visible).toBe(false);
                setProp(label, 'visible', 'true');
                expect(widget.visible).toBe(true);
            });

            await it('resolves a Pango enum nick — GtkLabel is in the shipped table', async () => {
                // `ellipsize` is PangoEllipsizeMode; without Pango in the namespace
                // list a built-in widget had an unsettable property.
                const label = createElement('GtkLabel');
                const widget = materialize(label) as unknown as Gtk.Label;
                setProp(label, 'ellipsize', 'end');
                expect(widget.ellipsize).toBe(3);
            });
        });

        await gated(diagnostics, 'refusals', async () => {
            await it('refuses an unknown property instead of dropping it', async () => {
                const btn = createElement('GtkButton');
                materialize(btn);
                expect(() => setProp(btn, 'labell', 'typo')).toThrow('has no property');
            });

            await it('refuses a read-only property, which GObject would accept silently', async () => {
                const btn = createElement('GtkButton');
                materialize(btn);
                expect(() => setProp(btn, 'scale-factor', 2)).toThrow('read-only');
            });

            await it('refuses a string for a flags property, which GObject also drops', async () => {
                const win = createElement('GtkWindow');
                materialize(win);
                // Gtk.Window has no flags prop to hand; Gtk.Entry's input-hints does.
                const entry = createElement('GtkEntry');
                materialize(entry);
                expect(() => setProp(entry, 'input-hints', 'spellcheck')).toThrow('flags type');
            });

            await it('reports refusals as GtkHostError with a code', async () => {
                const btn = createElement('GtkButton');
                materialize(btn);
                let caught: unknown;
                try {
                    setProp(btn, 'nope', 1);
                } catch (e) {
                    caught = e;
                }
                expect(caught instanceof GtkHostError).toBe(true);
                expect((caught as GtkHostError).code).toBe('unknown-prop');
            });
        });
    });
};
