// Access to the GjsifySqlite typelib that backs this package.

import { getLoadError, loadNativeSqlite, type NativeSqliteModule } from '@gjsify/sqlite-native';
import { InvalidStateError } from './errors.ts';

/**
 * The loaded native module, or a thrown explanation of why there is none.
 *
 * Unlike `@gjsify/tty`, which degrades to an env/GLib reading of the terminal when
 * `@gjsify/terminal-native` is absent, there is no second engine to fall back to: the
 * prebuild IS SQLite here. So the failure is raised at the first call that needs it —
 * carrying the loader's own message, which names the missing library rather than only
 * the namespace.
 */
export function nativeSqlite(): NativeSqliteModule {
    const native = loadNativeSqlite();
    if (!native) {
        const reason = getLoadError()?.message;
        throw new InvalidStateError(
            `@gjsify/sqlite requires the @gjsify/sqlite-native prebuild for this platform${
                reason ? `: ${reason}` : ''
            }`,
        );
    }
    return native;
}
