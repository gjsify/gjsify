// SPDX-License-Identifier: MIT
// The GI runtime-path prologue — the banner that lets a `--app gjs` bundle find GI
// libraries under a bare `gjs -m bundle.mjs` with NO `GI_TYPELIB_PATH` and no
// loader-path environment, and therefore with no launcher. It reaches what the bundle
// loads AFTER evaluation starts, not its static `gi://` imports — measured in the
// `gi-runtime-prologue` e2e, which is also where that bound is pinned.
//
// Asserted as a STRING, deliberately: same rationale as `process-stub-banner.spec.ts`
// — no bundle build, and it fails on the mistake itself rather than on a downstream
// symptom. The behaviour behind it is measured, not assumed (macOS 15.7.9 x86_64 VM +
// linux, gjs 1.88.1, `env -u DYLD_FALLBACK_LIBRARY_PATH -u DYLD_LIBRARY_PATH -u
// GI_TYPELIB_PATH`): without the prepend `imports.gi.Gtk` dies with `Failed to load
// shared library 'libgtk-4.1.dylib'`, with it `Gtk.Widget.$gtype.name` answers.
//
// Tested from @gjsify/cli's harness because the plugin package has no `test:node`
// script of its own — the same placement rationale as `process-stub-banner.spec.ts`
// and the twelve other bundler specs here.

import { describe, expect, it } from '@gjsify/unit';
import { giRuntimePathsStub, type GiSystemProbe } from '@gjsify/rolldown-plugin-gjsify';
import { giSystemProbes } from './utils/gi-runtime-paths.js';

/** GJS ambient globals a bundled module could plausibly shadow at top level. */
const AMBIENT_GLOBALS = ['imports', 'print', 'printerr', 'log', 'logError', 'ARGV'];

/**
 * The marker that says the RUNNING host is macOS, spelled out rather than read from
 * `gi-runtime-paths.ts`: an expectation that imports its own answer proves nothing.
 */
const MAC_HOST = '/System/Library/CoreServices/SystemVersion.plist';

/** `GFileTest`, verbatim from GLib's `gfileutils.h` — the stand-in refuses any other mode. */
const FILE_TEST = { IS_REGULAR: 1 << 0, IS_SYMLINK: 1 << 1, IS_DIR: 1 << 2, IS_EXECUTABLE: 1 << 3, EXISTS: 1 << 4 };

/** The body of every `try{…}catch` in the emitted prologue. */
function tryBodies(stub: string): string[] {
    return [...stub.matchAll(/try\{(.*?)\}catch/g)].map((m) => m[1]);
}

/** What the prologue did to a repository, in the order the paths end up in. */
interface RecordedPaths {
    search: string[];
    library: string[];
}

/**
 * EVALUATE the emitted prologue against a stand-in `imports`.
 *
 * The string assertions above pin the shape; this pins the BEHAVIOUR, which is the
 * half that decides whether a macOS install finds its GTK. `prepend_*` is modelled
 * with `unshift`, so the recorded arrays are the search paths as girepository would
 * then hold them — precedence is read off the result rather than inferred from the
 * emission order.
 *
 * Node-only, like the rest of this harness (`@gjsify/cli` has no `test:gjs`): under
 * GJS `globalThis.imports` is the live host object.
 */
function runStub(
    stub: string,
    opts: { existingDirs?: string[]; programPath?: string; giRepositoryThrows?: boolean } = {},
): RecordedPaths {
    const search: string[] = [];
    const library: string[] = [];
    const existing = new Set(opts.existingDirs ?? []);
    const gi = {
        get GIRepository() {
            // A namespace load THROWS on a host whose distribution ships the
            // girepository library without its typelib — the case this prologue must
            // survive at byte 1.
            if (opts.giRepositoryThrows)
                throw new Error("Typelib file for namespace 'GIRepository' (any version) not found");
            return {
                Repository: {
                    dup_default: () => ({
                        prepend_search_path: (dir: string) => search.unshift(dir),
                        prepend_library_path: (dir: string) => library.unshift(dir),
                    }),
                },
            };
        },
        GLib: {
            file_test: (path: string, test: number) => {
                // A stand-in that ignored the mode would answer the same for
                // `G.FileTest.TYPO` (undefined), so a misspelled mode in the emitted
                // string would pass here and probe nothing on a real host.
                if (test !== FILE_TEST.IS_DIR && test !== FILE_TEST.EXISTS) {
                    throw new Error(`the prologue asked for an unknown GFileTest: ${test}`);
                }
                return existing.has(path);
            },
            FileTest: FILE_TEST,
        },
    };
    const host = globalThis as { imports?: unknown };
    const previous = host.imports;
    host.imports = { gi, system: { programPath: opts.programPath } };
    try {
        new Function(stub)();
    } finally {
        host.imports = previous;
    }
    return { search, library };
}

