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
import { FORMATS } from './formats.js';
import { buildRpm } from './rpm.js';
import { isArchIndependent, type PayloadEntry } from './payload.js';
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
        minGjsVersion: '1.86',
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
};
