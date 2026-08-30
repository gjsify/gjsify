// SPDX-License-Identifier: MIT
// The `.dmg` target: what `hdiutil` is told, where the image may be packed, and
// what a Linux host is allowed to conclude about it (#1354 M4, ADR 0024 § A1/§ A6).
//
// EVERYTHING HERE IS PURE — no `hdiutil`, no filesystem — for the same reason
// `flatpak.spec.ts` is, one OS further away: the leg that runs this file is the
// containerised `e2e`/unit leg on Fedora, and `hdiutil` exists on exactly one
// operating system, which is not that one. What only a real `hdiutil` can answer
// — does the volume mount, is the image a UDIF a stranger's Finder opens —
// belongs to the darwin pack leg and the Linux reader leg behind it
// (`.github/ship-oracle/verify-dmg.py`), and neither is a claim this file makes.
//
// AND NO PATH IN THIS FILE IS SPELLED WITH A `/`. The two absolute strings below
// are opaque INPUTS `hdiutilCreateArgs` passes through untouched, so they compare
// to themselves on any host; every path this file builds or inspects goes through
// `join`/`sep`. That rule is here because breaking it cost a red `win32` leg — see
// `the volume is assembled apart from the artifact` below.
//
// SO WHAT IS LEFT IS THE HALF THAT CAN STILL BE WRONG WITHOUT ANY OF THAT: the
// flag vector, the volume name, and the two refusals that decide whether this
// packer ever runs. A wrong `-fs` produces an APFS image that the whole Linux
// reader chain cannot open, at exit 0, on a Mac — the failure would surface two
// jobs later as "dmg2img: not a valid dmg" and read as a broken artifact rather
// than as a wrong flag.

import { join, sep } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';

import {
    assertHostCanFinish,
    assertToolsInstalled,
    defaultFormatIds,
    FORMATS,
    FORMAT_IDS,
    formatIdsFor,
    resolveFormats,
} from './formats.js';
import { DMG_TOOL, dmgVolumeDir, dmgVolumeName, hdiutilCreateArgs } from './dmg.js';
import { LAYOUTS } from './layout.js';
import { SCHEMA_COMPILER } from './schemas.js';
import type { PackSettings } from './types.js';

function packSettings(overrides: Partial<PackSettings> = {}): PackSettings {
    return {
        binaryName: 'ship-demo',
        appId: 'org.example.ShipDemo',
        version: '1.2.3',
        release: '1',
        maintainer: 'Dev <dev@example.org>',
        summary: 'A demo',
        description: ['A demo.'],
        license: 'MIT',
        section: 'utils',
        group: 'Applications/System',
        extraDepends: { deb: [], rpm: [] },
        typelibPackages: {},
        app: 'node' as const,
        minGjsVersion: '1.86',
        minNodeVersion: '24',
        name: 'Ship Demo',
        flatpak: {
            runtime: 'org.gnome.Platform',
            runtimeVersion: '50',
            sdk: 'org.gnome.Sdk',
            branch: 'stable',
            sdkExtensions: [],
            appendPath: [],
            finishArgs: [],
            cleanup: [],
        },
        ...overrides,
    };
}

/** The flag vector under test, with the two paths the caller supplies. */
function args(volumeName = 'Ship Demo'): string[] {
    return hdiutilCreateArgs({
        volumeName,
        sourceDir: '/out/ship/dmg/volume',
        target: '/out/ship/out/ship-demo-1.2.3-1.arm64.dmg',
    });
}

/** The value `hdiutil` receives for a flag, so an assertion names the pair and not an index. */
function flag(name: string, vector: string[] = args()): string | undefined {
    const at = vector.indexOf(name);
    return at === -1 ? undefined : vector[at + 1];
}

