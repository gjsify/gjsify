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
  linux-x64/   libgwebgl.so + Gwebgl-0.1.typelib
  linux-arm64/  libgwebgl.so + Gwebgl-0.1.typelib
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

Prebuilds for every target in `package.json#gjsify.platforms` are built automatically by CI
(`.github/workflows/prebuilds.yml`) when the Vala source changes and committed back
to the repository. Since ADR 0017 each one ships in its own
`@gjsify/webgl-<os>-<arch>` package, referenced from here as an `optionalDependency`, so a
consumer installs only the artifact that fits its platform.

## Inspirations and credits

- [realh/gwebgl](https://github.com/realh/gwebgl)
- [stackgl/headless-gl](https://github.com/stackgl/headless-gl)
- [Maia-Everett/valagl](https://github.com/Maia-Everett/valagl)

## Platform coverage

| Platform | Prebuild | Built by |
|---|---|---|
| `linux-x64` | ✅ `libgwebgl.so` + `Gwebgl-0.1.typelib` | native runner |
| `linux-arm64` | ✅ | native runner |
| `linux-ppc64`, `linux-s390x`, `linux-riscv64` | ✅ | QEMU emulation |
| `darwin-arm64` / `darwin-x64` | ✅ `libgwebgl.dylib` + `Gwebgl-0.1.typelib` | native runner — **WebGL1 only, see below** |
| Windows | ❌ | — no Vala/GI bridge in this repo targets Windows |

**macOS renders — WebGL1 only.** Measured on macOS 15.7.8 / x86_64 with gtk 4.22 and
libepoxy 1.5.10: `Gtk.GLArea` realizes a `GdkMacosGLContext`, and this bridge draws real
pixels through it. Two limits come from the platform, not from the bridge:

- GTK4's macOS backend goes through **CGL, which offers desktop OpenGL only** — no GLES
  profile at any version. A GLES-exclusive request (`gtk_gl_area_set_use_es(TRUE)`) fails
  with *"Application does not support OpenGL API"*, so `WebGLBridge` declares
  `set_allowed_apis(GL | GLES)` and lets GDK choose: GLES 3.2 where it exists, desktop
  GL 4.1 on macOS.
- Desktop GL 4.1 has **no GLSL ES 3.00 compiler** (that needs `ARB_ES3_compatibility`, GL 4.3),
  so `#version 300 es` shaders — i.e. all WebGL2 content, including three.js ≥ r163 and
  Excalibur 0.32 — do not compile. `#version 100` (WebGL1) does, via `ARB_ES2_compatibility`.
  Of the 219 GL entry points the library references, exactly two are absent from Apple's
  `OpenGL.framework` (`glInvalidateFramebuffer`, `glInvalidateSubFramebuffer`, both GL 4.3);
  they are gated on `epoxy_gl_version() >= 43` because libepoxy aborts rather than returning
  null.

Remaining darwin gaps are tracked in [`status/open-todos.md`](../../../status/open-todos.md).

## Diagnosing a host

```bash
gjsify run packages/framework/webgl/scripts/probe-gl-host.js [--seconds N]
```

Configures a bare `Gtk.GLArea` exactly as `WebGLBridge` does and reports the negotiated GL API
and version, the widget scale factor, the logical allocation versus the device-pixel drawing
buffer, the GL vendor/renderer/GLSL strings and which shader dialects compile — then draws a
recognisable pattern using only `clearColor` + `scissor` + `clear`, so a blank window can never
be mistaken for a failed shader. Exits non-zero when the GLArea does not realize. It needs a
real display, which is why it is a script rather than a spec.

## License

MIT
