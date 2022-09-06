/*! (c) Andrea Giammarchi - ISC - https://github.com/WebReflection/gjs-require */

const { searchPath } = imports;
import { resolve as _resolve, readJSON, getNodeModulesPath } from '@gjsify/utils';
import Gio from '@gjsify/types/Gio-2.0';
import GLib from '@gjsify/types/GLib-2.0';
import { ALIASES_NODE, ALIASES_WEB } from "@gjsify/resolve-npm";
// import { URL } from 'url';

// See https://gjs-docs.gnome.org/gjs/esmodules.md
let [ __filename ] = GLib.filename_from_uri(import.meta.url);
let __dirname = GLib.path_get_dirname(__filename);

const NODE_MODULES_PATH = getNodeModulesPath().get_path();

// This should be defined with esbuild.define, but currently this leads to an error in esbuild
const RESOLVE_ALIASES = {...ALIASES_NODE, ...ALIASES_WEB};

const cache = Object.create(null);

/** gi://GLib?version=2.0 */
const giEsmImportToLegacy = (path: string) => {
  print("require", path);
  path = path.replace(/^gi\:\/\//, '');
  const parts = path.split('?')
  let version = parts[1];
  const lib = parts[0];
  if (version?.startsWith('version=')) {
    version = version.replace('version=', '');
    imports.gi.versions[lib] = version;
  }

  print("version", version);
  print("lib", lib);
  const test = imports.gi[lib];
  print("test", test);
  return test;
}

/**
 * CJS require for .js files
 * @param {string} file 
 * @returns 
 */
const requireJs = (file: string) => {

  // TODO
  if(file.startsWith('gi://')) {
    return giEsmImportToLegacy(file);
  }

  let fd = _resolve(file);
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

  let basename = fd.get_basename();

  if(basename.endsWith('.mjs')) {
    throw new Error(`You can't use "require" for .mjs files! Please use "import" instead! Path: ${fn}"`);
  }

  // "Gjs can't import files with .cjs file extensions, so we copy it to .js
  if (/\.(cjs)$/.test(basename)) {
    const dest = _resolve(dn, '__gjsify__' + basename.replace(/\.(cjs)$/, '.js'));
    if(dest.query_exists(null)) {
      dest.delete(null);
    }

    fd.copy(dest, Gio.FileCopyFlags.NONE, null, null);
    fd = dest;
    basename = fd.get_basename();
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
 * @param pkgNameOrFile
 * @param useAlias
 * @returns THe string path if the file was found, otherwise null
 */
const resolve = (pkgNameOrFile: string, useAlias = true) => {

  const _pkgNameOrFile = pkgNameOrFile;

  if(pkgNameOrFile.startsWith('gi://')) {
    return pkgNameOrFile;
  }

  if(useAlias && RESOLVE_ALIASES[pkgNameOrFile] && RESOLVE_ALIASES[pkgNameOrFile] !== pkgNameOrFile) {
    const alias = RESOLVE_ALIASES[pkgNameOrFile];
    console.warn(`require: Use alias "${alias}" for "${pkgNameOrFile}"`);
    pkgNameOrFile = alias;
  }

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
    path = _resolve(NODE_MODULES_PATH, pkgNameOrFile);
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
      const entryFileWithoutExtension = entryFile.get_path();
      entryFile = _resolve(entryFileWithoutExtension + '.js');
      if (!entryFile.query_exists(null)) {
        entryFile = _resolve(entryFileWithoutExtension + '.cjs');
      }
    }
    basename = entryFile.get_basename();
  }

  if(basename.endsWith('.mjs') && useAlias) {
    entryFile = _resolve(entryFile.get_path().replace(/\.mjs$/, '.js'));
    if (entryFile.query_exists(null)) {
      console.warn(`require: Replace ".mjs" with ".js", because you can't require ".mjs" files!`);
    } else {
      entryFile = _resolve(entryFile.get_path().replace(/\.mjs$/, '.cjs'));
      if (entryFile.query_exists(null)) {
        console.warn(`require: Replace ".mjs" with ".cjs", because you can't require ".mjs" files!`);
      } else {
        console.warn(`require: Revert alias because the resolved alias file ends with .mjs!`);
        return resolve(_pkgNameOrFile, false);
      }
    }
  }

  if (!entryFile.query_exists(null)) {
    if(useAlias) {
      console.warn(`require: Revert alias because the file was not found!`);
      return resolve(_pkgNameOrFile, false);
    }

    throw new Error(`require: Entry file "${entryFile.get_path()}" not exists!`);
  }

  return entryFile.get_path();
}

require.resolve = resolve;

Object.defineProperties(globalThis, {
  __dirname: { get: () => __dirname },
  __filename: { get: () => __filename },
  require: { value: require },
});
