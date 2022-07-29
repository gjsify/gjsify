import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const { File } = Gio;

const byteArray = imports.byteArray;

const _getProgramDir = (programFile) => {
  const info = programFile.query_info('standard::', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
  if (info.get_is_symlink()) {
    const symlinkFile = programFile.get_parent().resolve_relative_path(info.get_symlink_target());
    return symlinkFile.get_parent();
  } else {
    return programFile.get_parent();
  }
}

export const getProgramExe = () => {
  const currentDir = GLib.get_current_dir();
  return File.new_for_path(currentDir).resolve_relative_path(imports.system.programInvocationName);
}

export const getProgramDir = () => {
  return _getProgramDir(getProgramExe()).get_path();
}

export const getPathSeparator = () => {
  const currentDir = GLib.get_current_dir();
  return /^\//.test(currentDir) ? '/' : '\\';
}

// TODO move to path
export const resolve = (dir, file) => {
  return File.new_for_path(dir).resolve_relative_path(file);
}
  
export const readJSON = (path) => {
  const [ok, contents] = GLib.file_get_contents(path);
  if (ok) {
    const map = JSON.parse(byteArray.toString(contents));
    return map;
  }
  throw new Error(`Error on require "${path}"`);
}

// See https://github.com/denoland/deno_std/blob/44d05e7a8d445888d989d49eb3e59eee3055f2c5/node/_utils.ts#L21
export function notImplemented(msg) {
  const message = msg ? `Not implemented: ${msg}` : "Not implemented";
  throw new Error(message);
}

export function warnNotImplemented(msg) {
  const message = msg ? `Not implemented: ${msg}` : "Not implemented";
  console.warn(message);
}