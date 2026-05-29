// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by memfs
// (streamich + contributors, Apache-2.0).
//
// In-memory only. No persistence (OPFS bridge is a future iteration).
// No file watching (FSWatcher is a stub). No real permission/owner enforcement.
//
// This file is the browser entry point selected by the package's `"browser"`
// field + `exports."."` `"browser"` condition (Rolldown/Vite browser builds
// honour both via `mainFields:['browser','module','main']` and
// `conditionNames:['import','browser']`).
//
// Strategy: a single in-memory `Volume` (default) + `memfs`-shape `Volume`
// class export for tests that want sandboxes. Sync / callback / promise
// surfaces are all backed by the same volume so writes in one API are
// visible to reads in another.
//
// Known gaps (slot: partial):
//   - No OPFS / IndexedDB persistence — page reload wipes the volume.
//   - FSWatcher is a stub (registers events, never fires).
//   - Symlinks are stored but never followed by `realpath` / `stat`.
//   - chmod / chown alter mode bits but enforce nothing.
//   - File descriptors are minimal (no readv / writev / fsync / fdatasync).
//   - No `cp` (recursive copy) — implement on top of `readdir` + `copyFile`.

export { constants } from './browser/constants.js';
export * from './browser/constants.js';
export { Volume, __defaultVolume } from './browser/volume.js';
export { Stats, BigIntStats, Dirent } from './browser/types.js';
export * from './browser/sync.js';
export * from './browser/async.js';
export {
    createReadStream, ReadStream, createWriteStream, WriteStream,
    FSWatcher, StatWatcher, watch, watchFile, unwatchFile,
} from './browser/stream.js';

import * as promises from './browser/promises.js';
export { promises };

// Default export — a namespace bundle matching `import fs from 'fs'` in Node.
// We deliberately re-import the wildcard sets (rather than re-declaring each
// name) to keep this file under the LOC budget for the browser polyfill batch.
import * as syncApi from './browser/sync.js';
import * as asyncApi from './browser/async.js';
import * as streamApi from './browser/stream.js';
import { constants as fsConstants } from './browser/constants.js';
import { Volume as VolumeCls, __defaultVolume as defaultVol } from './browser/volume.js';
import { Stats as StatsCls, BigIntStats as BigIntStatsCls, Dirent as DirentCls } from './browser/types.js';

const defaultExport = {
    constants: fsConstants,
    Volume: VolumeCls,
    __defaultVolume: defaultVol,
    Stats: StatsCls,
    BigIntStats: BigIntStatsCls,
    Dirent: DirentCls,
    ...syncApi,
    ...asyncApi,
    ...streamApi,
    promises,
};
export default defaultExport;
