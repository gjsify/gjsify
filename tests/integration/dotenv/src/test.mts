// Integration-test entry for @gjsify/integration-dotenv.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// dotenv exercises @gjsify/fs (readFileSync of .env files, with optional
// URL-instance path argument) plus @gjsify/process — specifically the
// `process.env` Proxy whose get/set/delete traps must round-trip
// through GLib.{get,set,unset}env on GJS. The populate.spec.ts file is
// the most direct cross-runtime smoke test of those traps the suite
// has today.
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults
// to `--globals auto`, scanning the bundled output and injecting only
// the granular /register subpaths actually referenced.

import { run } from '@gjsify/unit';
import parseSuite from './parse.spec.js';
import parseMultilineSuite from './parse-multiline.spec.js';
import configSuite from './config.spec.js';
import populateSuite from './populate.spec.js';

run({
    parseSuite,
    parseMultilineSuite,
    configSuite,
    populateSuite,
});
