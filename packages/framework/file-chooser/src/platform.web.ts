// The browser door. Taken from the renderer's ROOT namespaces, not from the core directly, so the
// classes are the ones `gi://Gtk` and `gi://Gio` resolve to under `--gi-renderer`, the root's
// stylesheet reaches the self-drawn OPFS dialog, and `namespace/gio.ts` registers the web driver.

import { Gio, GLib, Gtk } from '@gjsify/adwaita-web';
import { registerFileChooserDriver } from '@gjsify/adwaita-core';

export const FileDialog = Gtk.FileDialog;
export const FileFilter = Gtk.FileFilter;
export const DialogError = Gtk.DialogError;
export const File = Gio.File;
export const ListStore = Gio.ListStore;
export const OutputStream = Gio.OutputStream;
export const FileOutputStream = Gio.FileOutputStream;
export const FileCreateFlags = Gio.FileCreateFlags;
export const IOErrorEnum = Gio.IOErrorEnum;
export const promisify = Gio._promisify;
export const Bytes = GLib.Bytes;
export const GLibError = GLib.Error;
export { registerFileChooserDriver };
