// SPDX-License-Identifier: MIT
//
// The SAME upstream conformance suite, over `@gjsify/effect-platform`'s Gio layer.
//
// GJS only, and that is why this file exists separately: it reaches `gi://Gio`, so
// importing it from the shared entry would put GIO in the `--app node` bundle. The
// Node leg's job is to prove the PORT is correct; this leg measures a second
// implementation against it.

import { fileSystemLayer } from '@gjsify/effect-platform';

import { conformance } from './filesystem-conformance.js';

export default conformance({
    label: 'Gio.File',
    layer: fileSystemLayer,
});
