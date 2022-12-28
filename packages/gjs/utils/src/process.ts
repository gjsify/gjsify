import Gio from '@gjsify/types/Gio-2.0';
import GLib from '@gjsify/types/GLib-2.0';

const System = imports.system;

/** Cached process id */
let PID = 0;
/** Cached parent process id */
let PPID = 0;
/** Cached locale */
let LOCALE = ""

export const getLocale = () => {
    if(!LOCALE) {
        LOCALE = GLib.getenv("LANG").split('.')[0].replace('_', '-');
    }
    return LOCALE
}

/** Get process id */
export const getPid = () => {
    if(!PID) {
        PID = new Gio.Credentials().get_unix_pid();
    }
    return PID;
}

/** Get parent process id */
export const getPpid = () => {
    if(!PPID) {
        const path = `/proc/${getPid()}/status`;
        const file = Gio.File.new_for_path(path);
        const [success, contents] = file.load_contents(null);
        if (success) {
            const contentStr = new TextDecoder().decode(contents);
            const numStr = contentStr.match(/^PPid:.*$/gm)[0]?.match(/(\d+)$/gm)[0]
            PPID = Number(numStr);
        }
        console.error(new Error("Failed to read file: " + path));
    }
    
    return PPID;
}

export const getTitle = () => {
    return GLib.get_prgname();
}

export const getGjsVersion = () => {
    const v = System.version.toString();
    return `${v[0]}.${+(v[1] + v[2])}.${+(v[3] + v[4])}`;
}