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

The one-line rule in [packages/framework/AGENTS.md](../AGENTS.md) links here for the
measurement behind it, because a rule without its reason gets "simplified" back into the
bug. Measured on macOS 15.7 / GdkMacosGLContext (`4.1 APPLE-21.1.1`, GLSL 4.10).

**The two missing entry points, reproduced.** `glInvalidateFramebuffer` and
`glInvalidateSubFramebuffer` are GL 4.3 and absent, hence the `epoxyGlVersion() >= 43` gate
in `webgl2-rendering-context.vala` — libepoxy ABORTS on a missing entry point rather than
returning null. They are also the only two, and that is a count anyone can re-take: of the
219 `epoxy_gl*` entry points `libgwebgl.dylib` references, `dlsym` against
`OpenGL.framework` resolves 217.

```bash
nm -u libgwebgl.dylib | sed -n 's/^ *_epoxy_//p' | grep -E '^gl[A-Z]'
# then, per name, ctypes.CDLL('/System/Library/Frameworks/OpenGL.framework/OpenGL')
```

**The GLES 3.0 spellings with no desktop-4.1 equivalent stay missing**, and this is the part
the shader rewrite above does not reach: `GL_PRIMITIVE_RESTART_FIXED_INDEX` (4.3 on desktop)
and the mandatory ETC2/EAC compressed formats. Both surface as a **draw-time** error rather
than a compile failure, so a shader that compiles is not evidence that a scene using them
will render.

**Four WebGL1 extensions are core on desktop GL, so the version answers, not the list.**
`OES_element_index_uint` (GL 1.1), `OES_standard_derivatives` (GL 2.0), `OES_texture_float` and
`OES_texture_float_linear` (GL 3.0) are features a GLES driver names as `GL_OES_*` extensions
and a desktop driver has no reason to list — macOS's does not, so `getExtension()` used to
answer `null` for three of them where Safari and Chrome expose all four.
`getSupportedExtensions()` now advertises each when the list names it OR the desktop GL version
provides it; on GLES the list stays the only source. An `RGBA`/`RGB` + `FLOAT` upload is handed
to a desktop driver as `RGBA32F`/`RGB32F`, since an unsized format leaves the storage to the
driver. `EXT_blend_minmax` (core GL 1.4) and `EXT_texture_filter_anisotropic` follow the same
rule. Each is held to a spec that USES the feature (a texel outside [0, 1] survives, a float
texture filters, 32-bit indices draw, `dFdx` evaluates, MAX blends), not merely to a non-null
object.

**Derivatives need a respelled shader on macOS.** A desktop core context compiles
`#version 100` through ARB_ES2_compatibility, and macOS's ES front end is GLSL ES 1.00 with no
extensions: `#extension GL_OES_standard_derivatives : enable` is "not supported" and `dFdx` is
undeclared. So a GLSL1 shader that calls a derivative is respelled in the context's own desktop
GLSL (`#version 410`, `attribute`/`varying`/`texture2D`/`gl_FragColor` renamed by macro —
`context/shader-program/glsl1-desktop.ts`), where the derivatives are core. Whether a context
needs that is PROBED once by compiling the smallest such shader, never read off the OS: a
driver whose ES front end honours the extension keeps the shader as written. Because macOS will
not link an ES stage with a desktop one, `linkProgram` gives every GLSL1 shader of a program the
spelling its most demanding member needs, recomputed per link so a vertex shader shared with a
plain program returns to the ES dialect there. `#ifdef GL_OES_standard_derivatives` is pointed
at an unreserved stand-in macro, defined only once the extension is enabled, because desktop GLSL
refuses to `#define` a `GL_` name; the `#extension` line is commented out (`: require` would be
an error there); a consumer name desktop GLSL claims (`uniform sampler2D texture;`) is renamed;
`#line` keeps every consumer line at its own number in compile errors.

**What a core profile removed, WebGL still has, so the bridge supplies it.** The profile is
asked of the context (`GL_CONTEXT_PROFILE_MASK`, `_isCoreProfile()`), never read off the OS,
so GLES and compatibility profiles keep the driver's own behaviour. Measured on macOS 27 /
Apple Silicon / GL 4.1 core: `test:conformance` went from 202/209 to 209/209.

