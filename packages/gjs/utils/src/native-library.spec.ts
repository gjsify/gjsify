// The native-library module against stub `imports.gi` views, so every branch —
// the darwin prebuild layout, a win32 path, each host that cannot help — runs on
// whichever host the suite has. The failing-library path needs a real library
// with a missing dependency, which is a prebuild fixture this package cannot
// own — `tests/e2e/native-library-missing-dep` drives it; here the three loader
// message shapes are captured verbatim instead.

import { describe, expect, it } from '@gjsify/unit';
import {
    colocateNativeLibrary,
    loadOptionalNativeModule,
    missingLibraryDependency,
    NativeLibraryLoadError,
    probeNativeLibrary,
    type NativeLibraryGiView,
} from './native-library.js';

/** A repository that knows the given typelib paths and records every prepend. */
const stubGi = (typelibs: Record<string, string>, prepended: string[]): NativeLibraryGiView =>
    ({
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
    }) as unknown as NativeLibraryGiView;

// macOS 27 arm64, the committed rolldown prebuild with its json-glib load
// command pointed at a leaf that does not exist.
const DYLD =
    'dlopen(/tmp/p/libgjsifyrolldown.dylib, 0x0009): Library not loaded: @rpath/libjson-glib-1.0.0.dylib\n' +
    '  Referenced from: <4F2BFB04-6668-39EB-B39C-98F6E4A3A1BE> /tmp/p/libgjsifyrolldown.dylib\n' +
    "  Reason: tried: '/tmp/p/libjson-glib-1.0.0.dylib' (no such file), '/opt/homebrew/lib/libjson-glib-1.0.0.dylib' (no such file)";
