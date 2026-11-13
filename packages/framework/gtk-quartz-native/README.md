# @gjsify/gtk-quartz-native

Makes a Dock click on a windowless macOS app activate the `GApplication`.

Decision and measurements: [ADR 0141](../../../docs/adr/0141-a-dock-click-reopens-the-application-on-macos.md).

GTK 4.24.1's `GtkApplicationQuartzDelegate` does not implement
`applicationShouldHandleReopen:hasVisibleWindows:`, so the click is dropped. This package adds the
method through the Objective-C runtime (`class_addMethod`). It fails, and so does nothing, once the
loaded GTK has the method: the bridge retires itself.

```ts
import GjsifyQuartz from 'gi://GjsifyQuartz?version=1.0';
GjsifyQuartz.install_reopen_handler(); // true if this call installed it
```

`@gjsify/adwaita-app` calls it for you on darwin. The library links neither GTK nor GLib; the
class is looked up by name at run time. No JavaScript; the prebuilt library and typelib arrive via
the per-target `optionalDependencies`.

## Tests

```sh
gjsify run test:meson   # darwin only; needs host gtk4, glib, gjs
```
