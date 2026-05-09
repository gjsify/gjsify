#!/usr/bin/env node
// Build hand-crafted PO/MO fixtures for the gettext-parser integration suite.
//
// The npm `gettext-parser` package does NOT ship its `test/fixtures/` dir
// (only `lib/`, `index.js`, `CHANGELOG.md` are in the published tarball).
// Instead of pulling fixtures from a separate source we synthesise them
// with the parser's own compiler at prebuild time:
//
//   1. Define a small UTF-8 PO source string (covers headers, plural forms,
//      multi-line msgstr, non-ASCII characters, msgctxt context).
//   2. Compile to .mo (binary) via gettext-parser → exercises the same
//      writer the parser must round-trip through under @gjsify/buffer.
//   3. Write a parallel ISO-8859-13 (latin13) PO + MO pair to exercise
//      non-UTF-8 charset paths (encoding library inside gettext-parser).
//
// All output lands in ./fixtures/ — gitignored, regenerated on every
// `prebuild:test:*` run.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import gettextParser from 'gettext-parser';

const { po, mo } = gettextParser;
const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures');

await rm(fixturesDir, { recursive: true, force: true });
await mkdir(fixturesDir, { recursive: true });

const utf8Po = `# Translation file
# Copyright (C) 2026 gjsify
msgid ""
msgstr ""
"Project-Id-Version: gjsify-test 1.0\\n"
"Content-Type: text/plain; charset=utf-8\\n"
"Content-Transfer-Encoding: 8bit\\n"
"Language: de\\n"
"Plural-Forms: nplurals=2; plural=(n != 1);\\n"

# A simple translation
msgid "hello"
msgstr "hallo"

msgid "world"
msgstr "welt"

# Non-ASCII
msgid "tree"
msgstr "Bäume"

# Plural form
msgid "%d apple"
msgid_plural "%d apples"
msgstr[0] "%d Apfel"
msgstr[1] "%d Äpfel"

# Multi-line / context
msgctxt "menu"
msgid "File"
msgstr "Datei"

msgctxt "button"
msgid "File"
msgstr "Akte"
`;

await writeFile(join(fixturesDir, 'utf8.po'), utf8Po, 'utf8');

const utf8Parsed = po.parse(utf8Po);
const utf8Mo = mo.compile(utf8Parsed);
await writeFile(join(fixturesDir, 'utf8.mo'), utf8Mo);

// Latin-13 (ISO-8859-13) PO — exercises non-UTF-8 charset path. Use
// characters covered by the latin-13 codepage (Lithuanian / Baltic).
const latin13Po = `msgid ""
msgstr ""
"Content-Type: text/plain; charset=iso-8859-13\\n"
"Plural-Forms: nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && (n%100<10 || n%100>=20) ? 1 : 2);\\n"

msgid "test"
msgstr "test"

msgid "rye"
msgstr "rugys"
`;

const latin13Buf = Buffer.from(latin13Po, 'binary');
await writeFile(join(fixturesDir, 'latin13.po'), latin13Buf);

const latin13Parsed = po.parse(latin13Buf);
const latin13Mo = mo.compile(latin13Parsed);
await writeFile(join(fixturesDir, 'latin13.mo'), latin13Mo);

console.log(`[build-fixtures] wrote 4 files → ${fixturesDir}`);
