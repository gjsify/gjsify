/*! (c) Andrea Giammarchi - ISC - https://github.com/WebReflection/gjs-require */

const { gi, system, searchPath } = imports;

const { GLib, Gio } = gi;
const { File } = Gio;

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

function resolve(dir, file) {
  return File.new_for_path(dir).resolve_relative_path(file);
}

function readJSON(path) {
  const [ok, contents] = GLib.file_get_contents(path);
  if (ok) {
    const map = JSON.parse(contents);
    return map;
  }
  throw new Error(`Error on require "${path}"`);
}

/**
 * 
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

  if(fn.endsWith('.json')) {
    return readJSON(fn);
  }

  print("fd", fd);
  print("fn", fn);

  if (fn in cache)
    return cache[fn];

  const dn = fd.get_parent().get_path();
  const _fn = __filename;
  const _dn = __dirname;
  const saved_exports = window.exports;
  const saved_module = window.module;
  const exports = {};
  const module = { exports };

  window.exports = exports;
  window.module = module;
  __filename = fn;
  __dirname = dn;
  searchPath.unshift(dn);
  imports[fd.get_basename().replace(/\.js$/, '')];
  cache[fn] = module.exports;
  searchPath.shift();
  __filename = _fn;
  __dirname = _dn;
  window.exports = saved_exports;
  window.module = saved_module;
  return cache[fn];
}

const DIR = GLib.get_current_dir();
const PROGRAM = resolve(DIR, system.programInvocationName);

let __dirname = getProgramDir(PROGRAM).get_path();
let __filename = PROGRAM.get_path();

Object.defineProperties(window, {
  __dirname: {get: () => __dirname},
  __filename: {get: () => __filename},
  global: {value: window},
  require: {value: require}
});

