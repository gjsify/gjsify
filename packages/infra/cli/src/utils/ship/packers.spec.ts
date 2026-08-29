// SPDX-License-Identifier: MIT
// The two packers, at the level the e2e suite cannot reach.
//
// `tests/e2e/ship` proves whole artifacts against `rpm`, `ar` and `tar` — but
// only for the payload that suite happens to build, and only where those tools
// exist. The cases here are the ones a fixture would have to be contorted to
// produce: an `Installed-Size` whose unit is invisible when wrong (dpkg never
// validates it, so a bytes-instead-of-KiB error ships silently), a control
// value carrying a newline, and a payload with a native binary in it — which
// nothing in the e2e fixture has, so the architecture derivation is otherwise
// tested in one direction only.

import { describe, expect, it } from '@gjsify/unit';

import { buildDeb } from './deb.js';
import { FORMATS, windowsProgramDirName } from './formats.js';
import { LAYOUTS } from './layout.js';
import { buildRpm } from './rpm.js';
import {
    assertPayloadMatchesArch,
    isArchIndependent,
    assertLauncherMatchesInterpreter,
    readBinaryArch,
    readLauncherInterpreters,
    readShebangInterpreters,
    type PayloadEntry,
} from './payload.js';
import type { ShipSettings } from './types.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function settings(overrides: Partial<ShipSettings> = {}): ShipSettings {
    return {
        projectDir: '/p',
        appId: 'org.example.Hello',
        name: 'Hello',
        binaryName: 'hello',
        version: '1.0.0',
        release: '1',
        maintainer: 'Dev <dev@example.org>',
        summary: 'A demo',
        description: ['A demo', 'Second paragraph.'],
        license: 'MIT',
        homepage: 'https://example.org',
        section: 'gnome',
        group: 'Applications/System',
        kind: 'cli',
        mimeTypes: [],
        extraDepends: { deb: [], rpm: [] },
        typelibPackages: {},
        bundlePath: '/p/dist/gjs.js',
        bundleDir: '/p/dist',
        iconFiles: [],
        schemaFiles: [],
        typelibFiles: [],
        localeFiles: [],
        extraFiles: {},
        execArgs: [],
        outDir: 'ship',
        arch: 'x64',
        app: 'gjs' as const,
        layoutOs: 'linux',
        minGjsVersion: '1.86',
        minNodeVersion: '24',
        ...overrides,
    };
}

function payload(entries: Array<[string, number, Uint8Array | string]>): PayloadEntry[] {
    return entries.map(([path, mode, data]) => ({
        path,
        mode,
        data: typeof data === 'string' ? encoder.encode(data) : data,
    }));
}

/**
 * Read `control` out of a built `.deb`.
 *
 * The e2e suite does this with GNU `ar` + `tar`, which is the stronger check
 * because those readers share no code with the writer. These cases assert on
 * the FIELD TEXT instead, so they use a small in-test ar walk and the same Web
 * decompression API — which keeps them runnable anywhere, including under GJS.
 */
async function debControl(inputs: Parameters<typeof buildDeb>[0]): Promise<string> {
    const bytes = await buildDeb(inputs);
    const text = decoder.decode(await gunzipMember(bytes, 'control.tar.gz'));
    const start = text.indexOf('Package:');
    return text.slice(start, text.indexOf('\0', start));
}

/** Pull one ar member out and gunzip it. */
async function gunzipMember(archive: Uint8Array, name: string): Promise<Uint8Array> {
    let offset = 8;
    while (offset < archive.byteLength) {
        const header = decoder.decode(archive.subarray(offset, offset + 60));
        const memberName = header.slice(0, 16).trim();
        const size = Number(header.slice(48, 58).trim());
        const body = archive.subarray(offset + 60, offset + 60 + size);
        if (memberName === name) {
            const stream = new Blob([new Uint8Array(body)]).stream().pipeThrough(new DecompressionStream('gzip'));
            const chunks: Uint8Array[] = [];
            const reader = stream.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value as Uint8Array);
            }
            let total = 0;
            for (const chunk of chunks) total += chunk.byteLength;
            const out = new Uint8Array(total);
            let at = 0;
            for (const chunk of chunks) {
                out.set(chunk, at);
                at += chunk.byteLength;
            }
            return out;
        }
        offset += 60 + size + (size % 2);
    }
    throw new Error(`no ar member named ${name}`);
}

