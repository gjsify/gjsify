# 116. An app's GResources are embedded at build time, and a Gio subset answers them on the web and NativeScript

- Status: **Proposed**
- Date: 2026-10-15
- Deciders: Pascal Garber
- Related: [ADR 0115](0115-web-full-colour-icons.md) (amended by this ADR),
  [ADR 0100](0100-file-dialog-and-gio-file-run-on-the-browser-and-nativescript.md) (`Gio.File`),
  [ADR 0105](0105-real-gobject-backs-the-nativescript-subset-on-android.md) /
  [ADR 0110](0110-real-gobject-becomes-the-android-default-and-the-subset-stays-tested-there.md)
  (the two GObject engines on Android), [ADR 0094](0094-gtksource-is-a-headless-core-and-a-nativescript-package.md)
  (GtkSource managers); `packages/infra/cli/src/commands/gresource.ts`,
  `packages/framework/adwaita-app/scripts/build-icon-gresource.mjs`

## Context

On GNOME an app ships its icons, UI files, CSS and data in a GResource. GTK finds them by path:

- `gtk_application_load_resources` (`refs/gtk/gtk/gtkapplication.c`), called from
  `gtk_application_startup`, appends `icons/` to the application's resource base path and calls
  `gtk_icon_theme_add_resource_path` on the default theme. GApplication derives that base path from
  the application ID (`g_application_set_resource_base_path` in GIO; GLib is not vendored under
  `refs/`). The same function loads `gtk/menus.ui` if `g_resources_get_info` finds it.
- `gtk_icon_theme_set_resource_path` (`refs/gtk/gtk/gtkicontheme.c`) reads each resource path as a
  hicolor-shaped directory (`<path>/scalable/apps/<name>.svg`, `<path>/16x16/actions/…`) and treats
  files directly under the path as unthemed fallbacks. Both scans use
  `g_resources_enumerate_children`; the built-in hicolor index uses `g_resources_lookup_data`.
- A resource-path icon is a FALLBACK behind the host theme. `build-icon-gresource.mjs` measured
  this against gtk4: a host theme that has the name wins, the resource wins otherwise.

Learn6502 is the reference consumer. Its GNOME app compiles `eu.jumplink.Learn6502.data.gresource.xml`
(icons, metainfo, two GtkSource language specs, two style schemes) and registers it with
`Gio.Resource.load(path)` plus `Gio.resources_register`. It then calls `add_resource_path` itself and
points the GtkSource search paths at `resource://…`. GJS's own `imports.package` does the same with
`Gio.Resource.load(…)._register()` (`refs/gjs/modules/script/package.js`).

The web and NativeScript ports have none of this. Learn6502's web entry imports 18 SVG files and calls
`registerIcon` once per file. Its shared UI feeds the GtkSource XML through `addLanguageFromXml` and
`addSchemeFromXml`, two methods GTK does not have. ADR 0115 added a third door,
`registerColorIcon(name, source)`, and kept `add_resource_path` a record. It argued that the web
has no GResource and that probing URLs is asynchronous.

That argument assumed the resources are only known at run time. They are known at BUILD time: the
`.gresource.xml` lists every file, and `gjsify gresource` already compiles it. A table that is in the
bundle can be read synchronously, so the lookup decides in the same frame as GTK. The project rule
is that gjsify re-creates GTK, GLib and Gio faithfully. Until a part is complete it is a true subset:
it throws on what it does not support, it is never silently wrong, and it adds no API that GTK lacks.
`registerColorIcon` breaks the last rule.

## Decision

### 1. The app's GResource reaches every target as the same bytes

The app keeps one `*.gresource.xml`. At build time the bundler compiles it with
`glib-compile-resources` (through `gjsify gresource`) and embeds the compiled bytes in the bundle as
a value. `build-icon-gresource.mjs` already does this for the Adwaita icon subset: `gjsify build`
emits one file and has no asset pipeline, so whatever must travel with the code travels as a value.
Base64 is the transport, as there.

The app registers those bytes with the GIO API it already uses on GNOME:

```ts
Gio.resources_register(Gio.Resource.new_from_data(bytes));
```

The same line runs on GJS, on the web and on NativeScript. How the app obtains `bytes` (an import of
the XML, or a declaration the build turns into a generated module) is an open question below. No
target registers anything behind the app's back.

### 2. Build options: what is supported, what is refused

- `prefix`, `alias`, nested paths: supported. They only shape the paths in the table.
- `preprocess="xml-stripblanks"` and `"json-stripblanks"`: supported. `glib-compile-resources` runs
  them on the build host, so the embedded bytes equal the GNOME bytes.
