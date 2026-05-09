// SPDX-License-Identifier: MIT
// Reference: gettext-parser README + node_modules/gettext-parser/lib/pocompiler.js
// Original: Copyright (c) Andris Reinman. MIT.
// Round-trips PO source through parse → compile → re-parse and asserts
// the second parse produces a translations table identical to the first.
// Exercises @gjsify/buffer string concatenation + utf-8 round-trip.

import { describe, it, expect } from '@gjsify/unit';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { po } from 'gettext-parser';

const fixturesUrl = new URL('../fixtures/', import.meta.url);

export default async () => {
  await describe('gettext-parser po.compile (round-trip)', async () => {

    await it('po → compile → parse keeps translations identical', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const original = await readFile(path);
      const first = po.parse(original);
      const recompiled = po.compile(first);

      // Output is a Buffer.
      expect(Buffer.isBuffer(recompiled)).toBeTruthy();

      const second = po.parse(recompiled);
      expect(second.translations).toStrictEqual(first.translations);
      expect(second.headers).toStrictEqual(first.headers);
      expect(second.charset).toBe(first.charset);
    });

    await it('preserves non-ASCII msgstr through round-trip', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const original = await readFile(path);
      const parsed = po.parse(original);
      const compiled = po.compile(parsed);
      const reparsed = po.parse(compiled);

      expect(reparsed.translations['']['tree'].msgstr[0]).toBe('Bäume');
      const plural = reparsed.translations['']['%d apple'];
      expect(plural.msgstr).toStrictEqual(['%d Apfel', '%d Äpfel']);
    });

    await it('preserves msgctxt through round-trip', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const original = await readFile(path);
      const parsed = po.parse(original);
      const compiled = po.compile(parsed);
      const reparsed = po.parse(compiled);

      expect(reparsed.translations['menu']['File'].msgstr[0]).toBe('Datei');
      expect(reparsed.translations['button']['File'].msgstr[0]).toBe('Akte');
    });

    await it('compile output is utf-8 encoded by default', async () => {
      const path = fileURLToPath(new URL('utf8.po', fixturesUrl));
      const original = await readFile(path);
      const parsed = po.parse(original);
      const compiled = po.compile(parsed);

      // Round-trip the buffer through utf-8 decode → must contain the
      // non-ASCII characters as-is.
      const text = compiled.toString('utf8');
      expect(text.includes('Bäume')).toBeTruthy();
      expect(text.includes('Äpfel')).toBeTruthy();
    });

  });
};
