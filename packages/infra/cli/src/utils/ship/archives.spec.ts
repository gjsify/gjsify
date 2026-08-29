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
import { buildZip, crc32, dosDateTime } from './zip.js';
import { readPayloadFacts } from './payload.js';
import { cacheRefreshCommands, renderDebScripts, renderRpmScriptlets } from './scripts.js';

const decoder = new TextDecoder();

function view(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * The maintainer scripts are keyed on what the PAYLOAD installs, so the fixture is a list of
 * staged paths rather than a settings object — and running them through `readPayloadFacts` is
 * deliberate: the mapping from "installs into share/icons/hicolor" to "runs gtk-update-icon-cache"
 * is the part that was wrong before (it followed the project's file lists, which a `kind: 'cli'`
 * project can have without staging a single icon).
 */
function facts(...paths: string[]) {
    return readPayloadFacts(paths.map((path) => ({ path })));
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
            const bare = facts('bin/hello', 'lib/hello/gjs.js');
            expect(cacheRefreshCommands(bare, '/usr').length).toBe(0);
            expect(Object.keys(renderDebScripts(bare, '/usr')).length).toBe(0);
            expect(renderRpmScriptlets(bare, '/usr').post).toBe(undefined);
        });

        await it('guards on the ACTION for dpkg and not at all for rpm', async () => {
            // dpkg passes an action name as `$1`; rpm passes a COUNT. A
            // dpkg-shaped `[ "$1" = "configure" ]` inside an rpm scriptlet is
            // never true, so the package installs and the scriptlet does
            // nothing — found by reading `rpm -qp --scripts`, not by a test
            // that only checked the body.
            const app = facts('share/glib-2.0/schemas/org.example.Hello.gschema.xml');
            expect(renderDebScripts(app, '/usr').postinst).toContain('[ "$1" = "configure" ]');
            expect(renderRpmScriptlets(app, '/usr').post).not.toContain('configure');
            expect(renderRpmScriptlets(app, '/usr').post).toContain('glib-compile-schemas /usr/share/glib-2.0/schemas');
        });

        await it('refreshes only the caches the payload actually wrote into', async () => {
            // The defect this pins: the icon cache used to be refreshed whenever the PROJECT had
            // icon files, which a `kind: 'cli'` project can have while `planStage` stages none.
            const withIcons = cacheRefreshCommands(facts('share/icons/hicolor/scalable/apps/x.svg'), '/usr');
            expect(withIcons.join('\n')).toContain('gtk-update-icon-cache');
            expect(cacheRefreshCommands(facts('bin/hello'), '/usr').join('\n')).not.toContain('gtk-update-icon-cache');
            // A desktop entry is what `update-desktop-database` reindexes, so it follows the file.
            expect(
                cacheRefreshCommands(facts('share/applications/org.example.Hello.desktop'), '/usr').join('\n'),
            ).toContain('update-desktop-database');
        });

        await it('never lets a missing helper fail a removal', async () => {
            for (const line of cacheRefreshCommands(facts('share/icons/hicolor/scalable/apps/x.svg'), '/usr')) {
                expect(line).toContain('command -v');
                expect(line).toContain('|| true');
            }
        });
    });

    // ── the ZIP writer (#1354 M2a) ────────────────────────────────────────
    //
    // `tests/e2e/ship-macos` reads a real archive back with `zipinfo -l` and
    // `unzip`, which settles whether the file is a zip and whether the mode
    // survived. What an independent reader CANNOT settle is the input it is never
    // given: a caller order that differs from the sorted one, a timestamp before
    // 1980, an odd second, a payload past the 32-bit fields. Those are the four
    // places a well-formed archive comes out wrong, and this is where they are
    // pinned.
    await describe('buildZip', async () => {
        const entry = (path: string, mode: number, text: string) => ({
            path,
            mode,
            data: new TextEncoder().encode(text),
        });
        /** The offsets of every central-directory header, by signature. */
        const centralOffsets = (zip: Uint8Array): number[] => {
            const out: number[] = [];
            const at = view(zip);
            for (let i = 0; i + 4 <= zip.byteLength; i++) {
                if (at.getUint32(i, true) === 0x02014b50) out.push(i);
            }
            return out;
        };

        await it('matches the CRC-32 vector every implementation of this polynomial agrees on', async () => {
            // `123456789` → 0xCBF43926 is the check value published with the
            // CRC-32/ISO-HDLC parameters, and it is the only assertion here that
            // does not depend on anything this repository wrote. A table built
            // with the un-reversed polynomial passes a self-consistent round trip
            // and fails this.
            expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
            expect(crc32(new Uint8Array(0))).toBe(0);
        });

        await it('puts the POSIX mode in the HIGH 16 bits, with the regular-file type', async () => {
            // The field the whole writer exists for. `unzip` reads it as a POSIX
            // mode only when `version made by` says Unix — high byte 3 — so both
            // halves are asserted together: with the DOS value the same bits are
            // read as DOS attribute flags and every file extracts at the umask
            // default, which is a `.app` that does not start.
            const zip = buildZip([entry('App.app/Contents/MacOS/demo', 0o755, '#!/bin/sh\n')], 1_700_000_000);
            const [central] = centralOffsets(zip);
            const at = view(zip);
            expect(at.getUint16((central as number) + 4, true)).toBe(0x0314);
            // `S_IFREG | 0755` in the top half; the low half is DOS attributes and
            // is deliberately zero.
            expect(at.getUint32((central as number) + 38, true) >>> 16).toBe(0o100755);
            expect(at.getUint32((central as number) + 38, true) & 0xffff).toBe(0);
        });

        await it('sorts by path, so the caller order cannot reach the bytes', async () => {
            // `readdir` order is a filesystem's opinion, and two runs over one
            // payload have to produce one byte sequence. Asserted by building the
            // SAME entries in two orders and comparing the whole file rather than
            // the listing: a writer that sorted its central directory and not its
            // local headers would pass a name comparison.
            const files = [entry('b.txt', 0o644, 'B'), entry('a.txt', 0o644, 'A'), entry('c.txt', 0o644, 'C')];
            const forward = buildZip(files, 1_700_000_000);
            const shuffled = buildZip([files[2] as never, files[0] as never, files[1] as never], 1_700_000_000);
            expect([...shuffled]).toStrictEqual([...forward]);
        });

        await it('stores rather than deflates, and says the two sizes are one size', async () => {
            // STORE is a first cut and legitimate — but it has to be DECLARED as
            // one. A method field of 8 with uncompressed bytes behind it is an
            // archive `unzip` reads as a corrupt deflate stream.
            const zip = buildZip([entry('a.txt', 0o644, 'hello')], 1_700_000_000);
            const at = view(zip);
            expect(at.getUint16(8, true)).toBe(0);
            expect(at.getUint32(18, true)).toBe(5);
            expect(at.getUint32(22, true)).toBe(5);
            // Bit 11 of the general-purpose flags: the name is UTF-8. Without it
            // the name is CP437, which cannot spell a display name that is not
            // ASCII — and `<App>.app` carries the display name.
            expect(at.getUint16(6, true) & 0x0800).toBe(0x0800);
        });

        await it('takes the timestamp from the caller and writes it as UTC', async () => {
            // Never `Date.now()` — the rule `buildTimestamp` and
            // `gzipDeterministic` already follow. UTC and not local time, because
            // a DOS stamp carries no zone: reading it back as the packing host's
            // zone would make two runners in different regions produce different
            // bytes from one stage.
            //
            // 2023-11-14T22:13:20Z: year 43 past 1980, month 11, day 14, hour 22,
            // minute 13, second 20 → 10 in the half-second field.
            const stamp = dosDateTime(1_700_000_000);
            expect(stamp.date).toBe((43 << 9) | (11 << 5) | 14);
            expect(stamp.time).toBe((22 << 11) | (13 << 5) | 10);
        });

        await it('clamps before 1980 and floors an odd second, rather than refusing either', async () => {
            // The format is from 1980 and its seconds field holds HALF-seconds, so
            // neither is representable. Both are METADATA no reader in this
            // repository asserts on, and failing a build because
            // `SOURCE_DATE_EPOCH` named 1979 would reject an artifact over a
            // display field — which is the opposite trade from the ZIP64 refusal
            // below, where the field is load-bearing and silence is the danger.
            expect(dosDateTime(0)).toStrictEqual({ date: (0 << 9) | (1 << 5) | 1, time: 0 });
            expect(dosDateTime(1_700_000_001).time).toBe(dosDateTime(1_700_000_000).time);
        });

        await it('refuses past the 32-bit fields instead of wrapping into a valid-looking archive', async () => {
            // A LOUD limit. Past 65535 entries the non-ZIP64 central directory
            // records the count in 16 bits and simply wraps, and what comes out is
            // well-formed and wrong — the same argument `assertPayloadMatchesArch`
            // makes one field over, where a label nothing compared to the payload
            // produced an artifact `rpm` confirmed.
            const many = Array.from({ length: 0x10000 }, (_unused, i) => entry(`f${i}.txt`, 0o644, ''));
            expect(() => buildZip(many, 1_700_000_000)).toThrow('ZIP64');
        });

        await it('writes one central header per entry and an EOCD that agrees with them', async () => {
            const zip = buildZip(
                [entry('a.txt', 0o644, 'A'), entry('b.txt', 0o755, 'B'), entry('c.txt', 0o600, 'C')],
                1_700_000_000,
            );
            const centrals = centralOffsets(zip);
            expect(centrals.length).toBe(3);
            const at = view(zip);
            const eocd = zip.byteLength - 22;
            expect(at.getUint32(eocd, true)).toBe(0x06054b50);
            // Both count fields — "this disk" and "total" — because a reader picks
            // whichever it likes and a writer that filled one is a writer whose
            // archive some tools see as empty.
            expect(at.getUint16(eocd + 8, true)).toBe(3);
            expect(at.getUint16(eocd + 10, true)).toBe(3);
            // And the central directory's offset really points at the first
            // central header, which is the field `unzip` seeks to before it reads
            // anything else.
            expect(at.getUint32(eocd + 16, true)).toBe(centrals[0]);
        });
    });
};