export default async () => {
    await describe('hdiutilCreateArgs', async () => {
        await it('asks for a READ-ONLY zlib image, because the reader is 7-Zip 23.01', async () => {
            // UDZO is zlib. The alternatives — ULFO (LZFSE) and ULMO (LZMA) —
            // need a newer decoder than the reader leg has: `ubuntu-latest` is
            // ubuntu-24.04 and ships 7-Zip 23.01, measured, while this
            // workstation happens to carry 26.02. A format chosen against the
            // developer's own tool is a format the CI reader cannot open.
            expect(flag('-format')).toBe('UDZO');
        });

        await it('names HFS+ explicitly rather than taking the default', async () => {
            // THE FLAG THIS WHOLE FILE EXISTS FOR. `hdiutil`'s default filesystem
            // follows the OS, and on a current macOS that is APFS — for which
            // `dmg2img` produces nothing usable and `fsck.hfsplus` has no subject,
            // leaving 7-Zip's handler as the sole reader. Two of the three oracles
            // would silently stop reading anything, on a host no Linux
            // contributor can inspect.
            expect(flag('-fs')).toBe('HFS+J');
        });

        await it('takes the SOURCE FOLDER and lets hdiutil size the image', async () => {
            // `-srcfolder` and not `-size`: a hardcoded size is a number that is
            // right until the payload grows past it, and the failure then lands on
            // whoever added a file rather than on whoever typed the number.
            expect(flag('-srcfolder')).toBe('/out/ship/dmg/volume');
            expect(args()).not.toContain('-size');
            expect(args()).not.toContain('-srcdevice');
        });

        await it('overwrites, because `out/` may hold the previous run', async () => {
            // `hdiutil create` REFUSES an existing target rather than replacing
            // it. Without `-ov` the pack succeeds once and fails on every re-run
            // in the same output directory — a failure that never reproduces on a
            // fresh CI runner.
            expect(args()).toContain('-ov');
        });

        await it('is `create` first and the target last, which is the tool grammar', async () => {
            const vector = args();
            expect(vector[0]).toBe('create');
            expect(vector[vector.length - 1]).toBe('/out/ship/out/ship-demo-1.2.3-1.arm64.dmg');
        });

        await it('passes the volume name as ONE argument, spaces and all', async () => {
            // A display name contains spaces. Split into two arguments, `hdiutil`
            // reads the tail as an image path and the error is about the wrong
            // thing entirely.
            expect(flag('-volname')).toBe('Ship Demo');
        });

        await it('keeps the progress meter out of a CI log', async () => {
            expect(args()).toContain('-quiet');
        });
    });

    await describe('dmgVolumeName', async () => {
        await it('mounts under the DISPLAY name, the one the bundle carries', async () => {
            // The volume and the `.app` inside it are the two names a user reads
            // in the one window this format has. `ship-demo-1.2.3` around
            // `Ship Demo.app` reads as somebody else's download.
            expect(dmgVolumeName(packSettings())).toBe('Ship Demo');
            // …while the FILE keeps the versioned, space-free spelling. Same split
            // the `.app` and its zip already make.
            expect(FORMATS['macos-app-dmg'].fileName(packSettings(), 'arm64')).toBe('ship-demo-1.2.3-1.arm64.dmg');
        });

        await it('refuses an empty name instead of shipping a volume called `untitled`', async () => {
            // `resolveShipSettings` derives the name as
            // `metadata.name ?? titleCase(binaryName)`, and `??` passes `''`
            // through. `hdiutil` accepts an empty `-volname` at exit 0 and calls
            // the volume `untitled` — the name every nameless image on the machine
            // has, so the user's Finder shows two of them.
            expect(() => dmgVolumeName(packSettings({ name: '' }))).toThrow();
            expect(() => dmgVolumeName(packSettings({ name: '   ' }))).toThrow();
        });

        await it('refuses the two characters HFS+ and the Finder swap', async () => {
            // Measured behaviour of HFS+, not a guess: `/` is the POSIX separator
            // and `:` is HFS+'s, and the Finder displays each as the other. The
            // volume would mount under a name this project never chose.
            expect(() => dmgVolumeName(packSettings({ name: 'Ship/Demo' }))).toThrow();
            expect(() => dmgVolumeName(packSettings({ name: 'Ship:Demo' }))).toThrow();
        });

        await it('allows a backslash, which is Windows’ problem and not HFS+’s', async () => {
            // The control for the rule above. A blanket "no punctuation" guard
            // would pass the two tests above while refusing a name macOS accepts,
            // and nothing would say which rule was actually being enforced.
            expect(dmgVolumeName(packSettings({ name: 'Ship\\Demo' }))).toBe('Ship\\Demo');
        });
    });

    await describe('the volume is assembled apart from the artifact', async () => {
        await it('never builds the volume in `out/`, which holds the artifacts', async () => {
            // `-srcfolder` copies WHATEVER it finds. A volume root that is also
            // the output directory would put the `.deb` beside it — or the
            // previous run's `.dmg` INSIDE this run's image — and the reader that
            // would catch it is the same listing comparison that would then have
            // to be taught to ignore it.
            //
            // SPELLED WITH `join`/`sep`, and the first draft was not — it compared
            // against the literal `/out/ship/dmg`, which is what `path.join`
            // answers on two of the three operating systems this repository ships
            // for. `dmgVolumeDir` builds a path on the PACKING HOST (the directory
            // `hdiutil` is pointed at, and the parent that becomes the spawn's
            // `cwd`), so it uses `node:path`'s `join` and gives `\` on Windows: the
            // implementation was right and the ASSERTION was Linux-shaped. It went
            // red on `windows-suites.yml`'s `@gjsify/cli` leg and nowhere else,
            // which is the whole reason that leg exists — a `.dmg` is darwin-only,
            // but the code deciding where the volume goes is compiled and unit-
            // tested on every host.
            //
            // And it is the PROPERTY that is asserted, not the implementation
            // restated: the volume must not BE the artifact directory, must not be
            // INSIDE it, and must still be under the run's output root. A
            // `dmgVolumeDir` returning `join(outRoot, 'out', 'volume')` or
            // `outRoot` itself reds here.
            const outRoot = join('build', 'ship');
            const artifacts = join(outRoot, 'out');
            const dir = dmgVolumeDir(outRoot);
            expect(dir === artifacts).toBe(false);
            expect(dir.startsWith(`${artifacts}${sep}`)).toBe(false);
            expect(dir.startsWith(`${outRoot}${sep}`)).toBe(true);
        });
    });

    await describe('the .dmg format descriptor', async () => {
        await it('wraps the darwin layout and adds no prefix of its own', async () => {
            const dmg = FORMATS['macos-app-dmg'];
            expect(dmg.layoutOs).toBe('darwin');
            // The same empty prefix its two siblings carry: a `.dmg` is a volume
            // around the same `<App>.app`, so nothing in the payload moves — which
            // is ADR 0024 § 2's claim, tested on the third macOS row.
            expect(dmg.prefix).toBe('');
            expect(dmg.prefix).toBe(FORMATS['macos-app'].prefix);
            expect(dmg.depends).toBe(null);
            expect(dmg.interpreters).toStrictEqual(['node']);
            expect(dmg.artifactKind).toBe('file');
        });

        await it('is the first row that is host-bound by its CONTAINER', async () => {
            // Flatpak is `['linux']` because flatpak runs on Linux — the format is
            // bound the way the application is. This one is bound because the only
            // UDIF writer in existence is on darwin, while the tree it wraps
            // assembles anywhere.
            expect(FORMATS['macos-app-dmg'].host.finishOn).toStrictEqual(['darwin']);
            expect(FORMATS['macos-app'].host.finishOn).toBe('any');
            expect(FORMATS['macos-app-zip'].host.finishOn).toBe('any');
        });

        await it('execs hdiutil and NOT the schema compiler its siblings declare', async () => {
            // Deliberate asymmetry, and the reason is the host boundary. The two
            // rows above declare `glib-compile-schemas`, which `schemas.ts` runs
            // at ASSEMBLY time because a non-Linux layout has no install step.
            // `assertToolsInstalled` fires on the PACK path — so declaring it here
            // would refuse a `--from-stage` pack on a Mac with no GLib, a pack
            // that works because `gschemas.compiled` already arrived in the stage.
            expect(FORMATS['macos-app-dmg'].host.requiredTools).toStrictEqual([DMG_TOOL]);
            expect(DMG_TOOL).toBe('hdiutil');
            expect(FORMATS['macos-app-dmg'].host.requiredTools).not.toContain(SCHEMA_COMPILER);
            expect(FORMATS['macos-app'].host.requiredTools).toContain(SCHEMA_COMPILER);
        });

        await it('reads back with three tools, none of them hdiutil, all on Linux', async () => {
            // ADR 0024 § A3 names this format as the case the field exists for:
            // `hdiutil verify` is hdiutil reading what hdiutil wrote. A reader on
            // the PACKING host would be worth less even if it were independent, so
            // the whole chain is declared for Linux — where every CI leg has one.
            const { oracle } = FORMATS['macos-app-dmg'].host;
            expect(oracle.readWith).toStrictEqual(['7z', 'dmg2img', 'fsck.hfsplus']);
            expect(oracle.readWith).not.toContain(DMG_TOOL);
            expect(oracle.readOn).toStrictEqual(['linux']);
            expect(oracle.selfReading).toBe(false);
        });

        await it('carries an install hint that does not name a package, because there is none', async () => {
            // `flatpak.spec.ts` requires a hint for every tool-needing row. This
            // one has to be honest instead of useful: `hdiutil` ships with macOS,
            // so a hint saying `brew install` or `dnf install` would send the one
            // reader who can ever see it — somebody on a Mac — to a package
            // manager that has never heard of it.
            const hint = FORMATS['macos-app-dmg'].host.installHint ?? '';
            expect(hint.length > 0).toBe(true);
            expect(hint).toContain('macOS');
            expect(hint.includes('dnf install')).toBe(false);
            expect(hint.includes('apt install')).toBe(false);
        });
    });

    await describe('when the .dmg is built, and when it is refused', async () => {
        await it('stays out of a bare `gjsify ship darwin`, like every host-bound row', async () => {
            // The same rule Flatpak established: a host-bound format is opt-in
            // through `--target` or `gjsify.ship.targets`, or a bare
            // `gjsify ship darwin` on Linux would start demanding a Mac.
            expect(defaultFormatIds('darwin')).toStrictEqual(['macos-app', 'macos-app-zip']);
            expect(formatIdsFor('darwin')).toContain('macos-app-dmg');
            expect(FORMAT_IDS).toContain('macos-app-dmg');
        });

        await it('resolves when it is asked for, beside the rows it shares a tree with', async () => {
            expect(resolveFormats(['macos-app-dmg'], LAYOUTS.darwin).map((f) => f.id)).toStrictEqual(['macos-app-dmg']);
            expect(resolveFormats(['macos-app,macos-app-dmg'], LAYOUTS.darwin).map((f) => f.id)).toStrictEqual([
                'macos-app',
                'macos-app-dmg',
            ]);
        });

        await it('is not a linux target, and the refusal says which layout to name', async () => {
            let message = '';
            try {
                resolveFormats(['macos-app-dmg'], LAYOUTS.linux);
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('macos-app-dmg');
            expect(message).toContain('darwin');
        });

        await it('refuses to pack off darwin, and names the two-phase way across', async () => {
            // The refusal a Linux contributor gets, and the only thing that turns
            // "unsupported" into an instruction. Both non-darwin hosts, because
            // the `finishOn` list is a membership test and a one-host test cannot
            // tell an inclusive check from a `=== 'darwin'`.
            for (const host of ['linux', 'win32']) {
                let message = '';
                try {
                    assertHostCanFinish(FORMATS['macos-app-dmg'], host);
                } catch (error) {
                    message = (error as Error).message;
                }
                expect(message).toContain('darwin');
                expect(message).toContain(host);
                expect(message).toContain('--stage');
                expect(message).toContain('--from-stage');
            }
        });

        await it('allows the pack on darwin', async () => {
            assertHostCanFinish(FORMATS['macos-app-dmg'], 'darwin');
        });

        await it('names the missing tool, not the format, when hdiutil is absent', async () => {
            let message = '';
            try {
                assertToolsInstalled(FORMATS['macos-app-dmg'], () => false);
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('hdiutil');
            // `--stage` needs neither the tool nor the host, and a user told only
            // "install hdiutil" on a machine that cannot have it is stuck.
            expect(message).toContain('--stage');
        });

        await it('passes when hdiutil is present', async () => {
            assertToolsInstalled(FORMATS['macos-app-dmg'], (cmd) => cmd === DMG_TOOL);
        });
    });
};
