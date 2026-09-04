// Everything L2 CLAIMS about GTK, asked of the GTK that is installed.
//
// `primitives.spec.ts` proves the table resolves the way it says it does. It cannot
// prove that `wrap`, `lines`, `input-purpose` and `notify::active` are real — a
// misspelled property name resolves perfectly and fails in a consumer's window, and
// GTK's own answer to a misspelled property is nothing at all. So this file asks the
// typelib: every tag registered, every property installed on the class it is routed
// to, every signal emitted by it.
//
// AND THEN IT RENDERS. The property check is necessary and not sufficient: it would
// pass with the two inverted defaults missing, with the overlay switch never firing,
// and with `contentContainerStyle` landing on the wrong node. The mount vectors are
// what read the REAL widget tree — never the plan, which agrees with itself — and
// every one of them asserts ZERO GTK diagnostics, because GTK's failure mode is
// exit 0.
//
// `gated` is a local six-liner rather than an import: `@gjsify/gtk-host`'s own
// version lives in `src/testing/gate.mts`, which the package's exports map
// deliberately does not publish (a `.mts` file is outside its library build, and
// `files` negates the declaration). Its REASON is what matters and is reproduced
// here — `@gjsify/unit` keeps ONE `beforeEach`/`afterEach` slot per module and nulls
// both when a `describe` returns, so hooks registered before the first of several
// siblings leave every later one ungated. Measured in `host.spec.ts`: a GTK critical
// injected into describe #15 printed to stderr, the case still reported a tick, and
// the blame surfaced twelve tests later on an innocent neighbour.
//
// ONE SLOT ALSO MEANS ONE REGISTRATION PER MODULE, which is the same trap from the
// inside and cost this file 37 of its 49 cases: three gated blocks registered their
// own `configureStyle`/`resetStyleConfig` pair, which REPLACED the gate's hooks
// rather than adding to them, so `assertQuiet` never ran for any case in them.
// MEASURED by writing an accessible state through the wrong GValue type — two
// `GLib-GObject-CRITICAL`s on stderr, and the case named "…with no diagnostic"
// green at exit 0. Both concerns now live in `gated` itself, and nothing else in
// this file may call `beforeEach` or `afterEach`.

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { afterEach, beforeEach, describe, expect, it, on, type Runtime } from '@gjsify/unit';
import { lookupWidget, paramSpecs, registerBuiltinWidgets } from '@gjsify/gtk-host';
import { descriptorProblems, dumpTree, gtkChildren, installDiagnosticsGate } from '@gjsify/gtk-host/conformance';
import { MINIMAL_TOKENS, StyleSheet as GeneratedStyleSheet, type StyleTokens } from '@gjsify/gtk-host/style';
import { createRoot, flushSync } from '@gjsify/gtk-host/react';
import { createElement, Fragment, type ReactNode } from 'react';

