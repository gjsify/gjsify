// SPDX-License-Identifier: MIT
// `giRealPlugin`: which `gi://` specifiers it claims, what version they carry, and the module it
// emits. The end-to-end proof (a bundle that reaches `Gio.SocketClient` under `giRenderer`) is
// the NativeScript device test; here the resolution contract is pinned.

import { describe, expect, it } from '@gjsify/unit';

import { giRealPlugin, giRealShimSource } from './gi-real.js';

type Hook = { handler: (this: unknown, ...args: unknown[]) => unknown };
const handlerOf = (hook: unknown) => (typeof hook === 'function' ? (hook as Hook['handler']) : (hook as Hook).handler);

const resolve = (namespaces: string[], source: string) => {
    const plugin = giRealPlugin({ namespaces });
    return handlerOf(plugin.resolveId).call({}, source) as { id: string } | null;
};
const load = (namespaces: string[], id: string) => {
    const plugin = giRealPlugin({ namespaces });
    return (handlerOf(plugin.load) as (id: string) => { code: string } | null).call({}, id);
};

export default async () => {
    await describe('giRealPlugin', async () => {
        await it('claims a listed namespace and leaves others to the renderer arm', () => {
            expect(resolve(['Gio'], 'gi://Gio?version=2.0')).not.toBeNull();
            expect(resolve(['Gio'], 'gi://Adw?version=1')).toBeNull();
            expect(resolve(['Gio'], 'node:fs')).toBeNull();
        });

        await it('keeps the version the import names, else the entry default', () => {
            expect(resolve(['Gio'], 'gi://Gio?version=2.0')?.id.endsWith('Gio:2.0')).toBe(true);
            expect(resolve(['Soup-3.0'], 'gi://Soup')?.id.endsWith('Soup:3.0')).toBe(true);
            expect(resolve(['Gio'], 'gi://Gio')?.id.endsWith('Gio:')).toBe(true);
        });

        await it('emits a module over requireGi with the namespace and version', () => {
            const id = resolve(['Gio'], 'gi://Gio?version=2.0')!.id;
            const code = load(['Gio'], id)!.code;
            expect(code).toBe(giRealShimSource('Gio', '2.0'));
            expect(code.includes(`@gjsify/node-gi/gi`)).toBe(true);
            expect(code.includes(`requireGi("Gio", "2.0")`)).toBe(true);
        });

        await it('omits the version argument when none is known', () => {
            expect(giRealShimSource('GLib').includes('requireGi("GLib")')).toBe(true);
        });

        await it('ignores ids that are not its own', () => {
            expect(load(['Gio'], 'something-else')).toBeNull();
        });
    });
};
