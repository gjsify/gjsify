import Gio from '@girs/gio-2.0';

/** Check if a file descriptor exists */
export const existsFD = (fd: number) => {
    try {
        let stream = Gio.UnixInputStream.new(fd, false);
        stream.close(null);
        // File descriptor 12345 exists
        return true
    } catch (error) {
        // File descriptor 12345 does not exist
        return false
    }
}

export function existsSync(path: string) {
    // TODO: accept buffer and URL too
    if (typeof path !== 'string' || path === '') {
        return false;
    }

    const file = Gio.File.new_for_path(path);
    return file.query_exists(null);
}