- `compressed="true"`: the web and NativeScript embed is compiled WITHOUT it. GIO decompresses on
  lookup, so `lookup_data` and `get_info` return the same data and size either way. The
  difference is invisible through the API. A synchronous zlib inflate is not available in the browser
  without shipping one, and HTTP transport compression already applies to the bundle.
- `preprocess="to-pixdata"`: refused. The build fails and names the file. GLib deprecated it, and
  GdkPixdata has no decoder on these targets.
- `Gio.Resource.load(path)`: throws on the web, because there is no file system to read synchronously.
  The error names the embedding path.

### 3. A synchronous Gio resource subset on the web and the NativeScript subset

One headless implementation, shared by `@gjsify/adwaita-web` and `@gjsify/adwaita-nativescript`,
reads the real GVDB format of the compiled bytes. It does not convert them into a second table
format, so the GNOME bytes and the web bytes cannot drift apart. The subset is:

| Supported | Behaviour |
|---|---|
| `Gio.Resource.new_from_data(bytes)` | `Uint8Array` or `GLib.Bytes`; throws `GLib.Error` on bytes that are not GVDB |
| `Gio.resources_register` / `resources_unregister`, `Resource._register` / `_unregister` | a process-wide list, searched in registration order like GIO |
| `Gio.resources_lookup_data(path, flags)` | returns `GLib.Bytes`; throws `Gio.ResourceError.NOT_FOUND` like GIO |
| `Gio.resources_enumerate_children(path, flags)` | children with the trailing `/` on directories, like GIO |
| `Gio.resources_get_info(path, flags)` | `[ok, size, flags]` |
| the same three as `Gio.Resource` instance methods | for one resource |

`Gio.ResourceLookupFlags.NONE` is the only flag; GIO defines no other. Refused, throwing:
`resources_open_stream` and `Resource.open_stream` (the web subset has no `GInputStream`),
and `Gio.Resource.load`. The registry is a singleton. A second
copy of the module in one bundle throws when it loads, because two registries would answer
differently.

### 4. `Gtk.IconTheme` resource paths become real

`add_resource_path`, `set_resource_path` and `get_resource_path` work on the web and in the
NativeScript icon theme. The lookup scans each path as `gtkicontheme.c` does: hicolor subdirectories
first, then files directly under the path as unthemed icons. A change emits the theme's `changed`
signal, and every mounted image looks up again.

ADR 0115 § 1 stays: one lookup in GThemedIcon order. The compiled Adwaita subset plays the host
theme's role and wins for a name it has; resource icons are the fallback, as on GTK. A `-symbolic`
file from a resource draws as a mask, like a glyph `registerIcon` adds. Any other file draws in
colour as ADR 0115 § 3 describes. On the web the image URL is an object URL made synchronously from
the bytes. `add_search_path` stays a record: there is still no file system to enumerate.

### 5. `GtkApplication` adds `<resource-base-path>/icons/` at startup

The web and NativeScript `Gtk.Application` follow `gtk_application_load_resources`. At startup they
add `<resource-base-path>/icons/` to the default icon theme. `resource-base-path` defaults from the
application ID, as in GApplication. An app that registers its resources before `run()` gets its
icons with no further code. This includes the application icon `AdwAboutDialog` shows.

The same function also loads `gtk/menus.ui` and `gtk/help-overlay.ui`. Until the web and NativeScript
`GtkBuilder` can read a resource, startup THROWS if either path exists in a registered resource.
Ignoring the file would build a different menu bar than GTK builds.

### 6. Every other `*_from_resource` stays refused until it lands

The same table can serve `Gtk.CssProvider.load_from_resource`, `Gtk.Image.set_from_resource`,
`Gtk.Picture`, `Gtk.Builder.new_from_resource` and widget templates. It can also serve
`Gio.File.new_for_uri('resource:///…')` for the `Gio.File` of ADR 0100, and `resource://` entries in
the GtkSource search paths. Each is its own step with its own specs. Until a step lands, the call
throws on the web and NativeScript and names this ADR.

### 7. Android

The NativeScript port uses the same embedded bytes. On the pure-JS GObject subset, which is the
Android default until ADR 0110's flip, the shared subset of § 3 answers. With real GObject,
`@gjsify/gi-runtime-android` ships real GIO, and `new_from_data` plus `resources_register` are GIO
itself. The NativeScript widgets read resources only through the `Gio` namespace the app uses, so
the engine choice does not change the code. iOS runs the same subset, but it is not tested here.

