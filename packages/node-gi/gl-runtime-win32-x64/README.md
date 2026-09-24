# @gjsify/gl-runtime-win32-x64

Optional OpenGL for GTK apps on Windows hosts that have **no OpenGL driver of their own**:
VMs, RDP sessions, Windows Server, CI runners. It contains Mesa's WGL build
(`opengl32.dll` + `libgallium_wgl.dll`) from the pinned
[mesa-dist-win](https://github.com/pal1000/mesa-dist-win) release, plus the licence texts
that must travel with them (`bin/THIRD-PARTY-NOTICES.md`).

> **Not yet published on npm.** The first publish of this name is queued in
> `status/pending-npm-bootstrap.json`; until then the dependency below 404s.

```json
"dependencies": {
  "@gjsify/gl-runtime-win32-x64": "^0.52.0"
}
```

## Why it is separate

It is ~22 MB in the tarball (59 MiB unpacked, almost all of it LLVM for Mesa's llvmpipe),
and most Windows machines never use it: a host with a vendor GPU driver keeps that driver.
So it is an opt-in, never part of `@gjsify/gtk-runtime-win32-x64` and never a dependency of
`@gjsify/node-gi` — node-gi finds it **by name** when an app has installed it.

## What happens at run time

`@gjsify/node-gi` asks whether the host has an OpenGL driver (the display driver's
user-mode ICD, or one registered under `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\OpenGLDrivers`).
Only when it has none, it loads this package's `opengl32.dll` **by absolute path** before GTK
loads. That is the only way it can take effect: `gtk-4-1.dll` imports `OPENGL32` statically,
and Windows never looks for it on `PATH`. Mesa then uses its d3d12 driver where a D3D12 device
exists (WARP included) and llvmpipe otherwise. Measured on a GitHub `windows-latest` runner:
GDK gets an OpenGL **4.6 core** context (`D3D12 (Microsoft Basic Render Driver)`), where
without this package it gets `No GL implementation is available`.

`GJSIFY_OPENGL=bundle` forces Mesa even over a vendor driver, `GJSIFY_OPENGL=system` never
uses it. `openGLActivation()` from `@gjsify/node-gi/gtk-runtime` reports the decision and why.

GSK itself still renders with cairo by default on Windows: GTK's win32 GL renderer requires
DirectComposition, which GTK makes opt-in (`GDK_DEBUG=dcomp`). `Gtk.GLArea` works either way.

## Building the payload

`node scripts/build-gl-runtime.mjs` downloads the pinned release, checks its sha256, extracts
the two DLLs into `bin/` and writes the notice. The pin lives in
`packages/node-gi/scripts/fetch-gl-implementation.mjs`; `licenses/provenance.json` must name
the same release (held by `node-gi/test/gl-runtime-package.test.mjs`).
