# @gjsify/webgl

WebGL module for GJS (GNOME JavaScript). Implements the WebGL 1.0 API via a Vala-compiled native library (`libgwebgl`) that wraps OpenGL ES 2.0.

## Usage

```ts
import { GjsifyHTMLCanvasElement } from '@gjsify/webgl';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';

Gtk.init();

const canvas = new GjsifyHTMLCanvasElement(800, 600);
const gl = canvas.getContext('webgl');
// ... use WebGL API as in the browser
```

## Running GJS apps that use this package

This package ships prebuilt native libraries for supported platforms:

```
prebuilds/
  linux-x86_64/   libgwebgl.so + Gwebgl-0.1.typelib
  linux-aarch64/  libgwebgl.so + Gwebgl-0.1.typelib
```

Use the gjsify CLI to run your app — it automatically sets `LD_LIBRARY_PATH` and
`GI_TYPELIB_PATH` so GJS can find the native library:

```bash
gjsify run dist/gjs.js
```

To see what env vars are needed for running directly with `gjs`:

```bash
gjsify info dist/gjs.js
# or for shell eval:
eval $(gjsify info --export)
gjs -m dist/gjs.js
```

## Building the native library locally

Requires: `meson`, `valac`, `gcc`, `libepoxy-devel`, `gtk4-devel`, `gdk-pixbuf2-devel`, `gobject-introspection-devel`

```bash
# Fedora / RHEL
sudo dnf install meson vala gcc libepoxy-devel gtk4-devel gdk-pixbuf2-devel gobject-introspection-devel

# Build
yarn build:meson

# Build and copy to prebuilds/ for the current architecture
yarn build:prebuilds
```

## Prebuilt binaries

Prebuilds for `linux-x86_64` and `linux-aarch64` are built automatically by CI
(`.github/workflows/prebuilds.yml`) when the Vala source changes and committed back
to the repository. They are included in the npm package via the `files` field.

## Inspirations and credits

- [realh/gwebgl](https://github.com/realh/gwebgl)
- [stackgl/headless-gl](https://github.com/stackgl/headless-gl)
- [Maia-Everett/valagl](https://github.com/Maia-Everett/valagl)