Not chosen for now: shipping the `.gresource` file under `assets/app/` and making `Gio.Resource.load`
work. NativeScript extracts `assets/app/**` to the file system, so this is possible later. It would
be a second path on one target only.

### 8. The invented doors

- `registerColorIcon` is removed before the next stable release. It reached only the `next`
  channel: `latest` is 0.64.0, and #2219 came after it. Nothing outside `@gjsify/adwaita-web`
  calls it (`git grep` in this repository and in Learn6502). The colour lookup and the colour
  rendering of ADR 0115 stay; only their entry point changes.
- `registerIcon` and `unregisterIcon` stay for now. Both are published in `@gjsify/adwaita-web` and
  `@gjsify/adwaita-nativescript`, and Learn6502's web entry depends on them. Once § 4 and § 5 work
  on both ports, the docs name `add_resource_path` as the way. Deprecation and removal are a
  separate decision under the release policy (ADR 0008).

## Consequences

- An app's icon code is the GNOME code. Learn6502's web entry loses 18 imports and 18
  `registerIcon` calls, and the app icon reaches `AdwAboutDialog` without a web-only call.
- Embedding has a measured cost. Learn6502's gresource has 27 files (22 SVG icons, metainfo, two
  language specs, two style schemes). Compiled it is 184,088 bytes; as base64 it is 245,452 bytes;
  that base64 is 90,130 bytes gzip -9, against 63,050 bytes for the compiled file gzipped on its
  own. So the embed costs about 43 % more on the wire than a separate file, and it is parsed as part
  of the JS. Binary files such as PNG cost 4/3 and do not shrink further. Large media belong outside
  the gresource; the build reports the embed size per target.
- The build host needs `glib-compile-resources` for web and Android builds too, not only for
  GNOME builds. `gjsify gresource` already reports a missing tool with a distro hint.
- The GtkSource methods `addLanguageFromXml` and `addSchemeFromXml` can be replaced the same way as
  `registerColorIcon`, through `resource://` search paths (§ 6). ADR 0094 owns that decision.
- ADR 0115 gets Amendment 1. Its lookup order and colour rendering stay; its door is replaced.

## Alternatives rejected

- **Probe URLs at run time.** This is asynchronous, so the first frame would draw something
  different from what GTK draws. ADR 0115 § 4 rejected it for that reason.
- **Translate the gresource into a JS map at build time.** It works, but it is a second format next to
  GVDB, and `Gio.Resource.new_from_data` would accept something GIO rejects.
- **Register the embed automatically before the app's code runs.** GTK does not do this. The app
  would lose the order and the error it controls on GNOME.

## What this does not decide

- The rendering of colour icons in the NativeScript widgets. ADR 0115's Consequences list that as
  separate work; this ADR gives it a source.
- `gtk/menus.ui`, `help-overlay.ui`, `Gtk.Builder` from a resource, CSS and images from a resource:
  § 6 refuses them until each lands.
- A JS replacement for `glib-compile-resources` on hosts without GLib.

## Open questions

Names are the maintainer's call. These are proposals only.

1. **How the app gets the bytes.** Proposed: an import of the XML,
   `import resourceBytes from './data/<app-id>.data.gresource.xml'`, with a default export of type
   `Uint8Array`, compiled by a bundler loader. The alternative is a `gjsify.resources` array in
   `package.json` that the build turns into a module the app imports. Proposed: the import, because
   GJS builds can use the same line and drop the run-time file path.
2. **Where the subset lives.** Proposed: `@gjsify/adwaita-core`, which already holds `GLib.Bytes` and
   `GLib.Error` for both ports. The alternative is a new package, for example `@gjsify/gio-resource`.
3. **The web and NativeScript `Gio` namespace exports.** These are GIO's own names: `Resource`,
   `resources_register`, `resources_unregister`, `resources_lookup_data`,
   `resources_enumerate_children`, `resources_get_info`, `ResourceLookupFlags`, `ResourceError`.

## Implementation (if accepted)

1. The bundler loader or generated module, the build-option rules of § 2, and a test that embeds
   Learn6502's XML.
2. The GVDB reader and the § 3 subset in the shared core, with specs that run against bytes
   `glib-compile-resources` produced. The same specs run under GJS against real GIO, as the
   oracle.
3. `Gtk.IconTheme` resource paths and the `GtkApplication` startup path on the web, then on
   NativeScript. Then `registerColorIcon` is removed and ADR 0115's specs move to a resource
   fixture.
4. The other consumers in § 6, one PR each.
