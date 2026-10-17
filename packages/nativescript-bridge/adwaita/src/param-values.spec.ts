// An authored value written to a property the APPLICATION registered (`GObject.registerClass` with
// a ParamSpec) reaches its setter converted by the spec's type, as `gtk_builder_value_from_string`
// converts it; a value GtkBuilder could not parse is refused. Found by Learn6502 on Android, where
// `SourceView`'s `copyable: true;` reached the setter as the string `'true'`.
//
// On the TREES entry for the reason `grid-layout.spec.ts` gives.

import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import { valueFromString } from './builder/param-values.js';
import * as GObject from './namespace/gobject.js';
import * as Adw from './namespace/adw.js';

const spec = (kind: 'boolean' | 'int' | 'uint' | 'double' | 'string') => {
    const flags = GObject.ParamFlags.READWRITE;
    if (kind === 'boolean') return GObject.ParamSpec.boolean('p', '', '', flags, false);
    if (kind === 'string') return GObject.ParamSpec.string('p', '', '', flags, '');
    return GObject.ParamSpec[kind]('p', '', '', flags, kind === 'uint' ? 0 : -1000, 1000, 0);
};

class NsParamTarget extends Adw.Bin {
    declare count: number;
    declare ratio: number;
    declare title: string;
    declare size: number;
    readonly seen: string[] = [];
    #copyable = false;
    get copyable(): boolean {
        return this.#copyable;
    }
    set copyable(value: boolean) {
        this.seen.push(typeof value);
        this.#copyable = value;
    }
}
GObject.registerClass(
    {
        GTypeName: 'NsParamTarget',
        Properties: {
            copyable: GObject.ParamSpec.boolean('copyable', '', '', GObject.ParamFlags.READWRITE, false),
            count: GObject.ParamSpec.int('count', '', '', GObject.ParamFlags.READWRITE, -100, 100, 0),
            ratio: GObject.ParamSpec.double('ratio', '', '', GObject.ParamFlags.READWRITE, 0, 10, 0),
            title: GObject.ParamSpec.string('title', '', '', GObject.ParamFlags.READWRITE, ''),
            size: GObject.ParamSpec.uint('size', '', '', GObject.ParamFlags.READWRITE, 0, 100, 0),
        },
    },
    NsParamTarget,
);

const tree = (props: SharedTreeNode['props']): SharedTreeNode => ({
    tag: 'GtkBox',
    children: [{ tag: 'NsParamTarget', extern: true, id: 'target', props }],
});

const targetOf = (root: object) =>
    (root as unknown as { getViewById(id: string): NsParamTarget }).getViewById('target');

export const AdwParamValuesNsTest = async () => {
    await describe('valueFromString: gtk_builder_value_from_string over the subset kinds', async () => {
        await it('reads every boolean spelling GtkBuilder reads, in any case', () => {
            for (const text of ['true', 'TRUE', 'yes', 'Yes', 't', 'T', 'y', '1']) {
                expect(valueFromString(spec('boolean'), text)).toBe(true);
            }
            for (const text of ['false', 'False', 'no', 'NO', 'f', 'n', 'N', '0']) {
                expect(valueFromString(spec('boolean'), text)).toBe(false);
            }
            for (const text of ['', 'maybe', '2', 'truee', ' true']) {
                expect(valueFromString(spec('boolean'), text)).toBe(undefined);
            }
        });

        await it('reads integers with base 0, as g_ascii_strtoll does', () => {
            expect(valueFromString(spec('int'), '42')).toBe(42);
            expect(valueFromString(spec('int'), '-7')).toBe(-7);
            expect(valueFromString(spec('int'), '0x1f')).toBe(31);
            expect(valueFromString(spec('int'), '010')).toBe(8);
            expect(valueFromString(spec('int'), '12px')).toBe(12);
            expect(valueFromString(spec('int'), 'abc')).toBe(undefined);
            expect(valueFromString(spec('uint'), '5')).toBe(5);
            expect(valueFromString(spec('uint'), '-5')).toBe(undefined);
        });

        await it('reads doubles and leaves strings as authored', () => {
            expect(valueFromString(spec('double'), '2.5')).toBe(2.5);
            expect(valueFromString(spec('double'), '-1e3')).toBe(-1000);
            expect(valueFromString(spec('double'), '.5')).toBe(0.5);
            expect(valueFromString(spec('double'), 'inf')).toBe(Infinity);
            expect(valueFromString(spec('double'), 'x')).toBe(undefined);
            expect(valueFromString(spec('string'), 'true')).toBe('true');
        });
    });

    await describe('build(): a registered class takes its authored props by ParamSpec', async () => {
        await it('hands the setter a boolean, a number and a string, never the attribute text', () => {
            const target = targetOf(
                build(tree({ copyable: 'true', count: '0x10', ratio: '2.5', title: 'true', size: 3 })),
            );
            expect(target.copyable).toBe(true);
            expect(target.seen.join()).toBe('boolean');
            expect(target.count).toBe(16);
            expect(target.ratio).toBe(2.5);
            expect(target.title).toBe('true');
            expect(target.size).toBe(3);
        });

        await it('converts a boolean the projection already typed', () => {
            expect(targetOf(build(tree({ copyable: false }))).copyable).toBe(false);
        });

        await it('refuses a value GtkBuilder could not parse, naming element, property and value', () => {
            expect(() => build(tree({ copyable: 'maybe' }))).toThrow(
                `<app:NsParamTarget copyable="maybe">: Could not parse boolean 'maybe'`,
            );
            expect(() => build(tree({ count: 'many' }))).toThrow("Could not parse integer 'many'");
            expect(() => build(tree({ size: '-1' }))).toThrow("Could not parse unsigned integer '-1'");
            expect(() => build(tree({ ratio: 'wide' }))).toThrow("Could not parse double 'wide'");
        });

        await it('converts a breakpoint setter too, and refuses a bad one at build time', () => {
            let feed: ((size: { width: number; height: number }) => void) | undefined;
            const observeSize = (_view: unknown, onSize: (size: { width: number; height: number }) => void) => {
                feed = onSize;
                return () => {};
            };
            const withSetter = (value: string): SharedTreeNode => ({
                ...tree({}),
                breakpoints: [
                    { condition: 'max-width: 400px', setters: [{ object: 'target', property: 'copyable', value }] },
                ],
            });
            const target = targetOf(build(withSetter('yes'), { observeSize }));
            feed!({ width: 300, height: 600 });
            expect(target.copyable).toBe(true);
            feed!({ width: 800, height: 600 });
            expect(target.copyable).toBe(false);
            expect(target.seen.every((kind) => kind === 'boolean')).toBe(true);

            expect(() => build(withSetter('perhaps'), { observeSize })).toThrow("Could not parse boolean 'perhaps'");
        });
    });
};
