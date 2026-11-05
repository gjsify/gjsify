import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import process from 'node:process';

/**
 * The per-user cache directory, as `GLib.get_user_cache_dir()` answers it on
 * Linux and macOS: `$XDG_CACHE_HOME` when it is an absolute path, else
 * `~/.cache`. Flatpak sets `XDG_CACHE_HOME` to the sandbox's own cache, so a
 * Flatpak app lands in `~/.var/app/<id>/cache` like every GLib app does.
 *
 * Read from the environment instead of GLib so the package runs under plain
 * Node too. On Windows GLib answers the Internet cache folder; this answers
 * `%LOCALAPPDATA%`, which is where Windows apps keep caches.
 */
export function userCacheDir(): string {
    const xdg = process.env.XDG_CACHE_HOME;
    if (xdg !== undefined && xdg !== '' && isAbsolute(xdg)) return xdg;
    if (process.platform === 'win32') {
        const local = process.env.LOCALAPPDATA;
        if (local !== undefined && local !== '') return local;
    }
    return join(homedir(), '.cache');
}

/** `<user cache>/gjsify/models` — the root every capability's directory sits under. */
export function modelsRoot(): string {
    return join(userCacheDir(), 'gjsify', 'models');
}
