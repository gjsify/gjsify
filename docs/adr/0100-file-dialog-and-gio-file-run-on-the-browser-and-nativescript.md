# 100. `Gtk.FileDialog` and `Gio.File` run on the browser and NativeScript, as `@gjsify/file-chooser`

- Status: **Proposed** (2026-10-09)
- Date: 2026-10-09
- Deciders: Pascal Garber
- Depends on: [ADR 0096 (a GObject subset)](0096-a-gobject-subset-runs-on-the-browser-and-nativescript.md)
- Related: [ADR 0098 (a minimal Application)](0098-a-minimal-application-runs-on-the-browser-and-nativescript.md),
  [ADR 0099 (`Gio.Settings`)](0099-gio-settings-runs-on-the-browser-and-nativescript.md)
- Completes: the `Gio.File` item of ADR 0098 § What this does not decide.

## Rule for every stage

The API is GTK's and GIO's. A stage may implement a strict SUBSET: the same names with GJS's
semantics, and what is not implemented throws, naming it. Later stages only add. A claim needs a
conformance vector; a refusal must throw.

## Guiding rule

The GTK API stays identical: a true subset, same names, same semantics. BELOW that API each platform
behaves the way its own native apps do: Android the Android way, the browser the web way. Where a
question arises, look at the native original first. This answers three questions this ADR once held
open: Android extension filters (§ 2), streams (§ 3) and a repeated save without File System Access
(§ 4).

## Context

Learn6502 (`gjsify/easy6502`, `packages/app-gnome/src/services/file.service.ts`) opens and saves
`.asm` source. Measured, by reading the source:

- **Dialog.** `new Gtk.FileDialog({ title, modal: true, filters, initial_name })`, then
  `await dialog.open(window, null)` / `await dialog.save(window, null)`. `bootstrap.ts` makes those
  awaitable with `Gio._promisify(Gtk.FileDialog.prototype, "open", "open_finish")` (and `save`).
- **Filters.** A `Gio.ListStore({ item_type: Gtk.FileFilter.$gtype })` of two `Gtk.FileFilter.new()`:
  `set_name` and `add_pattern("*.asm")`, `add_pattern("*.s")`; and `set_name` plus `add_pattern("*")`.
- **Read.** `await file.load_contents_async(null)` returns `[contents]`; decoded with `TextDecoder`.
  `file.get_basename()` is shown as the document name.
- **Write.** `file.replace_async(null, false, Gio.FileCreateFlags.NONE, GLib.PRIORITY_DEFAULT, null)`,
  `stream.write_bytes_async(new GLib.Bytes(bytes), …)`, `stream.close_async(…)`.
- **Handle kept.** The `Gio.File` is stored (`currentFile`) so "Save" writes to it again without a
  dialog.
- **Cancel.** Every path ends in a catch-all that logs and returns `null`/`false`. The code never
  tests for `Gtk.DialogError.DISMISSED`.

What gjsify has today, measured in this repository:

- `packages/framework/adwaita-app/src/file-dialog.ts`: `pickFile` / `saveFile`, GJS-only helpers over
  `Gtk.FileDialog` that return a PATH string (or `null` on any error). A path is exactly what the
  browser and Android do not have. They are a different shape from GTK's, so they are not the subset.
- `packages/nativescript-bridge/fs`: `node:fs/promises` over `java.io.File`. It cannot open a
  `content://` URI, which is what the Android file picker returns.
- `packages/web/webstorage` and the web `Gio` barrels hold no file API. `showOpenFilePicker`,
  `showSaveFilePicker` and `ACTION_OPEN_DOCUMENT` appear nowhere in `packages/`.

So the capability is new, and the path-returning helper is not a base for it.

## Decision

**`@gjsify/file-chooser` exports `FileDialog`, `FileFilter` and a `File` class that are a strict subset
of `Gtk.FileDialog`, `Gtk.FileFilter` and `Gio.File`. On GJS it is not used: `gi://Gtk` is native and
opens the xdg portal. On the browser it uses the File System Access API where present, `<input
type=file>` plus a download where not. On NativeScript it uses the Android Storage Access Framework.
A `File` is a handle to bytes, not a path. What a platform cannot honour is refused by name.**

