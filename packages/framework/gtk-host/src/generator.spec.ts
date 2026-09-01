// The generator, against the vocabulary it is generated from and the table it emits.
//
// There is no GIR reader here any more (ADR 0029): the widget vocabulary arrives as
// `@girs/<ns>/vocabulary`, read once by ts-for-gir, so this package stopped being the
// second reader of a 6.2 MB XML. What is left to check is not a parse but a CONTRACT,
// and it runs in two directions:
//
//  - THE INPUT. Every fact the generator relies on is a promise `@girs` makes: that
//    the keys of `DECLS` are classes that can actually be instantiated, that a
//    property reached only through an implemented interface or an ancestor is
//    findable, that nicks arrive as GObject registered them, that read-only
//    properties are already gone. Broken, each of these still yields a surface that
//    LOOKS right — which is the property a silent failure needs, and the reason these
//    are asserted here rather than assumed of a dependency.
//  - THE OUTPUT AGAINST THAT INPUT. `generated/surface-data.mts` is committed and no
//    CI leg re-runs the generator (ADR 0028 § Implementation), so the claim that the
//    artefact was built from THIS vocabulary and lost nothing in translation has no
//    other checker.
//
// The third question — whether the GTK actually installed agrees with the committed
// artefact — is `generated.spec.ts`, and stays there.
//
// The gates keep their five-row fixture. They are about the gates rather than about
// where the rows came from, and a two-widget namespace is what lets G4's floor be
// reached at all.

import { expect, it, on } from '@gjsify/unit';

import { GTK_HOSTS } from './testing/gate.mjs';

import { emitWidgets, type GateFailure, type WidgetRow } from './generator/emit.mjs';
import { volarResolves } from './generator/emit-types.mjs';
import { readDeclaredInterfaces, readNamespaceImports } from './generator/vocabulary-dts.mjs';
// STATIC, and both halves of that were earned.
//
// On `--app node` the bundler redirects the whole `@girs/*` scope to an empty module,
// which turns a static import of this subpath into six MISSING_EXPORTs before anything
// runs. `gjs-imports-empty.ts` carves the `/vocabulary` subpath out of that redirect —
// the data has no `gi://` in it and loads under plain Node — and the carve-out was
// briefly believed not to work: `node_modules/.bin/gjsify` execs
// `packages/infra/cli/dist/cli.gjs.mjs`, a BUNDLE with the plugin inlined, so a probe
// added to the plugin source runs nowhere until that bundle is rebuilt. A/B with the
// bundle rebuilt both ways: carve-out in, `build:test:node` exit 0; carve-out out, exit
// 1 with exactly the six MISSING_EXPORTs. It is load-bearing and it takes effect.
//
// Static rather than a module-scope `await import(…)`, which is a different hazard and
// not a hypothetical: as top-level await this file took the GJS leg from ~2 minutes to
// over five hours at 91% CPU with no output — a hang CI would have reported as a
// timeout with nothing to read.
import {
    DECLS as VOCABULARY_DECLS,
    ENUM_NICKS as VOCABULARY_ENUM_NICKS,
    OWN_PROPS as VOCABULARY_OWN_PROPS,
    OWN_SIGNALS as VOCABULARY_OWN_SIGNALS,
    PROVENANCE as VOCABULARY_PROVENANCE,
    SINCE as VOCABULARY_SINCE,
} from '@girs/gtk-4.0/vocabulary';

import { DECLS, ENUM_NICKS, OWN_PROPS, OWN_SIGNALS, SINCE, TAGS } from './generated/surface-data.mjs';
import type { AdwPreferencesPageProps, GtkEntryProps, GtkWidgetProps } from './generated/props.js';
import { assertInjective, tagOf } from './tags.js';
import type { WidgetDescriptor } from './types.js';

/** Just enough of a descriptor for the gates, which read `gtype` and `children`. */
const fake = (gtype: string, children: WidgetDescriptor['children']): WidgetDescriptor => ({
    gtype,
    ctor: (() => {
        throw new Error('never called by a gate');
    }) as unknown as WidgetDescriptor['ctor'],
    children,
});

