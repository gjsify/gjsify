import '@gjsify/types/index';
import Gio from '@gjsify/types/Gio-2.0';
import GLib from '@gjsify/types/GLib-2.0';

const byteArray = imports.byteArray;
const { File } = Gio;

const _getProgramDir = (programFile: Gio.File) => {
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
export const resolve = (dir: string, ...filenames: string[]) => {
  let file = File.new_for_path(dir);
  for (const filename of filenames) {
    file = file.resolve_relative_path(filename);
  }
  return file;
}
  
export const readJSON = (path: string) => {
  const [ok, contents] = GLib.file_get_contents(path);
  if (ok) {
    const map = JSON.parse(byteArray.toString(contents));
    return map;
  }
  throw new Error(`Error on require "${path}"`);
}

// See https://github.com/denoland/deno_std/blob/44d05e7a8d445888d989d49eb3e59eee3055f2c5/node/_utils.ts#L21
export const notImplemented = (msg: string) => {
  const message = msg ? `Not implemented: ${msg}` : "Not implemented";
  throw new Error(message);
}

export const warnNotImplemented = (msg) => {
  const message = msg ? `Not implemented: ${msg}` : "Not implemented";
  console.warn(message);
}

// TODO move this to a new package for https://nodejs.org/api/child_process.html
export const cli = (commandLine: string) => {
    const [res, out, err, status] = GLib.spawn_command_line_sync(commandLine);

    if(err.byteLength) throw new Error(byteArray.toString(err));

    return byteArray.toString(out);
};