import { PrimitiveError } from './errors.js';
import { createHandle, type TextInputHandle } from './handles.js';
import { PRIMITIVES, type PrimitiveSpec } from './table.js';
import {
    ActivityIndicator,
    AnimatedView,
    Button,
    Image,
    ImageBackground,
    KeyboardAvoidingView,
    Modal,
    Pressable,
    SafeAreaView,
    ScrollView,
    StatusBar,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from '../components.js';
import type { ImageProps, PressableState } from '../components.js';
import { AnimatedValue } from '../animated/value.js';
import { resetWindowMetricsCache } from '../apis/display.js';
import { useWindowDimensions } from '../hooks.js';
import { liveRegionWatchCount } from '../announce.js';
import { pressWatchCount } from '../press.js';
import { StyleSheet } from '../stylesheet.js';
import { configureStyle, resetStyleConfig } from '../style-config.js';

/** Named identities, not a capability: a probe that answers "no" stands the suite DOWN, and a suite that ran zero tests reports success. */
const GTK_HOSTS: Runtime[] = ['Gjs', 'Node.js', 'Bun', 'Deno'];

const TOKENS: StyleTokens = {
    ...MINIMAL_TOKENS,
    spacing: { ...MINIMAL_TOKENS.spacing, '1': '4px', '2': '8px', '4': '16px' },
    colors: { ...MINIMAL_TOKENS.colors, emphasis: 'rgb(17 34 51)' },
};

/** Properties `layout.ts` and `intents.ts` can emit on ANY widget — `Gtk.Widget`'s own. */
const UNIVERSAL = [
    'visible',
    'margin-top',
    'margin-bottom',
    'margin-start',
    'margin-end',
    'halign',
    'valign',
    'hexpand',
    'vexpand',
    'width-request',
    'height-request',
    'overflow',
    'css-classes',
    'name',
    'sensitive',
] as const;

interface Claim {
    readonly gtype: string;
    readonly property: string;
    readonly where: string;
}

/** Every (gtype, property) pair the table can produce, derived from the table itself. */
function propertyClaims(): Claim[] {
    const claims: Claim[] = [];
    const add = (gtype: string, property: string, where: string) => claims.push({ gtype, property, where });

    const walk = (name: string, spec: PrimitiveSpec): void => {
        const content = spec.content;
        const backdrop = spec.backdrop;
        // The three nodes a route can name, so a `on: 'backdrop'` claim is checked
        // against the PICTURE rather than against the overlay it hangs in. Without this
        // the gate reported `ImageBackground.resizeMode: GtkOverlay has no
        // "content-fit"` — which is how it caught the third node being added.
        const nodeTag: Record<string, string | undefined> = {
            outer: spec.tag,
            content: content?.tag,
            backdrop: backdrop?.tag,
        };
        for (const property of Object.keys(spec.widgetProps)) add(spec.tag, property, `${name}.widgetProps`);
        for (const property of Object.keys(content?.widgetProps ?? {})) {
            add(content!.tag, property, `${name}.content.widgetProps`);
        }
        for (const property of Object.keys(backdrop?.widgetProps ?? {})) {
            add(backdrop!.tag, property, `${name}.backdrop.widgetProps`);
        }
        for (const [prop, route] of Object.entries(spec.props)) {
            for (const single of Array.isArray(route) ? route : [route]) {
                if (single.to !== 'property') continue;
                const gtype = nodeTag[single.on ?? 'outer'];
                if (gtype === undefined) {
                    throw new Error(
                        `${name}.${prop} is routed to a "${single.on}" node the primitive does not declare`,
                    );
                }
                for (const property of single.names) add(gtype, property, `${name}.${prop}`);
                for (const property of Object.keys(single.also ?? {})) add(gtype, property, `${name}.${prop}.also`);
            }
        }
        // The intent resolver's own emissions, gated on the facts the table declares.
        for (const gtype of [spec.tag, content?.tag, backdrop?.tag, spec.overlayOnAbsoluteChild?.tag]) {
            if (gtype === undefined) continue;
            for (const property of UNIVERSAL) add(gtype, property, `${name} (universal)`);
        }
        if (spec.widget.box) {
            // A `View` that became an overlay keeps its box INSIDE, so these two land
            // on `spec.tag` either way — which is exactly what `BOX_ONLY_PROPS` moves.
            for (const property of ['orientation', 'spacing']) add(spec.tag, property, `${name} (box intent)`);
        }
        // The wrap swap's node. Its properties are NOT the box's: a `Gtk.FlowBox`
        // installs no `spacing` at all, so the two spacings the resolver emits are
        // the exact claim this gate exists to hold — a misspelling here resolves
        // perfectly and is refused at attach time, in a consumer's window.
        for (const facts of [spec.widget, content?.widget, backdrop?.widget]) {
            const into = facts?.wrapsInto ?? null;
            if (into === null) continue;
            for (const property of Object.keys(into.widgetProps)) add(into.tag, property, `${name} (wrap)`);
            for (const property of ['orientation', 'row-spacing', 'column-spacing']) {
                add(into.tag, property, `${name} (wrap spacing)`);
            }
            for (const property of UNIVERSAL) add(into.tag, property, `${name} (wrap, universal)`);
        }
        if (content?.widget.box === true) {
            for (const property of ['orientation', 'spacing'])
                add(content.tag, property, `${name}.content (box intent)`);
        }
        if (backdrop?.widget.box === true) {
            for (const property of ['orientation', 'spacing'])
                add(backdrop.tag, property, `${name}.backdrop (box intent)`);
        }
        if (spec.widget.alignsText) {
            for (const property of ['xalign', 'justify']) add(spec.tag, property, `${name} (text intent)`);
        }
        if (spec.switchOn !== undefined) walk(`${name}[${spec.switchOn.prop}]`, spec.switchOn.whenTrue);
    };

    for (const [name, spec] of Object.entries(PRIMITIVES)) walk(name, spec);
    return claims;
}

function signalClaims(): { gtype: string; signal: string; where: string }[] {
    const out: { gtype: string; signal: string; where: string }[] = [];
    const walk = (name: string, spec: PrimitiveSpec): void => {
        for (const [prop, route] of Object.entries(spec.props)) {
            for (const single of Array.isArray(route) ? route : [route]) {
                // An `announce` route names a signal exactly as an `event` does, so it
                // gets the same check: `notify::label` misspelt is a live region that
                // never fires, which looks precisely like a screen reader ignoring it.
                if (single.to !== 'event' && single.to !== 'announce') continue;
                out.push({ gtype: spec.tag, signal: single.signal, where: `${name}.${prop}` });
            }
        }
        if (spec.switchOn !== undefined) walk(`${name}[${spec.switchOn.prop}]`, spec.switchOn.whenTrue);
    };
    for (const [name, spec] of Object.entries(PRIMITIVES)) walk(name, spec);
    return out;
}

const klassOf = (gtype: string) => lookupWidget(gtype).ctor();

/** The one place a mount happens, so nothing forgets to tear its root down. */
function mounted(element: ReactNode, body: (container: Gtk.Box) => void): void {
    const container = new Gtk.Box();
    const root = createRoot(container);
    try {
        root.render(element);
        body(container);
    } finally {
        root.unmount();
    }
}

/**
 * `mounted`, with the container really inside a toplevel — the fixture `<Modal>` needs.
 *
 * The default `mounted` above mounts into a BARE `Gtk.Box`, and for a portal that is
 * the trap rather than a simplification: an `Adw.Dialog` presented against an
 * unrooted parent opens a separate `GtkWindow` at exit 0, and `box.append(dialog)` —
 * the thing the portal placement replaces — is a silent no-op on a bare box and
 * SIGABRT on a rooted one. A vector for a modal that used `mounted` would measure
 * neither. An `Adw.Window`, because only the libadwaita windows carry the
 * `AdwDialogHost` a dialog is presented into.
 *
 * `renderAgain` is handed through because that is how `visible` is exercised: the
 * modal closes by being unrendered, so the vector has to render twice.
 */
function mountedInWindow(
    element: ReactNode,
    body: (facts: { container: Gtk.Box; window: Adw.Window; renderAgain: (next: ReactNode) => void }) => void,
): void {
    const window = new Adw.Window();
    const container = new Gtk.Box();
    window.set_content(container);
    const root = createRoot(container);
    try {
        root.render(element);
        body({ container, window, renderAgain: (next) => flushSync(() => root.render(next)) });
    } finally {
        root.unmount();
        window.destroy();
    }
}

const typeOf = (widget: Gtk.Widget): string =>
    // `type_name` is nullable in the GIR (an unregistered GType has no name), and a
    // widget the reconciler produced always has one — so the `??` is a type
    // narrowing with a sentinel, not a fallback anyone should ever see.
    GObject.type_name((widget as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype) ??
    '(unregistered GType)';

/**
 * The classes THIS layer put on a widget, separated from the ones GTK did.
 *
 * MEASURED: a `Gtk.Box` reports `css-classes` of its ORIENTATION with nothing
 * authored — `Gtk.Orientable` adds it. So a vector that counted the whole list would
 * be asserting a GTK behaviour, and one that expected the list to be EMPTY would
 * fail for the same reason. The generated names are the only ones this layer owns.
 */
const generatedClasses = (widget: Gtk.Widget): string[] =>
    [...widget.cssClasses].filter((name) => name.startsWith('gjsify-'));

/**
 * The widget, having asserted it HAS an accessibility context to record into.
 *
 * Without this the accessibility vectors fail as "expected true, got false" and say
 * nothing about the cause, which is what happened: `GTK_A11Y=none` gives a NULL AT
 * context, so `update_property()` records nothing and every
 * `Gtk.test_accessible_has_*` answers false. `test.mts` installs the backend; this
 * names it the day something unsets it again.
 */
const withAtContext = (widget: Gtk.Widget): Gtk.Widget => {
    // A THROW rather than an `expect`, because the sentence is the whole value: the
    // generic "expected values to match using ===" is what sent three OS legs
    // looking for a marshalling bug that was never there.
    if (widget.get_at_context() === null) {
        throw new Error(
            'this widget has no GtkATContext, so update_property()/update_state() record nothing and every ' +
                'Gtk.test_accessible_has_* answers false — these vectors would be measuring an absent ' +
                'accessibility layer, not this package. GTK_A11Y=none does exactly that; src/test.mts installs ' +
                'GTK’s in-process `test` backend to prevent it, so something has unset it again.',
        );
    }
    return widget;
};

/** First strict descendant of a GType, breadth-first over the REAL tree. */
function find(root: Gtk.Widget, gtype: string): Gtk.Widget {
    const queue: Gtk.Widget[] = [...gtkChildren(root)];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (typeOf(widget) === gtype) return widget;
        queue.push(...gtkChildren(widget));
    }
    throw new Error(`no ${gtype} under:\n${dumpTree(root)}`);
}

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        registerBuiltinWidgets();
        const diagnostics = installDiagnosticsGate();
        const gated = (name: string, run: () => Promise<void>): Promise<void> =>
            describe(name, async () => {
                beforeEach(() => {
                    diagnostics.reset();
                    configureStyle({ tokens: TOKENS });
                });
                afterEach(() => {
                    resetStyleConfig();
                    diagnostics.assertQuiet();
                });
                await run();
            }) as Promise<void>;

        await gated('the widget table L2 depends on', async () => {
            await it('has a placement rule for every tag L2 can name', async () => {
                // `GtkOverlay` is the one the P1 milestone added, and without a curated
                // rule the overlay switch produces a tag whose insertion the host
                // refuses BY NAME — correct, and useless to the layer that has to
                // build it.
                for (const spec of Object.values(PRIMITIVES)) {
                    for (const gtype of [
                        spec.tag,
                        spec.content?.tag,
                        spec.backdrop?.tag,
                        spec.overlayOnAbsoluteChild?.tag,
                        spec.widget.wrapsInto?.tag,
                        spec.content?.widget.wrapsInto?.tag,
                    ]) {
                        if (gtype === undefined) continue;
                        expect(typeof lookupWidget(gtype).ctor()).toBe('function');
                    }
                }
                expect(lookupWidget('GtkOverlay').children.kind).toBe('slotted');
            });

            await it('names slots the outer node really has, for every node that declares one', async () => {
                // A `slot` is a string the host looks up in the PARENT's policy, and a
                // name that is not there is refused at insert time — in a window, at
                // runtime, which is the latest possible moment. `ImageBackground` is the
                // one primitive with two slotted nodes (`child` for the picture,
                // `overlay` for the children), and getting either wrong is a tree that
                // builds and then refuses.
                for (const [name, spec] of Object.entries(PRIMITIVES)) {
                    const slots = [spec.backdrop?.slot, spec.content?.slot].filter(
                        (slot): slot is string => typeof slot === 'string',
                    );
                    if (slots.length === 0) continue;
                    const policy = lookupWidget(spec.tag).children;
                    expect(`${name}: ${policy.kind}`).toBe(`${name}: slotted`);
                    for (const slot of slots) {
                        expect(Object.keys((policy as { slots: Record<string, string> }).slots)).toContain(slot);
                    }
                }
            });

            await it('names only methods and sinks the installed GTK has', async () => {
                expect(descriptorProblems()).toStrictEqual([]);
            });
        });

        await gated('every property claim, against the installed typelib', async () => {
            await it('is a property the class really installs', async () => {
                const missing: string[] = [];
                for (const claim of propertyClaims()) {
                    const specs = paramSpecs(klassOf(claim.gtype), claim.gtype);
                    if (!specs.has(claim.property))
                        missing.push(`${claim.where}: ${claim.gtype} has no "${claim.property}"`);
                }
                expect(missing).toStrictEqual([]);
            });

            await it('is WRITABLE, because a read-only write is accepted and stored nowhere', async () => {
                const readOnly: string[] = [];
                for (const claim of propertyClaims()) {
                    const spec = paramSpecs(klassOf(claim.gtype), claim.gtype).get(claim.property);
                    if (spec === undefined) continue;
                    if ((spec.flags & GObject.ParamFlags.WRITABLE) === 0) {
                        readOnly.push(`${claim.where}: ${claim.gtype}.${claim.property}`);
                    }
                }
                expect(readOnly).toStrictEqual([]);
            });
        });

        await gated('every signal claim', async () => {
            await it('is a signal the class really emits', async () => {
                const missing: string[] = [];
                for (const claim of signalClaims()) {
                    // `notify::active` is a DETAIL on `notify`, so the lookup is on the
                    // base name — which is also what the host's own
                    // `assertSignalExists` does.
                    const base = claim.signal.split('::')[0];
                    if (GObject.signal_lookup(base, klassOf(claim.gtype).$gtype) === 0) {
                        missing.push(`${claim.where}: ${claim.gtype} emits no "${base}"`);
                    }
                }
                expect(missing).toStrictEqual([]);
            });

            await it('finds `changed` on Gtk.Entry through the Editable interface', async () => {
                // Worth its own vector: `GObject.signal_list_ids(Gtk.Entry.$gtype)`
                // returns `activate`, `icon-press`, `icon-release` and NOT `changed`
                // — the signal belongs to the `GtkEditable` INTERFACE. A check that
                // enumerated the class's own ids would have reported
                // `onChangeText` as a broken claim.
                expect(GObject.signal_lookup('changed', Gtk.Entry.$gtype) !== 0).toBe(true);
            });
        });

        // The handle calls METHODS, and a method name is exactly as easy to misspell
        // as a property name and exactly as invisible: `handles.ts` types the widget
        // structurally (it may not import `gi://`), so TypeScript checks the shape it
        // ASSERTS rather than the shape GTK has. This gate is the other half.
        await gated('the imperative handle a ref receives', async () => {
            await it('calls only methods the routed classes really install', async () => {
                const missing: string[] = [];
                const has = (klass: unknown, method: string, where: string): void => {
                    if (typeof (klass as Record<string, unknown>)[method] !== 'function') {
                        missing.push(`${where}: no ${method}()`);
                    }
                };
                for (const [name, spec] of Object.entries(PRIMITIVES)) {
                    for (const [label, one] of [
                        [name, spec],
                        [`${name}[${spec.switchOn?.prop}]`, spec.switchOn?.whenTrue],
                    ] as const) {
                        if (one === undefined || one.handle === undefined) continue;
                        const widget = new (klassOf(one.tag) as unknown as new () => Gtk.Widget)();
                        for (const method of ['grab_focus', 'is_focus', 'get_root']) has(widget, method, label);
                        if (one.tag === 'GtkTextView') {
                            has(widget, 'get_buffer', label);
                            const buffer = (widget as Gtk.TextView).get_buffer();
                            for (const method of ['set_text', 'get_iter_at_offset', 'select_range']) {
                                has(buffer, method, `${label} buffer`);
                            }
                        } else {
                            for (const method of ['set_text', 'select_region']) has(widget, method, label);
                        }
                    }
                }
                expect(missing).toStrictEqual([]);
            });

            await it('clears and selects on a Gtk.Entry', async () => {
                const entry = new Gtk.Entry({ text: 'hello' });
                const handle = createHandle('text-input', entry, 'GtkEntry') as TextInputHandle;
                expect(handle.widget).toBe(entry);
                handle.setSelection(1, 3);
                expect(entry.get_selection_bounds()).toStrictEqual([true, 1, 3]);
                handle.clear();
                expect(entry.text).toBe('');
            });

            await it('clears and selects through the buffer on a Gtk.TextView', async () => {
                // The multiline half is a DIFFERENT widget with a different content
                // model — the reason `value` is refused there — so it is a separate
                // vector rather than a parameter of the one above.
                const view = new Gtk.TextView();
                view.get_buffer().set_text('abcdef', -1);
                const handle = createHandle('text-input', view, 'GtkTextView') as TextInputHandle;
                handle.setSelection(1, 3);
                const bounds = view.get_buffer().get_selection_bounds();
                expect([bounds[0], bounds[1].get_offset(), bounds[2].get_offset()]).toStrictEqual([true, 1, 3]);
                handle.clear();
                const buffer = view.get_buffer();
                expect(buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), false)).toBe('');
            });

            await it('accepts focus on the widget the table routes it to', async () => {
                // What a REAL widget can answer here, and no more. Whether the focus
                // then settles is the compositor's: MEASURED on gtk 4.22.4, a presented
                // window the compositor never activated reports `Gtk.Root.get_focus()`
                // null and `is_focus()` false for the widget `grab_focus()` just
                // returned true for — so `focus()`'s and `blur()`'s BEHAVIOUR is
                // asserted against a stub root in `primitives.spec.ts`, where it is
                // observable, and this vector holds the half GTK can report.
                const entry = new Gtk.Entry();
                const handle = createHandle('text-input', entry, 'GtkEntry') as TextInputHandle;
                handle.focus();
                // `can-focus`, NOT `focusable`. MEASURED on gtk 4.22.4: a fresh
                // `Gtk.Entry` reports `focusable` FALSE and `can-focus` true, because
                // the widget that takes the keyboard is the `GtkText` inside it and the
                // entry delegates. Asserting `focusable` would have failed on a
                // perfectly focusable widget.
                expect(entry.canFocus).toBe(true);
                expect(handle.isFocused()).toBe(entry.is_focus());
            });

            await it('refuses the four NativeMethods members BY NAME, never as undefined', async () => {
                // React Native's `NativeMethods` carries nine members; five have an
                // honest GTK answer above and these four do not. Absent, each one is
                // `undefined is not a function` — the failure this whole file exists
                // to convert into a sentence.
                const handle = createHandle('text-input', new Gtk.Entry(), 'GtkEntry') as TextInputHandle;
                for (const member of ['measure', 'measureInWindow', 'measureLayout', 'setNativeProps'] as const) {
                    expect(typeof handle[member]).toBe('function');
                    let error: unknown = null;
                    try {
                        (handle[member] as (...args: unknown[]) => unknown)(() => undefined);
                    } catch (thrown) {
                        error = thrown;
                    }
                    expect(error instanceof PrimitiveError).toBe(true);
                    expect((error as PrimitiveError).message).toContain(`ref.${member}()`);
                }
            });
        });

        await gated('a real tree, through a real reconciler', async () => {
            await it('renders a View as a VERTICAL box holding a label', async () => {
                mounted(createElement(View, { className: 'p-2' }, createElement(Text, null, 'hello')), (container) => {
                    const box = gtkChildren(container)[0] as Gtk.Box;
                    expect(typeOf(box)).toBe('GtkBox');
                    expect(box.orientation).toBe(Gtk.Orientation.VERTICAL);
                    expect(generatedClasses(box).length).toBe(1);
                    // GTK's own orientation class survived the `css-classes` write,
                    // which it did not before this milestone: the property is a
                    // whole-list write and `Gtk.Orientable` had already put `vertical`
                    // there. ADR 0032 § 5's union rule, with GTK as the other author.
                    expect([...box.cssClasses]).toContain('vertical');
                    const label = gtkChildren(box)[0] as Gtk.Label;
                    expect(typeOf(label)).toBe('GtkLabel');
                    expect(label.label).toBe('hello');
                    // The second inverted default, in the widget rather than the plan.
                    expect(label.wrap).toBe(true);
                });
            });

            await it('gives every child of a row the cross-axis alignment', async () => {
                mounted(
                    createElement(
                        View,
                        { className: 'flex-row items-center' },
                        createElement(Text, { key: 'a' }, 'a'),
                        createElement(Text, { key: 'b' }, 'b'),
                    ),
                    (container) => {
                        const box = gtkChildren(container)[0] as Gtk.Box;
                        expect(box.orientation).toBe(Gtk.Orientation.HORIZONTAL);
                        for (const child of gtkChildren(box)) {
                            expect((child as Gtk.Label).valign).toBe(Gtk.Align.CENTER);
                        }
                    },
                );
            });

            await it('becomes a Gtk.Overlay when a CHILD is absolutely positioned', async () => {
                mounted(
                    createElement(
                        View,
                        { className: 'p-2' },
                        createElement(Text, { key: 'body' }, 'body'),
                        createElement(Text, { key: 'badge', className: 'absolute inset-0' }, 'badge'),
                    ),
                    (container) => {
                        const overlay = gtkChildren(container)[0] as Gtk.Overlay;
                        expect(typeOf(overlay)).toBe('GtkOverlay');
                        // The main child is the box the ordinary children moved into;
                        // the badge is in the overlay slot beside it, not inside it.
                        const box = overlay.get_child() as Gtk.Box;
                        expect(typeOf(box)).toBe('GtkBox');
                        expect(gtkChildren(box).map((c) => (c as Gtk.Label).label)).toStrictEqual(['body']);
                        const badge = gtkChildren(overlay).find((c) => c !== box) as Gtk.Label;
                        expect((badge as Gtk.Label).label).toBe('badge');
                        expect(badge.halign).toBe(Gtk.Align.FILL);
                        expect(badge.valign).toBe(Gtk.Align.FILL);
                        // The padding stayed on the OUTER node, which is what keeps an
                        // overlay child positioned against the padding box.
                        expect(generatedClasses(overlay).length).toBe(1);
                        expect(generatedClasses(box)).toStrictEqual([]);
                    },
                );
            });

            await it('sees an absolute child through a Fragment, and still becomes an Overlay', async () => {
                // #1451, read off the REAL tree. A Fragment answers for itself, so the
                // parent used to count zero absolutely positioned children, stay a
                // `Gtk.Box`, and hand the child L2's refusal that names the PARENT —
                // for something the child's wrapper did. `card.overlay={<>…</>}` is
                // ordinary React and there is no prop on a Fragment to fix.
                mounted(
                    createElement(
                        View,
                        { className: 'p-2' },
                        createElement(Text, { key: 'body' }, 'body'),
                        createElement(
                            Fragment,
                            { key: 'group' },
                            createElement(Text, { key: 'badge', className: 'absolute inset-0' }, 'badge'),
                        ),
                    ),
                    (container) => {
                        const overlay = gtkChildren(container)[0] as Gtk.Overlay;
                        expect(typeOf(overlay)).toBe('GtkOverlay');
                        const box = overlay.get_child() as Gtk.Box;
                        expect(gtkChildren(box).map((c) => (c as Gtk.Label).label)).toStrictEqual(['body']);
                        // The badge is in the `add_overlay` slot beside the box, not
                        // inside it — which is the half a plan comparison cannot see.
                        const badge = gtkChildren(overlay).find((c) => c !== box) as Gtk.Label;
                        expect(badge.label).toBe('badge');
                        expect(badge.halign).toBe(Gtk.Align.FILL);
                    },
                );
            });

            await it('sees an absolute Animated.View, whose first frame is already written', async () => {
                // The second half of #1451, and an independent door into it: an
                // `Animated.Value` in a style is what L2 refuses on a plain element, so
                // a parent reading the raw props got a throw where it wanted an answer
                // and answered "not absolute". MEASURED in a consumer as the only
                // difference between a working absolute header and a refused one.
                const opacity = new AnimatedValue(0.25);
                mounted(
                    createElement(
                        View,
                        { className: 'p-2' },
                        createElement(Text, { key: 'body' }, 'body'),
                        createElement(AnimatedView, {
                            key: 'fade',
                            className: 'absolute inset-0',
                            style: { opacity },
                        }),
                    ),
                    (container) => {
                        const overlay = gtkChildren(container)[0] as Gtk.Overlay;
                        expect(typeOf(overlay)).toBe('GtkOverlay');
                        const box = overlay.get_child() as Gtk.Box;
                        const fade = gtkChildren(overlay).find((child) => child !== box) as Gtk.Box;
                        expect(typeOf(fade)).toBe('GtkBox');
                        expect(fade.halign).toBe(Gtk.Align.FILL);
                        // The two features composing is the point: the element is in
                        // the overlay slot AND carries the value's current number as a
                        // widget property, from the render rather than from the effect.
                        //
                        // 64/255 AND NOT 0.25, and the quantisation is the discriminator
                        // rather than an annoyance. MEASURED on gtk 4.22.4:
                        // `Gtk.Widget:opacity` is a `gdouble` in the ParamSpec and 8-bit
                        // internally, so a number that really went through GObject comes
                        // back rounded. A plain JS expando — which is what a misspelled
                        // property name produces, silently (`animated/properties.ts`) —
                        // would read back exactly 0.25.
                        expect(fade.opacity).toBe(64 / 255);
                    },
                );
            });

            await it('re-renders through a Fragment without rebuilding a single widget', async () => {
                // WHAT THE KEY SPELLING IS A PROXY FOR. `child-facts.spec.ts` asserts
                // that an expanded child keeps its own key composed behind its
                // Fragment's rather than reassigned; this is the effect that assertion
                // exists for, and the only half an application feels. React answers a
                // key that changed between renders by unmounting the subtree and
                // building it again — new GObjects, and with them everything the widget
                // holds that the descriptor does not: a cursor, a scroll position, an
                // animation binding. The tree LOOKS identical either way, which is why
                // the vector reads identities and not shape.
                const tree = (n: number): ReactNode =>
                    createElement(
                        View,
                        { className: 'p-2' },
                        createElement(Text, { key: 'body' }, `body ${n}`),
                        createElement(
                            Fragment,
                            { key: 'group' },
                            createElement(Text, { key: 'badge', className: 'absolute inset-0' }, `badge ${n}`),
                        ),
                    );
                const container = new Gtk.Box();
                const root = createRoot(container);
                try {
                    root.render(tree(0));
                    const overlay = gtkChildren(container)[0] as Gtk.Overlay;
                    const box = overlay.get_child() as Gtk.Box;
                    const body = gtkChildren(box)[0] as Gtk.Label;
                    const badge = gtkChildren(overlay).find((child) => child !== box) as Gtk.Label;
                    expect([body.label, badge.label]).toStrictEqual(['body 0', 'badge 0']);

                    flushSync(() => root.render(tree(1)));

                    // Read off the SAME references: a rebuild leaves these two holding
                    // the old widgets, still labelled 0, so this line is the assertion
                    // and the discriminator at once.
                    expect([body.label, badge.label]).toStrictEqual(['body 1', 'badge 1']);
                    const after = gtkChildren(container)[0] as Gtk.Overlay;
                    expect(after === overlay).toBe(true);
                    expect(after.get_child() === box).toBe(true);
                    expect(gtkChildren(after).find((child) => child !== box) === badge).toBe(true);
                } finally {
                    root.unmount();
                }
            });

            await it('becomes a Gtk.FlowBox for a wrap, and puts its children INSIDE it', async () => {
                // The tag is half the claim. The other half is that the host can
                // actually place children in the swapped-in class — a `Gtk.FlowBox`
                // wraps each child in a `Gtk.FlowBoxChild`, so a plan naming the tag
                // without a curated placement rule builds and then refuses at insert
                // time. This reads the REAL tree, through the wrapper row.
                mounted(
                    createElement(
                        View,
                        { className: 'flex-row flex-wrap gap-2' },
                        createElement(Text, { key: 'a' }, 'a'),
                        createElement(Text, { key: 'b' }, 'b'),
                    ),
                    (container) => {
                        const flow = gtkChildren(container)[0] as Gtk.FlowBox;
                        expect(typeOf(flow)).toBe('GtkFlowBox');
                        expect(flow.orientation).toBe(Gtk.Orientation.HORIZONTAL);
                        // The two corrected defaults, read back off the widget rather
                        // than off the plan: 7 children per line and a SINGLE
                        // selection are what a `Gtk.FlowBox` is without them.
                        expect(flow.maxChildrenPerLine).toBe(65535);
                        expect(flow.selectionMode).toBe(Gtk.SelectionMode.NONE);
                        // `gap-2` reached the two spacings, and NOT `Gtk.Box:spacing`
                        // — a property this class does not install at all.
                        expect(flow.rowSpacing).toBe(8);
                        expect(flow.columnSpacing).toBe(8);
                        // Each child sits in the wrapper row the host adds.
                        const rows = gtkChildren(flow);
                        expect(rows.map(typeOf)).toStrictEqual(['GtkFlowBoxChild', 'GtkFlowBoxChild']);
                        expect(rows.map((row) => (gtkChildren(row)[0] as Gtk.Label).label)).toStrictEqual(['a', 'b']);
                    },
                );
            });

            await it('renders a Pressable as a flat button whose click reaches onPress', async () => {
                let pressed = 0;
                mounted(
                    createElement(Pressable, { className: 'active:opacity-70', onPress: () => (pressed += 1) }, 'Go'),
                    (container) => {
                        const button = gtkChildren(container)[0] as Gtk.Button;
                        expect(typeOf(button)).toBe('GtkButton');
                        expect(button.label).toBe('Go');
                        expect([...button.cssClasses]).toContain('flat');
                        button.emit('clicked');
                        expect(pressed).toBe(1);
                    },
                );
            });

            await it('puts a ScrollView’s children in the implicit content box', async () => {
                mounted(
                    createElement(ScrollView, { contentContainerClassName: 'p-2' }, createElement(Text, null, 'row')),
                    (container) => {
                        const scrolled = gtkChildren(container)[0] as Gtk.ScrolledWindow;
                        expect(typeOf(scrolled)).toBe('GtkScrolledWindow');
                        expect(scrolled.hscrollbarPolicy).toBe(Gtk.PolicyType.NEVER);
                        // GTK wraps a scrolled window's child in a `GtkViewport` — the
                        // host's own `slotOccupant` records the same measurement — so
                        // the box is a DESCENDANT rather than the direct child.
                        const box = find(scrolled, 'GtkBox') as Gtk.Box;
                        expect(generatedClasses(box).length).toBe(1);
                        expect(gtkChildren(box).map((c) => (c as Gtk.Label).label)).toStrictEqual(['row']);
                    },
                );
            });

            await it('renders a TextInput as a Gtk.Entry whose changes reach onChangeText', async () => {
                const seen: unknown[] = [];
                mounted(
                    createElement(TextInput, {
                        value: 'x',
                        placeholder: 'p',
                        onChangeText: (t: string) => seen.push(t),
                    }),
                    (container) => {
                        const entry = gtkChildren(container)[0] as Gtk.Entry;
                        expect(typeOf(entry)).toBe('GtkEntry');
                        expect(entry.text).toBe('x');
                        expect(entry.placeholderText).toBe('p');
                        // The emitter never reaches a handler (the host strips it), so
                        // the value comes off the ref — this is the vector that proves
                        // that path rather than the plan's `read` field.
                        //
                        // ONE emission, and that is the whole reason the route binds
                        // `notify::text`: with `Gtk.Editable::changed` this same write
                        // produced `["", "xy"]`, because `gtk_editable_set_text` is a
                        // delete followed by an insert. A controlled input would have
                        // reported the intermediate empty string as the user clearing
                        // the field.
                        entry.text = 'xy';
                        expect(seen).toStrictEqual(['xy']);
                    },
                );
            });

            await it('hands a TextInput ref the imperative handle, not the bare widget', async () => {
                // The defect, end to end: `useRef<TextInput>(null)` plus
                // `ref.current?.focus()` is ordinary React Native code, and it was
                // `undefined is not a function` here because the ref carried the
                // `Gtk.Entry` itself. The type half is checked by `gjsify tsc`; this is
                // the value half, through the real reconciler.
                const ref: { current: TextInputHandle | null } = { current: null };
                mounted(createElement(TextInput, { value: 'hello', ref }), (container) => {
                    const entry = gtkChildren(container)[0] as Gtk.Entry;
                    expect(ref.current === null).toBe(false);
                    const handle = ref.current as TextInputHandle;
                    expect(handle.widget).toBe(entry);
                    for (const member of ['focus', 'blur', 'clear', 'isFocused', 'setSelection'] as const) {
                        expect(typeof handle[member]).toBe('function');
                    }
                    handle.clear();
                    expect(entry.text).toBe('');
                });
                // Detach hands back `null`, which is how a React application asks
                // whether it is still mounted — a handle wrapping a dropped widget
                // would answer that question wrongly.
                expect(ref.current).toBe(null);
            });

            await it('hands every other primitive’s ref the widget, exactly as before', async () => {
                const ref: { current: unknown } = { current: null };
                mounted(createElement(View, { ref }), (container) => {
                    expect(ref.current).toBe(gtkChildren(container)[0]);
                });
            });

            await it('announces a Text live region through Gtk.Accessible, at GTK’s own priority', async () => {
                // `announce()` is a no-op with no diagnostic when nothing is listening
                // (measured), so the CALL is what can be observed: the instance method
                // is shadowed, which GJS allows on a GObject wrapper. Without that the
                // only assertion available would be "it did not throw", which is the
                // shape this whole layer refuses.
                const seen: [string, number][] = [];
                mounted(createElement(Text, { accessibilityLiveRegion: 'polite' }, 'first'), (container) => {
                    const label = gtkChildren(container)[0] as Gtk.Label;
                    (label as unknown as Record<string, unknown>).announce = (message: string, priority: number) =>
                        seen.push([message, priority]);
                    // The MOMENT is the content changing, not the mount: React
                    // Native's live region speaks an update, and a screen reader
                    // that announced every label on first paint would be unusable.
                    expect(seen).toStrictEqual([]);
                    label.label = 'second';
                    expect(seen).toStrictEqual([['second', Gtk.AccessibleAnnouncementPriority.MEDIUM]]);
                    // An empty string is a `Gtk.Label` passing between two values.
                    label.label = '';
                    expect(seen.length).toBe(1);
                });
            });

            await it('announces a change the APPLICATION made, which is the only one that matters', async () => {
                // THE VECTOR THAT NEARLY WAS NOT WRITTEN. The one above changes the
                // label from OUTSIDE React, and a live region exists for the opposite
                // case: the application re-renders `<Text>{status}</Text>` and the user
                // is told. The host suppresses a `notify::` raised by its OWN property
                // write (`inHostWrite()` in `signals.ts` — what stops a controlled
                // `<TextInput>` re-entering `onChangeText`), so "it fires on an external
                // write" says nothing whatever about the path the prop is for.
                const seen: string[] = [];
                const container = new Gtk.Box();
                const root = createRoot(container);
                try {
                    root.render(createElement(Text, { accessibilityLiveRegion: 'polite' }, 'first'));
                    const label = gtkChildren(container)[0] as Gtk.Label;
                    (label as unknown as Record<string, unknown>).announce = (message: string) => seen.push(message);
                    flushSync(() => root.render(createElement(Text, { accessibilityLiveRegion: 'polite' }, 'second')));
                    expect(seen).toStrictEqual(['second']);
                } finally {
                    root.unmount();
                }
            });

            await it('subscribes to nothing without the prop, and disconnects on unmount', async () => {
                // The `pressWatchCount` shape, for the same reason: a `<Text>` with no
                // live region and one with `"none"` render identically to one that has
                // it, and only a COUNT tells them apart — so a subscription that leaked
                // onto every label in an application would be invisible. The unmount
                // half matters on its own: GJS blocks a JS callback during the sweeping
                // phase of GC, so a handler left connected is one connected for the
                // life of the process.
                const before = liveRegionWatchCount();
                mounted(createElement(Text, null, 'plain'), () => expect(liveRegionWatchCount()).toBe(before));
                mounted(createElement(Text, { accessibilityLiveRegion: 'none' }, 'quiet'), () =>
                    expect(liveRegionWatchCount()).toBe(before),
                );
                mounted(createElement(Text, { accessibilityLiveRegion: 'polite' }, 'loud'), () =>
                    expect(liveRegionWatchCount()).toBe(before + 1),
                );
                expect(liveRegionWatchCount()).toBe(before);
            });

            await it('announces nothing for accessibilityLiveRegion="none"', async () => {
                const seen: unknown[] = [];
                mounted(createElement(Text, { accessibilityLiveRegion: 'none' }, 'first'), (container) => {
                    const label = gtkChildren(container)[0] as Gtk.Label;
                    (label as unknown as Record<string, unknown>).announce = () => seen.push(1);
                    label.label = 'second';
                    expect(seen).toStrictEqual([]);
                });
            });

            await it('maps every accessibilityRole onto a role the installed GTK carries', async () => {
                // THE MECHANISM, not another example. A misspelled nick resolves
                // perfectly in the table and fails in a consumer's window — the
                // exact class this whole spec file exists for — and one vector per
                // role would still miss the 34th somebody adds. So the assertion is
                // over the TABLE: every value it maps to must be a real member of
                // `Gtk.AccessibleRole` on the GTK that is installed.
                const route = PRIMITIVES.View?.props.accessibilityRole as { map: Record<string, string> };
                const roles = Gtk.AccessibleRole as unknown as Record<string, number | undefined>;
                const unresolved = Object.entries(route.map)
                    .filter(([, nick]) => roles[nick.toUpperCase().replace(/-/g, '_')] === undefined)
                    .map(([name, nick]) => `${name} → ${nick}`);
                expect(unresolved).toStrictEqual([]);
                // …and the table is not empty, which is what makes the line above an
                // assertion rather than a loop over nothing.
                expect(Object.keys(route.map).length).toBeGreaterThan(30);
            });

            await it('puts accessibilityLabel and accessibilityHint into the widget’s AT context', async () => {
                // NOT a setter echo, and that is the whole point of using these
                // functions. `Gtk.test_accessible_has_property` reads the widget's
                // `GtkATContext` — the thing an AT-SPI client would read — so it
                // answers "GTK recorded this", where shadowing `update_property`
                // would only answer "our code called it".
                //
                // WHAT IT DOES NOT PROVE IS THE VALUE, and no in-process call does:
                // `gtk_test_accessible_check_property` is `introspectable="0"` in
                // the GIR (varargs), `Gtk.ATContext` exposes no reader, and there is
                // no public getter. The gate is what makes presence meaningful —
                // MEASURED: a write with the WRONG GValue type still makes
                // `has_property` answer true, and only the GLib critical it raises
                // tells the two apart. Presence plus zero diagnostics is the pair;
                // the value itself is AT-SPI's to report, and CI runs with
                // `GTK_A11Y=none`.
                mounted(
                    createElement(View, { accessibilityLabel: 'Save document', accessibilityHint: 'Opens the editor' }),
                    (container) => {
                        const box = withAtContext(gtkChildren(container)[0] as Gtk.Widget);
                        expect(Gtk.test_accessible_has_property(box, Gtk.AccessibleProperty.LABEL)).toBe(true);
                        expect(Gtk.test_accessible_has_property(box, Gtk.AccessibleProperty.HELP_TEXT)).toBe(true);
                        // DESCRIPTION is `<Image alt>`'s attribute and nothing here
                        // authored it — the two props stay apart on the real widget.
                        expect(Gtk.test_accessible_has_property(box, Gtk.AccessibleProperty.DESCRIPTION)).toBe(false);
                    },
                );
            });

            await it('sets no accessible property when no accessibility prop was authored', async () => {
                // The red half: without it, a vector that asserted `true` above
                // would pass against a GTK that sets LABEL on every widget itself.
                mounted(createElement(View, {}), (container) => {
                    const box = gtkChildren(container)[0] as Gtk.Widget;
                    expect(Gtk.test_accessible_has_property(box, Gtk.AccessibleProperty.LABEL)).toBe(false);
                    expect(Gtk.test_accessible_has_property(box, Gtk.AccessibleProperty.HELP_TEXT)).toBe(false);
                });
            });

            await it('writes accessibilityRole onto the real widget, which read-write proves', async () => {
                // `accessible-role` is the prop the received wisdom says cannot be
                // set after construction. `has_role` is a VALUE check rather than a
                // presence check, so this vector reads the role back.
                mounted(createElement(View, { accessibilityRole: 'button' }), (container) => {
                    const box = gtkChildren(container)[0] as Gtk.Widget;
                    expect(Gtk.test_accessible_has_role(box, Gtk.AccessibleRole.BUTTON)).toBe(true);
                    expect(box.get_accessible_role()).toBe(Gtk.AccessibleRole.BUTTON);
                });
                // …and a plain `<View>` is the GENERIC a `Gtk.Box` reports, so the
                // vector above is measuring the prop and not GTK's default.
                mounted(createElement(View, {}), (container) => {
                    expect((gtkChildren(container)[0] as Gtk.Widget).get_accessible_role()).toBe(
                        Gtk.AccessibleRole.GENERIC,
                    );
                });
            });

            await it('keeps a wrapping View out of GTK’s grid role', async () => {
                // `flex-wrap` swaps the `Gtk.Box` for a `Gtk.FlowBox`, whose own
                // default role is GRID (measured) — so a swap made for a STYLING
                // reason changed what the element is to a screen reader. The table
                // corrects it beside the other two FlowBox corrections.
                mounted(createElement(View, { className: 'flex-wrap' }), (container) => {
                    const wrapper = gtkChildren(container)[0] as Gtk.Widget;
                    expect(typeOf(wrapper)).toBe('GtkFlowBox');
                    expect(wrapper.get_accessible_role()).toBe(Gtk.AccessibleRole.GENERIC);
                });
            });

            await it('puts each accessibilityState key into the AT context, with no diagnostic', async () => {
                // The GValue type per state is measured, and a wrong one is a GLib
                // critical that leaves the attribute set anyway — so `gated`'s
                // `assertQuiet` is doing half the work of this vector. `checked:
                // "mixed"` is the tri-state, which is the case a boolean GValue
                // would have raised on.
                mounted(
                    createElement(View, {
                        accessibilityState: { disabled: true, busy: false, checked: 'mixed', selected: true },
                    }),
                    (container) => {
                        const box = withAtContext(gtkChildren(container)[0] as Gtk.Widget);
                        for (const state of [
                            Gtk.AccessibleState.DISABLED,
                            Gtk.AccessibleState.BUSY,
                            Gtk.AccessibleState.CHECKED,
                            Gtk.AccessibleState.SELECTED,
                        ]) {
                            expect(Gtk.test_accessible_has_state(box, state)).toBe(true);
                        }
                        expect(Gtk.test_accessible_has_state(box, Gtk.AccessibleState.EXPANDED)).toBe(false);
                    },
                );
            });

            await it('carries the accessibility props on a Pressable and a Text too', async () => {
                // They are in the COMMON set, so the interesting claim is that the
                // widget under each primitive really implements `Gtk.Accessible` —
                // a `Gtk.Button` and a `Gtk.Label` are different GTypes.
                mounted(
                    createElement(Pressable, { accessibilityLabel: 'Play', accessibilityRole: 'button' }),
                    (container) => {
                        const button = withAtContext(gtkChildren(container)[0] as Gtk.Widget);
                        expect(Gtk.test_accessible_has_property(button, Gtk.AccessibleProperty.LABEL)).toBe(true);
                        expect(Gtk.test_accessible_has_role(button, Gtk.AccessibleRole.BUTTON)).toBe(true);
                    },
                );
                mounted(createElement(Text, { accessibilityLabel: 'Heading' }, 'Title'), (container) => {
                    const label = gtkChildren(container)[0] as Gtk.Widget;
                    expect(Gtk.test_accessible_has_property(label, Gtk.AccessibleProperty.LABEL)).toBe(true);
                });
            });

            await it('clears an accessible property when the prop goes away', async () => {
                // GTK has no "unset" other than `reset_property`, so a label removed
                // between two renders would otherwise be spoken forever. The effect's
                // cleanup is what resets it, which only a re-render can exercise.
                const container = new Gtk.Box();
                const root = createRoot(container);
                try {
                    root.render(createElement(View, { accessibilityLabel: 'first' }));
                    const box = withAtContext(gtkChildren(container)[0] as Gtk.Widget);
                    expect(Gtk.test_accessible_has_property(box, Gtk.AccessibleProperty.LABEL)).toBe(true);
                    flushSync(() => root.render(createElement(View, {})));
                    expect(Gtk.test_accessible_has_property(box, Gtk.AccessibleProperty.LABEL)).toBe(false);
                } finally {
                    root.unmount();
                }
            });

            await it('renders a TextInput carrying the three props a desktop has no service for', async () => {
                // Before they were table rows these threw "is not a prop this primitive
                // answers for" — a build error on ordinary React Native code, decided
                // again in every consumer's own shim.
                mounted(
                    createElement(TextInput, {
                        value: 'a',
                        autoComplete: 'email',
                        textContentType: 'emailAddress',
                        submitBehavior: 'submit',
                    }),
                    (container) => {
                        const entry = gtkChildren(container)[0] as Gtk.Entry;
                        expect(typeOf(entry)).toBe('GtkEntry');
                        expect(entry.text).toBe('a');
                    },
                );
            });

            await it('renders a multiline TextInput as a Gtk.TextView that wraps', async () => {
                mounted(createElement(TextInput, { multiline: true }), (container) => {
                    const view = gtkChildren(container)[0] as Gtk.TextView;
                    expect(typeOf(view)).toBe('GtkTextView');
                    expect(view.wrapMode).toBe(Gtk.WrapMode.WORD_CHAR);
                });
            });

            await it('renders a Switch whose flip reaches onValueChange with the new value', async () => {
                const seen: unknown[] = [];
                mounted(
                    createElement(Switch, { value: false, onValueChange: (v: boolean) => seen.push(v) }),
                    (container) => {
                        const toggle = gtkChildren(container)[0] as Gtk.Switch;
                        expect(typeOf(toggle)).toBe('GtkSwitch');
                        expect(toggle.active).toBe(false);
                        toggle.active = true;
                        expect(seen).toStrictEqual([true]);
                    },
                );
            });

            await it('renders an ActivityIndicator as a sized Adw.Spinner', async () => {
                mounted(createElement(ActivityIndicator, { size: 'small' }), (container) => {
                    const spinner = gtkChildren(container)[0];
                    expect(typeOf(spinner)).toBe('AdwSpinner');
                    expect(spinner.widthRequest).toBe(16);
                    expect(spinner.heightRequest).toBe(16);
                });
            });
        });

        await gated('the P2 widgets, in a real tree', async () => {
            await it('renders an Image as a Gtk.Picture that FILLS, with the file GTK will open', async () => {
                // A path that does not exist is deliberate and safe: MEASURED, setting
                // `Gtk.Picture:file` to a missing file stores the file, leaves
                // `paintable` null and produces NO diagnostic — so this vector asserts
                // the plumbing without asserting that any image exists on the machine
                // running the suite, which would be a claim about the host and not the
                // code.
                mounted(
                    createElement(Image, { source: { uri: '/nonexistent-gjsify-vector.png' }, alt: 'a picture' }),
                    (container) => {
                        const picture = gtkChildren(container)[0] as Gtk.Picture;
                        expect(typeOf(picture)).toBe('GtkPicture');
                        expect(picture.contentFit).toBe(Gtk.ContentFit.COVER);
                        expect(picture.file?.get_path()).toBe('/nonexistent-gjsify-vector.png');
                        expect(picture.alternativeText).toBe('a picture');
                    },
                );
            });

            await it('maps every resizeMode this GTK has a member for', async () => {
                const expected: [ImageProps['resizeMode'], Gtk.ContentFit][] = [
                    ['cover', Gtk.ContentFit.COVER],
                    ['contain', Gtk.ContentFit.CONTAIN],
                    ['stretch', Gtk.ContentFit.FILL],
                    ['center', Gtk.ContentFit.SCALE_DOWN],
                ];
                for (const [mode, fit] of expected) {
                    mounted(createElement(Image, { resizeMode: mode }), (container) => {
                        expect((gtkChildren(container)[0] as Gtk.Picture).contentFit).toBe(fit);
                    });
                }
            });

            await it('puts an ImageBackground’s picture BEHIND its children, not over them', async () => {
                mounted(
                    createElement(
                        ImageBackground,
                        { source: { uri: '/nonexistent-gjsify-vector.png' }, className: 'p-2' },
                        createElement(Text, null, 'over the picture'),
                    ),
                    (container) => {
                        const overlay = gtkChildren(container)[0] as Gtk.Overlay;
                        expect(typeOf(overlay)).toBe('GtkOverlay');
                        // `get_child()` is the MAIN child, which a `Gtk.Overlay` paints
                        // UNDER every overlay child — so the picture being here is the
                        // whole of "behind".
                        const picture = overlay.get_child() as Gtk.Picture;
                        expect(typeOf(picture)).toBe('GtkPicture');
                        expect(picture.file?.get_path()).toBe('/nonexistent-gjsify-vector.png');
                        const box = gtkChildren(overlay).find((child) => child !== picture) as Gtk.Box;
                        expect(typeOf(box)).toBe('GtkBox');
                        expect(gtkChildren(box).map((child) => (child as Gtk.Label).label)).toStrictEqual([
                            'over the picture',
                        ]);
                        // The padding stayed on the overlay, which is what insets the
                        // children rather than the picture.
                        expect(generatedClasses(overlay).length).toBe(1);
                    },
                );
            });

            await it('renders the Touchable family over Pressable’s own widget', async () => {
                let pressed = 0;
                mounted(createElement(TouchableOpacity, { onPress: () => (pressed += 1) }, 'Go'), (container) => {
                    const button = gtkChildren(container)[0] as Gtk.Button;
                    expect(typeOf(button)).toBe('GtkButton');
                    expect([...button.cssClasses]).toContain('flat');
                    button.emit('clicked');
                    expect(pressed).toBe(1);
                });
            });

            await it('gives TouchableWithoutFeedback a real Gtk.GestureClick and takes it away again', async () => {
                let pressed = 0;
                const container = new Gtk.Box();
                const root = createRoot(container);
                try {
                    root.render(
                        createElement(
                            TouchableWithoutFeedback,
                            { onPress: () => (pressed += 1) },
                            createElement(Text, null, 'target'),
                        ),
                    );
                    const box = gtkChildren(container)[0] as Gtk.Box;
                    expect(typeOf(box)).toBe('GtkBox');
                    const controllers = box.observe_controllers();
                    expect(controllers.get_n_items()).toBe(1);
                    const gesture = controllers.get_item(0) as Gtk.GestureClick;
                    expect(typeOf(gesture as unknown as Gtk.Widget)).toBe('GtkGestureClick');
                    gesture.emit('released', 1, 0, 0);
                    expect(pressed).toBe(1);
                    // The controller is REMOVED on unmount. A controller left on a
                    // widget outlives every JS reference to it, and its handler is then
                    // one of the callbacks GJS blocks during GC.
                    root.render(null);
                    expect(controllers.get_n_items()).toBe(0);
                } finally {
                    root.unmount();
                }
            });

            await it('renders a Button as a FRAMED Gtk.Button, which is the opposite of Pressable', async () => {
                let pressed = 0;
                mounted(createElement(Button, { title: 'Send', onPress: () => (pressed += 1) }), (container) => {
                    const button = gtkChildren(container)[0] as Gtk.Button;
                    expect(typeOf(button)).toBe('GtkButton');
                    expect(button.label).toBe('Send');
                    expect([...button.cssClasses]).not.toContain('flat');
                    button.emit('clicked');
                    expect(pressed).toBe(1);
                });
            });

            await it('lays SafeAreaView and KeyboardAvoidingView out, which is what keeps them no-ops', async () => {
                for (const Component of [SafeAreaView, KeyboardAvoidingView]) {
                    mounted(
                        createElement(
                            Component,
                            { className: 'flex-row items-center' },
                            createElement(Text, null, 'a'),
                        ),
                        (container) => {
                            const box = gtkChildren(container)[0] as Gtk.Box;
                            expect(typeOf(box)).toBe('GtkBox');
                            expect(box.orientation).toBe(Gtk.Orientation.HORIZONTAL);
                            const label = gtkChildren(box)[0] as Gtk.Label;
                            expect(label.label).toBe('a');
                            expect(label.valign).toBe(Gtk.Align.CENTER);
                        },
                    );
                }
            });

            await it('renders a StatusBar as NO widget at all', async () => {
                mounted(
                    createElement(
                        View,
                        null,
                        createElement(StatusBar, { barStyle: 'light-content' }),
                        createElement(Text, null, 'body'),
                    ),
                    (container) => {
                        const box = gtkChildren(container)[0] as Gtk.Box;
                        // One child, not two: a status bar that rendered a box would
                        // take a row of the column on every ported screen.
                        expect(gtkChildren(box).map(typeOf)).toStrictEqual(['GtkLabel']);
                    },
                );
            });
        });

        await gated('<Modal>, the one primitive whose host node is not its parent node', async () => {
            await it('presents into the window and puts NOTHING in the parent box', async () => {
                // The two halves of the seam, in one tree. The append this replaces
                // is `g_error()` on exactly this shape — a rooted box — so "the box
                // is empty" is the assertion that says the abort is unreachable
                // rather than merely untriggered.
                configureStyle({ tokens: TOKENS });
                mountedInWindow(
                    createElement(Modal, {}, createElement(Text, {}, 'in the sheet')),
                    ({ container, window }) => {
                        expect(gtkChildren(container).length).toBe(0);
                        const dialog = window.visibleDialog;
                        expect(dialog !== null).toBe(true);
                        expect(typeOf(dialog as unknown as Gtk.Widget)).toBe('AdwDialog');
                        // The children went through the implicit content box, which is
                        // what makes two of them legal.
                        const content = (dialog as Adw.Dialog).get_child() as Gtk.Box;
                        expect(typeOf(content)).toBe('GtkBox');
                        expect((gtkChildren(content)[0] as Gtk.Label).label).toBe('in the sheet');
                    },
                );
            });

            await it('holds several children, which one Adw.Dialog slot could not', async () => {
                configureStyle({ tokens: TOKENS });
                mountedInWindow(
                    createElement(
                        Modal,
                        {},
                        createElement(Text, { key: 'a' }, 'first'),
                        createElement(Text, { key: 'b' }, 'second'),
                    ),
                    ({ window }) => {
                        const content = (window.visibleDialog as Adw.Dialog).get_child() as Gtk.Box;
                        expect(gtkChildren(content).map((w) => (w as Gtk.Label).label)).toStrictEqual([
                            'first',
                            'second',
                        ]);
                    },
                );
            });

            await it('closes when visible goes false, and comes back when it goes true', async () => {
                configureStyle({ tokens: TOKENS });
                const tree = (visible: boolean): ReactNode =>
                    createElement(Modal, { visible }, createElement(Text, {}, 'sheet'));
                mountedInWindow(tree(true), ({ window, renderAgain }) => {
                    expect(window.visibleDialog !== null).toBe(true);
                    renderAgain(tree(false));
                    // `can-close: false` is on the dialog, so this only works because
                    // the host's portal placement calls the FORCED close. With
                    // `close()` the sheet would still be up and this line would read
                    // the same dialog back.
                    expect(window.visibleDialog).toBe(null);
                    renderAgain(tree(true));
                    expect(window.visibleDialog !== null).toBe(true);
                });
            });

            await it('does not shift the siblings it is rendered between', async () => {
                configureStyle({ tokens: TOKENS });
                mountedInWindow(
                    createElement(
                        Fragment,
                        {},
                        createElement(Text, { key: 'a' }, 'above'),
                        createElement(Modal, { key: 'm' }, createElement(Text, {}, 'sheet')),
                        createElement(Text, { key: 'b' }, 'below'),
                    ),
                    ({ container, window }) => {
                        expect(gtkChildren(container).map((w) => (w as Gtk.Label).label)).toStrictEqual([
                            'above',
                            'below',
                        ]);
                        expect(window.visibleDialog !== null).toBe(true);
                    },
                );
            });

            await it('refuses a layout utility on the dialog, naming the primitive', async () => {
                // An `Adw.Dialog` installs no `orientation` and no `spacing`, so
                // `items-center` on a `<Modal>` has nowhere to land. A silent drop
                // here is the failure this layer exists to remove; the fix is a
                // `<View>` inside the modal, which the message says.
                configureStyle({ tokens: TOKENS });
                let caught: unknown;
                try {
                    mountedInWindow(createElement(Modal, { className: 'items-center' }), () => {});
                } catch (error) {
                    caught = error;
                }
                expect(caught instanceof PrimitiveError).toBe(true);
                expect(String(caught)).toContain('Modal');
            });
        });

        await gated('the press state, and the cheap path it must not cost', async () => {
            await it('resolves active:* to CSS and subscribes to NOTHING', async () => {
                // ADR 0032 § 7's whole claim, as a measurement rather than a comment.
                // Both spellings render a flat button that dims when pressed; only the
                // subscription count says which one round-trips through React.
                const sheet = new GeneratedStyleSheet();
                configureStyle({ tokens: TOKENS, sheet });
                const before = pressWatchCount();
                mounted(createElement(Pressable, { className: 'active:opacity-70' }, 'Go'), (container) => {
                    expect(typeOf(gtkChildren(container)[0])).toBe('GtkButton');
                    expect(pressWatchCount()).toBe(before);
                    expect(sheet.toString()).toContain(':active');
                    expect(sheet.toString()).toContain('opacity: 0.7');
                });
                expect(pressWatchCount()).toBe(before);
            });

            await it('gives a function child the real press state, and lets go of it on unmount', async () => {
                configureStyle({ tokens: TOKENS });
                const before = pressWatchCount();
                const container = new Gtk.Box();
                const root = createRoot(container);
                try {
                    // The function goes through the `children` PROP, not through
                    // `createElement`'s variadic children — whose declared type is
                    // `ReactNode` and rightly excludes a function. JSX resolves
                    // `<Pressable>{fn}</Pressable>` against the component's own
                    // `children` type, so an application writes the ordinary spelling.
                    root.render(
                        createElement(Pressable, {
                            children: ({ pressed }: PressableState) =>
                                createElement(Text, null, pressed ? 'down' : 'up'),
                        }),
                    );
                    const button = gtkChildren(container)[0] as Gtk.Button;
                    const label = () => (gtkChildren(button)[0] as Gtk.Label).label;
                    expect(label()).toBe('up');
                    expect(pressWatchCount()).toBe(before + 1);

                    // `set_state_flags` rather than a synthetic click: MEASURED, it
                    // emits `state-flags-changed` (128 → 129) and `get_state_flags()`
                    // answers the new flags, which is the mechanism — and it asserts
                    // nothing about an input device the machine running the suite may
                    // not have.
                    //
                    // `flushSync` because the default lane is concurrent: a `setState`
                    // from a GTK signal handler commits on a LATER main-loop iteration
                    // (the host's own `resolveUpdatePriority`), and a spec has no loop.
                    flushSync(() => button.set_state_flags(Gtk.StateFlags.ACTIVE, false));
                    expect(label()).toBe('down');
                    flushSync(() => button.unset_state_flags(Gtk.StateFlags.ACTIVE));
                    expect(label()).toBe('up');
                } finally {
                    root.unmount();
                }
                expect(pressWatchCount()).toBe(before);
            });

            await it('gives useWindowDimensions the WINDOW’s size, not the surface’s', async () => {
                // The one vector that needs a window, so it builds one and never
                // presents it. Measured: a presented 640×480 window has a 668×509
                // surface (the CSD shadow), and React Native's number is the window's —
                // so a hook that reported the surface would be wrong by the shadow on
                // every desktop with client-side decorations.
                configureStyle({ tokens: TOKENS });
                resetWindowMetricsCache();
                const window = new Gtk.Window({ defaultWidth: 643, defaultHeight: 483 });
                const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
                window.set_child(container);
                const root = createRoot(container);
                const Size = (): ReactNode => {
                    const size = useWindowDimensions();
                    return createElement(Text, null, `${size.width}x${size.height}`);
                };
                try {
                    root.render(createElement(Size));
                    expect((gtkChildren(container)[0] as Gtk.Label).label).toBe('643x483');
                } finally {
                    root.unmount();
                    window.destroy();
                    resetWindowMetricsCache();
                }
            });

            await it('reads hairlineWidth as one device pixel, without asserting the device', async () => {
                // The RELATIONSHIP, never the number: the scale of this machine's
                // monitors is a fact about the machine, and a vector that asserted 1
                // would be red on a HiDPI laptop and green here for the wrong reason.
                const width = StyleSheet.hairlineWidth;
                expect(width > 0).toBe(true);
                expect(width <= 1).toBe(true);
                const monitors = Gdk.Display.get_default()!.get_monitors();
                let smallest = 0;
                for (let index = 0; index < monitors.get_n_items(); index++) {
                    const monitor = monitors.get_item(index) as Gdk.Monitor;
                    const scale = monitor.get_scale() > 0 ? monitor.get_scale() : monitor.get_scale_factor();
                    if (smallest === 0 || scale < smallest) smallest = scale;
                }
                expect(width).toBe(smallest === 0 ? 1 : 1 / smallest);
            });
        });
    });
};
