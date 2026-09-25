// `probeNativeLibrary` + the loader-message parser. The failing-library path
// needs a real library with a missing dependency, which is a prebuild fixture
// this package cannot own — `tests/e2e/native-library-missing-dep` drives it.
// Here: the three loader message shapes, captured verbatim, the error text, and
// every host on which there is nothing to measure.

import { describe, expect, it } from '@gjsify/unit';
import {
    missingLibraryDependency,
    NativeLibraryLoadError,
    probeNativeLibrary,
    type NativeLibraryGiView,
} from './native-library-probe.js';

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
};
