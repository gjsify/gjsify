// SPDX-License-Identifier: MIT
// `?schema` (ADR 0099 § 1): what the build carries into a schema, and what it refuses by name.

import { describe, it, expect } from '@gjsify/unit';
import { parseGschema } from './gschema.js';

const wrap = (body: string, head = 'id="a.B" path="/a/B/"') =>
    `<schemalist>\n  <schema ${head}>\n${body}\n  </schema>\n</schemalist>`;
const key = (type: string, def: string, extra = '') =>
    `    <key name="k" type="${type}">${extra}<default>${def}</default></key>`;
const throws = (fn: () => void): string => {
    try {
        fn();
    } catch (e) {
        return (e as Error).message;
    }
    return '';
};

export default async () => {
    await describe('gschema ?schema', async () => {
        await it('carries type and default per key', async () => {
            const s = parseGschema(
                wrap(
                    [key('s', "'Sans 11'"), key('i', '-3'), key('b', 'true'), key('u', '7'), key('d', '1.5')]
                        .map((k, i) => k.replace('name="k"', `name="k${i}"`))
                        .join('\n'),
                ),
                'x.gschema.xml',
            );
            expect(s.id).toBe('a.B');
            expect(s.path).toBe('/a/B/');
            expect(s.keys.k0).toStrictEqual({ type: 's', default: 'Sans 11' });
            expect(s.keys.k1).toStrictEqual({ type: 'i', default: -3 });
            expect(s.keys.k2).toStrictEqual({ type: 'b', default: true });
            expect(s.keys.k3).toStrictEqual({ type: 'u', default: 7 });
            expect(s.keys.k4).toStrictEqual({ type: 'd', default: 1.5 });
        });
        await it('refuses an unsupported key type, naming key and line', async () => {
            const msg = throws(() => parseGschema(wrap(key('as', '[]')), 'x.gschema.xml'));
            expect(msg.includes("key 'k'")).toBe(true);
            expect(msg.includes('x.gschema.xml:3')).toBe(true);
        });
        await it('refuses range, choices, enum, flags, child and override', async () => {
            for (const tag of ['range', 'choices', 'enum', 'flags', 'child', 'override']) {
                const msg = throws(() => parseGschema(wrap(`    <${tag} name="z"/>`), 'x.gschema.xml'));
                expect(msg.includes(`<${tag}>`)).toBe(true);
            }
        });
        await it('refuses a schema without path', async () => {
            const msg = throws(() => parseGschema(wrap(key('b', 'true'), 'id="a.B"'), 'x.gschema.xml'));
            expect(msg.includes('no path')).toBe(true);
        });
        await it('refuses a default that is not the key type', async () => {
            expect(throws(() => parseGschema(wrap(key('u', '-1')), 'x.gschema.xml')) !== '').toBe(true);
            expect(throws(() => parseGschema(wrap(key('b', '1')), 'x.gschema.xml')) !== '').toBe(true);
        });
    });
};
