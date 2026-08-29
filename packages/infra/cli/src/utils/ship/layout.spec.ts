// SPDX-License-Identifier: MIT
// The layout map, and the two things it must REFUSE.
//
// Pure, so every case is written without staging anything — the same reason
// `plan.spec.ts` exists. What is worth pinning here is not that `bin/x` becomes
// `Contents/MacOS/x`, which the e2e reads off a real tree, but the pair of
// silent-wrong cases the map creates and nothing else can see: two payload files
// colliding on ONE destination after the map (they cannot collide before it),
// and a display name that would make the `.app` directory disagree with its own
// metadata.

import { describe, expect, it } from '@gjsify/unit';

import { hostLayout, launcherPath, layoutForOs, place, placeStage, resolveLayout, LAYOUTS } from './layout.js';
import type { StagedFile } from './types.js';

const IDENTITY = { binaryName: 'hello', name: 'Hello World' };

function file(path: string): StagedFile {
    return { path, mode: 0o644, source: { kind: 'text', text: '' } };
}

export default async () => {
    await describe('ship layout map', async () => {
        await it('leaves the Linux layout exactly where the plan put it', () => {
            for (const rel of [
                'bin/hello',
                'lib/hello/gjs.js',
                'lib/hello/gi/Gwebgl-0.1.typelib',
                'share/applications/org.example.Hello.desktop',
                'share/locale/de/LC_MESSAGES/hello.mo',
            ]) {
                expect(place(LAYOUTS.linux, IDENTITY, rel)).toBe(rel);
            }
        });

        await it('moves the macOS native files OUT of the bundle directory', () => {
            // The half a prefix substitution cannot express, and the reason
            // `FormatDescriptor.prefix` stopped being enough: on Linux `gi/`
            // sits inside `lib/<name>/`, and on macOS the dylibs belong in
            // `Contents/Frameworks` while the JavaScript belongs in Resources.
            expect(place(LAYOUTS.darwin, IDENTITY, 'lib/hello/gi/libgwebgl.dylib')).toBe(
                'Hello World.app/Contents/Frameworks/libgwebgl.dylib',
            );
            expect(place(LAYOUTS.darwin, IDENTITY, 'lib/hello/gjs.js')).toBe(
                'Hello World.app/Contents/Resources/lib/gjs.js',
            );
            expect(place(LAYOUTS.darwin, IDENTITY, 'share/metainfo/x.xml')).toBe(
                'Hello World.app/Contents/Resources/share/metainfo/x.xml',
            );
        });

        await it('keeps an unrecognised destination inside Contents on macOS', () => {
            // `gjsify.ship.extraFiles` can name any prefix-relative path. Outside
            // `Contents/` the file sits beside the bundle, where nothing in it
            // can address the file and `codesign` later refuses the bundle.
            expect(place(LAYOUTS.darwin, IDENTITY, 'etc/hello.conf')).toBe(
                'Hello World.app/Contents/Resources/etc/hello.conf',
            );
        });

        await it('flattens the Windows program directory and names the launcher .cmd', () => {
            expect(launcherPath(LAYOUTS.windows, IDENTITY)).toBe('hello.cmd');
            expect(place(LAYOUTS.windows, IDENTITY, 'lib/hello/gjs.js')).toBe('app/gjs.js');
            expect(place(LAYOUTS.windows, IDENTITY, 'lib/hello/gi/gwebgl-0.dll')).toBe('lib/gwebgl-0.dll');
            expect(place(LAYOUTS.windows, IDENTITY, 'share/metainfo/x.xml')).toBe('share/metainfo/x.xml');
        });

        await it('refuses two payload files the MAP brings onto one destination', () => {
            // Unreachable before the map: `bin/hello` and `hello.cmd` are two
            // distinct prefix-relative paths, so `planStage`'s deduplication —
            // which is what lets `extraFiles` override a default — leaves both.
            // The Windows map then makes them the same file, and without this
            // one silently replaces the other, decided by plan order.
            expect(() => placeStage(LAYOUTS.windows, IDENTITY, [file('bin/hello'), file('hello.cmd')])).toThrow(
                'install as hello.cmd',
            );
            // The same two paths are fine on Linux, where nothing brings them together.
            expect(placeStage(LAYOUTS.linux, IDENTITY, [file('bin/hello'), file('hello.cmd')]).length).toBe(2);
        });

        await it('refuses a display name a .app directory cannot carry', () => {
            // The Finder and HFS+ swap `/` and `:`, so a bundle named with either
            // is not the bundle its own `Info.plist` will name.
            for (const name of ['A/B', 'A:B', 'A\\B']) {
                expect(() => place(LAYOUTS.darwin, { binaryName: 'hello', name }, 'bin/hello')).toThrow('.app');
            }
        });
    });

    await describe('ship layout vocabulary', async () => {
        await it('records the process.platform spelling, whichever the caller typed', () => {
            // The positional is ADR 0024 § A2's `windows`; `--expect-target`
            // prints `win32-x64`. Both resolve, one is recorded.
            expect(resolveLayout('windows').os).toBe('win32');
            expect(resolveLayout('win32').os).toBe('win32');
            expect(resolveLayout('WINDOWS').name).toBe('windows');
            expect(resolveLayout('darwin').os).toBe('darwin');
        });

        await it('refuses an OS it has no layout for, and lists the ones it has', () => {
            expect(() => resolveLayout('freebsd')).toThrow('linux, darwin, windows');
            expect(() => hostLayout('freebsd')).toThrow('this host is freebsd');
        });

        await it('picks the host layout when the positional is absent', () => {
            expect(hostLayout('linux')).toBe(LAYOUTS.linux);
            expect(hostLayout('darwin')).toBe(LAYOUTS.darwin);
            expect(hostLayout('win32')).toBe(LAYOUTS.windows);
        });

        await it('records ADR 0024 § 4 without letting it decide anything yet', () => {
            // § 4 derives the runtime a SHIPPED ARTIFACT carries: Node on both
            // non-Linux OSes. M1 ships no artifact for either, so the field is
            // DATA and the launcher does not read it — the first cut let it
            // decide, and produced a macOS launcher naming `node` in front of a
            // GJS bundle while refusing every project that honestly declared
            // `gjsify.app: "gjs"`.
            expect(LAYOUTS.linux.shippedRuntime).toBe('gjs');
            expect(LAYOUTS.darwin.shippedRuntime).toBe('node');
            expect(LAYOUTS.windows.shippedRuntime).toBe('node');
        });

        await it('pairs every unmet runtime with the sentence that says why', () => {
            // A declared gap with no explanation is a field nobody reads. The
            // pairing is the invariant: exactly the layouts whose launcher cannot
            // yet name `shippedRuntime` carry a `runtimeGap`, and it is printed.
            expect(LAYOUTS.linux.runtimeGap).toBeUndefined();
            expect(LAYOUTS.darwin.runtimeGap).toContain('relocat');
            expect(LAYOUTS.windows.runtimeGap).toContain('NO GJS host on Windows');
        });

        await it('takes the process.platform spelling ALONE for a stage manifest', () => {
            // `resolveLayout` is for a word a human typed and accepts `windows`.
            // `layoutForOs` is for the manifest's `target.os`, a cross-host wire
            // format with one legal spelling — accepting an alias there makes
            // `--expect-target` stop comparing against the file's own bytes.
            expect(layoutForOs('win32')).toBe(LAYOUTS.windows);
            expect(() => layoutForOs('windows')).toThrow('process.platform');
            expect(() => layoutForOs('darwin')).not.toThrow();
        });
    });
};
