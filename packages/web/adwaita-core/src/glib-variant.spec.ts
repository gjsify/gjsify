// The GLib.Variant subset of the core against the shared vectors, and the text parser
// `@gjsify/app-settings` reads stored arrays with.

import { describe, expect, it } from '@gjsify/unit';

import { GLIB_VARIANT_VECTORS, driveGLibVariantVectors, type VariantClassLike } from './conformance/glib-variant.js';
import { Variant, parseVariant } from './glib-variant.js';

export default async () => {
    await driveGLibVariantVectors(
        { name: 'adwaita-core', isOracle: false, GLib: { Variant: Variant as unknown as VariantClassLike } },
        { describe, it, expect },
        GLIB_VARIANT_VECTORS,
    );

    await describe('adwaita-core: GLib.Variant text parser', async () => {
        const read = (type: string, text: string): unknown => {
            try {
                return parseVariant(type, text).print(true);
            } catch {
                return 'error';
            }
        };

        await it('reads what GLib reads (measured with GLib.Variant.parse)', () => {
            const cases: [string, string, string][] = [
                ['i', '010', '8'],
                ['i', '0x10', '16'],
                ['i', '-0x10', '-16'],
                ['i', 'int32 5', '5'],
                ['u', 'uint32 5', 'uint32 5'],
                ['d', '1', '1.0'],
                ['d', '1e3', '1000.0'],
                ['d', 'inf', 'inf'],
                ['d', '-inf', '-inf'],
                ['d', 'nan', 'nan'],
                ['d', 'double 2', '2.0'],
                ['d', '.5', '0.5'],
                ['d', '1.', '1.0'],
                ['b', 'true', 'true'],
                ['b', 'boolean false', 'false'],
                ['s', "'a\\u00e4\\U0001f600\\x41'", "'aä😀x41'"],
                ['s', "'a\\qb'", "'aqb'"],
                ['s', "'tab\\there'", "'tab\\there'"],
                ['s', 'string "x"', "'x'"],
                ['ai', '@ai []', '@ai []'],
                ['ai', '[]', '@ai []'],
                ['ai', ' [ 1 ,2 ] ', '[1, 2]'],
                ['au', '[uint32 1, 2]', '[uint32 1, 2]'],
                ['au', '[1, uint32 2]', '[uint32 1, 2]'],
                ['as', "['a', \"b'c\"]", "['a', \"b'c\"]"],
                ['ad', '[1, 2.5]', '[1.0, 2.5]'],
                ['ad', '[inf, nan]', '[inf, nan]'],
                ['ab', '[true, false]', '[true, false]'],
                ['i', '  7  ', '7'],
                ['i', '+5', '5'],
                ['i', '0X10', '16'],
                ['i', '-0', '0'],
            ];
            expect(cases.map(([type, text]) => read(type, text))).toStrictEqual(cases.map(([, , printed]) => printed));
        });

        await it('refuses what GLib refuses', () => {
            const cases: [string, string][] = [
                ['b', '1'],
                ['i', 'uint32 5'],
                ['i', '1.0'],
                ['ai', '[1, 2,]'],
                ['ai', '@au []'],
                ['ai', '[1] x'],
                ['ai', '[1'],
                ['i', '2147483648'],
                ['u', '4294967296'],
                ['u', '-1'],
                ['i', ''],
                ['i', '1 2'],
                ['i', '1_000'],
                ['i', '08'],
                ['i', '$x'],
                ['s', "'\\u12'"],
            ];
            expect(cases.map(([type, text]) => read(type, text))).toStrictEqual(cases.map(() => 'error'));
        });

        await it('reads back everything print() writes', () => {
            const values: [string, unknown][] = [
                ['ai', [1, -2147483648, 2147483647]],
                ['au', [0, 4294967295]],
                ['ad', [0.1, -0, 1e21, 1e-7, 1 / 3, NaN, -Infinity]],
                ['as', ['', "a'b", 'a"b', 'a\'"b', '\\', '\u0001\u007f\t\n', '\u{10ffff}', 'ä€😀']],
                ['ab', [true, false]],
                ['as', []],
            ];
            for (const [type, value] of values) {
                const variant = new Variant(type, value);
                for (const annotate of [true, false]) {
                    expect(parseVariant(type, variant.print(annotate)).equal(variant)).toBe(true);
                }
            }
        });

        await it('names the type string it refuses', () => {
            expect(read('aai', '[[1]]')).toBe('error');
            let message = '';
            try {
                parseVariant('a{sv}', '{}');
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message.includes("'a{sv}'")).toBe(true);
        });
    });
};
