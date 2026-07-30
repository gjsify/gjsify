import GLib from '@girs/glib-2.0';

// Decoding goes through the standard `TextDecoder` (a GJS built-in, and native
// on Node/browser) rather than the legacy `imports.byteArray.toString()`: the
// `imports` object only exists when the GJS ambient globals are present, so it
// throws a `ReferenceError` on a `--app node` bundle built without the
// `@gjsify/node-gi/globals` shim.
const decoder = new TextDecoder();

export const readJSON = (path: string) => {
    const [ok, contents] = GLib.file_get_contents(path);
    if (ok) {
        const map = JSON.parse(decoder.decode(contents));
        return map;
    }
    throw new Error(`Error on require "${path}"`);
};
