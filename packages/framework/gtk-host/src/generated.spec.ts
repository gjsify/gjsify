// The generated surface, checked against the GTK that is actually installed.
//
// This is the machine-independent half of ADR 0028's bargain: the artefact is
// COMMITTED, so no CI leg re-runs the generator and no byte comparison can fail
// because a second machine ships a different GTK. What travels instead is this
// suite, which asks the installed typelib whether every name the generator wrote
// is real — a property that is writable, a signal that exists, an enum nick the
// host can resolve, a class whose GType is what the table claims.
//
// The data it reads is `generated/surface-data.mts`, a `.mts` file so it is
// outside the library build glob and never ships. Shipping the property lists as
// runtime data would make them a second source for what `paramSpecs()` already
// answers from the class that is installed.

import { expect, it, on } from '@gjsify/unit';

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

import { installDiagnosticsGate } from './conformance/index.js';
import {
    BUILTIN_DESCRIPTORS,
    CURATED_DESCRIPTORS,
    GENERATED_WIDGETS,
    REQUIRED_CONSTRUCT_PROPS,
} from './descriptors/index.js';
import { createElement, materialize } from './host.js';
import { DECLS, ENUM_NICKS, OWN_PROPS, OWN_SIGNALS, SINCE, TAGS } from './generated/surface-data.mjs';
import { camelOf, eventPropOf } from './generator/tsmap.mjs';
import { isWritable, lookupEnumNick, paramSpecs } from './props.js';
import { isEventProp, toSignalName } from './signals.js';
import { hasWidget, lookupWidget } from './registry.js';
import { assertInjective, tagOf } from './tags.js';
import { gated } from './testing/gate.mjs';

/**
 * Every member the surface offers for a widget, and WHERE it was declared.
 *
 * The declaring type is what makes the version rule exact: a member missing from
 * the installed library is only acceptable if the GIR says it arrived in a release
 * newer than the one running, and "which release" is a question about the library
 * that declared it — Gtk's version for a `Gtk*` type, libadwaita's for an `Adw*`.
 */
const surfaceMembers = (gtype: string, own: Readonly<Record<string, readonly string[]>>): Map<string, string> => {
    const out = new Map<string, string>();
    for (const declaration of DECLS[gtype] ?? []) {
        for (const name of own[declaration] ?? []) if (!out.has(name)) out.set(name, declaration);
    }
    return out;
};

/** `'4.24'` against `'4.22.4'` — true. Missing or equal is NOT newer. */
export const newerThan = (since: string | undefined, running: string): boolean => {
    if (!since) return false;
    const a = since.split('.').map((n) => Number.parseInt(n, 10));
    const b = running.split('.').map((n) => Number.parseInt(n, 10));
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const left = a[i] ?? 0;
        const right = b[i] ?? 0;
        if (left !== right) return left > right;
    }
    return false;
};

const writableSpecs = (gtype: string): string[] => {
    const descriptor = lookupWidget(gtype);
    const names: string[] = [];
    for (const [name, spec] of paramSpecs(descriptor.ctor(), gtype)) if (isWritable(spec)) names.push(name);
    return names;
};

