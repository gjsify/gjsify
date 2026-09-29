# 73. OpenGL on win32 is an opt-in package that node-gi preloads, never part of the bundle

- Status: **Accepted**
- Date: 2026-09-24
- Deciders: Pascal Garber
- Related: [ADR 0017 (native distribution)](0017-native-package-distribution.md),
  [ADR 0023 (which GTK a node-gi process uses)](0023-gtk-source-precedence.md),
  [ADR 0057 (bundle images do not search outside the bundle)](0057-bundle-images-do-not-search-outside-the-bundle.md),
  `docs/node-gi-platform-notes.md`, #1097, PR #1789

## Context

The gvsbuild GTK in `@gjsify/gtk-runtime-win32-x64` is built without EGL and without Vulkan,
so its only GL path is WGL through `opengl32.dll`. A host with no OpenGL driver (a GPU-less VM,
an RDP session, a CI runner) offers only Microsoft's GDI generic OpenGL 1.1, which GDK rejects:
every `Gtk.GLArea` reads "No GL implementation is available". The bundle carries GL dispatch
(`epoxy-0.dll`) and no implementation.

Mesa's WGL build (mesa-dist-win: `opengl32.dll` + `libgallium_wgl.dll`) closes that. On
`windows-latest` it gives GDK a 4.6 core context (`D3D12 (Microsoft Basic Render Driver)`). It
costs ~22 MB per tarball (59 MiB unpacked, mostly LLVM for llvmpipe), and most Windows machines
never need it because they have a vendor driver.

A DLL on disk does nothing by itself: `gtk-4-1.dll` imports `OPENGL32` statically and epoxy
loads it by bare name. Windows answers both from already-loaded modules, then the application
directory, then System32, never from `PATH`. Measured on the VM: on `PATH`, no GL. Preloaded
from JS through `process.dlopen`, no GL either, because Node unloads a DLL that does not
self-register. Beside `node.exe`, GL 4.6.

## Decision

1. **A separate, opt-in npm package**, `@gjsify/gl-runtime-win32-x64`, carries the pinned,
   sha256-checked Mesa DLLs and their licence texts. It is never in the GTK bundle and never
   a dependency of `@gjsify/node-gi`, for the same reason as the bundle itself (ADR 0023):
   node-gi resolves it **by name** (monorepo sibling, then `require.resolve`). An app that must
   render GL on driverless hosts adds it to its own `dependencies`. It follows the release
   train and the platform-package conventions of ADR 0017 (`os`/`cpu` gating, payload built
   on CI, not committed).
2. **The addon preloads it by absolute path before GTK loads**, only when the host has no
   OpenGL ICD (the display driver's user-mode ICD via `D3DKMTQueryAdapterInfo`, or one
   registered under `HKLM\…\OpenGLDrivers`). The probe reads both without loading
   `opengl32.dll`. A vendor driver keeps serving GTK. An `opengl32` that is already loaded is
   reported and never fought. The preload resolves Mesa's own imports from the DLL's directory
   and System32 only (`LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32`), so a
   missing `libgallium_wgl.dll` fails loudly instead of being found in the working directory
   or on `PATH`. This is the ADR 0057 rule applied on win32: the payload does not search
   outside itself.
3. **`GJSIFY_OPENGL=bundle|system`** is the published override. `system` never preloads and
   silences the advice. `bundle` takes Mesa over a vendor driver when the package is
   installed. Without the package on a driverless host with a windowing bundle, the loader
   emits one `GJSIFY_OPENGL_MISSING` warning naming the package. `openGLActivation()` reports
   the decision and its reason.
4. **node-gi does not set `GDK_DEBUG=dcomp`.** GTK 4.22's win32 GL renderer draws through
   DirectComposition and refuses without it ("OpenGL requires Direct Composition"), so GSK
   stays on cairo by default even with Mesa loaded. GTK makes DComp opt-in on purpose:
   `gdk_win32_display_init_dcomp()` says it "causes issues with the GL and Vulkan renderers
   (e.g. black borders)" and is to be re-enabled "when the D3D12 renderer lands". Setting it
   from the loader would override that upstream policy for every app, on vendor-driver hosts
   too, through a debug-flag channel that also leaks into child processes. An app that wants
   GSK on GL sets `GDK_DEBUG=dcomp` itself. The Windows leg asserts both halves: cairo by
   default for GTK's stated reason, GL with the flag.

## What this does NOT decide

- ANGLE. It would need libepoxy and GTK rebuilt with EGL on the gvsbuild side.
- Real-GPU hosts. The "keep the vendor driver" branch is unit-tested (pure decision) but has
  not run on a machine with a vendor ICD.
- Other architectures. `win32-arm64` would be a sibling package with the same shape.

## Consequences

- One more published platform package. Its first publish needs the npm bootstrap
  (`status/pending-npm-bootstrap.json`) before release.yml's OIDC publish can take over.
- The licence payload is the package's responsibility. mesa-dist-win ships no licence texts
  (only its own MIT for the deploy scripts), so the texts are vendored per component and held
  against the pin by `gl-runtime-package.test.mjs`. That includes the notices of third-party
  code compiled into `libgallium_wgl.dll` that neither upstream `licenses/` listing names
  (SoftFloat, xxHash, Henry Spencer's regex).
- Moving the Mesa pin means re-taking those texts. `build-gl-runtime.mjs` refuses to build
  when `provenance.json` names another release.
