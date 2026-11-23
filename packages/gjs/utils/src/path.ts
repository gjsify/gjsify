import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
const { File } = Gio;

export const resolve = (dir: string, ...filenames: string[]) => {
    let file = File.new_for_path(dir);
    for (const filename of filenames) {
        file = file.resolve_relative_path(filename);
    }
    return file;
};

export const getPathSeparator = () => {
    const currentDir = GLib.get_current_dir();
    return currentDir.startsWith('/') ? '/' : '\\';
};
