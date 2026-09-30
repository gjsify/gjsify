// Property coercion — the layer that turns GObject's silent failures into loud ones.

import { expect, it, on } from '@gjsify/unit';

import Gio from 'gi://Gio?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
// Type position only — the descriptors pull Adw in for value use themselves.
import type Adw from 'gi://Adw?version=1';

import { installDiagnosticsGate } from './conformance/index.js';
import { NICK_VECTORS } from './conformance/nick-vectors.mjs';
import { camelOf } from './generator/names.mjs';
import { GTK_HOSTS, gated } from './testing/gate.mjs';
import { GtkHostError } from './errors.js';
import { createElement, materialize, setProp } from './host.js';
import {
    constructOnlyNames,
    enumMembers,
    gtypeOfName,
    lookupEnumNick,
    paramSpecs,
    removedValue,
    toPropertyName,
} from './props.js';
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

        await gated(diagnostics, 'a GType NAME to its installed type', async () => {
            await it('reads the GType of a CLASS, which GJS makes a constructor', async () => {
                // THE DEFECT, AND IT IS THE WHOLE REASON THIS LOOKUP IS NOT A `typeof`.
                // A GObject class is the CONSTRUCTOR function in GJS, so the namespace
                // read had to survive a `'function'`, and the `typeof candidate !==
                // 'object'` filter in front of it refused every class and admitted only
                // the enums — which is why this read looked healthy while answering
                // `undefined` for a class that is present and constructible.
                //
                // `GtkSnapshot` on purpose: no table row carries it and no suite reads
                // it, so `type_from_name` cannot have registered it and the assertion
                // measures the TABLE branch rather than the cache in front of it. The
                // premise is asserted FIRST, because reading the member is itself what
                // registers it — check it after and the check is vacuous.
                // Measured on gjs 1.88.1 / GTK 4.24.0, before the fix:
                // `gtypeOfName('GtkSnapshot')` answered `undefined`.
                expect(GObject.type_from_name('GtkSnapshot')).toBe(null);
                expect(typeof Gtk.Snapshot).toBe('function');
                const gtype = gtypeOfName('GtkSnapshot');
                expect(gtype === undefined).toBe(false);
                // NON-ZERO, which is the claim a consumer gating on a GTK version
                // branches on. `type_name` of `G_TYPE_INVALID` is null, so this is the
                // assertion that would catch a zero answering as a hit.
                expect(gtype !== undefined && GObject.type_name(gtype) === 'GtkSnapshot').toBe(true);
                // And it is the SAME GType the class itself carries, so the lookup
                // confirmed the candidate rather than taking the name on trust.
                //
                // BY NAME, NOT BY IDENTITY: the two runtimes box a GType differently —
                // GJS gives a NUMBER, so `toBe` compares by value, while node-gi
                // marshals a FRESH `Napi::External` per call (`MakeGTypeHandle`,
                // node-gi/src/marshal.cc:353 — its own test asserts `typeof back ===
                // 'object'`, gtype.test.mjs:72). Two reads of one type are then two
                // objects, so identity is no claim either runtime agrees on; this
                // case passes it on node-gi only by accident, `type_from_name` having
                // missed so both sides read the handle cached on the class. The
                // NON-ZERO claim above is unaffected: `type_name` of `G_TYPE_INVALID`
                // is null, never a name, so a zero still fails it.
                expect(gtype !== undefined && GObject.type_name(gtype) === GObject.type_name(Gtk.Snapshot.$gtype)).toBe(
                    true,
                );
            });

            await it('answers for an enum and for one of its members, through the same path', async () => {
                // The other half, so the fix cannot be a class-only special case: the
                // path already served enums and must still. `GtkOrientation` is both an
                // enum and the `value_type` of a property every shipped widget carries.
                const gtype = gtypeOfName('GtkOrientation');
                expect(gtype === undefined).toBe(false);
                // BY NAME, for the marshalling reason the class case above sets out:
                // `GtkOrientation` IS in `type_from_name`, so the left side is a
                // freshly marshalled External while `Gtk.Orientation.$gtype` is the
                // one handle cached on the class — two objects, and `toBe` fails.
                // The name is what both runtimes agree on, and a zero cannot pass it.
                expect(
                    gtype !== undefined && GObject.type_name(gtype) === GObject.type_name(Gtk.Orientation.$gtype),
                ).toBe(true);
                expect(enumMembers('GtkOrientation')).toContain('VERTICAL');
                expect(lookupEnumNick('GtkOrientation', 'vertical')).toBe(Gtk.Orientation.VERTICAL);
                // The member the parser itself cannot answer, so the SECOND resolution
                // route — the one that reads members off the namespace object rather
                // than asking the parser — is on the table too. `0bsd` parses to 0 in
                // `GtkLicense` (measured, GTK 4.22.5) while the member is 18.
                expect(lookupEnumNick('GtkLicense', '0bsd')).toBe(Gtk.License['0BSD']);
            });

            await it('refuses a name no namespace member carries', async () => {
                // The guard the `typeof` was reaching for, stated as its own case: a
                // NON-GI member of the same namespace (`Gtk.init` is a plain function,
                // `Gtk.MAJOR_VERSION` a number) carries no `$gtype` and a name nothing
                // defines has no member at all. Neither may answer as a type.
                expect(gtypeOfName('GtkThisClassDoesNotExist')).toBe(undefined);
                expect(gtypeOfName('GtkInit')).toBe(undefined);
                expect(gtypeOfName('GtkMajorVersion')).toBe(undefined);
            });

            await it('reports members for an enum and nothing for a class', async () => {
                // WHY `enumMembers` RE-CHECKS the kind rather than trusting the widened
                // lookup: it now finds a CLASS as readily as an enum, and a class carries
                // no numeric members. `undefined` (no such enum here) is the honest
                // answer; `[]` would read as "an enum that registers nothing", which is
                // the claim every caller of this function is entitled to trust.
                expect(enumMembers('GtkSnapshot')).toBe(undefined);
                expect(enumMembers('GtkOrientation')).toContain('HORIZONTAL');
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

        await gated(diagnostics, 'portable values at the ParamSpec seam (ADR 0042, 0046, 0047)', async () => {
            // The ParamSpec TYPE decides, never the property's NAME — the same keying as
            // the enum branch above. What is pinned here is the premise each branch rests
            // on and one read-back per value; the vectors that drive them row by row live
            // in `list-model.spec.ts` and `adjustment.spec.ts`, beside `menu.spec.ts`.
            await it('reads a Gio.ListModel property off the installed GTK, and what can hold it', async () => {
                const el = createElement('adw-combo-row');
                const spec = paramSpecs(el.descriptor.ctor(), el.descriptor.gtype).get('model');
                expect(spec === undefined).toBe(false);
                const valueType = (spec as GObject.ParamSpec).value_type;
                expect(GObject.type_is_a(valueType, Gio.ListModel.$gtype)).toBe(true);
                expect(GObject.type_is_a(Gtk.StringList.$gtype, valueType)).toBe(true);
            });

            await it('reads a Gtk.Adjustment property off the installed GTK', async () => {
                const el = createElement('adw-spin-row');
                const spec = paramSpecs(el.descriptor.ctor(), el.descriptor.gtype).get('adjustment');
                expect(spec === undefined).toBe(false);
                expect(GObject.type_name((spec as GObject.ParamSpec).value_type)).toBe('GtkAdjustment');
            });

            await it('turns an ARRAY into the model GTK stores, where the name alone would have mis-keyed', async () => {
                const combo = createElement('adw-combo-row', { model: ['a', 'b'] });
                const model = (materialize(combo) as unknown as Adw.ComboRow).model as Gtk.StringList;
                expect(model instanceof Gtk.StringList).toBe(true);
                expect(model.get_n_items()).toBe(2);
                // The SAME name on a widget whose ParamSpec is a GtkSelectionModel: refused
                // by name, naming what GTK wants, before anything is recorded.
                const view = createElement('gtk-list-view');
                expect(() => setProp(view, 'model', ['a', 'b'])).toThrow('GtkSelectionModel');
            });

            await it('turns an OBJECT into the adjustment GTK stores, and refuses a bare number', async () => {
                const row = createElement('adw-spin-row', { adjustment: { lower: 0, upper: 10, value: 7 } });
                const widget = materialize(row) as unknown as Adw.SpinRow;
                expect(widget.adjustment instanceof Gtk.Adjustment).toBe(true);
                expect(widget.adjustment.upper).toBe(10);
                expect(widget.value).toBe(7);
                expect(() => setProp(row, 'adjustment', 3)).toThrow('got a number');
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

        // THE NICK VECTORS, each driven against a real widget of the installed GTK.
        // The outcome is read back off the WIDGET, never off the shadow tree: a host
        // that recorded the prop and wrote nothing would agree with itself.
        await gated(diagnostics, 'nick vectors (enums and bitfields, one resolver)', async () => {
            for (const vector of NICK_VECTORS) {
                const authored = JSON.stringify(vector.authored);
                await it(`<${vector.tag}>.${vector.prop} = ${authored} — ${vector.what}`, async () => {
                    const el = createElement(vector.tag);
                    const widget = materialize(el) as unknown as Record<string, unknown>;
                    if ('refuses' in vector.outcome) {
                        let caught: unknown;
                        try {
                            setProp(el, vector.prop, vector.authored);
                        } catch (error) {
                            caught = error;
                        }
                        expect(caught instanceof GtkHostError).toBe(true);
                        // The CODE, not the message: a message is prose and gets
                        // reworded, a code is what a renderer branches on.
                        expect((caught as GtkHostError).code).toBe(vector.outcome.refuses);
                        return;
                    }
                    setProp(el, vector.prop, vector.authored);
                    expect(widget[camelOf(vector.prop)]).toBe(vector.outcome.holds);
                });
            }

            await it('drives every edge the table claims', async () => {
                // Not vacuous, and it is the loop above that needs saying so: a table
                // that lost its refusal rows would leave 20-odd green assertions and
                // nothing checking that a bad nick still fails.
                const refusals = new Set(
                    NICK_VECTORS.flatMap((v) => ('refuses' in v.outcome ? [v.outcome.refuses] : [])),
                );
                expect([...refusals].sort()).toStrictEqual(['bad-enum', 'bad-flags', 'blank-flags']);
                // Every bitfield row names a property of a DIFFERENT type than the
                // last, or the table proves one parser call over and over.
                const flagProps = new Set(NICK_VECTORS.map((v) => `${v.tag}.${v.prop}`));
                expect(flagProps.size >= 6).toBe(true);
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
                // Measured on gjs 1.88.1 / GTK 4.22.4 / libadwaita 1.9.3.
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
