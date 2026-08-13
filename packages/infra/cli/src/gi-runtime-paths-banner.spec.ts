// SPDX-License-Identifier: MIT
// The GI runtime-path prologue — the banner that lets a `--app gjs` bundle run under a
// bare `gjs -m bundle.mjs` with NO `GI_TYPELIB_PATH` and no loader-path environment,
// and therefore with no launcher.
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
import { giRuntimePathsStub } from '@gjsify/rolldown-plugin-gjsify';

/** GJS ambient globals a bundled module could plausibly shadow at top level. */
const AMBIENT_GLOBALS = ['imports', 'print', 'printerr', 'log', 'logError', 'ARGV'];

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
            // Guarded probes and not try/catch: none of these calls has a throw path
            // (no `throws` in the GIR), so a catch would have nothing to catch and
            // would hide a real absence. What is genuinely optional is the API.
            const stub = giRuntimePathsStub(['x']);
            expect(stub.includes('dup_default')).toBe(true);
            for (const guard of ['!i||!i.gi', '!R||!R.Repository', '!r.prepend_search_path']) {
                expect(stub.includes(guard)).toBe(true);
            }
            expect(/\bcatch\b/.test(stub)).toBe(false);
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

        await it('emits every directory it was given, JSON-quoted', async () => {
            const dirs = ['a-dir', 'with space', "with'quote"];
            const stub = giRuntimePathsStub(dirs);
            for (const d of dirs) expect(stub.includes(JSON.stringify(d))).toBe(true);
        });
    });
};
