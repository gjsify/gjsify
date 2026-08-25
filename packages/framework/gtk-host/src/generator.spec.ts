// The generator, against a GIR small enough to reason about.
//
// The real input is 6.2 MB and its answers are all plausible, which is the worst
// property a test input can have: a reader that drops interface properties, or
// spells a nick wrong, or answers `string` for `string[]`, still produces a table
// that looks right. This suite runs the same code over a five-class fixture whose
// every element is there to make one branch visible — including the two that the
// real GTK hierarchy never reaches (a member conflict across bases, and a
// namespace with no `@girs` package).

import { expect, it, on } from '@gjsify/unit';

import { GTK_HOSTS } from './testing/gate.mjs';

import { methodsOf } from './conformance/index.js';
import { emitWidgets, type GateFailure } from './generator/emit.mjs';
import { emitProps, emitSurfaceData, volarResolves } from './generator/emit-types.mjs';
import { ancestors, concreteWidgets, declarations, indexClasses, readNamespace } from './generator/gir.mjs';
import { MINI_GIR, MINI_PACKAGES } from './generator/mini.fixture.mjs';
import { buildSurface } from './generator/surface.mjs';
import { buildUniverse, nickOf, tsTypeOf } from './generator/tsmap.mjs';
import { assertInjective, tagOf } from './tags.js';
import type { WidgetDescriptor } from './types.js';

const mini = readNamespace(MINI_GIR);
const index = indexClasses([mini]);
const widgets = concreteWidgets([mini], 'MiniWidget');
const universe = buildUniverse([mini], MINI_PACKAGES);
const model = buildSurface(widgets, [mini], universe);
const props = emitProps(model, 'Mini-1.0').text;

const declaration = (gtype: string) => {
    for (const d of model.declarations.values()) if (d.gtype === gtype) return d;
    throw new Error(`no declaration ${gtype}`);
};

/** Just enough of a descriptor for the gates, which read `gtype` and `children`. */
const fake = (gtype: string, children: WidgetDescriptor['children']): WidgetDescriptor => ({
    gtype,
    ctor: (() => {
        throw new Error('never called by a gate');
    }) as unknown as WidgetDescriptor['ctor'],
    children,
});

const MINI_MODULES = { Mini: 'gi://Mini?version=1.0' } as const;

const emitFixture = (curated: readonly WidgetDescriptor[], floor = 2) =>
    emitWidgets({ namespaces: [mini], widgets, curated, methodsOf, modules: MINI_MODULES }, floor);

