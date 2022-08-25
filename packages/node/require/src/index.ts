/*! (c) Andrea Giammarchi - ISC - https://github.com/WebReflection/gjs-require */

const { gi, searchPath } = imports;
import { resolve as _resolve, readJSON, getProgramDir, getProgramExe, getNodeModulesPath } from '@gjsify/utils';
import Gio from '@gjsify/types/Gio-2.0';

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
  const fd = _resolve(file);
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
 * CJS require
 * @param {string} file 
 * @returns 
 */
const require = (file: string) => {
  const path = resolve(file);

  if(!path) {
    throw new Error(`require: File "${file}" not found!`);
  }

  if (path in cache) {
    return cache[path];
  }

  if (file.endsWith('.json')) {
    return readJSON(path);
  } 

  return requireJs(path);
}

/**
 * @param file 
 * @returns THe string path if the file was found, otherwise null
 */
const resolve = (pkgNameOrFile: string) => {

  let path: Gio.File;

  // Relative path
  if (pkgNameOrFile.startsWith('.')) {
    path = _resolve(__dirname, pkgNameOrFile);
  }
  // Full path
  else if (pkgNameOrFile.startsWith('/') || pkgNameOrFile.startsWith('file://')) {
    path = _resolve(pkgNameOrFile);
  }
  // node modules path
  else {
    path = _resolve(NODE_MODULES, pkgNameOrFile);
  }

  if (!path.query_exists(null)) {
    const basename = path.get_basename();
    if(!basename.includes('.')) {
      path = _resolve(path.get_path() + '.js');
    }
  }

  let pathStr = path.get_path();

  const pathInfo = path.query_info('standard::', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
  if (pathInfo.get_is_symlink()) {
    // Get real path from symlink
    pathStr = path.get_parent().resolve_relative_path(pathInfo.get_symlink_target()).get_path();
  }

  const basename = path.get_basename();

  if(basename.includes('.') || pathStr.endsWith('/')) {
    return pathStr;
  }

  const pkgJsonFile = _resolve(pathStr, 'package.json');
  
  if (!pkgJsonFile.query_exists(null)) {
    return pathStr;
  }

  const pkgData = readJSON(pkgJsonFile.get_path());
  let pkgMain: string = pkgData.main || 'index.js';

  if(!pkgMain.slice(pkgMain.length - 5).includes('.')) {
    pkgMain = pkgMain + '.js';
  }

  const entryFile = _resolve(pathStr, pkgMain);

  if (!entryFile.query_exists(null)) {
    console.error(`require: Entry file "${entryFile.get_path()}" not exists!`);
    return null;
  }

  return entryFile.get_path();
}

require.resolve = resolve;

Object.defineProperties(globalThis, {
  __dirname: { get: () => __dirname },
  __filename: { get: () => __filename },
  require: { value: require },
});
