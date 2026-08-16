import Gio from '@girs/gio-2.0';
import GioUnix from '@girs/giounix-2.0';
/** Is `fd` open? Probed by wrapping it, as GLib has no file-descriptor test. */
export const existsFD = (fd: number) => {
    try {
        let stream = GioUnix.InputStream.new(fd, false);
        stream.close(null);
        return true;
    } catch (_error) {
        // The throw IS the answer: an unusable fd cannot be wrapped.
        return false;
    }
};

export function existsSync(path: string) {
    // TODO(open-todos: small API gaps): accept buffer and URL too
    if (typeof path !== 'string' || path === '') {
        return false;
    }

    const file = Gio.File.new_for_path(path);
    return file.query_exists(null);
}