export default async () => {
    await describe('giRuntimePathsStub: nothing to say, nothing emitted', async () => {
        await it('emits an empty string for an empty list', async () => {
            // A no-op prologue in every bundle is a guard that can never fire, and a
            // banner that is not there cannot drift.
            expect(giRuntimePathsStub([])).toBe('');
        });
    });

    await describe('giRuntimePathsStub: the byte-1 rules', async () => {
        await it('reaches every ambient global through globalThis.', async () => {
            // THE incident this pins, from `process-stub-banner.spec.ts`: a BARE
            // `imports` at byte 1 binds to any top-level `const imports` a bundled
            // module declares — `@girs/gjs`'s generated shim declares exactly that —
            // and at byte 1 that binding is still in its temporal dead zone, so the
            // bundle dies at load with `ReferenceError: can't access lexical
            // declaration 'imports' before initialization`.
            const stub = giRuntimePathsStub(['node_modules/@gjsify/webgl-linux-x64/prebuilds/linux-x64']);
            for (const name of AMBIENT_GLOBALS) {
                const bare = new RegExp(`(^|[^.\\w"'])${name}\\b`);
                const offending = bare.exec(stub.replace(/globalThis\./g, 'globalThis_'));
                expect(offending === null || /globalThis_/.test(offending[0])).toBe(true);
            }
            expect(stub.includes('globalThis.imports')).toBe(true);
        });

        await it('stays on ONE line', async () => {
            // The banner runs before any source-map-aware machinery, so a newline
            // shifts every bundle line number by one.
            expect(giRuntimePathsStub(['a', 'b']).includes('\n')).toBe(false);
        });
    });

    await describe('giRuntimePathsStub: both prepends, because both are load-bearing', async () => {
        await it('calls prepend_search_path AND prepend_library_path', async () => {
            // Measured on linux: prepending only the SEARCH path finds the typelib and
            // then fails with `Failed to load shared library 'libgwebgl.so' referenced
            // by the typelib`. Dropping either call is a silent half-fix.
            const stub = giRuntimePathsStub(['prebuilds/linux-x64']);
            expect(stub.includes('prepend_search_path')).toBe(true);
            expect(stub.includes('prepend_library_path')).toBe(true);
        });

        await it('degrades to a no-op where GIRepository is not introspectable', async () => {
            // Guarded probes and not try/catch: none of these CALLS has a throw path
            // (no `throws` in the GIR), so a catch would have nothing to catch and
            // would hide a real absence. What is genuinely optional is the API.
            const stub = giRuntimePathsStub(['x']);
            expect(stub.includes('dup_default')).toBe(true);
            for (const guard of ['!i||!i.gi', '!R||!R.Repository', '!r.prepend_search_path']) {
                expect(stub.includes(guard)).toBe(true);
            }
        });

        await it('wraps the namespace LOADS, and nothing else, in try', async () => {
            // The one operation here that does throw. `imports.gi.GIRepository` reads a
            // typelib distributions package separately from the girepository library
            // GJS links against (Debian: `gir1.2-girepository-3.0` vs
            // `libgirepository-2.0-0`), so a lean host raises "Typelib file for
            // namespace 'GIRepository' (any version) not found" — measured, and the
            // reason `activateNativePrebuilds()` wraps the same access. At byte 1 that
            // throw takes the whole program down before a line of it runs, on hosts
            // where the bundle was fine while this prologue was still the empty string.
            //
            // Held to the loads ONLY: a try around the prepends would be the anti-pattern
            // the assertion above pins, and would hide a real absence.
            const bodies = tryBodies(
                giRuntimePathsStub(['x'], [['/opt/homebrew/lib', '/opt/homebrew/lib/girepository-1.0', MAC_HOST]]),
            );
            expect(bodies.length).toBe(2);
            for (const body of bodies) expect(/^[A-Z]=i\.gi\.[A-Za-z]+$/.test(body)).toBe(true);
        });
    });

    await describe('the prologue, evaluated', async () => {
        const HOMEBREW: GiSystemProbe = ['/opt/homebrew/lib', '/opt/homebrew/lib/girepository-1.0', MAC_HOST];
        const LOCAL: GiSystemProbe = ['/usr/local/lib', '/usr/local/lib/girepository-1.0', MAC_HOST];

        await it('puts what ships with the program AHEAD of what the host has', async () => {
            // ADR 0023 \u00a7 4. Two GI registries in one process is the #910 failure; when
            // both are present the bundle\u2019s own copy has to win.
            const stub = giRuntimePathsStub(['prebuilds/darwin-arm64'], [HOMEBREW, LOCAL]);
            const { search, library } = runStub(stub, {
                existingDirs: [MAC_HOST, HOMEBREW[1], LOCAL[1]],
                programPath: '/Applications/App/bin/app.js',
            });
            expect(search).toStrictEqual(['/Applications/App/bin/prebuilds/darwin-arm64', HOMEBREW[0], LOCAL[0]]);
            // Search path alone finds the typelib and then fails the dlopen.
            expect(library).toStrictEqual(search);
        });

        await it('drops a candidate whose marker is not on this host', async () => {
            // The measurement that makes the constant table safe to ship everywhere: a
            // Linux host that has never seen Homebrew must come out unchanged.
            const stub = giRuntimePathsStub([], [HOMEBREW, LOCAL]);
            expect(runStub(stub, { existingDirs: [] }).search).toStrictEqual([]);
            expect(runStub(stub, { existingDirs: [MAC_HOST, LOCAL[1]] }).search).toStrictEqual([LOCAL[0]]);
        });

        await it('leaves a Linux host that has the DIRECTORY alone', async () => {
            // The other gate, and the one the girepository-1.0 marker cannot supply.
            // `/usr/local/lib/girepository-1.0` is a normal shape on Linux — `meson setup
            // --prefix=/usr/local`, jhbuild — and the rule being mirrored is about
            // LOADERS, not about GI: `systemGiLibraryDirs()` is empty off darwin because
            // ld.so's cache already resolves these leaves. Prepending anyway would put a
            // second GI stack ahead of the distro's typelibs AND libraries for every
            // bundle on that host (ADR 0023 § 4, #910).
            const stub = giRuntimePathsStub([], [HOMEBREW, LOCAL]);
            const linux = runStub(stub, { existingDirs: [LOCAL[1]] });
            expect(linux.search).toStrictEqual([]);
            expect(linux.library).toStrictEqual([]);
            // Same host facts plus the darwin marker: the candidate is wanted there.
            expect(runStub(stub, { existingDirs: [MAC_HOST, LOCAL[1]] }).search).toStrictEqual([LOCAL[0]]);
        });

        await it('survives a host with no GIRepository typelib', async () => {
            // Debian ships `libgirepository-2.0-0` without `gir1.2-girepository-3.0`.
            // Unwrapped, the load throws at BYTE 1 and takes down a program that ran
            // fine while this prologue was still the empty string.
            const stub = giRuntimePathsStub(['prebuilds/linux-x64'], [HOMEBREW]);
            const recorded = runStub(stub, {
                giRepositoryThrows: true,
                existingDirs: [MAC_HOST, HOMEBREW[1]],
                programPath: '/opt/app/app.js',
            });
            expect(recorded.search).toStrictEqual([]);
        });

        await it('still applies the host half when the program path has no directory', async () => {
            // `gjs -c '\u2026'` leaves `programPath` unset. Returning there would throw away
            // the one repair that does not depend on knowing where the program lives.
            const stub = giRuntimePathsStub(['prebuilds/linux-x64'], [HOMEBREW]);
            const recorded = runStub(stub, { existingDirs: [MAC_HOST, HOMEBREW[1]], programPath: undefined });
            expect(recorded.search).toStrictEqual([HOMEBREW[0]]);
        });

        await it('cuts a win32 program path on the backslash', async () => {
            const stub = giRuntimePathsStub(['prebuilds/win32-x64']);
            const recorded = runStub(stub, { programPath: 'C:\\Program Files\\App\\app.js' });
            expect(recorded.search).toStrictEqual(['C:\\Program Files\\App/prebuilds/win32-x64']);
        });

        await it('leaves an absolute directory absolute', async () => {
            const stub = giRuntimePathsStub(['/opt/vendor/lib']);
            const recorded = runStub(stub, { programPath: '/opt/app/app.js' });
            expect(recorded.search).toStrictEqual(['/opt/vendor/lib']);
        });
    });

    await describe('giRuntimePathsStub: system dirs are the HOST\u2019s fact, probed at runtime', async () => {
        const PROBE: GiSystemProbe = ['/opt/homebrew/lib', '/opt/homebrew/lib/girepository-1.0', MAC_HOST];

        await it('emits a probe half with no baked directories at all', async () => {
            // The shape a `--app gjs` bundle actually ships: nothing about the build
            // tree, only candidates the RUNNING host is asked about.
            const stub = giRuntimePathsStub([], [PROBE]);
            expect(stub).not.toBe('');
            for (const part of PROBE) expect(stub.includes(JSON.stringify(part))).toBe(true);
            // No program-relative machinery when there is nothing relative to place.
            expect(stub.includes('programPath')).toBe(false);
        });

        await it('prepends a candidate only where its marker exists', async () => {
            // Without the marker test this would prepend `/opt/homebrew/lib` on every
            // host — a LIBRARY path, so on a Linux box with an unrelated
            // `/usr/local/lib` it can shadow a correctly resolved library process-wide.
            // That is the same failure `buildNativeEnv()` avoids by using
            // DYLD_FALLBACK_LIBRARY_PATH rather than DYLD_LIBRARY_PATH.
            const stub = giRuntimePathsStub([], [PROBE]);
            expect(stub.includes('file_test')).toBe(true);
            expect(stub.includes('FileTest.IS_DIR')).toBe(true);
            // And the platform gate, which is the OTHER half of "only where it belongs":
            // the host marker is a FILE, so it is tested for existence, not for a dir.
            expect(stub.includes('FileTest.EXISTS')).toBe(true);
        });

        await it('keeps bundle dirs AHEAD of system dirs', async () => {
            // ADR 0023 \u00a7 4: what ships with the program wins over what the host has.
            // Prepending reverses, so the system half must be emitted FIRST \u2014 and each
            // loop counts down, so the order within a half survives too.
            const stub = giRuntimePathsStub(['prebuilds/linux-x64'], [PROBE]);
            expect(stub.indexOf(JSON.stringify(PROBE[0]))).toBeLessThan(stub.indexOf('"prebuilds/linux-x64"'));
            expect(stub.includes('for(var j=S.length;j--;)')).toBe(true);
            expect(stub.includes('for(var k=D.length;k--;)')).toBe(true);
        });

        await it('never joins a system candidate under the program dir', async () => {
            // `/opt/homebrew/lib` under the program directory names nothing. The relative
            // half\u2019s absolute-path escape hatch covers a dir passed as `dirs`; the probe
            // half calls the prepend directly and must not acquire a join at all.
            const stub = giRuntimePathsStub([], [PROBE]);
            expect(stub.includes("b+'/'+d")).toBe(false);
        });
    });

    await describe('giSystemProbes: what the CLI actually puts in the prologue', async () => {
        await it('carries every candidate of every platform, not the build host\u2019s', async () => {
            // `--app gjs` emits platform-neutral JavaScript: the bundle a Linux runner
            // produces is the bundle a Mac runs, so a build-time platform gate would
            // ship the runner\u2019s answer to a question only the host can answer.
            const probes = giSystemProbes();
            const dirs = probes.map(([dir]) => dir);
            for (const expected of ['/opt/homebrew/lib', '/usr/local/lib', '/opt/local/lib']) {
                expect(dirs.includes(expected)).toBe(true);
            }
        });

        await it('marks each candidate with its own girepository-1.0 subdir', async () => {
            for (const [dir, marker] of giSystemProbes()) {
                expect(marker).toBe(`${dir}/girepository-1.0`);
                expect(dir.startsWith('/')).toBe(true);
            }
        });

        await it('gates every candidate on the platform its table row names', async () => {
            // `PROBED_GI_LIBDIRS` is keyed by platform and `systemGiLibraryDirs()` honours
            // that key; flattening the table would ship darwin's prefixes to every host.
            for (const probe of giSystemProbes()) expect(probe[2]).toBe(MAC_HOST);
        });

        await it('changes nothing on a Linux host that has /usr/local/lib/girepository-1.0', async () => {
            // End to end through the REAL table and the REAL generator, in both
            // directions: `meson setup --prefix=/usr/local` and jhbuild produce exactly
            // this host, and it must come out with the distro's GI stack still first.
            const stub = giRuntimePathsStub([], giSystemProbes());
            const linux = runStub(stub, { existingDirs: ['/usr/local/lib/girepository-1.0'] });
            expect(linux.search).toStrictEqual([]);
            expect(linux.library).toStrictEqual([]);

            const mac = runStub(stub, { existingDirs: [MAC_HOST, '/usr/local/lib/girepository-1.0'] });
            expect(mac.search).toStrictEqual(['/usr/local/lib']);
            expect(mac.library).toStrictEqual(['/usr/local/lib']);
        });

        await it('is sorted and free of duplicates', async () => {
            // Two machines must build one `--app gjs` bundle byte-for-byte identically
            // (`scripts/verify-committed-bundles.mjs` holds `dist/affected.gjs.mjs` to
            // exactly that), and table order is a source edit away from changing.
            const dirs = giSystemProbes().map(([dir]) => dir);
            expect(dirs).toStrictEqual([...new Set(dirs)].sort());
        });

        await it('bakes no build-machine directory into the prologue', async () => {
            // The regression that would undo the decision in `utils/gi-runtime-paths.ts`:
            // `detectNativePackages()` answers with the build tree\u2019s
            // `node_modules/@gjsify/<pkg>-<host target>/prebuilds/<host target>`, which
            // names nothing on the machine a shipped bundle runs on.
            const stub = giRuntimePathsStub([], giSystemProbes());
            expect(stub.includes('node_modules')).toBe(false);
            expect(stub.includes('prebuilds')).toBe(false);
        });
    });

    await describe('giRuntimePathsStub: paths are relative to the PROGRAM', async () => {
        await it('joins against the program dir rather than baking an absolute path', async () => {
            // A baked absolute path is the BUILD machine's, so a shipped app would
            // carry directories that do not exist on the user's disk.
            const stub = giRuntimePathsStub(['prebuilds/linux-x64']);
            expect(stub.includes('programPath')).toBe(true);
            expect(stub.includes('programInvocationName')).toBe(true);
        });

        await it('cuts the program dir on EITHER separator', async () => {
            // The program path is the HOST's: on win32 it is `C:\…\main.js`, where a
            // `/`-only cut matches nothing and the join would silently yield a relative
            // path. Same rule as `@gjsify/utils/core`'s `lastPathSeparatorIndex` (#1143).
            const stub = giRuntimePathsStub(['x']);
            const cut = /\/\^\(\.\*\)\[([^\]]*)\]/.exec(stub);
            expect(cut !== null).toBe(true);
            expect(cut![1].includes('\\\\')).toBe(true);
            expect(cut![1].includes('\\/')).toBe(true);
        });

        await it('uses an ABSOLUTE entry as given, on both separator styles', async () => {
            // Bundle prebuilds ship beside the program; a SYSTEM libdir does not.
            // Joining `/usr/local/lib` under the program dir would name nothing,
            // which is what would silently happen if the join were unconditional.
            const stub = giRuntimePathsStub(['/usr/local/lib']);
            const test = /\/\^\(\[A-Za-z\]:/.exec(stub);
            expect(test !== null).toBe(true);
            expect(stub.includes("?d:b+'/'+d")).toBe(true);
        });

        await it('emits every directory it was given, JSON-quoted', async () => {
            const dirs = ['a-dir', 'with space', "with'quote"];
            const stub = giRuntimePathsStub(dirs);
            for (const d of dirs) expect(stub.includes(JSON.stringify(d))).toBe(true);
        });
    });
};
