// GJS entry: the pure suites plus the drivers against the fake portal.
import { run } from '@gjsify/unit';

import autostartFileSuite from './autostart-file.gjs.spec.js';
import desktopEntrySuite from './desktop-entry.spec.js';
import portalSuite from './portal.gjs.spec.js';
import windowsSuite from './portal.windows.gjs.spec.js';
import refusalSuite from './refusal.spec.js';
import stubSuite from './stub.spec.js';
import wishGjsSuite from './wish.gjs.spec.js';
import wishSuite from './wish.spec.js';

run({
    desktopEntrySuite,
    wishSuite,
    refusalSuite,
    stubSuite,
    wishGjsSuite,
    autostartFileSuite,
    portalSuite,
    windowsSuite,
});
