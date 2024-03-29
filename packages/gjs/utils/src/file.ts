import GLib from '@girs/glib-2.0';

const byteArray = imports.byteArray;

export const readJSON = (path: string) => {
  const [ok, contents] = GLib.file_get_contents(path);
  if (ok) {
    const map = JSON.parse(byteArray.toString(contents));
    return map;
  }
  throw new Error(`Error on require "${path}"`);
}
