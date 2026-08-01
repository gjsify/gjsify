import GLib from '@girs/glib-2.0';

// TextDecoder, not the legacy `imports.byteArray.toString()` — bare `imports.*`
// is a ReferenceError off gjs (AGENTS.md § The legacy imports.* object is NOT
// an API; lint-enforced via no-restricted-globals).
const decoder = new TextDecoder();

export const readJSON = (path: string) => {
    const [ok, contents] = GLib.file_get_contents(path);
    if (ok) {
        const map = JSON.parse(decoder.decode(contents));
        return map;
    }
    throw new Error(`Error on require "${path}"`);
};
