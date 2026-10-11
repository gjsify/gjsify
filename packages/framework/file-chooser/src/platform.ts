// The base of the fork: the ADR 0100 subset with NO driver below it. A target the gjsify chains do
// not name (another bundler, a plain Node import) lands here, and every `open`/`save` rejects
// `Gtk.DialogError.FAILED` until the app registers a driver. The real doors are the siblings:
// `.gtk` (GJS, the native classes), `.web` (adwaita-web) and `.native` (adwaita-nativescript).

export {
    GtkFileDialog as FileDialog,
    GtkFileFilter as FileFilter,
    GioFile as File,
    GioListStore as ListStore,
    GioOutputStream as OutputStream,
    GioFileOutputStream as FileOutputStream,
    FileCreateFlags,
    IOErrorEnum,
    DialogError,
    GLibBytes as Bytes,
    GLibError,
    promisify,
    registerFileChooserDriver,
} from '@gjsify/adwaita-core';