// A namespace small enough to reason about. Written out rather than parsed: the rows
// a table emitter takes are three strings, so a fixture that had to be READ out of
// something was only ever the GIR reader's shadow.
const MINI_ROWS: readonly WidgetRow[] = [
    { gtype: 'MiniBox', namespace: 'Mini', name: 'Box' },
    { gtype: 'MiniGLThing', namespace: 'Mini', name: 'GLThing' },
];

// G1 asks a GTYPE SET, not the widget rows: a curated descriptor may legitimately
// name an abstract class or an interface as a mount container, and a widget-only set
// would report every one of those as missing.
const MINI_GTYPES = new Set([...MINI_ROWS.map((r) => r.gtype), 'MiniWidget', 'MiniOrientable', 'MiniNotAWidget']);

const MINI_MODULES = { Mini: 'gi://Mini?version=1.0' } as const;

// A vocabulary `.d.ts` in miniature — every shape whose MISREADING is silent.
//
// A regex over TypeScript returns fewer names, never an error, so each of these has to
// be pinned against a literal: the real `@girs` file stops exhibiting a shape the moment
// upstream's emitter changes, and a regression test that reads the installed package
// proves only what that package happens to contain today. Three of the eight below have
// already shipped a defect (`\s*` before the brace, the single-line comment terminator,
// and doc adjacency); the rest are the neighbours found while fixing them.
const DTS_FIXTURE = `
import type GLib from '@girs/glib-2.0';
import type Mini from './mini-1.0.js';

/** A miniature widget. */
export interface MiniBoxProps extends MiniWidgetProps, MiniOrientableProps {
    /**
     * A documented property.
     * @since 1.2
     * @default 0
     */
    'baseline-child'?: number;
    /** A one-line comment, whose terminator must not survive into the emitter. */
    label?: string;
    undocumented?: Mini.Thing | null;
    /** @default FALSE */
    homogeneous?: boolean;
    layout?: { readonly rows: number; readonly cols: number };
    /** @deprecated */
    legacy?: GLib.Variant;
}

export interface MiniRootProps {
    rooted?: string;
}

export interface MiniWrappedProps
    extends MiniWidgetProps,
        MiniOrientableProps {
    wrapped?: string;
}
`;

const emitFixture = (curated: readonly WidgetDescriptor[], floor = 2) =>
    emitWidgets(
        { provenance: 'Mini-1.0', knownGTypes: MINI_GTYPES, widgets: MINI_ROWS, curated, modules: MINI_MODULES },
        floor,
    );

// The half of the vocabulary that lives in its `.d.ts` and in no runtime value: the
// RENDERED TypeScript of each property. `gjsify tsc` is what holds these two literals
// — the runner only proves they were reached — and each key is a case the GIR route
// used to get wrong in a way that compiled anyway.
const widgetProps: GtkWidgetProps = {
    // `<property name="css-classes"><array><type name="utf8"/></array>` is `string[]`,
    // and a reader that asked for a DESCENDANT `<type>` answered `string`. Both
    // spellings, because the surface offers both and only one of them is checked in
    // JSX (a hyphenated attribute is exempt from excess-property checking, so the
    // value check on a declared key is all it can ever get).
    'css-classes': ['card'],
    cssClasses: ['card'],
    // An enum PROPERTY takes the nick, because the host resolves it (`coerce()`) —
    // GObject would otherwise keep the old value with no diagnostic at all.
    halign: 'baseline-fill',
};
// A base emitted as `Omit<GtkWidgetProps, 'name'>`, which is the only repair for an
// inherited member the vocabulary made incompatible — a local redeclaration turns TS2430
// into a different error rather than fixing it. `AdwPreferencesPage:name` is GIR-nullable
// and `GtkWidget:name` is not; with the omission unwired, @girs 4.5.0 made the whole
// generated surface uncompilable and `check-type-surfaces` reported nine problems from
// this one property. `null` here is what needs the `Omit` — assign a plain string and the
// literal compiles either way.
const preferencesPageProps: AdwPreferencesPageProps = { name: null };
const entryProps: GtkEntryProps = {
    // FLAGS ARE `number`, mirroring the runtime exactly: the host REFUSES a nick
    // string for a flags property by name (`err.badFlags`), because resolving a nick
    // set is not something GObject exposes. A union here would type-check what the
    // host rejects.
    'input-hints': 0x2,
};