- `ALPHA` / `LUMINANCE` / `LUMINANCE_ALPHA` textures are stored as `R8`/`RG8` (`R32F`/`RG32F`,
  `R16F`/`RG16F` for float types) plus a texture swizzle (`(0,0,0,R)`, `(R,R,R,1)`,
  `(R,R,R,G)`), which is how ANGLE does it (`context/texture-management/legacy-formats.ts`).
  The swizzle is texture state, so re-specifying the texture in another format resets it.
  `copyTexImage2D` into `ALPHA`/`LUMINANCE_ALPHA` reads the region back, because no GL copy
  moves the framebuffer's alpha into a red or green channel.
- `GENERATE_MIPMAP_HINT` is kept in JS: `hint()` records it and `getParameter` reports it,
  which is all a hint obliges an implementation to do.
- Three program rules are WebGL's (GLES 2.0 §2.10.3) and are checked in TypeScript, because a
  desktop linker may accept what they forbid (macOS does): one shader per stage, no link
  without both a vertex and a fragment shader, no `useProgram` on a program whose last link
  failed. These run on every context; a GLES driver gives the same answers.

For the dialect rewrite itself — including why **win32 is rewritten too**, which this file
predicted wrongly once — see [Platform coverage](#platform-coverage) above. Host diagnosis:
`gjsify run packages/framework/webgl/scripts/probe-gl-host.js`, which also draws a
shader-free pattern so a blank window cannot be mistaken for a failed shader.

## HiDPI: the two canvas bridges are NOT symmetric

**This asymmetry is a whole bug class, and it is invisible on every machine you are likely to develop on.**

GTK silently pre-scales a `Gtk.DrawingArea`'s Cairo context, so Canvas2D code written in logical pixels renders sharp with nothing to do. `Gtk.GLArea` does **not**: its framebuffer is `allocation x scale-factor` and `gl.viewport` is in raw device pixels.

So the GL side reports the DRAWING BUFFER in device pixels (`canvas.width` / `canvas.height`, hence `gl.drawingBufferWidth`) while CSS layout size stays logical (`clientWidth` / `offsetWidth`), and `installGlobals()` publishes `devicePixelRatio` as an ACCESSOR over the widget's live `get_scale_factor()`. The identity

```
clientWidth * devicePixelRatio === canvas.width
```

is what lets an unmodified Three.js or Excalibur viewport cover the whole framebuffer.

Reporting the allocation as `canvas.width` — as this bridge did until 2026-08 — is invisible at scale-factor 1, which is every desktop, every CI runner and every test VM. On the first scale-factor-3 host it drew each scene into the bottom-left NINTH of its widget: measured on a OnePlus 6T running postmarketOS / GNOME Mobile, where the teapot, the pixel-postprocessing and the Excalibur showcases all rendered a 120x218 corner of a 360x655-logical widget.

`@gjsify/dom-elements`' register seeds `devicePixelRatio: 1` as the widget-less default only. A real `Gtk.GLArea` cannot regression-test this, because its host reports 1 — `html-canvas-element.spec.ts` varies the scale factor through a stub, which is the entire point of that stub.

## Naming the GL you actually got

`WEBGL_debug_renderer_info` is implemented (the spec'd `VENDOR` / `RENDERER` stay masked) and `bridge.rendererInfo` reads it, so a CPU rasteriser (`isSoftwareRenderer`) costs ONE stderr line. A GPU-less host is otherwise invisible: every draw call succeeds, and only the frame budget tells.

**It is DIAGNOSTIC ONLY.** The same driver carries a demand-driven three.js scene and needs 1.1 s for a single textured full-screen draw in a game, so a renderer swap keys on a MEASURED frame budget, never on this string.

## Resize, clone and the WebGL2 overrides

- On resize `WebGLBridge` dispatches a DOM `resize` and re-invokes the last rAF callback — demand-driven re-render, no animation loop.
- A canvas clones PLAIN (`_createCloneTarget`): there is one GLArea and it stays with the original.
- `WebGL2RenderingContext` overrides `texImage2D`, `texSubImage2D` and `drawElements` from the WebGL1 base, bypassing WebGL1 format/type validation — the native Vala side handles all GLES 3.2 formats.

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
