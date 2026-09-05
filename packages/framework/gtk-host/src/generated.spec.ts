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
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { installDiagnosticsGate } from './conformance/index.js';
import {
    BUILTIN_DESCRIPTORS,
    CURATED_DESCRIPTORS,
    GENERATED_PROVENANCE,
    GENERATED_WIDGETS,
    REQUIRED_CONSTRUCT_PROPS,
} from './descriptors/index.js';
import { createElement, insert, materialize, setEventHandler, setProp } from './host.js';
import { ENUM_VALUES, ENUM_VALUES_UNAVAILABLE, VALUES_PROVENANCE } from './generated/enum-values.mjs';
import { DECLS, ENUM_NICKS, OWN_PROPS, OWN_SIGNALS, SINCE, TAGS } from './generated/surface-data.mjs';
import { camelOf, eventPropOf } from './generator/names.mjs';
import { enumMembers, isWritable, lookupEnumNick, paramSpecs } from './props.js';
import { isEventProp, toSignalName } from './signals.js';
import { hasWidget, lookupWidget } from './registry.js';
import { assertInjective, tagOf } from './tags.js';
import { GTK_HOSTS, gated } from './testing/gate.mjs';

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

/**
 * The constructor a descriptor names, or `null` when the installed library has no
 * such class.
 *
 * `ctor`'s declared type promises a constructor unconditionally. At runtime it
 * answers `undefined` for a class the installed library predates — the vocabulary is
 * generated against one GTK release and checked against whatever is on this machine,
 * and GtkSvgWidget is newer than the GTK here. Six checks below used to dereference
 * that and die as `can't access property "$gtype", ctor() is undefined`, naming
 * nothing: the missing class had to be found by hand. The gap is now a fact one test
 * reports and the others skip.
 */
const installedCtor = (descriptor: {
    readonly ctor: () => unknown;
}): (GObject.ObjectClass & (new (props?: Record<string, unknown>) => GObject.Object)) | null =>
    (descriptor.ctor() as
        | (GObject.ObjectClass & (new (props?: Record<string, unknown>) => GObject.Object))
        | undefined) ?? null;

/**
 * The GType object for any DECLARATION the surface names, widget or interface.
 *
 * `lookupWidget` only knows the rows of the table; a chain link like `GtkEditable` is
 * an interface with no row and no `ctor`, and it is precisely where the check below
 * found something. Two namespaces are enough by construction — the vocabulary drops
 * every base outside Gtk and Adw, which is why `GObject`'s `notify` and
 * `Gio.ActionGroup`'s four signals cannot appear as omissions here.
 */
const declarationGType = (gtype: string): GObject.GType | null => {
    const adw = gtype.startsWith('Adw');
    if (!adw && !gtype.startsWith('Gtk')) return null;
    const ns = (adw ? Adw : Gtk) as unknown as Record<string, unknown>;
    const klass = ns[gtype.slice(3)] as { $gtype?: GObject.GType } | undefined;
    return klass?.$gtype ?? null;
};

