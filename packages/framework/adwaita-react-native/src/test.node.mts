// The NODE leg: everything that does not need a display or a typelib.
//
// Two entries rather than one, because the package genuinely has two halves. The GTK
// modules import `gi://Adw` and only run under GJS (or node-gi with a display); the
// React Native modules import `react-native`, which is Flow source that this chain
// cannot parse and which `build:test:node` therefore aliases onto the type-pinned
// double. Neither leg can host the other's specs, and a single entry would have to
// drop one of them — silently, since nothing counts a suite that was never written.

import { run } from '@gjsify/unit';

import binNativeSuite from './widgets/bin.native.spec.js';
import clampNativeSuite from './widgets/clamp.native.spec.js';
import doubleSuite from './testing/react-native.spec.js';
import paritySuite from './parity.spec.js';

run({
    paritySuite,
    doubleSuite,
    binNativeSuite,
    clampNativeSuite,
});
