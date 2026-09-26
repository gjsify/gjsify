// `colocateNativeLibrary` against a stub `imports.gi`, so every branch — the
// darwin prebuild layout, a win32 path, and each host that cannot help — runs
// on whichever host the suite has.

import { describe, expect, it } from '@gjsify/unit';
import { colocateNativeLibrary, type GiImportsView } from './native-library.js';

/** A repository that knows the given typelib paths and records every prepend. */
const stubGi = (typelibs: Record<string, string>, prepended: string[]): GiImportsView => ({
    GIRepository: {
        Repository: {
            dup_default: () => ({
                get_typelib_path: (ns: string) => typelibs[ns] ?? null,
                prepend_library_path: (dir: string) => {
                    prepended.push(dir);
                },
            }),
        },
    },
});

export default async () => {
    await describe('colocateNativeLibrary', async () => {
        await it("prepends the typelib's own directory", async () => {
            const prepended: string[] = [];
            const gi = stubGi(
                { GjsifyTls: '/p/node_modules/@gjsify/tls-native/prebuilds/darwin-arm64/GjsifyTls-1.0.typelib' },
                prepended,
            );
            expect(colocateNativeLibrary('GjsifyTls', gi)).toBe(true);
            expect(prepended).toStrictEqual(['/p/node_modules/@gjsify/tls-native/prebuilds/darwin-arm64']);
        });

        await it('splits a win32 path on the backslash', async () => {
            const prepended: string[] = [];
            const gi = stubGi({ GjsifyHttp2: 'C:\\app\\prebuilds\\win32-x64\\GjsifyHttp2-1.0.typelib' }, prepended);
            expect(colocateNativeLibrary('GjsifyHttp2', gi)).toBe(true);
            expect(prepended).toStrictEqual(['C:\\app\\prebuilds\\win32-x64']);
        });

        await it('does nothing for a namespace the repository has not loaded', async () => {
            const prepended: string[] = [];
            expect(colocateNativeLibrary('GjsifyTerminal', stubGi({}, prepended))).toBe(false);
            expect(prepended).toStrictEqual([]);
        });

        await it('does nothing on GLib < 2.86 (no dup_default)', async () => {
            expect(colocateNativeLibrary('GjsifyTerminal', { GIRepository: { Repository: {} } })).toBe(false);
        });

        await it('does not throw when the GIRepository typelib itself is missing', async () => {
            const gi = Object.defineProperty({}, 'GIRepository', {
                get() {
                    throw new Error("Typelib file for namespace 'GIRepository' (any version) not found");
                },
            }) as GiImportsView;
            expect(colocateNativeLibrary('GjsifyTerminal', gi)).toBe(false);
        });

        await it('does nothing when imports.gi has no GIRepository', async () => {
            expect(colocateNativeLibrary('GjsifyTerminal', {})).toBe(false);
        });
    });
};
