/*! (c) Andrea Giammarchi - ISC - https://github.com/WebReflection/gjs-require */

const { gi, system, searchPath } = imports;
import { resolve, readJSON } from '@gjsify/utils';
import { performance } from './performance.js';
import timers from './timers.js';
import process from 'process';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const cache = Object.create(null);

function getProgramDir(programFile) {
  const info = programFile.query_info('standard::', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
  if (info.get_is_symlink()) {
    const symlinkFile = programFile.get_parent().resolve_relative_path(info.get_symlink_target());
    return symlinkFile.get_parent();
  } else {
    return programFile.get_parent();
  }
}

/**
 * CommonJS require
 * @param {string} file 
 * @returns 
 */
function require(file) {

  if (/^[A-Z]/.test(file))
    return file.split('.').reduce(($, k) => $[k], gi);

  if (!file.includes('.') && !/\.js$/.test(file))
    file += '.js';

  const fd = resolve(__dirname, file);
  const fn = fd.get_path();

  if (fn.endsWith('.json')) {
    return readJSON(fn);
  }

  if (fn in cache)
    return cache[fn];

  const dn = fd.get_parent().get_path();
  const _fn = __filename;
  const _dn = __dirname;
  const saved_exports = globalThis.exports;
  const saved_module = globalThis.module;
  const exports = {};
  const module = { exports };

  globalThis.exports = exports;
  globalThis.module = module;
  
  __filename = fn;
  __dirname = dn;
  searchPath.unshift(dn);
  imports[fd.get_basename().replace(/\.js$/, '')];
  cache[fn] = module.exports;
  searchPath.shift();
  __filename = _fn;
  __dirname = _dn;
  globalThis.exports = saved_exports;
  globalThis.module = saved_module;
  return cache[fn];
}

const DIR = GLib.get_current_dir();
const PROGRAM = resolve(DIR, system.programInvocationName);

let __dirname = getProgramDir(PROGRAM).get_path();
let __filename = PROGRAM.get_path();



Object.defineProperties(globalThis, {
  __dirname: { get: () => __dirname },
  __filename: { get: () => __filename },
  require: { value: require },
});

// if (!globalThis.global) Object.defineProperty(global, { value: globalThis });
// if (!globalThis.window) Object.defineProperty(window, { value: globalThis });

if (!globalThis.clearImmediate) Object.defineProperty(globalThis, 'clearImmediate', { value: timers.clearImmediate });
if (!globalThis.clearInterval) Object.defineProperty(globalThis, 'clearInterval', { value: timers.clearInterval });
if (!globalThis.clearTimeout) Object.defineProperty(globalThis, 'clearTimeout', { value: timers.clearTimeout });
if (!globalThis.setImmediate) Object.defineProperty(globalThis, 'setImmediate', { value: timers.setImmediate });
if (!globalThis.setInterval) Object.defineProperty(globalThis, 'setInterval', { value: timers.setInterval });
if (!globalThis.setTimeout) Object.defineProperty(globalThis, 'setTimeout', { value: timers.setTimeout });

if (!globalThis.process) Object.defineProperty(globalThis, 'process', { value: process });

if (!globalThis.performance) Object.defineProperty(globalThis, 'performance', { value: performance() });