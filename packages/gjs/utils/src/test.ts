import { run } from '@gjsify/unit';
import fontMapSuite from './font-map.spec.js';
import hostOsSuite from './host-os.spec.js';
import hostProcessSuite from './host-process.spec.js';
import logSuite from './log.spec.js';
import nativeLibrarySuite from './native-library.spec.js';
import nextTickSuite from './next-tick.spec.js';
import pathShapeSuite from './path-shape.spec.js';
import platformNamesSuite from './platform-names.spec.js';
import systemGiDirsSuite from './system-gi-dirs.spec.js';

run({
    fontMapSuite,
    hostOsSuite,
    hostProcessSuite,
    logSuite,
    nativeLibrarySuite,
    nextTickSuite,
    pathShapeSuite,
    platformNamesSuite,
    systemGiDirsSuite,
});
