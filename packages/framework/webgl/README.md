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
[Platform coverage](#platform-coverage) — Linux, macOS and Windows. Since
[ADR 0017](https://github.com/gjsify/gjsify/blob/main/docs/adr/0017-native-package-distribution.md)
each target lives in its own `optionalDependencies` package, so your package
manager installs the one that fits and silently skips the rest:

```
@gjsify/webgl-linux-x64/prebuilds/linux-x64/         libgwebgl.so    + Gwebgl-0.1.typelib
@gjsify/webgl-linux-arm64/…                          libgwebgl.so    + Gwebgl-0.1.typelib
@gjsify/webgl-linux-{ppc64,s390x,riscv64}/…          libgwebgl.so    + Gwebgl-0.1.typelib
@gjsify/webgl-darwin-{arm64,x64}/…                   libgwebgl.dylib + Gwebgl-0.1.typelib
@gjsify/webgl-win32-x64/prebuilds/win32-x64/         gwebgl.dll      + Gwebgl-0.1.typelib
```

**Windows needs two more things than the other platforms**, and neither is
optional:

- **`@gjsify/gtk-runtime-win32-x64`.** `gwebgl.dll` imports `epoxy-0.dll`, and
  Windows has no system libepoxy — so unlike the `.so`/`.dylib` artifacts this
  one is not loadable from the host alone. The epoxy it needs is already in that
  bundle (GTK4 links it), which every Windows consumer has anyway because it is
  how [`@gjsify/node-gi`](../../node-gi/node-gi) resolves `gi://` at all. It is
  deliberately not duplicated here: two libepoxy images in one address space is
  a worse failure than the one it would solve.
- **A real OpenGL ICD.** GTK4 rejects the GDI generic OpenGL 1.1 that Windows
  falls back to, and the GTK bundle ships no GL implementation of its own
  (`epoxy-0.dll` is the *dispatch* layer — it resolves nothing by itself). On a
  machine with vendor graphics drivers this is already true; on a GPU-less host
  (VM, RDP session, CI) install [Mesa for Windows](https://github.com/pal1000/mesa-dist-win)
  and register it system-wide (`systemwidedeploy.cmd 1`). Without one,
  `Gdk.Display.create_gl_context()` fails with *"No GL implementation is
  available"* and the window paints that string instead of your scene — a
  `Gtk.GLArea` failure, not a `gi://Gwebgl` one.

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
| `darwin-arm64` / `darwin-x64` | ✅ `libgwebgl.dylib` + `Gwebgl-0.1.typelib` | native runner — **WebGL2 via a shader-dialect rewrite, see below** |
| `win32-x64` | ✅ `gwebgl.dll` + `Gwebgl-0.1.typelib` | **two jobs** — valac does not run on Windows, so a Linux runner emits the C + GIR and a `windows-latest` runner compiles them with MSVC against gvsbuild's GTK4. Needs a GL ICD and the GTK bundle at run time, [see above](#running-gjs-apps-that-use-this-package) |

**macOS renders, WebGL1 and WebGL2.** Measured on macOS 15.7.8 / x86_64 with gtk 4.22 and
libepoxy 1.5.10: `Gtk.GLArea` realizes a `GdkMacosGLContext`, and this bridge draws real
pixels through it. That describes the GL stack once GTK is loaded — reaching it needed
`DYLD_LIBRARY_PATH=/usr/local/lib` exported by hand, because the `Gtk-4.0` typelib names a
bare `libgtk-4.1.dylib` leaf that a Homebrew prefix does not put on the loader's search path
for every host; that defect is tracked and fixed separately. Two further limits come from the
platform, not from the bridge:

- GTK4's macOS backend goes through **CGL, which offers desktop OpenGL only** — no GLES
  profile at any version. A GLES-exclusive request (`gtk_gl_area_set_use_es(TRUE)`) fails
  with *"Application does not support OpenGL API"*, so `WebGLBridge` declares
  `set_allowed_apis(GL | GLES)` and lets GDK choose: GLES 3.2 where it exists, desktop
  GL 4.1 on macOS.
- Desktop GL 4.1 has **no GLSL ES 3.00 compiler** (that needs `ARB_ES3_compatibility`, GL 4.3),
  so `#version 300 es` shaders — i.e. all WebGL2 content, including three.js ≥ r163 and
  Excalibur 0.32 — do not compile as written. `#version 100` (WebGL1) does, via
  `ARB_ES2_compatibility`, which is core from 4.1; that one-version gap between the two
  extensions is the entire reason WebGL1 worked here first.

  **`shaderSource()` now closes it by rewriting the dialect**, and only where it must: on a
  desktop context that lacks `ARB_ES3_compatibility`, `#version 300 es` becomes
  `#version <the context's GLSL> core` (4.10 on macOS). Nothing else in the source changes,
  which is a measured claim rather than a hopeful one — a three.js-shaped GLES 3.00 pair
  (`layout(location=)` on attributes and fragment outputs, a `layout(std140)` block,
  `texture()`, `isampler2D` + `texelFetch`, `textureLod`, MRT, precision statements) and
  eleven separately probed edge constructs all compile on GLSL 4.10 with just that
  substitution. Measured end to end on macOS 15.7.9 / GL 4.1 core: compiles, links, draws,
  and `readPixels` returns the shader's colour. `#version 100` is left byte-for-byte alone,
  and a context that already speaks GLSL ES 3.00 — GLES anywhere, or any desktop context
  with `ARB_ES3_compatibility` — is not rewritten at all.

  **The same rewrite applies on Windows, which is not what this file used to predict.** Mesa
  on win32 advertises `4.6 (Compatibility Profile)`, so the guess was that win32 would take
  the untouched path; measured on the win11-gjsify VM it does not, because GDK asks for a
  CORE profile. `is_legacy` is false there, and the dialect decision goes exactly as it does
  on macOS.

  Of the 219 GL entry points the library references, exactly two are absent from Apple's
  `OpenGL.framework` (`glInvalidateFramebuffer`, `glInvalidateSubFramebuffer`, both GL 4.3);
  they are gated on `epoxy_gl_version() >= 43` because libepoxy aborts rather than returning
  null.

Remaining darwin gaps are tracked in [`status/open-todos.md`](../../../status/open-todos.md).

### The darwin GL 4.1 ceiling

Moved here from [packages/framework/AGENTS.md](../AGENTS.md) when that file reached the
32 KiB `project_doc_max_bytes` cap. The rule there is one line and links back; this is the
measurement behind it, which a rule without its reason gets "simplified" back into.

**What the darwin GL 4.1 ceiling still costs, measured on macOS 15.7 / GdkMacosGLContext (`4.1 APPLE-21.1.1`, GLSL 4.10):** (1) `glInvalidateFramebuffer`/`glInvalidateSubFramebuffer` are GL 4.3 and absent, hence the `epoxyGlVersion() >= 43` gate in `webgl2-rendering-context.vala` — libepoxy ABORTS on a missing entry point rather than returning null. They are also the ONLY two missing: of the 219 `epoxy_gl*` entry points `libgwebgl.dylib` references, `dlsym` against `OpenGL.framework` resolves 217 (`nm -u <lib> | sed -n 's/^ *_epoxy_//p' | grep -E '^gl[A-Z]'`, then `ctypes.CDLL('/System/Library/Frameworks/OpenGL.framework/OpenGL')`). (2) **GLSL ES 3.00 does not compile, so `shaderSource()` REWRITES the dialect** — `#version 300 es` needs ARB_ES3_compatibility (core in GL 4.3) and the 4.1 compiler refuses it (`version '300' is not supported`), while GLSL ES 1.00 is accepted via ARB_ES2_compatibility, core in 4.1: that ONE version between the two extensions is why WebGL1 worked here first. On a desktop context lacking the extension, `shaderSource()` substitutes `#version <the context's GLSL> core` (4.10 on macOS) and changes nothing else, so **WebGL2 content DOES draw on darwin** — measured end to end on macOS 15.7.9 / GL 4.1 core: an unmodified `#version 300 es` pair compiles, links, draws, and `readPixels` returns the shader's colour. The predicate is the EXTENSION, not the OS: Mesa's `4.6 (Compatibility Profile)` on win32 has it and is NOT rewritten; `#version 100` comes back byte-for-byte unchanged. Construct-by-construct measurement: `packages/framework/webgl/README.md`. (3) The API-level GLES 3.0 spellings desktop 4.1 has no equivalent for stay missing — `GL_PRIMITIVE_RESTART_FIXED_INDEX` (4.3 on desktop) and the mandatory ETC2/EAC formats; both surface as a draw-time error, not a compile failure. Host diagnosis: `gjsify run packages/framework/webgl/scripts/probe-gl-host.js`, which also draws a shader-free pattern so a blank window cannot be mistaken for a failed shader. Remaining darwin gaps: `status/open-todos.md`.

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
