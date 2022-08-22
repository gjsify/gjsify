/*! (c) Andrea Giammarchi - ISC - https://github.com/WebReflection/gjs-require */

const { gi, searchPath } = imports;
import { resolve, readJSON, getProgramDir, getProgramExe, getNodeModulesPath } from '@gjsify/utils';

let __dirname = getProgramDir();
let __filename = getProgramExe().get_path();

const NODE_MODULES = getNodeModulesPath().get_path();

const cache = Object.create(null);

/**
 * CJS require for .js files
 * @param {string} file 
 * @returns 
 */
const requireJs = (file: string) => {
  if (!/\.js$/.test(file)) {
    file += '.js';
  }

  const fd = resolve(__dirname, file);
  const fn = fd.get_path();
  const dn = fd.get_parent().get_path();

  const _fn = __filename;
  const _dn = __dirname;
  const saved_exports = globalThis.exports;
  const saved_module = globalThis.module;
  const exports = {};
  const module = { exports };

  globalThis.exports = exports;
  globalThis.module = module as NodeModule;
  
  // Override `__filename` and `__dirname` relative to the current required file so that indirect requires can be resolved correctly
  __filename = fn;
  __dirname = dn;

  searchPath.unshift(dn);
  imports[fd.get_basename().replace(/\.js$/, '')];

  cache[fn] = module.exports;

  searchPath.shift();

  // Reset `__filename` and `__dirname` to the default
  __filename = _fn;
  __dirname = _dn;

  globalThis.exports = saved_exports;
  globalThis.module = saved_module;
  return cache[fn];
}

/**
 * CJS require for npm packages
 * @param {string} pkgName 
 * @returns 
 */
export const requireNpm = (pkgName: string) => {
  const path =  resolve(NODE_MODULES, pkgName).get_path();
  const pkgJsonPath = resolve(path, 'package.json').get_path();
  const pkgData = readJSON(pkgJsonPath);
  const pkgMain = pkgData.main || 'index.js';

  return requireJs(resolve(path, pkgMain).get_path());
}

/**
 * CJS require for json files
 * @param {string} file 
 * @returns 
 */
 export const requireJson = (file: string) => {
  const fd = resolve(__dirname, file);
  const fn = fd.get_path();

  const data = readJSON(fn);

  cache[fn] = data;

  return cache[fn];
}

/**
 * CJS require
 * @param {string} file 
 * @returns 
 */
export const require = (file: string) => {

  if (/^[A-Z]/.test(file)) {
    return file.split('.').reduce(($, k) => $[k], gi);
  }

  const fd = resolve(__dirname, file);
  const fn = fd.get_path();

  if (fn in cache) {
    return cache[fn];
  }

  if (file.endsWith('.json')) {
    return readJSON(fn);
  } else if (file.indexOf('/') === -1) {
    return requireNpm(file);
  }

  return requireJs(file);
}

Object.defineProperties(globalThis, {
  __dirname: { get: () => __dirname },
  __filename: { get: () => __filename },
  require: { value: require },
});