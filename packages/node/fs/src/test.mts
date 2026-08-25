import '@gjsify/node-globals/register/process';
import '@gjsify/node-globals/register/buffer';
import '@gjsify/node-globals/register/timers';
import '@gjsify/node-globals/register/url';
// K-21 needs a global `ReadableStream`. GJS exposes none (see
// status/upstream-patch-candidates.md), and `readableWebStream()` deliberately
// resolves the constructor off globalThis rather than importing it, so an app that
// never calls the method does not bundle the WHATWG implementation. The TEST is
// what has to supply it.
import '@gjsify/web-streams/register';
import { run } from '@gjsify/unit';

import testSuiteCallback from './callback.spec.js';
import testSuiteFileHandle from './file-handle.spec.js';
import testSuitePromise from './promises.spec.js';
import testSuiteSync from './sync.spec.js';
import testSuiteSymlink from './symlink.spec.js';
import testSuiteStat from './stat.spec.js';
import testSuiteNewApis from './new-apis.spec.js';
import testSuiteExtended from './extended.spec.js';

import testSuiteErrors from './errors.spec.js';
import testSuiteStreams from './streams.spec.js';
import testSuiteCp from './cp.spec.js';
import testSuiteDir from './dir.spec.js';
import testSuiteGlob from './glob.spec.js';
import testSuiteWatch from './watch.spec.js';
import testSuiteWatchRecursive from './watch-recursive.spec.js';
import testSuiteWatchBackend from './watch-backend.gjs.spec.js';
import testSuiteWatchFile from './watchfile.spec.js';
import testSuiteStatFs from './statfs.spec.js';
import testSuiteUtimes from './utimes.spec.js';
import testSuiteFdOps from './fd-ops.spec.js';
import testSuiteRmSymlink from './rm-symlink.spec.js';
import testSuiteFsSemantics from './fs-semantics.spec.js';

run({
    testSuiteCallback,
    testSuiteFileHandle,
    testSuitePromise,
    testSuiteSync,
    testSuiteSymlink,
    testSuiteStat,
    testSuiteNewApis,
    testSuiteExtended,
    testSuiteErrors,
    testSuiteStreams,
    testSuiteCp,
    testSuiteDir,
    testSuiteGlob,
    testSuiteWatch,
    testSuiteWatchRecursive,
    testSuiteWatchBackend,
    testSuiteWatchFile,
    testSuiteStatFs,
    testSuiteUtimes,
    testSuiteFdOps,
    testSuiteRmSymlink,
    testSuiteFsSemantics,
});