const GLIBC = 'libjson-glib-1.0.so.0: cannot open shared object file: No such file or directory';
const MUSL =
    'Error loading shared library libjson-glib-1.0.so.0: No such file or directory (needed by /tmp/p/libgjsifyrolldown.so)';

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
            expect(
                colocateNativeLibrary('GjsifyTerminal', {
                    GIRepository: { Repository: {} },
                } as unknown as NativeLibraryGiView),
            ).toBe(false);
        });

        await it('does not throw when the GIRepository typelib itself is missing', async () => {
            const gi = Object.defineProperty({}, 'GIRepository', {
                get() {
                    throw new Error("Typelib file for namespace 'GIRepository' (any version) not found");
                },
            }) as NativeLibraryGiView;
            expect(colocateNativeLibrary('GjsifyTerminal', gi)).toBe(false);
        });

        await it('does nothing when imports.gi has no GIRepository', async () => {
            expect(colocateNativeLibrary('GjsifyTerminal', {})).toBe(false);
        });
    });

    await describe('missingLibraryDependency', async () => {
        await it('reads the leaf out of a dyld message', async () => {
            expect(missingLibraryDependency(DYLD, '/tmp/p/libgjsifyrolldown.dylib')).toBe('libjson-glib-1.0.0.dylib');
        });

        await it('reads a glibc dlerror', async () => {
            expect(missingLibraryDependency(GLIBC, '/tmp/p/libgjsifyrolldown.so')).toBe('libjson-glib-1.0.so.0');
        });

        await it('reads a musl dlerror', async () => {
            expect(missingLibraryDependency(MUSL, '/tmp/p/libgjsifyrolldown.so')).toBe('libjson-glib-1.0.so.0');
        });

        await it('names no dependency when the library itself is what is missing', async () => {
            const reason = '/tmp/p/libgjsifyrolldown.so: cannot open shared object file: No such file or directory';
            expect(missingLibraryDependency(reason, '/tmp/p/libgjsifyrolldown.so')).toBeUndefined();
        });

        await it('names no dependency for a message that carries none (win32 LoadLibrary)', async () => {
            expect(
                missingLibraryDependency("'C:\\app\\gjsifyrolldown.dll': The specified module could not be found."),
            ).toBeUndefined();
        });
    });

    await describe('NativeLibraryLoadError', async () => {
        const failure = {
            namespace: 'GjsifyRolldown',
            library: '/tmp/p/libgjsifyrolldown.dylib',
            reason: DYLD,
            missingDependency: 'libjson-glib-1.0.0.dylib',
        };

        await it('names the library, the missing dependency and the loader text', async () => {
            const { message } = new NativeLibraryLoadError(failure);
            expect(message).toContain('/tmp/p/libgjsifyrolldown.dylib could not be loaded');
            expect(message).toContain('It needs libjson-glib-1.0.0.dylib');
            expect(message).toContain('Library not loaded: @rpath/libjson-glib-1.0.0.dylib');
            expect(message).toContain('gjsify system-check');
        });

        await it("carries the caller's install hint instead of the generic one", async () => {
            const { message } = new NativeLibraryLoadError(failure, 'Install it:\n  brew install json-glib');
            expect(message).toContain('brew install json-glib');
            expect(message).not.toContain('gjsify system-check');
        });
    });

    await describe('probeNativeLibrary', async () => {
        await it('reports nothing for a library that loads', async () => {
            // GObject's typelib names libgobject, which this very process runs on.
            expect(probeNativeLibrary('GObject')).toBeNull();
        });

        await it('reports nothing for a namespace the repository has not loaded', async () => {
            expect(probeNativeLibrary('GjsifyNoSuchNamespace')).toBeNull();
        });

        await it('reports nothing without GIRepository 3 (no dup_default)', async () => {
            const gi = { GIRepository: { Repository: {} } } as unknown as NativeLibraryGiView;
            expect(probeNativeLibrary('GjsifyRolldown', gi)).toBeNull();
        });

        await it('does not throw when the GIRepository typelib itself is missing', async () => {
            const gi = Object.defineProperty({}, 'GIRepository', {
                get() {
                    throw new Error("Typelib file for namespace 'GIRepository' (any version) not found");
                },
            }) as NativeLibraryGiView;
            expect(probeNativeLibrary('GjsifyRolldown', gi)).toBeNull();
        });

        await it('reports nothing off GJS', async () => {
            expect(probeNativeLibrary('GjsifyRolldown', {})).toBeNull();
        });
    });

    await describe('loadOptionalNativeModule', async () => {
        await it('returns the namespace of a library that loads', async () => {
            const { module, error } = loadOptionalNativeModule<{ Object: unknown }>('GObject', ['Object']);
            expect(error).toBeNull();
            expect(module?.Object).toBeDefined();
        });

        await it("keeps girepository's error for a typelib that is not installed", async () => {
            const gi = Object.defineProperty({}, 'GjsifyTerminal', {
                get() {
                    throw new Error("Typelib file for namespace 'GjsifyTerminal' (any version) not found");
                },
            }) as NativeLibraryGiView;
            const { module, error } = loadOptionalNativeModule('GjsifyTerminal', ['Terminal'], gi);
            expect(module).toBeNull();
            expect(error?.message).toContain("namespace 'GjsifyTerminal'");
        });

        // GLib < 2.86: nothing to colocate or probe with, so touching the classes
        // is the only thing that tells a namespace without its library from one
        // that works.
        await it('reads a class that will not open as absent when nothing can be probed', async () => {
            const gi = {
                GjsifyTls: Object.defineProperty({}, 'Tls', {
                    get() {
                        throw new Error('Unsupported type void, deriving from fundamental void');
                    },
                }),
            } as unknown as NativeLibraryGiView;
            const { module, error } = loadOptionalNativeModule('GjsifyTls', ['Tls'], gi);
            expect(module).toBeNull();
            expect(error?.message).toContain('Unsupported type void');
        });

        await it('names a namespace imports.gi does not have', async () => {
            const { module, error } = loadOptionalNativeModule('GjsifyHttp2', [], {} as NativeLibraryGiView);
            expect(module).toBeNull();
            expect(error?.message).toBe('GjsifyHttp2: typelib not found');
        });
    });
};