### 1. `Gtk.FileDialog`

| GJS spelling | on the browser and NativeScript |
|---|---|
| `new Gtk.FileDialog({ title, modal, filters, initial_name, default_filter })` | implemented. `modal: false` is refused: neither surface can open non-modally |
| `open(parent, cancellable, callback)` + `open_finish(result)` | implemented; the primitive. `parent` is accepted and ignored on the web, used as the owner on NativeScript |
| `save(parent, cancellable, callback)` + `save_finish(result)` | implemented, as above |
| `await dialog.open(parent, null)` after `Gio._promisify` | implemented: `Gio._promisify` is exported with the same call shape, so `bootstrap.ts` keeps working. `open`/`save` resolve a `File`; a missing `_finish` pair throws at the `_promisify` call |
| `set_title`, `set_filters`, `set_default_filter`, `set_initial_name`, `set_modal` | implemented, same checks as the constructor |
| `open_multiple`, `select_folder`, `select_multiple_folders` + `_finish` | refused by name until the gap report lists them (ADR 0096 § 2) |
| `initial_folder`, `initial_file`, `accept_label` | refused by name. A folder is not a thing the web or SAF lets a page choose |
| `Gtk.FileChooserNative`, `Gtk.FileChooserDialog`, `Gtk.FileChooserWidget` | refused by name |

`cancellable` is accepted and honoured only as "already cancelled": `open(parent, cancellable)` with
`cancellable.is_cancelled()` rejects with `Gio.IOErrorEnum.CANCELLED` (code 19) before opening. A
cancellable that fires while the dialog is open cannot close a browser picker or an Android intent;
it is ignored there and the vector says so.

### 2. Filters

`Gtk.FileFilter` subset: `Gtk.FileFilter.new()` / `new Gtk.FileFilter()`, `set_name`, `add_pattern`,
`add_suffix`, `add_mime_type`. `filters` is a `Gio.ListStore` whose `item_type` is
`Gtk.FileFilter.$gtype`, with `append` only; `Gio.ListStore` here is the minimal store the dialog
reads, and any other member throws by name.

| filter content | browser, File System Access | browser, `<input type=file>` | Android |
|---|---|---|---|
| `add_pattern("*.ext")`, `add_suffix("ext")` | `types[].accept` extension | `accept=".ext"` | a hint: `*/*` (below) |
| `add_mime_type(m)` | `types[].accept` MIME | `accept="m"` | `EXTRA_MIME_TYPES` |
| `add_pattern("*")` | the filter is the accept-all option | no `accept` | `*/*` |
| any other glob (`a*.s`, `[ab].s`) | refused by name | refused | refused |
| `add_pixbuf_formats`, `add_mime_type` of a wildcard other than `*/*` | refused | refused | `type/*` implemented |

Case: GTK's `add_pattern` is case-sensitive and `add_suffix` is not. File System Access matches
extensions case-insensitively. The vector pins GJS's behaviour; the browser cell records the
difference for patterns instead of hiding it.

**Android filters by MIME type.** `ACTION_OPEN_DOCUMENT` takes MIME types only, and an `.asm` file has
no registered one. `add_mime_type` maps to `EXTRA_MIME_TYPES`. A filter with only suffixes or patterns
opens with `*/*` and any pick is accepted: the filter is a hint. This is the native Android
convention, which is what the Guiding rule asks for, not a deviation. GTK's own filter is a user
choice as well.

### 3. What a `File` is

A `File` is created only by a dialog (or `File.new_for_path`, § 5). It carries a platform handle:

| | handle | `get_path()` | `get_uri()` | `get_basename()` |
|---|---|---|---|---|
| browser, File System Access | `FileSystemFileHandle` | `null` | refused by name | `handle.name` |
| browser, `<input type=file>` | the `File` object, read-only | `null` | refused | `file.name` |
| browser, download fallback | a download sink, one download per save (§ 4) | `null` | refused | the suggested name |
| Android, SAF | `content://` URI | `null` | the URI | `OpenableColumns.DISPLAY_NAME` |

`null` for `get_path()` is GJS's own answer for a file with no local path (a portal `content://` or
`smb://` file), so a caller written for GJS already handles it.

