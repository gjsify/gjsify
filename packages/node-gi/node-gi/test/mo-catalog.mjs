// SPDX-License-Identifier: MIT
// Write a GNU gettext `.mo` catalog from plain JS — the fixture builder for the
// locale tests.
//
// NOT `msgfmt` and NOT a committed binary: a fixture that needs a tool the host may
// lack turns "the fix works" into "msgfmt was installed", and a reviewer cannot read
// the discriminating msgid→msgstr pairs out of a `.mo`. Here they sit in the test
// beside the assertion that consumes them.
//
// Format (GNU gettext manual, "The Format of GNU MO Files"): a 28-byte header, two
// (length, offset) tables, then the string data. Little-endian, which the magic
// identifies — a big-endian reader byte-swaps on the mismatch, so one spelling is
// portable.
//
// Two encodings the container does not mention, both used below because gettext's
// lookup key IS the encoded string:
//   • plural entry — key `msgid \0 msgid_plural`, value `plural[0] \0 plural[1] …`
//   • context entry (pgettext) — key `context \x04 msgid`
// and the entries MUST be sorted by their encoded key: with no hash table present
// glibc binary-searches the original table, so an unsorted catalog silently misses.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MAGIC = 0x950412de;
const EOT = '\u0004'; // pgettext context separator
const NUL = '\u0000';

/**
 * Encode one entry of a `.mo` catalog.
 *
 * @param {{ msgid: string, msgstr?: string, context?: string, plural?: string,
 *           plurals?: string[] }} entry
 * @returns {{ key: string, value: string }} the encoded lookup key + value
 */
function encodeEntry(entry) {
    const { msgid, msgstr, context, plural, plurals } = entry;
    const key = (context === undefined ? '' : context + EOT) + (plural === undefined ? msgid : msgid + NUL + plural);
    const value = plurals === undefined ? msgstr : plurals.join(NUL);
    return { key, value };
}

/**
 * Write a `.mo` catalog, creating parent directories as needed.
 *
 * The `""` header entry is supplied here rather than by the caller: gettext reads
 * `Content-Type`'s charset to decide whether to transcode, and `Plural-Forms` to
 * pick a plural index, so a catalog without it answers ngettext from index 0 only.
 *
 * @param {string} file destination path (…/<lang>/LC_MESSAGES/<domain>.mo)
 * @param {Array<{ msgid: string, msgstr?: string, context?: string,
 *                 plural?: string, plurals?: string[] }>} entries
 * @param {string} [pluralForms] the Plural-Forms header value
 */
export function writeMoCatalog(file, entries, pluralForms = 'nplurals=2; plural=(n != 1);') {
    const header = {
        key: '',
        value: `Content-Type: text/plain; charset=UTF-8\nPlural-Forms: ${pluralForms}\n`,
    };
    const all = [header, ...entries.map(encodeEntry)].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const keys = all.map((e) => Buffer.from(e.key, 'utf8'));
    const values = all.map((e) => Buffer.from(e.value, 'utf8'));
    const count = all.length;

    // Header (7 uint32) + both tables, then the data area. Every string is stored
    // NUL-terminated but the recorded length EXCLUDES the terminator.
    const tablesEnd = 28 + count * 8 * 2;
    const offsets = [];
    let cursor = tablesEnd;
    for (const buf of [...keys, ...values]) {
        offsets.push(cursor);
        cursor += buf.length + 1;
    }

    const out = Buffer.alloc(cursor);
    out.writeUInt32LE(MAGIC, 0);
    out.writeUInt32LE(0, 4); // format revision
    out.writeUInt32LE(count, 8);
    out.writeUInt32LE(28, 12); // originals table
    out.writeUInt32LE(28 + count * 8, 16); // translations table
    out.writeUInt32LE(0, 20); // hash table size — none, so the reader binary-searches
    out.writeUInt32LE(0, 24); // hash table offset

    for (let i = 0; i < count; i++) {
        out.writeUInt32LE(keys[i].length, 28 + i * 8);
        out.writeUInt32LE(offsets[i], 28 + i * 8 + 4);
        out.writeUInt32LE(values[i].length, 28 + count * 8 + i * 8);
        out.writeUInt32LE(offsets[count + i], 28 + count * 8 + i * 8 + 4);
    }
    for (let i = 0; i < count; i++) {
        keys[i].copy(out, offsets[i]);
        values[i].copy(out, offsets[count + i]);
    }

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, out);
}
