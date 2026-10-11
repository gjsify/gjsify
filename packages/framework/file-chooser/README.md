# @gjsify/file-chooser

`Gtk.FileDialog`, `Gtk.FileFilter` and `Gio.File` as one import on GJS, the browser and
NativeScript ([ADR 0100](../../../docs/adr/0100-file-dialog-and-gio-file-run-on-the-browser-and-nativescript.md)).

```ts
import { FileDialog, FileFilter, File, ListStore, promisify } from '@gjsify/file-chooser';

promisify(FileDialog.prototype, 'open', 'open_finish');
promisify(File.prototype, 'load_contents_async', 'load_contents_finish');

const filter = FileFilter.new();
filter.set_name('Assembly');
filter.add_suffix('asm');
const filters = new ListStore({ item_type: FileFilter.$gtype });
filters.append(filter);

const file = await new FileDialog({ filters }).open(window, null);
const [contents] = await file.load_contents_async(null);
```

| Target | What you get |
|---|---|
| GJS | the native `gi://` classes, by identity; the xdg portal is the dialog |
| browser | File System Access where `showSaveFilePicker` exists, otherwise a self-drawn Adwaita dialog over the Origin Private File System |
| NativeScript (Android) | the Storage Access Framework (`ACTION_OPEN_DOCUMENT` / `ACTION_CREATE_DOCUMENT`) |

The package is a strict SUBSET of the GJS API: the same names and semantics, and anything outside
the subset (`File.new_for_uri`, `get_parent`, `query_exists`, non-modal dialogs, `open_multiple`,
glob patterns other than `*.ext` and `*`, …) throws `UnsupportedGObjectError` rather than guessing.

## Recommended import path

- An app written against `gi://` that you build with `gjsify build --gi-renderer` needs nothing
  from here: `gi://Gtk` and `gi://Gio` already resolve to the renderer, which carries the same
  subset.
- Code that imports `@gjsify/file-chooser` gets the right door per target through gjsify's
  platform files (`platform.gtk.ts` / `platform.web.ts` / `platform.native.ts`). A bundler
  without those chains gets the base, which has no driver: every `open`/`save` rejects
  `Gtk.DialogError.FAILED` until you call `registerFileChooserDriver()`.

## Behaviour you should know about

- **A save is not atomic on the ports.** `replace_async` truncates and writes in place; GJS writes
  a temporary file and renames it. A crash mid-write leaves a partial file on the web and Android.
- **OPFS is invisible to the file manager.** On a browser without File System Access, files live
  in the origin's private storage. The dialog's "Upload…" copies a picked file in; nothing is ever
  saved as a download.
- **Persistence is the app's call.** The browser may evict OPFS under storage pressure; call
  `navigator.storage.persist()` yourself if your files must survive that.
- **Android filters by MIME type.** An extension-only filter (`add_suffix('asm')`) opens `*/*`
  and accepts any pick: the filter is a hint, as is usual on Android.
- **`etag` is `null` on the ports**; the browser has no user activation outside a gesture, so a
  dialog opened then rejects `Gtk.DialogError.FAILED`.
- **iOS has no picker yet**: `open`/`save` reject `FAILED`.

## Conformance

`@gjsify/file-chooser/conformance` exports `FILE_CHOOSER_VECTORS` and `driveFileChooserVectors`,
the same vectors that run against real GJS, for anyone writing a driver of their own.