| GJS spelling | on the browser and NativeScript |
|---|---|
| `load_contents_async(cancellable)` + `load_contents_finish` | implemented; resolves `[Uint8Array, etag]` as GJS does, `etag` `null`. Reads the handle in full |
| `replace_contents_async(contents, etag, make_backup, flags, cancellable)` + `_finish` | implemented for `etag` `null`, `make_backup` `false`, `flags` `Gio.FileCreateFlags.NONE`. Anything else throws naming the argument. Writes in place and truncates |
| `get_basename()`, `get_path()`, `get_uri()` | as the table |
| `replace_async(etag, make_backup, flags, io_priority, cancellable)` + `replace_finish` → `Gio.FileOutputStream` | implemented for `etag` `null`, `make_backup` `false`, `flags` `Gio.FileCreateFlags.NONE`; anything else throws naming the argument. Opens the handle for writing and truncates |
| `Gio.FileOutputStream.write_bytes_async(bytes, io_priority, cancellable)` + `write_bytes_finish` | implemented; `bytes` is a `GLib.Bytes`, the result the count written. Writes after the last write; a write after `close_async` throws |
| `Gio.FileOutputStream.close_async(io_priority, cancellable)` + `close_finish` | implemented; commits the write (a download on a handle without File System Access, § 4). A second close resolves `true`, as GIO's does |
| `GLib.Bytes` | minimal: `new GLib.Bytes(Uint8Array)`, `get_size()`, `get_data()`. Everything else (`new_take`, `slice`, `hash`, `compare`, `unref_to_data`) refused by name |
| other `Gio.OutputStream` / `Gio.FileOutputStream` members (`write`, `write_all`, `splice`, `flush`, `seek`, `query_info`) | refused by name |
| `read_async`, `query_info`, `query_exists`, `delete`, `move`, `copy`, `get_parent`, `enumerate_children`, `monitor_*` | refused by name |
| `Gio.File.new_for_path`, `new_for_uri` | refused by name. A page and an Android app have no path to name |

`replace_contents_async` is NOT atomic here. GJS writes a temporary file and renames it. File System
Access `createWritable` commits on `close()` and Android `openOutputStream(uri, "wt")` truncates then
writes. A crash mid-write can lose content on Android. The vector checks the contents after a
success, not atomicity, and the package's README states the difference.

### 4. Browser without File System Access

Firefox and Safari have `<input type=file>` and `<a download>` and nothing that writes to a chosen
place. `open()` works through `<input type=file>` and resolves a read-only `File`. `save()` resolves a
download-only `File`: each `replace_contents_async`, or each `replace_async` stream closed with
`close_async`, offers `Blob` bytes as a download named `initial_name`. A repeated save on the same
handle downloads again; it does not throw. That is what native web apps do, and the browser names the
file `file (1).asm` itself. `load_contents_async` on a download-only handle throws, naming that it
cannot be read.

`open()` and `save()` need transient user activation in the browser. A call without it rejects with
a `Gtk.DialogError.FAILED` naming that cause; GJS never has this condition.

### 5. Cancel and errors

GJS rejects with `GLib.Error` in the `Gtk.DialogError` domain: `FAILED` = 0, `CANCELLED` = 1,
`DISMISSED` = 2. A user closing the portal dialog is `DISMISSED`. The subset:

| event | rejection |
|---|---|
| browser `AbortError` from `showOpenFilePicker`, `cancel` event of `<input type=file>` | `Gtk.DialogError.DISMISSED` |
| Android `RESULT_CANCELED` | `Gtk.DialogError.DISMISSED` |
| `cancellable` already cancelled | `Gio.IOErrorEnum.CANCELLED` |
| anything else (permission, `SecurityError`, no activation) | `Gtk.DialogError.FAILED`, message names the cause |

In GJS every rejection is `instanceof GLib.Error`, so the subset exports a real `GLib.Error` class, not
a dialog-only error shape. It carries what consumers use: `new GLib.Error(domain, code, message)`, the
`domain`, `code` and `message` fields, and `matches(domain, code)`
(`e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)`). `instanceof GLib.Error` holds for every
rejection from `Gtk.FileDialog` and the `Gio.File` subset. Everything else on `GLib.Error`
(`new_literal`, the quark helpers) throws by name. `Gtk.DialogError` and `Gio.IOErrorEnum` are exported
with the members used only.

