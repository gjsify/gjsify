// SPDX-License-Identifier: MIT
// The byte-level writers, pinned at the offsets a reader actually reads.
//
// These are the parts where "it looks right" and "it is right" come apart:
// a 61-byte ar header, an unaligned INT32 in an rpm store, or a region trailer
// with a positive offset all produce a file that a hex dump makes look fine and
// that `dpkg`/`rpm` reject — or, worse, misread. The e2e suite proves the whole
// artifact against the real tools; this proves the individual invariants those
// tools rely on, so a failure says WHICH one broke.

import { describe, expect, it } from '@gjsify/unit';

import { createArArchive } from './ar.js';
import { createCpioArchive, S_IFREG } from './cpio.js';
import { ancestorDirectories } from './deb.js';
import { buildRpmHeader, buildRpmLead, padToEight, RpmType, RPM_TAG_HEADERIMMUTABLE } from './rpm-header.js';
import { cacheRefreshCommands, renderDebScripts, renderRpmScriptlets } from './scripts.js';
import type { ShipSettings } from './types.js';

const decoder = new TextDecoder();

function view(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function settings(overrides: Partial<ShipSettings> = {}): ShipSettings {
    return {
        projectDir: '/p',
        appId: 'org.example.Hello',
        name: 'Hello',
        binaryName: 'hello',
        version: '1.0.0',
        release: '1',
        maintainer: 'Dev <dev@example.org>',
        summary: 'demo',
        description: ['demo'],
        license: 'MIT',
        section: 'gnome',
        group: 'Applications/System',
        kind: 'app',
        extraDepends: { deb: [], rpm: [] },
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

export default async () => {
    await describe('createArArchive', async () => {
        await it('writes the global header and a 60-byte header per member', async () => {
            const archive = createArArchive([{ name: 'debian-binary', data: new TextEncoder().encode('2.0\n') }]);
            expect(decoder.decode(archive.slice(0, 8))).toBe('!<arch>\n');
            // The member header starts at 8. Field offsets within it:
            // name(0,16) mtime(16,12) uid(28,6) gid(34,6) mode(40,8, OCTAL)
            // size(48,10) fmag(58,2) — and dpkg-deb writes the name
            // space-padded with NO trailing slash.
            expect(decoder.decode(archive.slice(8, 8 + 16))).toBe('debian-binary   ');
            expect(decoder.decode(archive.slice(8 + 40, 8 + 48))).toBe('100644  ');
            expect(decoder.decode(archive.slice(8 + 48, 8 + 58))).toBe('4         ');
            expect(decoder.decode(archive.slice(8 + 58, 8 + 60))).toBe('`\n');
            expect(decoder.decode(archive.slice(68, 72))).toBe('2.0\n');
        });

        await it('pads an odd member with a newline that is NOT counted in size', async () => {
            // Miss this and every later header is off by one, which dpkg
            // reports as "bad archive header magic" — a corruption message for
            // an arithmetic bug.
            const archive = createArArchive([
                { name: 'a', data: new TextEncoder().encode('abc') },
                { name: 'b', data: new TextEncoder().encode('d') },
            ]);
            expect(decoder.decode(archive.slice(8 + 48, 8 + 58))).toBe('3         ');
            expect(archive[8 + 60 + 3]).toBe(0x0a);
            expect(decoder.decode(archive.slice(8 + 60 + 4, 8 + 60 + 4 + 1))).toBe('b');
        });

        await it('refuses a name the 16-byte field cannot hold', async () => {
            // dpkg supports neither the GNU nor the BSD long-name extension, so
            // a name that does not fit has to be an error rather than a
            // truncation.
            expect(() => createArArchive([{ name: 'x'.repeat(17), data: new Uint8Array(1) }])).toThrow(
                'does not fit in 16 bytes',
            );
        });
    });

    await describe('createCpioArchive', async () => {
        await it('writes a 110-byte header and 4-byte-aligns name and data', async () => {
            const archive = createCpioArchive([
                { name: './usr/bin/x', mode: S_IFREG | 0o755, data: new TextEncoder().encode('hi') },
            ]);
            expect(decoder.decode(archive.slice(0, 6))).toBe('070701');
            // namesize includes the NUL: './usr/bin/x' is 11 + 1 = 12 = 0xC.
            expect(decoder.decode(archive.slice(94, 102))).toBe('0000000C');
            expect(decoder.decode(archive.slice(110, 122))).toBe('./usr/bin/x\0');
            // 110 + 12 = 122, padded to 124 before the data.
            expect(decoder.decode(archive.slice(124, 126))).toBe('hi');
        });

        await it('pads an odd body so the NEXT header stays 4-aligned', async () => {
            // The pad that matters, and the one a single-entry test cannot see:
            // miss it and every later header is read at the wrong offset.
            const archive = createCpioArchive([
                { name: './a', mode: S_IFREG | 0o644, data: new TextEncoder().encode('xyz') },
                { name: './b', mode: S_IFREG | 0o644, data: new TextEncoder().encode('q') },
            ]);
            // entry 1: header 110 + name './a\0' 4 = 114 → pad to 116, data 3 → pad to 120.
            expect(decoder.decode(archive.slice(116, 119))).toBe('xyz');
            expect(decoder.decode(archive.slice(120, 126))).toBe('070701');
            expect(decoder.decode(archive.slice(120 + 110, 120 + 114))).toBe('./b\0');
        });

        await it('terminates with the TRAILER!!! entry', async () => {
            const archive = createCpioArchive([]);
            expect(decoder.decode(archive.slice(110, 120))).toBe('TRAILER!!!');
            expect(archive.byteLength % 4).toBe(0);
        });
    });

    await describe('ancestorDirectories', async () => {
        await it('expands the full chain, root included', async () => {
            // dpkg opens each file with O_CREAT|O_EXCL and never calls
            // `mkdir -p`, so a missing parent aborts the unpack half-installed.
            expect(ancestorDirectories(['./usr/share/applications/x.desktop', './usr/bin/y'])).toStrictEqual([
                './',
                './usr/',
                './usr/bin/',
                './usr/share/',
                './usr/share/applications/',
            ]);
        });
    });

    await describe('buildRpmHeader', async () => {
        await it('puts the region entry first and its trailer last, with a negative offset', async () => {
            const header = buildRpmHeader(
                [{ tag: 1000, type: RpmType.STRING, value: 'hello' }],
                RPM_TAG_HEADERIMMUTABLE,
            );
            const data = view(header);
            const indexCount = data.getUint32(8);
            const storeSize = data.getUint32(12);
            expect(indexCount).toBe(2); // the region entry counts itself
            // Index entry 0 is the region, pointing at the trailer.
            expect(data.getInt32(16)).toBe(RPM_TAG_HEADERIMMUTABLE);
            expect(data.getInt32(24)).toBe(storeSize - 16);
            expect(data.getInt32(28)).toBe(16);
            // The trailer is the last 16 store bytes; its offset is the
            // NEGATED index length, which is what marks it as a trailer at all.
            const trailerAt = 16 + indexCount * 16 + storeSize - 16;
            expect(data.getInt32(trailerAt)).toBe(RPM_TAG_HEADERIMMUTABLE);
            expect(data.getInt32(trailerAt + 8)).toBe(-(16 * indexCount));
            expect(data.getInt32(trailerAt + 12)).toBe(16);
        });

        await it('aligns an INT32 in the store, which rpm enforces', async () => {
            const header = buildRpmHeader(
                [
                    { tag: 1000, type: RpmType.STRING, value: 'abc' }, // 4 bytes
                    { tag: 1001, type: RpmType.STRING, value: 'de' }, // 3 bytes → store at 7
                    { tag: 1006, type: RpmType.INT32, value: [42] },
                ],
                RPM_TAG_HEADERIMMUTABLE,
            );
            const data = view(header);
            const indexCount = data.getUint32(8);
            // Entries are sorted by tag, so the INT32 is the third index entry
            // after the region; its store offset must be a multiple of 4.
            const int32Offset = data.getInt32(16 + 3 * 16 + 8);
            expect(int32Offset % 4).toBe(0);
            expect(indexCount).toBe(4);
        });

        await it('refuses a tag rpm would reject and an empty array', async () => {
            expect(() => buildRpmHeader([{ tag: 63, type: RpmType.STRING, value: 'x' }], 63)).toThrow('below 100');
            expect(() => buildRpmHeader([{ tag: 1000, type: RpmType.INT32, value: [] }], 63)).toThrow('empty array');
        });
    });

    await describe('buildRpmLead / padToEight', async () => {
        await it('writes the one field rpm validates', async () => {
            const lead = buildRpmLead('hello-1.0.0-1');
            expect(lead.byteLength).toBe(96);
            expect(Array.from(lead.subarray(0, 4))).toStrictEqual([0xed, 0xab, 0xee, 0xdb]);
            expect(lead[4]).toBe(3);
            expect(decoder.decode(lead.slice(10, 23))).toBe('hello-1.0.0-1');
        });

        await it('pads to the boundary the main header starts on, with zeros', async () => {
            const padded = padToEight(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
            expect(padded.byteLength).toBe(16);
            expect(Array.from(padded.subarray(0, 12))).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
            expect(Array.from(padded.subarray(12))).toStrictEqual([0, 0, 0, 0]);
            expect(padToEight(new Uint8Array(16)).byteLength).toBe(16);
        });
    });

    await describe('maintainer scripts', async () => {
        await it('emits nothing when the payload needs no cache refreshed', async () => {
            const cli = settings({ kind: 'cli' });
            expect(cacheRefreshCommands(cli, '/usr').length).toBe(0);
            expect(Object.keys(renderDebScripts(cli, '/usr')).length).toBe(0);
            expect(renderRpmScriptlets(cli, '/usr').post).toBe(undefined);
        });

        await it('guards on the ACTION for dpkg and not at all for rpm', async () => {
            // dpkg passes an action name as `$1`; rpm passes a COUNT. A
            // dpkg-shaped `[ "$1" = "configure" ]` inside an rpm scriptlet is
            // never true, so the package installs and the scriptlet does
            // nothing — found by reading `rpm -qp --scripts`, not by a test
            // that only checked the body.
            const app = settings({ schemaFiles: ['/p/data/org.example.Hello.gschema.xml'] });
            expect(renderDebScripts(app, '/usr').postinst).toContain('[ "$1" = "configure" ]');
            expect(renderRpmScriptlets(app, '/usr').post).not.toContain('configure');
            expect(renderRpmScriptlets(app, '/usr').post).toContain('glib-compile-schemas /usr/share/glib-2.0/schemas');
        });

        await it('never lets a missing helper fail a removal', async () => {
            const app = settings({ iconFiles: ['/p/icon.svg'] });
            for (const line of cacheRefreshCommands(app, '/usr')) {
                expect(line).toContain('command -v');
                expect(line).toContain('|| true');
            }
        });
    });
};
