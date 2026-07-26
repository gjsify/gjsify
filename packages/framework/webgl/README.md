# @gjsify/webgl

GJS implementation of WebGL 1.0/2.0 using a custom Vala extension (gwebgl). Provides WebGLBridge extending Gtk.GLArea.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/webgl

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/webgl
yarn add @gjsify/webgl
```

## Usage

```typescript
import { WebGLBridge } from '@gjsify/webgl';

const widget = new WebGLBridge();
widget.installGlobals();

widget.onReady((canvas, gl) => {
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
});

window.set_child(widget);
```

## Globals

The package root is a **side-effect-free barrel** — importing it gives you named
exports and nothing else. Browser globals are installed by the dedicated
`/register` subpath:

```typescript
import '@gjsify/webgl/register';   // globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext
```

You normally never write that import: `gjsify build` defaults to `--globals auto`,
which detects a free `WebGLRenderingContext` / `WebGL2RenderingContext` reference in
the bundled output and injects the subpath for you. Application and example code
should rely on that (see the tree-shakeable-globals convention in `AGENTS.md`) — an
explicit `/register` import in app code hides auto-detection gaps.

What each entry point gives you:

| | `@gjsify/webgl` | `@gjsify/webgl/register` | `WebGLBridge.installGlobals()` |
|---|---|---|---|
| `WebGLRenderingContext`, `WebGL2RenderingContext`, `HTMLCanvasElement`, `WebGLBridge`, the WebGL object + extension classes | named exports | — | — |
| `globalThis.WebGLRenderingContext`, `globalThis.WebGL2RenderingContext` | — | ✅ (installed only when absent) | ✅ (installed unconditionally) |
| `globalThis.requestAnimationFrame`, `globalThis.cancelAnimationFrame`, `globalThis.performance` | — | — | ✅ |

The `'webgl'` / `'webgl2'` contexts themselves need no register: this package's
`HTMLCanvasElement` subclass answers `getContext('webgl')` directly, so a
`WebGLBridge` works even with `--globals none`.

> **Changed after 0.22.0** — up to and including 0.22.0, `import { WebGLBridge } from '@gjsify/webgl'`
> installed `WebGLRenderingContext` / `WebGL2RenderingContext` on `globalThis` as an
> import side effect. They now come from `/register` (or `installGlobals()`). See
> [ADR 0012](https://github.com/gjsify/gjsify/blob/main/docs/adr/0012-framework-register-ownership.md).

## Running GJS apps that use this package

This package ships prebuilt native libraries for the platforms listed under
[Platform coverage](#platform-coverage) — today that is Linux only:

```
prebuilds/
  linux-x86_64/   libgwebgl.so + Gwebgl-0.1.typelib
  linux-aarch64/  libgwebgl.so + Gwebgl-0.1.typelib
  linux-ppc64/    libgwebgl.so + Gwebgl-0.1.typelib
  linux-s390x/    libgwebgl.so + Gwebgl-0.1.typelib
  linux-riscv64/  libgwebgl.so + Gwebgl-0.1.typelib
```

There is **no macOS or Windows prebuild**; on those platforms `getContext('webgl')`
has no native backend.

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

Prebuilds for `linux-x86_64`, `linux-aarch64`, `linux-ppc64`, `linux-s390x`, and `linux-riscv64` are built automatically by CI
(`.github/workflows/prebuilds.yml`) when the Vala source changes and committed back
to the repository. They are included in the npm package via the `files` field.

## Inspirations and credits

- [realh/gwebgl](https://github.com/realh/gwebgl)
- [stackgl/headless-gl](https://github.com/stackgl/headless-gl)
- [Maia-Everett/valagl](https://github.com/Maia-Everett/valagl)

## Platform coverage

| Platform | Prebuild | Built by |
|---|---|---|
| `linux-x86_64` | ✅ `libgwebgl.so` + `Gwebgl-0.1.typelib` | native runner |
| `linux-aarch64` | ✅ | native runner |
| `linux-ppc64`, `linux-s390x`, `linux-riscv64` | ✅ | QEMU emulation |
| macOS (`darwin-arm64` / `darwin-x64`) | ❌ | **unverified, see below** |
| Windows | ❌ | — no Vala/GI bridge in this repo targets Windows |

**macOS is not blocked — it is unverified, and a green build would not be enough.** The
build needs gtk4 + libepoxy + gdk-pixbuf from Homebrew (all available). The real question is
runtime: GTK4's macOS (Quartz) backend goes through CGL, which tops out at desktop OpenGL 4.1
Core and offers no GLES 3.2 — the profile this Vala bridge is written against. So compiling
successfully on macOS would say nothing about whether `Gtk.GLArea` can actually render a
WebGL2 context there. `meson.build` already emits the correct `.dylib` typelib leaf; the
manual-dispatch `build-prebuilds-macos-experimental` job in the prebuilds workflow exists to
establish the compile half of the answer.

## License

MIT
