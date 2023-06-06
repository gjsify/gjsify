import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
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

export const resolve = (dir: string, ...filenames: string[]) => {
    let file = File.new_for_path(dir);
    for (const filename of filenames) {
      file = file.resolve_relative_path(filename);
    }
    return file;
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

export const getNodeModulesPath = () => {
    let dir = File.new_for_path(getProgramDir());
    let found = false;

    do {
        dir = dir.resolve_relative_path("..");
        const nodeModulesDir = dir.resolve_relative_path("node_modules");
        found = nodeModulesDir.query_exists(null);
        if (found) {
            dir = nodeModulesDir;
        }
    } while (dir.has_parent(null) && !found)

    return dir;
}