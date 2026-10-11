// The GJS door: the native classes, re-exported (ADR 0100 § 7). `Gtk.FileDialog` opens the xdg
// portal, so there is no driver to register here; the portal is the seam (ADR 0101).

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import type { FileChooserDriver } from '@gjsify/adwaita-core';

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

export function registerFileChooserDriver(_next: FileChooserDriver | null): FileChooserDriver | null {
    throw new Error(
        'registerFileChooserDriver() has no effect on GJS: Gtk.FileDialog is native there and the xdg portal is its driver (ADR 0101).',
    );
}
