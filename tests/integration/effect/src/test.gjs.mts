// The GJS entry: everything the shared entry runs, plus the legs that reach GIO.
//
// `@gjsify/effect-platform` is a second implementation of the same contracts, so
// both run TWICE here. FileSystem gets upstream's own conformance suite over
// `node:fs` and over `Gio.File`. Path has no upstream suite, so it gets a
// differential: every operation, over one corpus, against `node:path` as the oracle.

import { run } from '@gjsify/unit';

import { commonSuites } from './suites.js';
import fileSystemGioSuite from './filesystem-gio.spec.js';
import pathDifferentialSuite from './path-differential.spec.js';

run({
    ...commonSuites,
    fileSystemGioSuite,
    pathDifferentialSuite,
});
