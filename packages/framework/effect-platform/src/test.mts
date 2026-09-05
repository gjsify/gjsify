// Test entry for @gjsify/effect-platform.
//
// GJS only: every module here reaches GIO or GTK, so there is no Node leg to be
// the control. The control for the FileSystem layer lives in
// `tests/integration/effect`, which runs the SAME upstream conformance suite
// against this layer and against the `node:fs`-backed one and requires both to
// answer alike.

import { run } from '@gjsify/unit';
import errorsSuite from './errors.spec.js';
import pathSuite from './path.spec.js';
import fileSystemSuite from './filesystem.spec.js';

run({
    errorsSuite,
    pathSuite,
    fileSystemSuite,
});