const writableSpecs = (gtype: string): string[] | null => {
    const ctor = installedCtor(lookupWidget(gtype));
    if (!ctor) return null;
    const names: string[] = [];
    for (const [name, spec] of paramSpecs(ctor, gtype)) if (isWritable(spec)) names.push(name);
    return names;
};

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        // The table registers itself here rather than in a hook: registration is
        // keyed on the GType name and idempotent, and every case below needs it.
        const { registerBuiltinWidgets } = await import('./descriptors/index.js');
        registerBuiltinWidgets();
        const diagnostics = installDiagnosticsGate();

        // The running version of each library that can declare a widget member.
        // Nothing else needs one: measured, every signal and every writable
        // property of every table row is declared by a Gtk or an Adw type, or by
        // GObject.Object — which contributes only `notify`, present since 2.0.
        const running: Readonly<Record<string, string>> = {
            Gtk: `${Gtk.get_major_version()}.${Gtk.get_minor_version()}.${Gtk.get_micro_version()}`,
            Adw: `${Adw.get_major_version()}.${Adw.get_minor_version()}.${Adw.get_micro_version()}`,
        };
        // The provenance line states the library version each vocabulary was generated
        // from — `Gtk-4.0/4.23.3`. Read back here, it turns "this class is missing"
        // from a crash into a question with an answer.
        const generatedAgainst: Readonly<Record<string, string>> = Object.fromEntries(
            GENERATED_PROVENANCE.split(' ')
                .map((part) => /^(\w+)-[\d.]+\/([\d.]+)$/.exec(part))
                .filter((m): m is RegExpExecArray => m !== null)
                .map((m) => [m[1] as string, m[2] as string]),
        );
        const libraryOf = (gtype: string): 'Adw' | 'Gtk' => (gtype.startsWith('Adw') ? 'Adw' : 'Gtk');
        /**
         * WHICH rule excuses a type the installed library does not have, not merely
         * whether one does.
         *
         * `stated` is exact: the vocabulary says the type arrived in a release newer
         * than the one running. `blanket` is not — it only says the vocabulary as a
         * whole is newer, which excuses EVERY absence at once for as long as that is
         * true. Both were one boolean, so a run could not report how much it had
         * stopped checking; measured here, 40 of 169 widgets carry a stated version
         * and NONE of the 129 enum types do, so on the enum side the blanket is the
         * only route there is.
         */
        const excuseFor = (gtype: string): 'stated' | 'blanket' | null => {
            const library = libraryOf(gtype);
            const declared = SINCE[gtype];
            if (declared !== undefined) return newerThan(declared, running[library] as string) ? 'stated' : null;
            const against = generatedAgainst[library];
            return against !== undefined && newerThan(against, running[library] as string) ? 'blanket' : null;
        };
        const predatesHost = (gtype: string): boolean => excuseFor(gtype) !== null;
        /**
         * Whether the two checks that lean on `excuseFor` are sharp AT ALL on this host.
         *
         * They are not, wherever the vocabulary is ahead — and that is the normal state,
         * CI included: the container is the same Fedora release as the maintainer
         * workstation, which carries GTK 4.22.4 and libadwaita 1.9.3 against a
         * vocabulary generated from 4.23.3 and 1.10.0. An earlier revision of this file
         * claimed the opposite in a comment ("SHARP … in CI"), which is the shape of
         * claim that survives precisely because nothing prints it. So it is printed.
         */
        const blunted = (['Gtk', 'Adw'] as const).filter(
            (library) =>
                generatedAgainst[library] !== undefined &&
                newerThan(generatedAgainst[library] as string, running[library] as string),
        );

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
                // Measured bare over every row on gjs 1.88.1 / GTK 4.22.4 / Adw
                // 1.10: all but one construct and not one throws. So a REGRESSION here is a
                // new abort, and this test is what turns it into a failure whose last
                // line names the tag instead of a core dump nobody attributes.
                const required = new Map(Object.entries(REQUIRED_CONSTRUCT_PROPS));
                const failed: string[] = [];
                // Diagnostics are drained PER ROW, not left to the gate at the end
                // of the test. Same assertion, with the one thing the gate cannot
                // give: a name. Measured — a first CI run failed here with
                // "GTK reported 1 diagnostic(s)" over the whole table and no way
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
                    // A class the installed library does not have cannot be built. The
                    // absence is weighed above, once; here it is simply not a row.
                    if (!installedCtor(w)) continue;
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
                        // per process over the whole table, disposing makes EIGHT of them do it
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

            await it('has a FLOOR — a deleted row cannot pass unnoticed', async () => {
                // Every other check in this file iterates the committed table and
                // therefore agrees with whatever the table happens to say; the one
                // length assertion it had (`BUILTIN_DESCRIPTORS.length` ===
                // `GENERATED_WIDGETS.length`) compares the merge against its own
                // input. So deleting a row from `generated/widgets.ts` was invisible:
                // the tag stops existing, nothing iterates it, exit 0.
                //
                // `TAGS` is the floor because it is a SECOND artifact — the generator
                // writes `generated/widgets.ts` (shipped) and `generated/surface-data.mts`
                // (test-only) in the same run, from the same GIR, and nothing in the
                // package reads one from the other. Agreement between them is the only
                // claim here that a hand edit to either file can break, and it is
                // exact in BOTH directions rather than a hard-coded count, which would
                // itself be a number that drifts unseen.
                const shipped = new Set(GENERATED_WIDGETS.map((w) => w.gtype));
                const surfaced = Object.keys(TAGS);
                expect(GENERATED_WIDGETS.length).toBe(surfaced.length);
                expect(surfaced.filter((gtype) => !shipped.has(gtype))).toStrictEqual([]);
                // And a floor under the floor: an empty table would satisfy both
                // lines above, so the two halves must be non-trivially large and the
                // curated rules must all still be reachable through them.
                expect(surfaced.length > CURATED_DESCRIPTORS.length).toBe(true);
                expect(CURATED_DESCRIPTORS.filter((d) => !shipped.has(d.gtype))).toStrictEqual([]);
            });

            await it('refuses to guess a placement for an uncurated row', async () => {
                // A/B in the shape of `REQUIRED_CONSTRUCT_PROPS`' one above, for the
                // other curated-vs-generated fact — and the only safety property the
                // UNCURATED majority of the table has. It had ZERO tests: `grep
                // uncurated-placement` found two throw sites and this error's
                // constructor. (The count that used to stand here was 138 of 164,
                // which encoded a curated figure that had itself drifted to 26 in the
                // generated header; `tableProvenance()` is the live answer.)
                //
                // `GtkExpander` really does hold one child, so this is what a user
                // hits first; `add`, `append` and `set_child` all exist somewhere in
                // GTK and calling the wrong one is a warning at exit 0.
                const expander = createElement('gtk-expander');
                materialize(expander);
                expect(lookupWidget('GtkExpander').children.kind).toBe('uncurated');
                expect(() => insert(createElement('gtk-label'), expander)).toThrow(/GENERATED table/);
                // And it is a REFUSAL, not a ban: the row is creatable, settable and
                // handler-bearing — which is the whole content of "uncurated".
                setProp(expander, 'label', 'Details');
                setEventHandler(expander, 'onActivate', () => {});
                expect((materialize(expander) as unknown as Gtk.Expander).label).toBe('Details');
                // The curated twin of the same one-child shape takes the child.
                const frame = createElement('gtk-frame');
                materialize(frame);
                insert(createElement('gtk-label', { label: 'x' }), frame);
                expect((materialize(frame) as unknown as Gtk.Frame).get_child() instanceof Gtk.Label).toBe(true);
            });

            await it('refuses a fatal construction by name instead of aborting', async () => {
                // A/B for the guard above: without `requiresProps` this call does not
                // throw — it ends the process. The assertion is that it is an ERROR.
                expect(() => materialize(createElement('adw-layout-slot'))).toThrow(/cannot be constructed without id/);
                // And the requirement is a REQUIREMENT, not a ban: with the id, it builds.
                const slot = materialize(createElement('adw-layout-slot', { id: 'probe' }));
                expect(slot instanceof Adw.LayoutSlot).toBe(true);
            });

            await it('explains every class the installed library does not have', async () => {
                // A class the host lacks is fine when the vocabulary was generated
                // against a newer release — that is the normal state of this repo, and
                // the provenance line says so. A class missing WITHOUT that gap means
                // the surface names something that never existed, which is the failure
                // this whole suite is for. Reported here so the other cases can skip
                // silently instead of each rediscovering the same absence.
                const unexplained: string[] = [];
                // Excused by the blanket alone. Not a failure — but a number that must
                // be READABLE, because it is the part of this check that did not run.
                const blanket: string[] = [];
                for (const w of GENERATED_WIDGETS) {
                    if (installedCtor(w)) continue;
                    const excuse = excuseFor(w.gtype);
                    if (excuse === 'blanket') blanket.push(w.gtype);
                    if (excuse !== null) continue;
                    const library = libraryOf(w.gtype);
                    unexplained.push(
                        `${w.gtype} (generated against ${library} ${generatedAgainst[library] ?? '?'}, running ${running[library]})`,
                    );
                }
                if (blanket.length > 0) {
                    console.error(
                        `  (${blanket.length} absent class(es) excused by the vocabulary-wide version alone, ` +
                            `no stated one: ${blanket.join(', ')})`,
                    );
                }
                expect(unexplained).toStrictEqual([]);
            });

            await it('names a real class for every tag', async () => {
                const wrong: string[] = [];
                for (const w of GENERATED_WIDGETS) {
                    const ctor = installedCtor(w);
                    if (!ctor) continue;
                    const name = GObject.type_name(ctor.$gtype);
                    if (name !== w.gtype) wrong.push(`${w.gtype} -> ${name}`);
                }
                expect(wrong).toStrictEqual([]);
            });
        });

        await gated(diagnostics, 'generated surface vs installed typelib', async () => {
            await it('offers no property the installed GTK does not have as writable', async () => {
                const problems: string[] = [];
                for (const w of GENERATED_WIDGETS) {
                    const writable = writableSpecs(w.gtype);
                    if (!writable) continue;
                    const real = new Set(writable);
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
                    for (const name of writableSpecs(w.gtype) ?? [])
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
                    const ctor = installedCtor(w);
                    if (!ctor) continue;
                    const gtype = ctor.$gtype;
                    for (const [signal, declaration] of surfaceMembers(w.gtype, OWN_SIGNALS)) {
                        if (GObject.signal_lookup(signal, gtype) !== 0) continue;
                        if (unreleased(`${declaration}::${signal}`, declaration)) continue;
                        problems.push(`${w.gtype}::${signal} (declared on ${declaration})`);
                    }
                }
                expect(problems).toStrictEqual([]);
            });

            await it('leaves no signal of the installed GTK out of the surface', async () => {
                // THE REVERSE of the check above, and the asymmetry it closes was
                // paid for: properties have had both directions for as long as this
                // file has existed, signals only ever had the forward one. So the
                // vocabulary migration removed SEVEN signals of the installed GTK
                // from the surface — `<gtk-entry onChanged={…}>` stopped
                // type-checking — and every check in this file stayed green,
                // because nothing asks what the surface is MISSING.
                //
                // Asked per DECLARATION rather than per widget, against the same
                // `DECLS` chain `surfaceMembers` walks, so a base the vocabulary
                // deliberately dropped is never consulted and cannot appear here.
                //
                // THIS RAN UNDER `it.failing` FOR ONE RELEASE, and what it caught is
                // why it exists. `IntrospectedInterface` in ts-for-gir had no
                // `signals` field — only `IntrospectedClass.fromXML` read
                // `<glib:signal>` — so every signal a GObject INTERFACE registers
                // reached no vocabulary. Measured on Gtk-4.0: 8 signals over
                // GtkEditable, GtkCellEditable, GtkColorChooser and GtkFontChooser,
                // which through `implements` is 50 handler slots across 17 concrete
                // widgets. `<gtk-entry onChanged>` was five of them. Fixed upstream
                // in ts-for-gir #460 and released as @girs 4.6.0; the guard retired
                // itself by going green, which under `it.failing` is a failure.
                const missing: string[] = [];
                const asked = new Set<string>();
                for (const w of GENERATED_WIDGETS) {
                    for (const declaration of DECLS[w.gtype] ?? []) {
                        if (asked.has(declaration)) continue;
                        const gtype = declarationGType(declaration);
                        if (!gtype) continue; // not in this library — judged once, above
                        asked.add(declaration);
                        const offered = new Set(OWN_SIGNALS[declaration] ?? []);
                        for (const id of GObject.signal_list_ids(gtype)) {
                            const signal = GObject.signal_name(id);
                            if (signal && !offered.has(signal)) missing.push(`${declaration}::${signal}`);
                        }
                    }
                }
                // Not vacuous: an empty chain would satisfy the assertion with
                // nothing asked.
                expect(asked.size > 100).toBe(true);
                expect(missing).toStrictEqual([]);
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
                const ahead: string[] = [];
                for (const [gtype, nicks] of Object.entries(ENUM_NICKS)) {
                    for (const nick of nicks) {
                        if (lookupEnumNick(gtype, nick) !== undefined) continue;
                        // A nick the host cannot resolve is a real defect ONLY when the
                        // host is as new as the vocabulary. Generated against GTK 4.23
                        // and run against an older one, `GtkEditableProperties`'
                        // `prop-complete-text` is simply not here yet, and there is no
                        // per-member SINCE to be finer than the library version.
                        //
                        // MEASURED, and worse than the earlier note here admitted:
                        // NONE of the 129 enum types carries a stated version, so
                        // `excuseFor` can only ever answer `blanket` for one of them —
                        // and while the vocabulary is ahead, that answer is yes for
                        // every nick at once. `problems` is then structurally empty,
                        // in CI too (same Fedora release as the workstation, GTK
                        // 4.22.4). The forward direction is therefore a REPORT while
                        // that holds, and the assertion that still bites is the
                        // reverse one below.
                        (predatesHost(gtype) ? ahead : problems).push(`${gtype}.${nick}`);
                    }
                }
                if (ahead.length > 0)
                    console.error(`  (${ahead.length} nick(s) newer than the installed library: ${ahead.join(', ')})`);
                if (blunted.length > 0) {
                    console.error(
                        `  (this check is BLUNTED: ${blunted
                            .map((library) => `${library} ${generatedAgainst[library]} > running ${running[library]}`)
                            .join(', ')} — every unresolvable nick is excused)`,
                    );
                }
                expect(problems).toStrictEqual([]);
            });

            await it('lists every enum nick the installed host registers', async () => {
                // THE DIRECTION THE VERSION GAP CANNOT EXCUSE, and the reason it is a
                // separate case rather than more lines in the one above.
                //
                // The forward check asks whether a nick the surface offers resolves,
                // and a vocabulary generated against a NEWER library legitimately
                // offers nicks this host has never heard of — so it is excused into
                // silence. This asks the opposite: every member the installed enum
                // registers must have a nick in the table. Being ahead cannot explain
                // a MISSING one, so this stays sharp exactly while the other goes
                // blunt, and it covers the class the other never could — a nick
                // dropped in extraction is not in `ENUM_NICKS` at all, so no loop over
                // `ENUM_NICKS` can see it.
                //
                // Through the member spelling `lookupEnumNick` derives, so the two
                // agree by construction; a `-`-for-`_` misspelling normalises to the
                // same member and is caught instead by `generator.spec.ts`, which
                // asserts no emitted nick contains an underscore.
                const uncovered: string[] = [];
                let checked = 0;
                for (const [gtype, nicks] of Object.entries(ENUM_NICKS)) {
                    const members = enumMembers(gtype);
                    if (!members) continue; // the host has no such enum — the case above owns it
                    checked++;
                    const covered = new Set(nicks.map((nick) => nick.toUpperCase().replace(/-/g, '_')));
                    for (const member of members) if (!covered.has(member)) uncovered.push(`${gtype}.${member}`);
                }
                expect(uncovered).toStrictEqual([]);
                // Not vacuous: an empty `ENUM_NICKS`, or a lookup that found no enum
                // object at all, would satisfy the line above with nothing checked.
                expect(checked > 100).toBe(true);
            });

            await it('gives every enum nick the number the installed typelib registers', async () => {
                // THE VALUE HALF, and the reason `generated/enum-values.mts` exists at
                // all: `ENUM_NICKS` says what a member is CALLED and nothing here said
                // what it IS. A surface with no GI has to hand GTK an integer, and
                // counting positions in the nick list answers wrong on six of the 129
                // enums — `GtkConstraintStrength.required` is 1001001000 where counting
                // says 0 — plus a seventh, `GtkEditableProperties`, wherever the
                // installed GTK is older than the vocabulary and an unvalued nick shifts
                // every position after it. The artifact is read from a typelib by
                // `scripts/generate-enum-values.mjs`; this is the check that the typelib
                // it was read from and the one running agree.
                //
                // WHY A DISAGREEMENT IS NORMALLY A DEFECT. An enum value is ABI: GTK 4
                // cannot renumber `GtkAlign` without breaking every compiled caller. So
                // a version gap can only ADD members, and the one member in the corpus
                // that legitimately MOVES is a count sentinel —
                // `GtkEditableProperties.num-properties`, 8 on a GTK with eight editable
                // properties and 10 on one with ten. That is why a mismatch is excused
                // only where the host is NEWER than the artifact, and is named even then.
                const values = Object.entries(ENUM_VALUES);
                const valuesAgainst: Readonly<Record<string, string>> = Object.fromEntries(
                    VALUES_PROVENANCE.split(' ')
                        .map((part) => /^(\w+)-[\d.]+\/([\d.]+)$/.exec(part))
                        .filter((m): m is RegExpExecArray => m !== null)
                        .map((m) => [m[1] as string, m[2] as string]),
                );
                /** True where the RUNNING library is newer than the one the values came from. */
                const hostIsAhead = (gtype: string): boolean => {
                    const library = libraryOf(gtype);
                    const read = valuesAgainst[library];
                    return read !== undefined && newerThan(running[library] as string, read);
                };
                const problems: string[] = [];
                const moved: string[] = [];
                const absent: string[] = [];
                for (const [key, value] of values) {
                    const at = key.indexOf('.');
                    const gtype = key.slice(0, at);
                    const nick = key.slice(at + 1);
                    const here = lookupEnumNick(gtype, nick);
                    if (here === undefined) {
                        // The artifact was generated against a NEWER library than this
                        // one. Same shape as the nick check above, excused the same way:
                        // a member that does not exist here cannot carry a number.
                        (predatesHost(gtype) ? absent : problems).push(`${key} has no member on this host`);
                        continue;
                    }
                    if (here === value) continue;
                    (hostIsAhead(gtype) ? moved : problems).push(`${key} is ${value} in the artifact and ${here} here`);
                }
                if (absent.length > 0)
                    console.error(`  (${absent.length} valued nick(s) this host does not have: ${absent.join(', ')})`);
                if (moved.length > 0)
                    console.error(
                        `  (${moved.length} value(s) moved under a newer library — regenerate with ` +
                            `\`gjs -m scripts/generate-enum-values.mjs\`: ${moved.join(', ')})`,
                    );
                expect(problems).toStrictEqual([]);
                // Not vacuous: an empty artifact, or a `lookupEnumNick` that resolved
                // nothing, would satisfy the line above having compared no numbers.
                expect(values.length > 500).toBe(true);
            });

            await it('excuses only the enum nicks this host really has no member for', async () => {
                // The OTHER direction on the declared remainder. A nick lands in
                // `ENUM_VALUES_UNAVAILABLE` because the generating host's library had no
                // such member; on a host that HAS it the entry is stale, and the artifact
                // is behind rather than wrong. Reported rather than failed for exactly
                // that reason — being behind costs a number nobody could read yet, and
                // the step that fixes it is the generator's own `--check`.
                const stale = Object.keys(ENUM_VALUES_UNAVAILABLE).filter((key) => {
                    const at = key.indexOf('.');
                    return lookupEnumNick(key.slice(0, at), key.slice(at + 1)) !== undefined;
                });
                if (stale.length > 0)
                    console.error(
                        `  (${stale.length} nick(s) excused as unavailable that this host DOES register — ` +
                            `the artifact predates this machine's libraries: ${stale.join(', ')})`,
                    );
                // Every excused nick is still one the vocabulary offers. That half is
                // not version-relative, so it is an assertion and not a report.
                const unknown = Object.keys(ENUM_VALUES_UNAVAILABLE).filter((key) => {
                    const at = key.indexOf('.');
                    return !(ENUM_NICKS[key.slice(0, at)] ?? []).includes(key.slice(at + 1));
                });
                expect(unknown).toStrictEqual([]);
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
