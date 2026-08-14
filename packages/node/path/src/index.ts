// Reference: Node.js lib/path.js
// Reimplemented for GJS
//
// Selects the flavour PER HOST, the way Node does (`process.platform === 'win32'`).
// It used to export `posix` unconditionally, on the reasoning that "GJS runs on POSIX
// systems" — true when GJS was Linux-only, and the project now ships
// `@gjsify/gtk-runtime-win32-x64` and runs `windows-suites.yml`. Every win32 divergence
// was therefore silent rather than wrong-looking: `dirname('C:\\app\\x.js')` answered
// `'.'`, which is a valid path, so a caller wrote into the CWD instead of failing
// (#1146).
//
// SELECTED ONCE, AT MODULE INIT, and that is measured rather than assumed. `hostOs()`
// warns that a module-eval read of `process.platform` can land on the byte-1 banner
// stub before `@gjsify/process` registers — but that window belongs to the polyfill's
// own bootstrap, not to a consumer. Probed under the GJS bundle: at this module's eval
// time `globalThis.process` already exists, `platform` is already correct, and it agrees
// with a later read. `@gjsify/process` does not depend on this package either, so there
// is no bootstrap cycle to fall into. That is what lets `sep` and `delimiter` stay plain
// values — an `export const` is a snapshot however it is computed, and they are the two
// exports most likely to be concatenated into a path.
//
// Off a host that can answer (a browser), `hostOs()` is undefined, so this resolves to
// posix — both the old behaviour and the right one.

import { hostOs } from '@gjsify/utils/core';

import { selectFlavour } from './flavour.js';
import * as posix from './posix.js';
import * as win32 from './win32.js';

export type { ParsedPath, FormatInputPathObject } from './posix.js';

/** The flavour matching this host. Both modules export the same names. */
const active = selectFlavour(hostOs());

export const {
    resolve,
    normalize,
    isAbsolute,
    join,
    relative,
    toNamespacedPath,
    dirname,
    basename,
    extname,
    format,
    parse,
    sep,
    delimiter,
} = active;

// Both flavours stay reachable by name whatever the host, as in Node.
export { posix, win32 };

export default {
    resolve: active.resolve,
    normalize: active.normalize,
    isAbsolute: active.isAbsolute,
    join: active.join,
    relative: active.relative,
    toNamespacedPath: active.toNamespacedPath,
    dirname: active.dirname,
    basename: active.basename,
    extname: active.extname,
    format: active.format,
    parse: active.parse,
    sep: active.sep,
    delimiter: active.delimiter,
    posix,
    win32,
};
