// Integration-test entry for @gjsify/integration-gettext-parser.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// Validates that gettext-parser (PO/MO parser used by
// @gjsify/vite-plugin-gettext) runs end-to-end on GJS. Stresses
// @gjsify/buffer (binary MO file parsing, endianness, NUL/EOT separators),
// @gjsify/fs (URL-path file reads), and text encoding edge cases.

import '@gjsify/node-globals/register';
import { run } from '@gjsify/unit';
import parsePoSuite from './parse-po.spec.js';
import parseMoSuite from './parse-mo.spec.js';
import compilePoSuite from './compile-po.spec.js';
import compileMoSuite from './compile-mo.spec.js';
import pluralFormsSuite from './plural-forms.spec.js';

run({
  parsePoSuite,
  parseMoSuite,
  compilePoSuite,
  compileMoSuite,
  pluralFormsSuite,
});
