import GLib from '@girs/glib-2.0';

// `imports.byteArray` is GJS-only and undefined under Node. Access lazily inside
// the function body (called only on GJS) so the module's top level stays free
// of a hard `imports` reference — keeps node-target bundles loadable.

export const readJSON = (path: string) => {
    const [ok, contents] = GLib.file_get_contents(path);
    if (ok) {
        const map = JSON.parse(imports.byteArray.toString(contents));
        return map;
    }
    throw new Error(`Error on require "${path}"`);
};
