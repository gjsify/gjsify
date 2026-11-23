import Gio from '@girs/gio-2.0';

export function existsSync(path: string) {
    // TODO(open-todos: small API gaps): accept buffer and URL too
    if (typeof path !== 'string' || path === '') {
        return false;
    }

    const file = Gio.File.new_for_path(path);
    return file.query_exists(null);
}
