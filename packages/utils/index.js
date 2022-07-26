import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const { File } = Gio;

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
  return getProgramDir(getProgramExe()).get_path();
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
    const map = JSON.parse(contents);
    return map;
  }
  throw new Error(`Error on require "${path}"`);
}


