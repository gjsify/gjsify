# Real Gio behind Settings and Gio.File: the rest of ADR 0105 stage 3 (2026-10-12)

[Stage 3's first half](2026-10-10-real-gio-stage3.md) put a real `Gio.ListStore` behind the
portable list model. This is the other half: ADR 0099's `SETTINGS_VECTORS` and ADR 0100's
`FILE_CHOOSER_VECTORS` run against **real `Gio.Settings` and `Gio.File`** through node-gi, on the
host under Node and on an `x86_64` Android emulator (API 36).

**Both hold.** No vector was weakened and no `it.failing` was added. Getting there needed five
fixes in node-gi itself, each with a test, because the vectors were written against GJS and node-gi
disagreed with GJS in five places.

## Result

- **Host, Node 24.19.0, GLib 2.88, node-gi built in-tree:** `test:gjs-on-node` in
  `@gjsify/adwaita-gobject-native` went from 43 tests / 73 assertions to **79 tests / 109
  assertions**, all green. Settings runs against a compiled schema and the `memory` backend,
  never dconf. The file-chooser vectors run twice: once with real GTK, once with the Gtk stand-in
  the device uses, so the device path is covered on the host first.
- **Device, `x86_64` emulator, opt-in run:** **60 of 60** cases pass (twice in a row). The
  control run on pure JS: **27 of 27**. Settings is 8 vector rows plus the rows the loop adds;
  the file-chooser subject runs the Gio rows only (see below).
- **node-gi** `npm test`: 856 tests, one failure that predates this work (`webgl-glarea`, a
  missing dependency in the worktree).

## What had to be fixed in node-gi

1. **`Gio.Settings` aborted the process** on an unknown schema or key, and `set_uint('k', -1)`
   stored 4294967295. GJS throws in all of these. New `overrides/gio-settings.js`, ported from
   GJS's override.
2. **`Gio._promisify` replaced a JS function on the prototype** with the native call. GJS wraps
   it; the vectors rely on that to script a dialog.
3. **`Gio._promisify` accepted a method that does not exist.** GJS throws
   `<proto> has no method named X` at the call.
4. **A registration on a base class did not reach a subclass prototype** whose thunks were
   already materialised: `OutputStream.prototype` and `FileOutputStream`.
5. **An IN array of an async call was freed before the operation finished**
   (`replace_contents_async` wrote freed memory; the file held garbage). Fixed in `calls.cc`: the
   callback owns the containers until it is released. This one is native, so a prebuilt payload
   needs a rebuild; the emulator run failed on exactly this row until `libnode_gi.so` was rebuilt.
6. Found on the device: **`instanceof Gio.SettingsSchema` is false** for a schema `lookup`
   returned, because a boxed instance has no prototype link to its class. The Settings
   constructor check now recognises it by methods.

## Divergences recorded, not fixed

- `GLib.Error.domain` in node-gi is the quark NAME, GJS's is the numeric quark. Two `error` rows
  of ADR 0100 read it, and are listed in `NODE_GI_DIVERGENT_RULES` rather than weakened. Open
  todo in `status/open-todos/node-gi.md`.
- node-gi's integer marshaller wraps modulo 2^32. The Settings override range-checks instead. Open
  todo as well.

## Device specifics

- **No `glib-compile-schemas` on the device.** `scripts/compile-schemas.mjs` compiles the fixture
  schema on the host; the bytes ride in the bundle as base64 and are written to the app's
  documents folder at run time. Compiled bytes are loaded by the GLib in the APK, never compared.
- **`GSETTINGS_SCHEMA_DIR` is not honoured on the device**: the default schema source was already
  built, empty, before the suite ran. The subject therefore reads the schema from an explicit
  `Gio.SettingsSchemaSource` and constructs `Gio.Settings` from it; an id the source lacks falls
  through, so the unknown-schema row still meets the real refusal. The backend is still
  `GSETTINGS_BACKEND=memory`.
- **No Gtk typelib in the payload.** The file-chooser subject uses a Gtk stand-in
  (`FileFilter`, `FileDialog`, `DialogError`), and `rowsFor` drops the rows that are about GTK
  itself: `dialog`, `filter` and the enum-member, FileFilter and FileDialog rules. Everything
  about `Gio.File`, streams, `GLib.Error` and `_promisify` runs for real.
- To measure fix 5 the local `x86_64` `libnode_gi.so` inside the gitignored AAR was replaced with
  one built from this branch (NDK 27, same flags as the probe script plus `-llog`).

## Not done

- The prebuilt `@gjsify/gi-runtime-android` payload is not rebuilt or republished; it still has the
  `calls.cc` defect. That is a release action.
- No arm64 device was used. No timings were taken.
- The two `GLib.Error` rows stay off node-gi until a decision on the domain shape.
