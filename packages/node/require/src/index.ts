/*! (c) Andrea Giammarchi - ISC - https://github.com/WebReflection/gjs-require */

const { searchPath } = imports;
import { resolve as _resolve, readJSON, getProgramDir, getProgramExe, getNodeModulesPath } from '@gjsify/utils';
import Gio from '@gjsify/types/Gio-2.0';

let __dirname = getProgramDir();
let __filename = getProgramExe().get_path();

const NODE_MODULES = getNodeModulesPath().get_path();

// This should be defined with esbuild.define, but currently this leads to an error in esbuild
const RESOLVE_ALIASES = {
  path: 'path-browserify',
  util: 'util',
  buffer: 'buffer',
  assert: 'assert',
  constants: 'constants-browserify',
  crypto: 'crypto-browserify',
  domain: 'domain-browser',
  events: '@gjsify/events',
  url: '@gjsify/url',
  stream: '@gjsify/stream',
  'stream/web': 'web-streams-polyfill/ponyfill',
  string_decoder: 'string_decoder',
  querystring: 'querystring-es3',
  zlib: '@gjsify/zlib',
  tty: '@gjsify/tty',
  fs: '@gjsify/fs',
  'fs/promises': '@gjsify/fs/lib/promises.mjs',
  os: '@gjsify/os',
  process: '@gjsify/process',
  punycode: 'punycode',
  http: '@gjsify/http',
  net: '@gjsify/net',
}

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

  const basename = fd.get_basename();

  // "Gjs can't import files with .cjs file extensions, so we copy it to .js if no .js exists
  if (/\.(cjs)$/.test(basename)) {
    const dest = _resolve(dn, basename.replace(/\.(cjs)$/, '.js'));
    if(!dest.query_exists(null)) {
      fd.copy(dest, Gio.FileCopyFlags.NONE, null, null);
    }
  }

  print("require", file, "from", _fn);
  
  // Use gjs import.xyz to import the file
  imports[basename.replace(/\.(js|cjs)$/, '')];

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

  if(RESOLVE_ALIASES[file]) {
    file = RESOLVE_ALIASES[file];
  }

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

    if (!path.query_exists(null)) {
      path = _resolve(path.get_path() + '.cjs');
    }
  }

  let pathStr = path.get_path();

  const pathInfo = path.query_info('standard::', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
  if (pathInfo.get_is_symlink()) {
    // Get real path from symlink
    pathStr = path.get_parent().resolve_relative_path(pathInfo.get_symlink_target()).get_path();
  }

  let basename = path.get_basename();

  if(basename.includes('.') || pathStr.endsWith('/')) {
    return pathStr;
  }

  const pkgJsonFile = _resolve(pathStr, 'package.json');
  
  if (!pkgJsonFile.query_exists(null)) {
    return pathStr;
  }

  const pkgData = readJSON(pkgJsonFile.get_path());
  let pkgMain: string = pkgData.main || pkgData.module || pkgData.browser || 'index.js';

  let entryFile = _resolve(pathStr, pkgMain);
  basename = entryFile.get_basename();

  if (!entryFile.query_exists(null)) {
    basename = entryFile.get_basename();
    if(!basename.includes('.')) {
      entryFile = _resolve(entryFile.get_path() + '.js');
    }
  }

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