### 6. Proof

- `FILE_CHOOSER_VECTORS` in `@gjsify/file-chooser/conformance`, on the web driver (with the browser
  pickers replaced by a scripted double), the NativeScript driver (the Android intent replaced by a
  scripted double) and real GJS. The GJS driver replaces the portal by a `Gtk.FileDialog` backed by a
  test `Gio.File`; GJS is the oracle for the SHAPE of results and errors, not for the picker UI.
- Vectors: `open` resolves a `File` whose `load_contents_async` returns the bytes; `save` then
  `replace_contents_async` then `load_contents_async` round-trips; a second `replace_contents_async`
  on the same `File` overwrites (on a download-only handle: offers a second download); the stream
  path `replace_async` → `write_bytes_async(new GLib.Bytes(bytes))` → `close_async` round-trips the
  same bytes, one vector per call (`replace_async`, `write_bytes_async`, `close_async`,
  `GLib.Bytes` `get_size`/`get_data`); a write after close throws; `get_basename`; `get_path` is `null` where § 3 says so; a filter
  with `*.asm` and `*.s` reaches the picker as both; the dismissed dialog rejects with
  `Gtk.DialogError.DISMISSED`, `instanceof GLib.Error` is true and `matches(Gtk.DialogError,
  Gtk.DialogError.DISMISSED)` is true while `matches(Gtk.DialogError, Gtk.DialogError.FAILED)` and
  `matches(Gio.IOErrorEnum, …)` are false; a cancelled `cancellable` rejects `instanceof GLib.Error`
  with domain `Gio.IOErrorEnum`; `domain`, `code` and `message` are read back; `new GLib.Error(domain,
  code, message)` round-trips the three fields and is `instanceof GLib.Error`; every rejection from
  the `Gio.File` subset is `instanceof GLib.Error`; callback form and `_promisify` form agree.
- Refusal vectors (every refused row of §§ 1–3, `modal: false`, a non-extension glob,
  `etag`/`make_backup`/`flags`, the refused `GLib.Bytes`, stream and `GLib.Error` members) are subset-only and not
  run on GJS.
- The Android mapping is verified on a device or emulator before the NativeScript cell says
  `implemented`; the pure half (filter → intent extras) is specced off-device.
- The gate is the one ADR 0093 § 4 built.

## Consequences

- Learn6502's `file.service.ts` runs on three targets with no change: `bootstrap.ts`, the dialog code
  and `saveToFile` stay as they are.
- `pickFile`/`saveFile` in `@gjsify/adwaita-app` stay as GJS helpers; they are not the portable API.
- A browser without File System Access gets "Open", and every "Save" is a download, as in a native
  web app.
- `Gio.File` handles do not survive a restart. Android persistable permissions and
  `IndexedDB`-stored handles are not claimed.

## Alternatives rejected

- **A path-returning `pickFile` everywhere.** The web has no paths and Android's are `content://`
  URIs; a path-shaped API invents one.
- **`showOpenFilePicker` only.** It excludes Firefox and Safari from "Open", which `<input
  type=file>` serves.
- **Throw on a second save to a download handle.** No native web app does; it would make the app
  differ from the platform it runs on.
- **Change Learn6502 to avoid streams.** The API stays GTK's; the subset grows by what the app calls.
- **Port `Gio.File` completely** (`query_info`, monitors, enumerate). No handle on these targets can
  answer them.

## What this does not decide

- `Gio.OutputStream` and `GLib.Bytes` beyond the calls in § 3, folders and multiple selection, drag-and-drop files, and the
  clipboard.
- Handles across restarts, and iOS (document picker is the obvious cell, not reasoned here).

## Implementation

Tracked in `status/open-todos/adwaita-core.md`. One PR, a commit per step: the vectors against
GJS (the oracle first); the filter mapping and `File`; the File System Access and `<input>` doors;
the Android door; the `Gtk`/`Gio` barrel rows and the `GI_RENDERERS` arm. First consumer: Learn6502's
`file.service.ts`, converted in its own repository once a release carries this.