export default async () => {
    await on(GTK_HOSTS, async () => {
        await it('reads a vocabulary .d.ts in every shape whose misreading is silent', async () => {
            const declared = readDeclaredInterfaces(DTS_FIXTURE);
            expect([...declared.keys()]).toStrictEqual(['MiniBox', 'MiniRoot', 'MiniWrapped']);

            // `\s*` BEFORE THE BRACE. `[^{]*` swallows the space only when `extends` is
            // present, so `MiniRoot` — declared without one — was invisible, and with it
            // every extends-less interface of the real vocabularies: measured on @girs
            // 4.5.0, 13 of 191. The same missing `\s*` was still live in
            // `scripts/check-adwaita-element-properties.mjs`, where it read the
            // generated surface instead and hid 25.
            expect([...(declared.get('MiniRoot')?.props.keys() ?? [])]).toStrictEqual(['rooted']);
            // And `\s`, not a literal space: the emitter wraps a long heritage list.
            expect([...(declared.get('MiniWrapped')?.props.keys() ?? [])]).toStrictEqual(['wrapped']);

            const box = declared.get('MiniBox');
            // The INTERFACE's own blurb. Reading it is what a published type surface is
            // for (ADR 0028 § 6), and leaving it unread took 194 of 197 comments out of
            // `generated/props.ts` while the input still carried every one.
            expect(box?.doc).toBe('A miniature widget.');
            // Brace-MATCHED: a nested object type contains a closing brace of its own,
            // and a reader that stops at the first one truncates the interface there.
            expect([...(box?.props.keys() ?? [])]).toStrictEqual([
                'baseline-child',
                'label',
                'undocumented',
                'homogeneous',
                'layout',
                'legacy',
            ]);
            expect(box?.props.get('layout')?.ts).toBe('{ readonly rows: number; readonly cols: number }');

            const documented = box?.props.get('baseline-child');
            expect(documented?.doc).toBe('A documented property.');
            expect(documented?.since).toBe('1.2');
            expect(documented?.deprecated).toBe(false);

            // A SINGLE-LINE comment. Stripping the delimiters per line leaves the
            // terminator attached, the emitter then closes it a second time, and
            // `gjsify format` rejects the result as a syntax error.
            expect(box?.props.get('label')?.doc).toBe(
                'A one-line comment, whose terminator must not survive into the emitter.',
            );
            // Tag-only comments carry no prose.
            expect(box?.props.get('homogeneous')?.doc).toBe(undefined);
            expect(box?.props.get('legacy')?.deprecated).toBe(true);

            // ADJACENCY, and `undocumented` sits directly after a member with PROSE on
            // purpose: `lastIndexOf` finds the nearest block ANYWHERE above, so a member
            // with no JSDoc took its predecessor's, and `GtkTreeView.model` shipped
            // documented as "Extra indentation for each level." A first draft of this
            // fixture put it after the tag-only comment instead, where both readings
            // give `undefined` and the vector proved nothing — measured, the reverted
            // rule passed it.
            expect(box?.props.get('undocumented')?.doc).toBe(undefined);

            // The namespace imports, which the source list cannot answer: a Gtk property
            // whose rendered type names `Gdk.RGBA` needs the Gdk import from the
            // vocabulary's own header, or the emitted file is TS2503. A relative
            // specifier is the vocabulary's own package.
            expect([...readNamespaceImports(DTS_FIXTURE, 'mini-1.0')]).toStrictEqual([
                ['GLib', '@girs/glib-2.0'],
                ['Mini', '@girs/mini-1.0'],
            ]);
        });

        await it('states the namespace, version and library it was generated against', async () => {
            // `main.mts` builds the artefact's provenance line out of these three
            // fields, and `generated.spec.ts` parses it back with `^(\w+)-[\d.]+\/([\d.]+)$`
            // to decide whether a class the installed GTK lacks is a defect or a
            // version gap. Nothing else holds those two ends together.
            expect(VOCABULARY_PROVENANCE.namespace).toBe('Gtk');
            expect(VOCABULARY_PROVENANCE.version).toBe('4.0');
            expect(typeof VOCABULARY_PROVENANCE.libraryVersion).toBe('string');
            const line = `${VOCABULARY_PROVENANCE.namespace}-${VOCABULARY_PROVENANCE.version}/${VOCABULARY_PROVENANCE.libraryVersion}`;
            expect(/^(\w+)-[\d.]+\/([\d.]+)$/.test(line)).toBe(true);
        });

        await it('keys its widget rows on classes that can be instantiated', async () => {
            // The generator turns `Object.keys(DECLS)` into tags. Taking `OWN_PROPS`
            // instead — the obvious shortcut, since that is where the members are —
            // would emit a row for every abstract class and every interface: twelve of
            // them here, each a tag whose `ctor` cannot be called.
            expect('GtkWidget' in VOCABULARY_DECLS).toBe(false);
            expect('GtkOrientable' in VOCABULARY_DECLS).toBe(false);
            const notInstantiable = Object.keys(VOCABULARY_OWN_PROPS).filter((g) => !(g in VOCABULARY_DECLS));
            expect(notInstantiable.includes('GtkWidget')).toBe(true);
            expect(notInstantiable.includes('GtkOrientable')).toBe(true);
            // And the emitted table agrees: no tag for either, while a class that
            // declares NO property of its own still gets one.
            expect('GtkWidget' in TAGS).toBe(false);
            expect('GtkOrientable' in TAGS).toBe(false);
            expect('GtkSeparator' in VOCABULARY_OWN_PROPS).toBe(false);
            expect(TAGS.GtkSeparator).toBe('gtk-separator');
        });

        await it('reaches a property through an implemented interface', async () => {
            // The defect this prevents: GtkBox declares four properties and
            // `orientation` is not one of them — it lives on Gtk.Orientable. A
            // generator that read own members only would emit a surface in which the
            // most-written GtkBox attribute is a type error.
            expect(VOCABULARY_OWN_PROPS.GtkBox?.includes('orientation')).toBe(false);
            expect(VOCABULARY_OWN_PROPS.GtkOrientable).toStrictEqual(['orientation']);
            expect(VOCABULARY_DECLS.GtkBox?.includes('GtkOrientable')).toBe(true);
        });

        await it('reaches a property through an ancestor class', async () => {
            // The same rule one axis over, and it was measured as two FALSE FAILURES
            // rather than reasoned about: an own-members-only check reported
            // `GtkApplicationWindow.set_child` and `GtkToggleButton.set_child` as
            // missing on the real GIR, because both are inherited. The chain walk is
            // not optional, and these are the two classes that proved it.
            expect(VOCABULARY_OWN_PROPS.GtkApplicationWindow).toStrictEqual(['show-menubar']);
            expect(VOCABULARY_DECLS.GtkApplicationWindow?.includes('GtkWindow')).toBe(true);
            expect(VOCABULARY_OWN_PROPS.GtkWindow?.includes('child')).toBe(true);
            expect(VOCABULARY_OWN_PROPS.GtkToggleButton?.includes('child')).toBe(false);
            expect(VOCABULARY_DECLS.GtkToggleButton?.includes('GtkButton')).toBe(true);
            expect(VOCABULARY_OWN_PROPS.GtkButton?.includes('child')).toBe(true);
        });

        await it('offers no property GTK would refuse to write', async () => {
            // WRITABLE-ONLY is a promise of the vocabulary, not something this
            // generator filters. Measured on Gtk-4.0, `ConstructorProps` — the obvious
            // alternative source — offers 150 read-only properties across 68 classes
            // as settable, and GTK's failure mode for writing one is exit 0.
            for (const readOnly of ['parent', 'root', 'scale-factor']) {
                expect(VOCABULARY_OWN_PROPS.GtkWidget?.includes(readOnly)).toBe(false);
            }
            expect(VOCABULARY_OWN_PROPS.GtkWidget?.includes('visible')).toBe(true);
        });

        await it('spells an enum member as the nick GObject registered', async () => {
            // GIR writes `baseline_fill`; the nick GObject registered is
            // `baseline-fill`. The substitution is right for Gtk and Adw by luck and
            // not by construction — some nicks elsewhere keep an underscore it would
            // have replaced — so the vocabulary ships `glib:nick` as DATA and nothing
            // here derives it. A guessed nick is a type that accepts a value GObject
            // then drops SILENTLY.
            expect(VOCABULARY_ENUM_NICKS.GtkAlign?.includes('baseline-fill')).toBe(true);
            expect(VOCABULARY_ENUM_NICKS.GtkAlign?.includes('baseline_fill')).toBe(false);
            const underscored = Object.entries(VOCABULARY_ENUM_NICKS).flatMap(([gtype, nicks]) =>
                nicks.filter((nick) => nick.includes('_')).map((nick) => `${gtype}.${nick}`),
            );
            expect(underscored).toStrictEqual([]);
        });

        await it('gives a flags type no nick union at all', async () => {
            // Why `entryProps['input-hints']` above can only be `number`: the
            // vocabulary lists nicks for enums and omits flags entirely, so there is
            // no `GtkInputHintsNick` for the emitter to reference. Same answer the
            // host gives, for the same reason — a nick SET ("spellcheck|lowercase") is
            // not something GObject resolves.
            expect('GtkInputHints' in VOCABULARY_ENUM_NICKS).toBe(false);
            expect('GtkInputHints' in ENUM_NICKS).toBe(false);
            expect(VOCABULARY_OWN_PROPS.GtkEntry?.includes('input-hints')).toBe(true);
            expect(entryProps['input-hints']).toBe(2);
        });

        await it('carries the vocabulary into the committed artefact verbatim', async () => {
            // The artefact is committed and nothing regenerates it in CI, so this is
            // the only check that it came from the `@girs` version this package
            // depends on. Compared field by field rather than by a count: a count is a
            // number that drifts unseen, and it cannot tell a renamed property from a
            // missing one.
            const diverged: string[] = [];
            const compare = (
                what: string,
                vocabulary: Readonly<Record<string, readonly string[]>>,
                emitted: Readonly<Record<string, readonly string[]>>,
            ) => {
                for (const [gtype, members] of Object.entries(vocabulary)) {
                    const there = emitted[gtype];
                    if (!there) diverged.push(`${what} ${gtype}: absent from the artefact`);
                    else if (there.join(',') !== members.join(','))
                        diverged.push(`${what} ${gtype}: ${there.join(',')}`);
                }
            };
            compare('OWN_PROPS', VOCABULARY_OWN_PROPS, OWN_PROPS);
            compare('OWN_SIGNALS', VOCABULARY_OWN_SIGNALS, OWN_SIGNALS);
            compare('DECLS', VOCABULARY_DECLS, DECLS);
            compare('ENUM_NICKS', VOCABULARY_ENUM_NICKS, ENUM_NICKS);
            expect(diverged).toStrictEqual([]);
            // Not vacuous: the maps are non-trivially large, and every widget the
            // vocabulary declares reached the tag map.
            expect(Object.keys(VOCABULARY_DECLS).length > 100).toBe(true);
            expect(Object.keys(VOCABULARY_DECLS).filter((gtype) => !(gtype in TAGS))).toStrictEqual([]);
        });

        await it('records the release each member arrived in', async () => {
            // `SINCE` is what lets `generated.spec.ts` be exact instead of carrying an
            // allowlist: a member the installed library lacks is a defect UNLESS the
            // release it arrived in is newer than the one running. A dropped entry
            // turns that check from sharp into wrong, and in the safe direction — it
            // reports a defect for a correct surface.
            const lost = Object.entries(VOCABULARY_SINCE).filter(([key, since]) => SINCE[key] !== since);
            expect(lost).toStrictEqual([]);
            expect(SINCE['GtkBox.baseline-child']).toBe('4.12');
            expect(SINCE['GtkAppChooserButton::activate']).toBe('4.4');
            // BOTH key shapes, because the version rule only works for the members it
            // covers: a property-only map leaves a missing SIGNAL unexplainable.
            expect(Object.keys(VOCABULARY_SINCE).some((key) => key.includes('::'))).toBe(true);
        });

        await it('renders the types no runtime value can carry', async () => {
            // The two literals above are the assertion; `gjsify tsc` is the checker.
            // Reached here so the runner reports them, and tied back to the runtime
            // data so the nick in the literal cannot quietly become one the host would
            // refuse.
            expect(widgetProps.cssClasses).toStrictEqual(['card']);
            expect(VOCABULARY_ENUM_NICKS.GtkAlign?.includes(String(widgetProps.halign))).toBe(true);
            // And the omission, from the runtime side: the vocabulary really does state
            // the two `name` properties differently, which is what the `Omit` answers.
            expect(preferencesPageProps.name).toBe(null);
            expect(VOCABULARY_OWN_PROPS.GtkWidget?.includes('name')).toBe(true);
        });

        await it('finds the tag Volar cannot resolve, by rule', async () => {
            // A Vue template tag is camelized and capitalised before lookup, and that
            // transform has no acronym knowledge: `gtk-gl-area` becomes `GtkGlArea`,
            // which is not `GtkGLArea` — TS2339. The generator finds such a widget
            // instead of leaving it to a bug report, and gives it an extra kebab key
            // that a kebab tag does resolve against.
            expect(tagOf('GtkGLArea')).toBe('gtk-gl-area');
            expect(volarResolves('gtk-box', 'GtkBox')).toBe(true);
            expect(volarResolves('gtk-gl-area', 'GtkGLArea')).toBe(false);
            // Over the whole emitted table, so a second such widget arrives as a named
            // failure here rather than as an unresolvable tag in a consumer's editor.
            const unresolvable = Object.entries(TAGS)
                .filter(([gtype, tag]) => !volarResolves(tag, gtype))
                .map(([gtype]) => gtype);
            expect(unresolvable).toStrictEqual(['GtkGLArea']);
        });

        await it('refuses a tag map that is not injective', async () => {
            // Two GTypes whose acronym runs collapse to the same kebab tag would
            // make one of them unreachable BY TAG, silently.
            expect(tagOf('MiniFooBar')).toBe('mini-foo-bar');
            expect(tagOf('MiniFOOBar')).toBe('mini-foo-bar');
            expect(() => assertInjective(['MiniFooBar', 'MiniFOOBar'])).toThrow(Error);
            expect(() => assertInjective(['MiniBox', 'MiniGLThing'])).not.toThrow();
        });

        await it('emits a table that carries no curated field', async () => {
            const table = emitFixture([
                fake('MiniBox', { kind: 'ordered', append: 'append', remove: 'remove', reorder: 'remove-all' }),
            ]);
            expect(table.count).toBe(2);
            expect(table.text.includes("{ gtype: 'MiniBox', tag: 'mini-box', ctor: () => Mini.Box },")).toBe(true);
            for (const field of ['children:', 'textSink:', 'eventAliases:']) {
                expect(table.text.includes(field)).toBe(false);
            }
        });

        await it('fails G1 when a curated widget is not in the vocabulary', async () => {
            let failure: GateFailure | null = null;
            try {
                emitFixture([fake('MiniGone', { kind: 'none' })]);
            } catch (error) {
                failure = error as GateFailure;
            }
            expect(failure?.gate).toBe('G1');
            expect(failure?.message.includes('MiniGone')).toBe(true);
            // And it passes for a gtype the vocabulary knows but does not emit as a
            // row — the reason G1 asks the GType set rather than the widget list.
            expect(() => emitFixture([fake('MiniWidget', { kind: 'single', set: 'show' })])).not.toThrow();
        });

        await it('fails G4 below the count floor — the parse-went-wrong guard', async () => {
            let failure: GateFailure | null = null;
            try {
                emitFixture([], 100);
            } catch (error) {
                failure = error as GateFailure;
            }
            expect(failure?.gate).toBe('G4');
            expect(failure?.message.includes('below the floor of 100')).toBe(true);
        });
    });
};
