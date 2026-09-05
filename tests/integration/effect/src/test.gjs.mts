// The GJS entry: everything the shared entry runs, plus the legs that reach GIO.
//
// `@gjsify/effect-platform`'s FileSystem is a second implementation of the same
// contract, so the conformance suite runs TWICE here — once over `node:fs` and once
// over `Gio.File` — and both must answer alike.

import { run } from '@gjsify/unit';

import { commonSuites } from './suites.js';
import fileSystemGioSuite from './filesystem-gio.spec.js';

run({
    ...commonSuites,
    fileSystemGioSuite,
});