export default async () => {
    await on('Gjs', async () => {
        Gtk.init();
        // The table registers itself here rather than in a hook: registration is
        // keyed on the GType name and idempotent, and every case below needs it.
        const { registerBuiltinWidgets } = await import('./descriptors/index.js');
        registerBuiltinWidgets();
        const diagnostics = installDiagnosticsGate();

        // The running version of each library that can declare a widget member.
        // Nothing else needs one: measured, every signal and every writable
        // property of all 164 widgets is declared by a Gtk or an Adw type, or by
        // GObject.Object — which contributes only `notify`, present since 2.0.
        const running: Readonly<Record<string, string>> = {
            Gtk: `${Gtk.get_major_version()}.${Gtk.get_minor_version()}.${Gtk.get_micro_version()}`,
            Adw: `${Adw.get_major_version()}.${Adw.get_minor_version()}.${Adw.get_micro_version()}`,
        };
        const unreleased = (key: string, declaration: string): boolean => {
            const library = declaration.startsWith('Adw') ? 'Adw' : declaration.startsWith('Gtk') ? 'Gtk' : null;
            if (!library) return false;
            return newerThan(SINCE[key], running[library] as string);
        };

        await gated(diagnostics, 'generated table', async () => {
            await it('adds tags without touching a curated rule', async () => {
                const curated = new Map(CURATED_DESCRIPTORS.map((d) => [d.gtype, d]));
                for (const generated of GENERATED_WIDGETS) {
                    const existing = curated.get(generated.gtype);
                    if (!existing) continue;
                    // The merged table must hand back the CURATED object itself for
                    // every widget that has one. Comparing the policy would pass if
                    // the merge replaced a descriptor with an equal-looking copy and
                    // silently dropped its `textSink`.
                    expect(lookupWidget(generated.gtype) === existing).toBe(true);
                }
                expect(BUILTIN_DESCRIPTORS.length).toBe(GENERATED_WIDGETS.length);
            });

            await it('every curated widget is one the generator also found', async () => {
                // A curated gtype absent from the GIR-derived set means the two
                // halves disagree about what exists — a rename, or a descriptor for
                // an abstract class that can never be instantiated.
                const generated = new Set(GENERATED_WIDGETS.map((w) => w.gtype));
                const orphans = CURATED_DESCRIPTORS.map((d) => d.gtype).filter((g) => !generated.has(g));
                expect(orphans).toStrictEqual([]);
            });

            await it('is reachable by both spellings, and the kebab map is injective', async () => {
                assertInjective(GENERATED_WIDGETS.map((w) => w.gtype));
                for (const w of GENERATED_WIDGETS) {
                    expect(TAGS[w.gtype]).toBe(w.tag);
                    expect(tagOf(w.gtype)).toBe(w.tag);
                    expect(hasWidget(w.tag)).toBe(true);
                    expect(lookupWidget(w.tag) === lookupWidget(w.gtype)).toBe(true);
                }
            });

            await it('constructs every row it offers', async () => {
                // The check the table did not have, and the reason it shipped a row
                // that KILLS THE PROCESS. `descriptorProblems()` reads policy and
                // never instantiates, so `AdwLayoutSlot` — whose `constructed` calls
                // `g_error("AdwLayoutSlot %p created without an ID")`, fatal by
                // contract, SIGABRT and a core dump — was green in a 1746-test suite.
                //
                // Measured bare over all 164 rows on gjs 1.88.1 / GTK 4.22.4 / Adw
                // 1.10: 163 construct and not one throws. So a REGRESSION here is a
                // new abort, and this test is what turns it into a failure whose last
                // line names the tag instead of a core dump nobody attributes.
                const required = new Map(Object.entries(REQUIRED_CONSTRUCT_PROPS));
                const failed: string[] = [];
                // Diagnostics are drained PER ROW, not left to the gate at the end
                // of the test. Same assertion, with the one thing the gate cannot
                // give: a name. Measured — a first CI run failed here with
                // "GTK reported 1 diagnostic(s)" over 164 constructions and no way
                // to tell which, while the same sweep is silent on a workstation
                // both with and without a session bus.
                const noisy: string[] = [];
                // The ONE exemption, and it is about the machine rather than the
                // widget. `GtkColorChooserDialog`'s eyedropper asks the Screenshot
                // portal for its version; a CI container has a D-Bus session and no
                // `xdg-desktop-portal` behind it, so GTK warns:
                //
                //   Cannot get portal org.freedesktop.portal.Screenshot version:
                //   GDBus.Error:org.freedesktop.DBus.Error.InvalidArgs: No such
                //   interface “org.freedesktop.portal.Screenshot”
                //
                // Measured, and the third state is why it took a CI run to see: with
                // a portal it is silent, with NO session bus at all it is silent
                // (GTK never asks), and only with a bus that answers without the
                // interface does it warn. Stripping DBUS_SESSION_BUS_ADDRESS on a
                // workstation reproduces the second state, not the container's.
                //
                // Scoped to the MESSAGE, not to the widget: any widget reaching a
                // portal produces this, and `GtkColorChooserDialog` stays under test
                // for everything else it might say.
                const missingPortal = /^Cannot get portal org\.freedesktop\.portal\./;
                for (const w of GENERATED_WIDGETS) {
                    // Through the HOST, not through `new w.ctor()`: `materialize` is
                    // where the refusal lives, so constructing around it would leave
                    // the guard itself unchecked.
                    const props: Record<string, unknown> = {};
                    for (const name of required.get(w.gtype) ?? []) props[name] = 'probe';
                    diagnostics.reset();
                    try {
                        // Left alive on purpose — NOT destroyed, NOT `run_dispose()`d.
                        //
                        // `installDiagnosticsGate` sets a process-global JS log writer
                        // and never takes it back, so any widget GJS finalises during
                        // SHUTDOWN prints `Gjs-CRITICAL: Attempting to run a JS callback
                        // during shutdown` on stderr, after the summary. Severing a
                        // widget's internals is what schedules that: measured one row
                        // per process over all 164, disposing makes EIGHT of them do it
                        // (AdwComboRow, GtkColumnView, GtkEditableLabel, GtkEmojiChooser,
                        // GtkScrollbar, GtkColorChooserDialog, GtkColorChooserWidget,
                        // GtkFileChooserWidget) and leaving them alone makes TWO
                        // (GtkColorChooserWidget, GtkEmojiChooser).
                        //
                        // Two leaked-by-design lines beat eight, in a process that exits
                        // seconds later; neither is the host's doing, and skipping the
                        // two rows would trade the noise for the blindness this test
                        // exists to remove.
                        materialize(createElement(w.tag, props));
                    } catch (error) {
                        failed.push(`${w.gtype}: ${(error as Error).message}`);
                    }
                    const said = diagnostics.seen.filter((message) => !missingPortal.test(message));
                    if (said.length > 0) noisy.push(`${w.gtype}: ${said.join(' | ')}`);
                    diagnostics.reset();
                }
                expect(failed).toStrictEqual([]);
                expect(noisy).toStrictEqual([]);
                expect(required.size).toBe(1);
                // The exemption is NARROW — it must not swallow an ordinary GTK
                // warning, which is the whole reason the sweep exists.
                expect(missingPortal.test('Cannot get portal org.freedesktop.portal.Screenshot version: x')).toBe(true);
                expect(missingPortal.test('Trying to snapshot GtkButton without a current allocation')).toBe(false);
                expect(missingPortal.test('gtk_box_append: assertion failed')).toBe(false);
            });

            await it('refuses a fatal construction by name instead of aborting', async () => {
                // A/B for the guard above: without `requiresProps` this call does not
                // throw — it ends the process. The assertion is that it is an ERROR.
                expect(() => materialize(createElement('adw-layout-slot'))).toThrow(/cannot be constructed without id/);
                // And the requirement is a REQUIREMENT, not a ban: with the id, it builds.
                const slot = materialize(createElement('adw-layout-slot', { id: 'probe' }));
                expect(slot instanceof Adw.LayoutSlot).toBe(true);
            });

            await it('names a real class for every tag', async () => {
                const wrong: string[] = [];
                for (const w of GENERATED_WIDGETS) {
                    const name = GObject.type_name(w.ctor().$gtype);
                    if (name !== w.gtype) wrong.push(`${w.gtype} -> ${name}`);
                }
                expect(wrong).toStrictEqual([]);
            });
        });

        await gated(diagnostics, 'generated surface vs installed typelib', async () => {
            await it('offers no property the installed GTK does not have as writable', async () => {
                const problems: string[] = [];
                for (const w of GENERATED_WIDGETS) {
                    const real = new Set(writableSpecs(w.gtype));
                    for (const [name, declaration] of surfaceMembers(w.gtype, OWN_PROPS)) {
                        if (real.has(name)) continue;
                        if (unreleased(`${declaration}.${name}`, declaration)) continue;
                        problems.push(`${w.gtype}.${name} (declared on ${declaration})`);
                    }
                }
                expect(problems).toStrictEqual([]);
            });

            await it('leaves no writable property of the installed GTK out of the surface', async () => {
                const problems: string[] = [];
                for (const w of GENERATED_WIDGETS) {
                    const offered = surfaceMembers(w.gtype, OWN_PROPS);
                    for (const name of writableSpecs(w.gtype))
                        if (!offered.has(name)) problems.push(`${w.gtype}.${name}`);
                }
                // A failure here is the OPPOSITE skew and cannot be explained by a
                // version: the installed GTK is NEWER than the GIR the committed
                // surface came from, so the surface is incomplete rather than
                // untrue. The fix is `npm run generate` against that GTK's GIR,
                // which is why the message names every property.
                expect(problems).toStrictEqual([]);
            });

            await it('offers no signal the installed GTK does not emit', async () => {
                const problems: string[] = [];
                for (const w of GENERATED_WIDGETS) {
                    const gtype = w.ctor().$gtype;
                    for (const [signal, declaration] of surfaceMembers(w.gtype, OWN_SIGNALS)) {
                        if (GObject.signal_lookup(signal, gtype) !== 0) continue;
                        if (unreleased(`${declaration}::${signal}`, declaration)) continue;
                        problems.push(`${w.gtype}::${signal} (declared on ${declaration})`);
                    }
                }
                expect(problems).toStrictEqual([]);
            });

            await it('compares versions the way the two rules above rely on', async () => {
                // The version rule is the reason those two checks can be exact
                // rather than carry an allowlist, and on a machine whose GTK
                // matches the GIR it is never exercised — so it is checked
                // directly. `4.24` against the 4.22.4 that first produced the
                // skew, and the two boundaries either side of it.
                expect(newerThan('4.24', '4.22.4')).toBe(true);
                expect(newerThan('4.22', '4.22.4')).toBe(false);
                expect(newerThan('4.22.5', '4.22.4')).toBe(true);
                expect(newerThan('5.0', '4.99.99')).toBe(true);
                expect(newerThan(undefined, '4.22.4')).toBe(false);
            });

            await it('offers only enum nicks this host can resolve', async () => {
                // The generator turns a GIR member name into a nick with one
                // substitution (`baseline_fill` -> `baseline-fill`). That is the
                // whole claim, and it is checked here through the SAME lookup
                // `coerce()` uses, so a nick the surface offers can never be one the
                // host would refuse.
                const problems: string[] = [];
                for (const [gtype, nicks] of Object.entries(ENUM_NICKS)) {
                    for (const nick of nicks) {
                        if (lookupEnumNick(gtype, nick) === undefined) problems.push(`${gtype}.${nick}`);
                    }
                }
                expect(problems).toStrictEqual([]);
            });

            await it('names every event prop so the host resolves it back to the same signal', async () => {
                // TWO INDEPENDENT IMPLEMENTATIONS, checked against each other: the
                // generator derives `onRowActivated` from `row-activated`, and the
                // host's `parseEventProp` derives a signal name back from the prop.
                // Nothing made them agree, and the first run of this check found
                // that they did not — GObject.Object's `notify` signal became
                // `onNotify`, which the host read as `notify::` with an empty
                // property name.
                const problems: string[] = [];
                for (const [declaration, signals] of Object.entries(OWN_SIGNALS)) {
                    for (const signal of signals) {
                        const prop = eventPropOf(signal);
                        const back = toSignalName(prop);
                        if (back !== signal) problems.push(`${declaration}::${signal} -> ${prop} -> ${back}`);
                    }
                }
                for (const [declaration, names] of Object.entries(OWN_PROPS)) {
                    for (const name of names) {
                        const camel = camelOf(name);
                        const prop = `onNotify${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
                        const back = toSignalName(prop);
                        if (back !== `notify::${name}`) problems.push(`${declaration}.${name} -> ${prop} -> ${back}`);
                    }
                }
                expect(problems).toStrictEqual([]);
            });

            await it('offers no property a framework would swallow or mistake for a signal', async () => {
                // Two whole classes of silent failure, both a GTK release away:
                //
                //  - a property named `on-something` generates `onSomething`, which
                //    `isEventProp` reads as an event binding — the property would
                //    never be written and no diagnostic would say so.
                //  - a property named `key` or `ref` is in Vue's `isReservedProp`
                //    set, which the Vue adapter strips before the props reach the
                //    host, so it would silently never be applied.
                //
                // Measured clean today over all 561 distinct names, and that is
                // exactly why it is asserted rather than noted.
                const reserved = new Set(['key', 'ref', 'ref_for', 'ref_key', 'is', 'class', 'style']);
                const problems: string[] = [];
                for (const [declaration, names] of Object.entries(OWN_PROPS)) {
                    for (const name of names) {
                        const camel = camelOf(name);
                        if (isEventProp(camel)) problems.push(`${declaration}.${name} reads as an event prop`);
                        if (reserved.has(name)) problems.push(`${declaration}.${name} is a framework-reserved name`);
                    }
                }
                expect(problems).toStrictEqual([]);
                // Not vacuous: the two shapes it looks for.
                expect(isEventProp(camelOf('on-something'))).toBe(true);
                expect(isEventProp(camelOf('orientation'))).toBe(false);
            });

            await it('reports a fabricated name — none of the above is vacuous', async () => {
                // Each check above walks real data and would report `[]` just as
                // happily over an empty table. These run the same lookups against
                // names that cannot exist.
                const specs = paramSpecs(lookupWidget('GtkBox').ctor(), 'GtkBox');
                expect(specs.has('spacing')).toBe(true);
                expect(specs.has('no-such-property')).toBe(false);
                expect(GObject.signal_lookup('no-such-signal', Gtk.Box.$gtype)).toBe(0);
                expect(lookupEnumNick('GtkOrientation', 'vertical')).toBe(Gtk.Orientation.VERTICAL);
                expect(lookupEnumNick('GtkOrientation', 'sideways')).toBe(undefined);
                expect(toSignalName(eventPropOf('row-activated'))).toBe('row-activated');
                expect(toSignalName('onNotifyNoSuchThing')).toBe('notify::no-such-thing');
            });
        });
    });
};
