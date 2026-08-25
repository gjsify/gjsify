// Property coercion — the layer that turns GObject's silent failures into loud ones.

import { expect, it, on } from '@gjsify/unit';

import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
// Type position only — the descriptors pull Adw in for value use themselves.
import type Adw from 'gi://Adw?version=1';

import { installDiagnosticsGate } from './conformance/index.js';
import { GTK_HOSTS, gated } from './testing/gate.mjs';
import { GtkHostError } from './errors.js';
import { createElement, materialize, setProp } from './host.js';
import { constructOnlyNames, paramSpecs, removedValue, toPropertyName } from './props.js';
import { registerBuiltinWidgets } from './descriptors/index.js';
import { hasWidget } from './registry.js';

export default async () => {
    await on(GTK_HOSTS, async () => {
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

            await it('refuses a real installed GType that carries no descriptor', async () => {
                // NOT `AdwClamp` — it is a concrete GtkWidget descendant, so the
                // generated table has carried it since #1281 and pinning it here
                // would assert the opposite of what it says. `GtkAdjustment` is
                // real, installed, and not a widget, which is the durable version
                // of the same claim: being in the typelib is not enough, and the
                // error text no longer offers "use a raw GType tag" as a way out
                // (ADR 0028 — `createElement` looks the GType up exactly).
                expect(hasWidget('AdwClamp')).toBe(true);
                expect(GObject.type_name(Gtk.Adjustment.$gtype)).toBe('GtkAdjustment');
                expect(() => createElement('GtkAdjustment')).toThrow('registerWidget');
                let caught: unknown;
                try {
                    createElement('GtkAdjustment');
                } catch (e) {
                    caught = e;
                }
                expect((caught as GtkHostError).code).toBe('unknown-tag');
                expect((caught as GtkHostError).message.includes('raw GType tag')).toBe(false);
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

        await gated(diagnostics, 'removedValue', async () => {
            // A descriptor is what `removedValue` keys on, so the vectors below go
            // through the registry rather than hand-building one.
            const descriptorFor = (gtype: string) => {
                const el = createElement(gtype);
                materialize(el);
                return el.descriptor;
            };

            await it('answers with the CONSTRUCTED value where the ParamSpec disagrees', async () => {
                // The four behavioural disagreements, named so a future GTK that
                // changes one of them fails by name instead of drifting quietly.
                // Measured on gjs 1.88.1 / GTK 4.22.4 / Adw 1.10.
                const vectors: ReadonlyArray<readonly [string, string, unknown, unknown]> = [
                    // gtype, property, ParamSpec says, construction says
                    ['AdwActionRow', 'activatable', true, false],
                    ['GtkWindow', 'visible', true, false],
                    ['GtkToggleButton', 'receives-default', false, true],
                    ['GtkListBox', 'focusable', false, true],
                ];
                for (const [gtype, prop, fromSpec, fromConstruction] of vectors) {
                    const descriptor = descriptorFor(gtype);
                    const spec = paramSpecs(descriptor.ctor(), descriptor.gtype).get(prop);
                    expect(spec === undefined).toBe(false);
                    // The premise: these two really do disagree on this GTK. Without
                    // it the assertion below is satisfied by either implementation.
                    expect((spec as unknown as { get_default_value(): unknown }).get_default_value()).toBe(fromSpec);
                    expect(removedValue(descriptor, spec as never)).toBe(fromConstruction);
                }
            });

            await it('probes a fatal GType with the id it demands, not bare', async () => {
                // The interaction the probe was one line away from: `AdwLayoutSlot`
                // is legal to AUTHOR (`<adw-layout-slot id="…">`) and fatal to
                // construct bare — `g_error()`, SIGABRT, exit 134, uncatchable, so
                // the `try` around the probe is not a guard for it. Removing ANY
                // prop on a slot the consumer built correctly would have ended the
                // process, and no assertion in this file would have run to say so.
                const el = createElement('AdwLayoutSlot', { id: 'probe', 'css-classes': ['x'] });
                materialize(el);
                const spec = paramSpecs(el.descriptor.ctor(), el.descriptor.gtype).get('css-classes');
                expect(spec === undefined).toBe(false);
                // Reaching this line at all IS the assertion — the probe ran.
                expect(removedValue(el.descriptor, spec as never) !== undefined).toBe(true);
                // And the premise: this GType really does declare a requirement.
                expect(el.descriptor.requiresProps).toStrictEqual(['id']);
            });

            await it('falls back to the ParamSpec for a value construction cannot report', async () => {
                // `child` is object-valued, so no probe reads it and the ParamSpec
                // is the only answer. This is the arm that keeps a removal working
                // rather than throwing when the probe has nothing to say.
                const descriptor = descriptorFor('GtkFrame');
                const spec = paramSpecs(descriptor.ctor(), descriptor.gtype).get('child');
                expect(spec === undefined).toBe(false);
                expect(removedValue(descriptor, spec as never)).toBe(null);
            });

            await it('removing `activatable` leaves the row NOT activatable', async () => {
                // The end-to-end shape of the defect: with the ParamSpec as the
                // source, `activatable={cond}` going undefined turned a row that had
                // never been activatable INTO one, at exit 0.
                const row = createElement('AdwActionRow', { activatable: true });
                const widget = materialize(row) as unknown as Adw.ActionRow;
                expect(widget.activatable).toBe(true);
                setProp(row, 'activatable', undefined);
                expect(widget.activatable).toBe(false);
            });

            await it('removing `receives-default` leaves a toggle button receiving it', async () => {
                // The opposite polarity, so a fix that merely inverted the boolean
                // cannot satisfy both vectors.
                const btn = createElement('GtkToggleButton', { 'receives-default': false });
                const widget = materialize(btn) as unknown as Gtk.ToggleButton;
                expect(widget.receivesDefault).toBe(false);
                setProp(btn, 'receives-default', undefined);
                expect(widget.receivesDefault).toBe(true);
            });
        });
    });
};
