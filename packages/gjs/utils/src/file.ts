import GLib from '@gjsify/types/GLib-2.0';
import { byteArray } from '@gjsify/types/Gjs';

export const readJSON = (path: string) => {
  const [ok, contents] = GLib.file_get_contents(path);
  if (ok) {
    const map = JSON.parse(byteArray.toString(contents));
    return map;
  }
  throw new Error(`Error on require "${path}"`);
}