export default async () => {
    await describe('buildDeb: control', async () => {
        const base = {
            settings: settings(),
            prefix: FORMATS.deb.prefix,
            depends: ['gjs >= 1.86', 'gir1.2-gtk-4.0'],
            archLabel: 'all',
            mtime: 1700000000,
        };

        await it('counts Installed-Size in KiB — files rounded UP, one per directory', async () => {
            // dpkg never validates this field, so a bytes-instead-of-KiB error
            // (1024x) ships and only ever shows up as a wrong number in apt.
            // 1500 B → 2 KiB, 10 B → 1 KiB, plus `./`, `./usr/`, `./usr/bin/`,
            // `./usr/share/` and `./usr/share/hello/` = 5 directories.
            const control = await debControl({
                ...base,
                payload: payload([
                    ['bin/hello', 0o755, 'x'.repeat(1500)],
                    ['share/hello/data', 0o644, 'x'.repeat(10)],
                ]),
            });
            expect(control).toContain('Installed-Size: 8');
        });

        await it("spells the dependency bound dpkg's way", async () => {
            const control = await debControl({ ...base, payload: payload([['bin/hello', 0o755, 'x']]) });
            expect(control).toContain('Depends: gjs (>= 1.86), gir1.2-gtk-4.0');
        });

        await it('keeps a wrapped summary on ONE line instead of forging a field', async () => {
            // A newline here does not corrupt the file, it invents a field.
            const control = await debControl({
                ...base,
                settings: settings({ summary: 'benign summary\nPre-Depends: evil-package' }),
                payload: payload([['bin/hello', 0o755, 'x']]),
            });
            expect(control).toContain('Description: benign summary Pre-Depends: evil-package');
            expect(control).not.toContain('\nPre-Depends:');
        });

        await it('ends with exactly one newline, which dpkg parses for', async () => {
            const control = await debControl({ ...base, payload: payload([['bin/hello', 0o755, 'x']]) });
            expect(control.endsWith('\n')).toBe(true);
            expect(control.endsWith('\n\n')).toBe(false);
        });
    });

    await describe('buildRpm', async () => {
        await it('writes the lead magic rpm validates before anything else', async () => {
            // Everything past the magic is checked by the real `rpm` in the e2e
            // suite; what this pins is that a package is produced at all, and
            // that the build-time parallel-array invariant did not reject it.
            const built = await buildRpm({
                settings: settings(),
                payload: payload([['bin/hello', 0o755, 'x']]),
                prefix: FORMATS.rpm.prefix,
                depends: ['gjs >= 1.86'],
                archLabel: 'noarch',
                mtime: 1700000000,
            });
            // Lead magic — the one field rpm validates before anything else.
            expect(Array.from(built.subarray(0, 4))).toStrictEqual([0xed, 0xab, 0xee, 0xdb]);
        });
    });

    await describe('readShebangInterpreters', async () => {
        // The defect this reads for: every `.rpm` this writer produced installed a
        // `#!/bin/sh` launcher and required no shell. `rpmbuild` emits one
        // `Requires` per executable shebang; nothing here did until the first real
        // `rpm -qp --requires` ran against the artifact.
        await it('reads the interpreter an executable actually asks for', () => {
            expect(readShebangInterpreters(payload([['bin/hello', 0o755, '#!/bin/sh\nexec gjs\n']]))).toStrictEqual([
                '/bin/sh',
            ]);
        });

        await it('takes the interpreter, not the arguments after it', () => {
            expect(
                readShebangInterpreters(payload([['bin/hello', 0o755, '#!/usr/bin/env -S gjs -m\n']])),
            ).toStrictEqual(['/usr/bin/env']);
        });

        // The GJS bundle case, and the reason the mode is read at all: it carries a
        // shebang for the days it is run directly, but the installed package never
        // executes it as a program — the launcher passes it to `gjs` as an argument.
        await it('says nothing about a shebang in a file the package cannot execute', () => {
            expect(
                readShebangInterpreters(payload([['lib/hello/cli.gjs.mjs', 0o644, '#!/usr/bin/env -S gjs -m\n']])),
            ).toStrictEqual([]);
        });

        await it('ignores a file whose first line is not a shebang at all', () => {
            expect(readShebangInterpreters(payload([['bin/hello', 0o755, 'MZ\u0000\u0000binary\n']]))).toStrictEqual(
                [],
            );
        });

        await it('reports each interpreter once, in a stable order', () => {
            const entries = payload([
                ['bin/b', 0o755, '#!/usr/bin/perl\n'],
                ['bin/a', 0o755, '#!/bin/sh\n'],
                ['bin/c', 0o755, '#!/bin/sh\n'],
            ]);
            expect(readShebangInterpreters(entries)).toStrictEqual(['/bin/sh', '/usr/bin/perl']);
        });
    });

    await describe('the launcher and the dependency must name the same interpreter', async () => {
        const IDENTITY = { binaryName: 'demo', name: 'Demo App' };
        const at = (path: string) => (text: string) => [{ path, mode: 0o755, data: encoder.encode(text) }];
        const linuxLauncher = at('bin/demo');
        // Where the SAME launcher sits in the other two layouts. `place()` is not
        // used to build these: the point is to check the reader against paths a
        // human wrote down, exactly as `tests/e2e/ship-layout` writes its map out.
        const darwinLauncher = at('Demo App.app/Contents/MacOS/demo');
        const windowsLauncher = at('demo.cmd');
        const gjsLauncher = '#!/bin/sh\nset -e\nexec gjs -m "$prefix"/lib/demo/app.gjs.js "$@"\n';
        const nodeLauncher = '#!/bin/sh\nset -e\nexec node "$prefix"/lib/demo/app.node.mjs "$@"\n';
        // The Windows launcher is a `.cmd`, and until #1354 M3 these fixtures put
        // the POSIX text above at `demo.cmd` — a file no `cmd.exe` could run, which
        // made this an assertion about a reader applied to a launcher that does not
        // exist. The reader is dialect-aware now (batch has no `exec`, `%~dp0`
        // carries its own separator, and the file is `node.exe`), so the fixture has
        // to be the thing it reads.
        const cmdGjsLauncher = '@echo off\r\nsetlocal\r\nset "HERE=%~dp0"\r\ngjs -m "%HERE%app\\app.gjs.js" %*\r\n';
        const cmdNodeLauncher =
            '@echo off\r\nsetlocal\r\nset "HERE=%~dp0"\r\n"%HERE%node.exe" "%HERE%app\\app.node.mjs" %*\r\n';

        await it('reads the interpreter off the staged launcher', async () => {
            expect(readLauncherInterpreters(linuxLauncher(gjsLauncher), LAYOUTS.linux, IDENTITY)).toStrictEqual([
                'gjs',
            ]);
            expect(readLauncherInterpreters(linuxLauncher(nodeLauncher), LAYOUTS.linux, IDENTITY)).toStrictEqual([
                'node',
            ]);
        });

        await it('resolves a launcher this tree did not write', async () => {
            // `gjsify.ship.extraFiles` can replace `bin/<name>` outright, and
            // these are the shapes a hand-written one takes. The raw-token
            // version answered `/usr/bin/gjs` and `env`, and REFUSED both.
            expect(
                readLauncherInterpreters(linuxLauncher('exec /usr/bin/gjs -m /app/x.js\n'), LAYOUTS.linux, IDENTITY),
            ).toStrictEqual(['gjs']);
            expect(
                readLauncherInterpreters(
                    linuxLauncher('exec env NODE_OPTIONS=--x node /app/x.mjs\n'),
                    LAYOUTS.linux,
                    IDENTITY,
                ),
            ).toStrictEqual(['node']);
            expect(
                readLauncherInterpreters(
                    linuxLauncher('exec /usr/bin/env -S node --enable-source-maps /a.mjs\n'),
                    LAYOUTS.linux,
                    IDENTITY,
                ),
            ).toStrictEqual(['node']);
        });

        await it('reports EVERY exec, not the first — a launcher may branch', async () => {
            // The first cut's comment said "the LAST `exec` line" while its
            // non-global regex returned the FIRST. Neither is right for a script
            // with branches, so all of them are collected and the caller decides.
            const branching =
                '#!/bin/sh\nif [ -n "$WAYLAND_DISPLAY" ]; then\n  exec gjs -m /a.js\nfi\nexec gjs -m /b.js\n';
            expect(readLauncherInterpreters(linuxLauncher(branching), LAYOUTS.linux, IDENTITY)).toStrictEqual(['gjs']);
            const mixed = '#!/bin/sh\nif [ "$X" ]; then\n  exec node /a.mjs\nfi\nexec gjs -m /b.js\n';
            expect(readLauncherInterpreters(linuxLauncher(mixed), LAYOUTS.linux, IDENTITY)).toStrictEqual([
                'node',
                'gjs',
            ]);
        });

        await it('refuses a package that depends on one interpreter and execs the other', async () => {
            // The defect measured on the first cut of the Node half: a filename
            // heuristic put `nodejs (>= 24)` in `Depends:` while this line still
            // read `exec gjs -m`. Both files were individually well-formed, so no
            // structural check could see it — only comparing them can.
            expect(() =>
                assertLauncherMatchesInterpreter(linuxLauncher(gjsLauncher), LAYOUTS.linux, IDENTITY, 'node'),
            ).toThrow('execs `gjs`');
            expect(() =>
                assertLauncherMatchesInterpreter(linuxLauncher(nodeLauncher), LAYOUTS.linux, IDENTITY, 'gjs'),
            ).toThrow('execs `node`');
        });

        await it('names a cause the reader can act on, and not the false one', async () => {
            // "re-run the `--stage` phase" was the old advice and is FALSE for the
            // case that reaches a user: re-staging an extraFiles override
            // reproduces it forever.
            let message = '';
            try {
                assertLauncherMatchesInterpreter(linuxLauncher(nodeLauncher), LAYOUTS.linux, IDENTITY, 'gjs');
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('gjsify.ship.extraFiles');
            expect(message).not.toContain('--stage');
        });

        await it('passes a working package whose launcher it merely does not understand', async () => {
            // FAIL ONLY on a positively identified OTHER interpreter. Everything
            // else passes: a guard that turns working packages into failures buys
            // nothing over the defect it prevents.
            assertLauncherMatchesInterpreter(linuxLauncher(gjsLauncher), LAYOUTS.linux, IDENTITY, 'gjs');
            assertLauncherMatchesInterpreter(
                linuxLauncher('exec /usr/bin/gjs -m /a.js\n'),
                LAYOUTS.linux,
                IDENTITY,
                'gjs',
            );
            assertLauncherMatchesInterpreter(
                linuxLauncher('exec env NODE_OPTIONS=--x node /a.mjs\n'),
                LAYOUTS.linux,
                IDENTITY,
                'node',
            );
            // Neither interpreter, no exec at all, no launcher, and a branch that
            // includes the declared one.
            assertLauncherMatchesInterpreter(
                linuxLauncher('exec /usr/bin/python3 /a.py\n'),
                LAYOUTS.linux,
                IDENTITY,
                'gjs',
            );
            assertLauncherMatchesInterpreter(linuxLauncher('#!/bin/sh\nexit 0\n'), LAYOUTS.linux, IDENTITY, 'node');
            assertLauncherMatchesInterpreter([], LAYOUTS.linux, IDENTITY, 'node');
            assertLauncherMatchesInterpreter(
                linuxLauncher('#!/bin/sh\nif [ "$X" ]; then\n  exec node /a.mjs\nfi\nexec gjs -m /b.js\n'),
                LAYOUTS.linux,
                IDENTITY,
                'gjs',
            );
            expect(readLauncherInterpreters([], LAYOUTS.linux, IDENTITY)).toStrictEqual([]);
        });

        await it("reads the LAYOUT's launcher, not the prefix-relative path, on every OS", async () => {
            // THE DISCRIMINATOR for a reader that was vacuous off Linux. It looked
            // up `bin/<binaryName>` — the PREFIX-relative path — which exists in no
            // non-Linux stage, so both lines below answered `[]` before this was
            // fixed: a `.app` whose launcher execs the wrong interpreter passed a
            // check that had found no launcher at all. Run against the old reader
            // these two `toStrictEqual` calls fail and the two `toThrow`s below
            // report "expected function to throw".
            expect(readLauncherInterpreters(darwinLauncher(nodeLauncher), LAYOUTS.darwin, IDENTITY)).toStrictEqual([
                'node',
            ]);
            expect(readLauncherInterpreters(windowsLauncher(cmdGjsLauncher), LAYOUTS.windows, IDENTITY)).toStrictEqual([
                'gjs',
            ]);
            expect(() =>
                assertLauncherMatchesInterpreter(darwinLauncher(gjsLauncher), LAYOUTS.darwin, IDENTITY, 'node'),
            ).toThrow('execs `gjs`');
            expect(() =>
                assertLauncherMatchesInterpreter(windowsLauncher(cmdNodeLauncher), LAYOUTS.windows, IDENTITY, 'gjs'),
            ).toThrow('execs `node`');
            // And the message names the path the reader would go and LOOK at,
            // which `bin/demo` was not on either of these layouts.
            let message = '';
            try {
                assertLauncherMatchesInterpreter(darwinLauncher(gjsLauncher), LAYOUTS.darwin, IDENTITY, 'node');
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('Demo App.app/Contents/MacOS/demo');
        });

        await it('is not fooled by the word `exec` inside the launcher body', async () => {
            const withNoise =
                '#!/bin/sh\n# exec gjs is what this used to do\nEXECUTABLE=1\nexec node "$prefix"/lib/demo/a.mjs\n';
            expect(readLauncherInterpreters(linuxLauncher(withNoise), LAYOUTS.linux, IDENTITY)).toStrictEqual(['node']);
        });
    });

    await describe('isArchIndependent', async () => {
        await it('reads the magic, not the file name', async () => {
            const elf = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1, 0]);
            // A bundled runtime is just called `node`; an extension list misses
            // it and calls an x86-64 payload `Architecture: all`, which apt then
            // installs on arm64.
            expect(isArchIndependent(payload([['lib/hello/node', 0o755, elf]]))).toBe(false);
            expect(isArchIndependent(payload([['lib/hello/main.js', 0o644, 'print(1)']]))).toBe(true);
        });

        await it('names the artifact after the architecture it derived', async () => {
            const elf = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1, 0]);
            const native = payload([['lib/hello/native.node', 0o755, elf]]);
            const pure = payload([['lib/hello/main.js', 0o644, 'print(1)']]);
            for (const format of [FORMATS.deb, FORMATS.rpm]) {
                const nativeName = format.fileName(settings(), format.archName('x64', isArchIndependent(native)));
                const pureName = format.fileName(settings(), format.archName('x64', isArchIndependent(pure)));
                expect(nativeName).toContain(format.id === 'deb' ? 'amd64' : 'x86_64');
                expect(pureName).toContain(format.id === 'deb' ? 'all' : 'noarch');
            }
        });
    });

    await describe('windowsProgramDirName', async () => {
        await it('refuses a name Windows cannot hold, in all three ways it cannot', async () => {
            // THE CLASS: the artifact assembles at exit 0 on Linux, uploads, and
            // fails on a stranger's box — which is the whole shape `gjsify ship` is
            // built against, and the reason this is checked on the ASSEMBLING host.
            // An earlier draft tested only the reserved characters while calling
            // itself "the Win32 reserved set", and every name below passed it.
            for (const bad of [
                'A<B', // reserved characters
                'A|B',
                'A?B',
                'CON', // reserved DEVICE names — devices at every path
                'nul',
                'COM1',
                'PRN.txt', // …with or without an extension
                'Demo.', // a trailing dot or space, which Win32 silently STRIPS,
                'Demo ', // so the directory created is not the one `%~dp0` resolves
            ]) {
                expect(() => windowsProgramDirName({ ...settings(), name: bad })).toThrow(
                    'the windows layout would put this app in a directory called',
                );
            }
            // EMPTY IS ITS OWN MESSAGE, because it is its own defect: an empty name
            // gives the zip no top level, which is exactly the scattering
            // `windows-dir-zip` synthesises one to prevent — reproduced at exit 0 by
            // the function that prevents it. `resolveShipSettings` derives the name
            // with `??`, which passes `''` straight through.
            for (const empty of ['', '   ']) {
                expect(() => windowsProgramDirName({ ...settings(), name: empty })).toThrow(
                    'has no name to call the program directory',
                );
            }
            // …and the names a third-party app actually has.
            expect(windowsProgramDirName({ ...settings(), name: 'Ship Demo' })).toBe('Ship Demo');
            expect(windowsProgramDirName({ ...settings(), name: 'Console' })).toBe('Console');
        });
    });

    // `--arch` LABELS the payload and cross-compiles nothing, and until this
    // guard the two were never compared. Reproduced on 0.41.0: a payload with one
    // x86-64 `.so`, packed `--arch arm64` on an x86-64 host, produced
    // `…_arm64.deb` and `….aarch64.rpm`; `rpm -qp --qf '%{ARCH}'` answered
    // `aarch64` while the `.so` inside it was ELF `e_machine` 0x3e. The
    // independent oracle confirms the lie, because the header it reads was
    // written from the caller's claim.
    await describe('the payload must match the label it is given', async () => {
        /** A minimal ELF header — 20 bytes is all `readBinaryArch` needs. */
        const elfFor = (machine: number): Uint8Array => {
            const data = new Uint8Array(20);
            data.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], 0); // \x7fELF, 64-bit, little-endian
            data[18] = machine & 0xff;
            data[19] = machine >>> 8;
            return data;
        };

        await it('reads the architecture an ELF records about itself', () => {
            expect(readBinaryArch(elfFor(0x3e))).toBe('x64');
            expect(readBinaryArch(elfFor(0xb7))).toBe('arm64');
            expect(readBinaryArch(elfFor(0xf3))).toBe('riscv64');
        });

        await it('says nothing about a file whose architecture it cannot read', () => {
            // Three reasons, all of which must stay silent rather than become a
            // mismatch: not a binary at all, a machine constant nothing here
            // emits, and a PE — whose COFF field this tree has never parsed.
            expect(readBinaryArch(new TextEncoder().encode('#!/bin/sh\nexec gjs -m x\n'))).toBe(null);
            expect(readBinaryArch(elfFor(0x9999))).toBe(null);
            expect(readBinaryArch(Uint8Array.from([0x4d, 0x5a, ...Array.from({ length: 18 }, () => 0)]))).toBe(null);
        });

        await it('REFUSES an x86-64 payload labelled arm64 — the reproduced defect', () => {
            const mixed = payload([
                ['bin/demo', 0o755, '#!/bin/sh\n'],
                ['lib/demo/libdemo.so', 0o755, elfFor(0x3e)],
            ]);
            let message = '';
            try {
                assertPayloadMatchesArch(mixed, 'arm64');
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('lib/demo/libdemo.so');
            expect(message).toContain('does not cross-compile');
        });

        await it('accepts the cross-host case the two-phase split exists to allow', () => {
            // An arm64 payload assembled on an x64 machine is legitimate: the
            // packers are pure JavaScript (ADR 0024 § A1). A host comparison
            // would refuse exactly this, which is why the check is
            // payload-against-LABEL and never payload-against-host.
            const arm = payload([['lib/demo/libdemo.so', 0o755, elfFor(0xb7)]]);
            expect(() => assertPayloadMatchesArch(arm, 'arm64')).not.toThrow();
        });

        await it('accepts a payload with nothing architecture-specific in it', () => {
            const pure = payload([['lib/demo/main.js', 0o644, 'print(1)']]);
            expect(() => assertPayloadMatchesArch(pure, 'arm64')).not.toThrow();
        });
    });
};