export default async () => {
    await on(GTK_HOSTS, async () => {
        await it('reads the classes GIR describes, and skips the two it must', async () => {
            expect(mini.name).toBe('Mini');
            expect(mini.version).toBe('1.0');
            // `Nameless` has no glib:type-name, so it can never be instantiated by
            // tag and is dropped rather than guessed at.
            expect(mini.classes.map((c) => c.gtype).sort()).toStrictEqual([
                'MiniBox',
                'MiniGLThing',
                'MiniNotAWidget',
                'MiniOrientable',
                'MiniWidget',
            ]);
            expect(mini.enums.map((e) => e.gtype).sort()).toStrictEqual(['MiniAlign', 'MiniStateFlags']);
            expect(mini.otherTypes).toStrictEqual(['Mini.Rect']);
        });

        await it('takes only concrete descendants of the root', async () => {
            // MiniWidget is abstract, MiniOrientable is an interface, MiniNotAWidget
            // does not descend from the root — three different reasons to be out.
            expect(widgets.map((w) => w.gtype)).toStrictEqual(['MiniBox', 'MiniGLThing']);
        });

        await it('reaches a property through an implemented interface', async () => {
            // The defect this prevents, measured on the real GIR: GtkBox declares
            // four properties and `orientation` is not one of them — it lives on
            // Gtk.Orientable. A class-only reader emits a surface in which the most
            // written GtkBox attribute is a type error.
            const box = index.get('Mini.Box');
            expect(box?.properties.map((p) => p.name)).toStrictEqual(['spacing', 'label', 'old-thing']);
            expect(declarations(box as never, index).map((d) => d.gtype)).toStrictEqual([
                'MiniBox',
                'MiniWidget',
                'MiniOrientable',
            ]);
            expect(ancestors(box as never, index).map((d) => d.gtype)).toStrictEqual(['MiniWidget']);
            expect(props.includes('orientation?: MiniAlignNick | Mini.Align;')).toBe(true);
        });

        await it('spells a two-word enum member as the nick GObject registered', async () => {
            expect(nickOf('baseline_fill')).toBe('baseline-fill');
            // `two_words` carries `glib:nick="renamed"`. The derivation would answer
            // `two-words`, so this member is the whole difference between reading the
            // nick and guessing it — and a guessed nick is a type that accepts a value
            // GObject then drops SILENTLY.
            expect(nickOf('two_words')).toBe('two-words');
            expect(props.includes("export type MiniAlignNick = 'fill' | 'baseline-fill' | 'renamed';")).toBe(true);
            expect(props.includes('two-words')).toBe(false);
        });

        await it('answers an array property with an array type', async () => {
            // `querySelector('type')` finds a DESCENDANT, so an `<array><type
            // name="utf8"/></array>` reads as `string` unless the array is checked
            // first. On the real GIR that is `css-classes` on every widget.
            expect(props.includes('cssClasses?: string[];')).toBe(true);
            expect(props.includes("'css-classes'?: string[];")).toBe(true);
        });

        await it('drops a property that is not writable', async () => {
            expect(props.includes('locked')).toBe(false);
            expect(declaration('MiniWidget').props.map((p) => p.kebab)).toStrictEqual([
                'visible',
                'css-classes',
                'area',
            ]);
        });

        await it('types an enum as a nick in a property and as the constant in a parameter', async () => {
            // A handler parameter arrives as the marshalled NUMBER, so offering the
            // nick union there would invite `how === 'fill'`, which is always false.
            expect(props.includes('mode?: MiniAlignNick | Mini.Align;')).toBe(true);
            expect(props.includes('onRowActivated?: (row: Mini.Widget, how: Mini.Align) => void;')).toBe(true);
        });

        await it('types a flags property as a number, matching what the host accepts', async () => {
            // `coerce()` REFUSES a nick string for flags by name, because resolving a
            // nick set is not something GObject exposes. A nick union here would
            // type-check what the runtime rejects.
            expect(props.includes('flags?: number;')).toBe(true);
            expect(props.includes('MiniStateFlagsNick')).toBe(false);
        });

        await it('omits a member from the base that disagrees with a nearer one', async () => {
            // MiniBox.label is a string and MiniOrientable.label an int. TypeScript
            // requires a multiply inherited member to be IDENTICAL, and a local
            // redeclaration does not repair it — only removing it from one base does.
            expect(model.omissions.get('Mini.Box')?.get('Mini.Orientable')).toStrictEqual(['label']);
            expect(
                props.includes(
                    'export interface MiniBoxProps extends MiniWidgetProps, Omit<MiniOrientableProps, ' + "'label'> {",
                ),
            ).toBe(true);
        });

        await it('carries the docs and the deprecations the typelib cannot', async () => {
            // The whole reason the reader takes the XML: gi-docgen reads the GIR
            // because the typelib strips documentation by design, and hover text is
            // what a published type surface is FOR.
            expect(props.includes('/** Which way round it goes. */')).toBe(true);
            // First sentence only — the second is deliberately dropped.
            expect(props.includes('dropped')).toBe(false);
            expect(props.includes('@deprecated')).toBe(true);
        });

        await it('emits one notify handler per property, and the tag maps', async () => {
            expect(props.includes('onNotifySpacing?: NotifyHandler;')).toBe(true);
            expect(props.includes("import type Mini from '@girs/mini-1.0';")).toBe(true);
            expect(props.includes("    'mini-box': MiniBoxProps;")).toBe(true);
            expect(props.includes('    MiniBox: MiniBoxProps;')).toBe(true);
        });

        await it('finds the tag Volar cannot resolve, by rule', async () => {
            expect(tagOf('MiniGLThing')).toBe('mini-gl-thing');
            expect(volarResolves('mini-box', 'MiniBox')).toBe(true);
            expect(volarResolves('mini-gl-thing', 'MiniGLThing')).toBe(false);
            // So it gets a kebab key of its own, which a kebab tag does resolve
            // against — and the one it can reach is not listed twice.
            // The BODY of that one interface, not the tail of the file: everything
            // after it includes WidgetClassByTag, which lists every tag — so a
            // slice-to-end assertion would have passed while proving nothing.
            const start = props.indexOf('export interface WidgetPropsVueAliases');
            const aliases = props.slice(start, props.indexOf('}', start));
            expect(aliases.includes("'mini-gl-thing': MiniGLThingProps;")).toBe(true);
            expect(aliases.includes("'mini-box'")).toBe(false);
        });

        await it('records the release each member arrived in', async () => {
            const data = emitSurfaceData(model, 'Mini-1.0').text;
            expect(data.includes("'MiniBox::row-activated': '1.2',")).toBe(true);
            expect(data.includes("MiniBox: ['spacing', 'label', 'old-thing'],")).toBe(true);
            expect(data.includes("MiniBox: ['MiniBox', 'MiniWidget', 'MiniOrientable'],")).toBe(true);
            expect(data.includes("MiniAlign: ['fill', 'baseline-fill', 'renamed'],")).toBe(true);
        });

        await it('refuses a type whose namespace it cannot import', async () => {
            // The branch the real GIR never reaches: every one of its seven
            // namespaces has a @girs package, so without a fixture this refusal is
            // dead code that has never once run.
            const bare = buildUniverse([mini], {});
            let message = '';
            try {
                tsTypeOf({ name: 'Mini.Widget', array: false }, bare, 'prop');
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message.includes('no @girs package known for namespace Mini')).toBe(true);
            let unresolved = '';
            try {
                tsTypeOf({ name: 'Nope.Thing', array: false }, universe, 'prop');
            } catch (error) {
                unresolved = (error as Error).message;
            }
            expect(unresolved.includes('unresolved GIR type Nope.Thing')).toBe(true);
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

        await it('fails G1 when a curated widget is not in the GIR', async () => {
            let failure: GateFailure | null = null;
            try {
                emitFixture([fake('MiniGone', { kind: 'none' })]);
            } catch (error) {
                failure = error as GateFailure;
            }
            expect(failure?.gate).toBe('G1');
            expect(failure?.message.includes('MiniGone')).toBe(true);
        });

        await it('fails G3 when a policy names a method the class does not have', async () => {
            let failure: GateFailure | null = null;
            try {
                emitFixture([
                    fake('MiniBox', { kind: 'ordered', append: 'nope', remove: 'remove', reorder: 'remove-all' }),
                ]);
            } catch (error) {
                failure = error as GateFailure;
            }
            expect(failure?.gate).toBe('G3');
            expect(failure?.message.includes('MiniBox.nope')).toBe(true);
        });

        await it('accepts a method reached only through an ancestor', async () => {
            // An own-methods-only check reports two false failures on the real GIR
            // (GtkApplicationWindow.set_child, GtkToggleButton.set_child are both
            // inherited), so the ancestor walk is not optional.
            expect(() => emitFixture([fake('MiniBox', { kind: 'single', set: 'show' })])).not.toThrow();
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
