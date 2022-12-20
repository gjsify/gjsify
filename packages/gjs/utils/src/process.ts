import Gio from '@gjsify/types/Gio-2.0';
import GLib from '@gjsify/types/GLib-2.0';

export const getLocale = () => {
    return GLib.getenv("LANG").split('.')[0].replace('_', '-');
}

/** Get process id */
export const getPid = () => {
    return new Gio.Credentials().get_unix_pid();
}

/** Get parent process id */
export const getPpid = () => {
    const path = `/proc/${getPid()}/status`;
    const file = Gio.File.new_for_path(path);
    const [success, contents] = file.load_contents(null);
    if (success) {
        const contentStr = new TextDecoder().decode(contents);
        const numStr = contentStr.match(/^PPid:.*$/gm)[0]?.match(/(\d+)$/gm)[0]
        return Number(numStr);
    }
    console.error(new Error("Failed to read file: " + path));
    return -1;
}

