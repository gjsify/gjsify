<!-- Authored Open-TODO sections — area: @gjsify/webgl.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### `@gjsify/webgl` on darwin — WebGL2 content draws; HiDPI and two GLES 3.0 API gaps do not

First rendering proof on darwin, measured 2026-08-03 on the Intel macOS 15.7.8 test VM
(`docs/workstation/macos-test-vm.md`): the committed `darwin-x64` prebuild draws real pixels onto
the desktop through `Gtk.GLArea` + libepoxy + CGL — a `clearColor`/`scissor`/`clear` pattern,
`gl.getError()` 0, screenshotted. Everything before this proved a `dlopen`, not a pixel. The
`set_use_es(true)` defect that made it impossible is fixed (§ Bridge pattern).

**Read every measurement below with one precondition stated.** Each one was taken with
`DYLD_LIBRARY_PATH=/usr/local/lib` exported by hand, because without it the `Gtk-4.0` typelib's bare
`libgtk-4.1.dylib` leaf does not resolve on this host at all — the darwin loader defect #973 fixes.
So these results describe the GL stack ONCE libgtk is loaded; they do NOT say a user who runs
`gjsify showcase` on macOS gets that far, and the darwin webgl claim is contingent on #973 or an
equivalent. Worth naming explicitly because it is the same masking pattern #973 found in CI, where
the workflow exports `DYLD_FALLBACK_LIBRARY_PATH` itself and thereby hides the defect from every
job: a loader variable supplied by the harness rather than by the user's environment turns "it
works" into "it works for us". SIP makes it worse than a normal env var — `DYLD_*` is stripped when
exec'ing a protected binary, so putting `nohup`/`env` in front of `gjs` silently drops it and the
failure comes back looking like a broken prebuild.

What is still open:

- **GLSL ES 3.00 does not exist on macOS — but the WebGL2 route through GL 4.1 is now MEASURED,
  and it is option (b), far cheaper than this entry assumed.** `#version 300 es` needs
  ARB_ES3_compatibility (core in GL 4.3) and macOS caps CGL at 4.1, so the dialect is genuinely
  refused: `version '300' is not supported`. What was never measured is how much of the SHADER has
  to change once the version line does, and the answer is **nothing**. On macOS 15.7.9 / GL 4.1
  core / GLSL 4.10, a three.js-shaped GLES 3.00 pair — `layout(location=)` attributes AND fragment
  outputs, a `layout(std140)` uniform block, `texture()`, `isampler2D` + `texelFetch`,
  `textureLod`, MRT, `precision highp` statements — compiles clean after swapping ONLY
  `#version 300 es` → `#version 410 core`. So do all eleven constructs probed separately for being
  the likely breakers: `invariant gl_Position`, a fragment shader with no precision statement at
  all, `gl_FragDepth`, `sampler2DShadow` + `texture(vec3)`, `uint`/`uvec4`/bitfield ops,
  `gl_VertexID`/`gl_InstanceID`, `textureGrad`/`textureOffset`, `mediump` on a struct member, a
  dynamically-indexed sampler array, and even `#extension GL_OES_standard_derivatives : enable` /
  `GL_EXT_shader_texture_lod : enable` (an unknown extension with `: enable` is specified to warn,
  not fail — only `: require` would error, which is the one directive form a translator must
  rewrite). **The premise the old entry rested on — "this is what ANGLE does and it is not small" —
  does not survive the measurement**: ANGLE is large because it targets the whole GLES conformance
  suite from a D3D/Metal backend, whereas the gap between GLSL ES 3.00 and GLSL 4.10 on a desktop
  GL backend is a version line. That the route EXISTS was never in doubt: Safari and Chrome both
  ship WebGL2 on macOS, on a stack capped at the same 4.1. **Decision: (b)** — rewrite the dialect
  in the Vala layer at `shaderSource()` time for a desktop-GL context, NOT (a) declaring darwin
  WebGL1-only and not (c) shipping ANGLE. **DONE**, and measured end to end on macOS 15.7.9 /
  GL 4.1 core through the real library: an unmodified `#version 300 es` pair compiles, links,
  draws, and `readPixels` returns the shader's colour — the first WebGL2 CONTENT this repo has
  drawn on darwin. `#version 100` comes back byte-for-byte unchanged in the same run.
  **The predicate is the EXTENSION, not the OS**: `ARB_ES3_compatibility` (core from GL 4.3) is
  what makes a desktop compiler accept the ES dialect, so Mesa's `4.6 (Compatibility Profile)` on
  win32 has it and is deliberately NOT rewritten — rewriting a context that never needed it would
  be changing a consumer's shader for nothing. The mirror of that extension is why WebGL1 worked
  here first: `ARB_ES2_compatibility` is core from 4.1, and the ONE version between the two is the
  whole of what separated WebGL1 from WebGL2 on this platform.
  Deliberately NOT done, with the reason rather than a shrug: `: require` → `: enable` is not
  rewritten, because three.js 0.185 emits exactly two `require` directives
  (`GL_ANGLE_clip_cull_distance`, `GL_ANGLE_multi_draw`) and only when the context ADVERTISES
  those extensions, which a desktop GL context does not — so the case cannot arise from the
  consumer that motivated the work, and silently downgrading a shader's stated hard requirement
  to a warning behind its back is worse than the failure it would hide.
  Still open: the API-level GLES 3.0 features desktop GL 4.1 spells differently —
  `GL_PRIMITIVE_RESTART_FIXED_INDEX` (4.3 on desktop; 4.1 has `glPrimitiveRestartIndex` +
  `GL_PRIMITIVE_RESTART`, which is what ANGLE emulates with) and the mandatory ETC2/EAC formats
  (absent on desktop, unused by three.js/Excalibur). Neither is reached by the showcases, so
  neither is claimed as working; both are shader-independent and would surface as a draw-time
  error, not a compile failure.
- ~~**`getSupportedExtensions()` trips a GLib assertion on every desktop-GL context.**~~ **CLOSED**
  (#1101). A core profile makes `glGetString(GL_EXTENSIONS)` return NULL, and the split
  dereferenced it — `g_strsplit: assertion 'string != NULL' failed` here, a silent process death on
  win32. `webgl-rendering-context-base.vala` now reads the indexed form
  (`GL_NUM_EXTENSIONS` + `glGetStringi`). **Decided from `GL_VERSION`, NOT by trying the old call
  and recovering from NULL**, which is what the issue proposed: measured on this host, the invalid
  call QUEUES `GL_INVALID_ENUM` (0x500), so the obvious fix would have traded a crash for a
  phantom error reported to the next consumer that calls `getError()` — the exact class of defect
  the entry below was filed about. `getString()` and `getParameter`'s `GL_EXTENSIONS` branch went
  through the same guard; they had the same unchecked return. Verified against the real built
  library on a GtkGLArea 4.1 core context: 46 extensions, 0x0 queued afterwards.
- ~~**A `GL_INVALID_OPERATION` (0x502) is pending before the first draw**~~ **CLOSED — it was the
  first candidate, and it is now measured rather than suspected.** A desktop GL core profile has NO
  default vertex-array object; GLES keeps object 0 as a real one, so every WebGL consumer draws with
  nothing bound and macOS is the platform that reaches a core profile (CGL offers no GLES profile at
  all, so GDK hands out desktop GL 4.1). Measured per profile on this VM through CGL, same call
  sequence: `legacy 2.1` → `enableVertexAttribArray` 0x0, `drawArrays` 0x0; `4.1 core` → **0x502 on
  both**; `4.1 core` with any VAO bound → clean. `WebGLRenderingContextBase.construct` now generates
  and binds a stand-in (`ensureDefaultVertexArray()`, a no-op wherever `GL_CONTEXT_PROFILE_MASK`
  does not report core — so Mesa's `4.6 (Compatibility Profile)` on win32 correctly gets none), and
  `WebGL2RenderingContext.bindVertexArray(0)` maps onto it so "back to the default vertex array"
  does not restore the broken state. **It is done in the Vala constructor and not from the JS
  `_init()` beside `_gtkFboId`** because `@girs/gwebgl-0.1` is a PINNED published package: a new
  method is not callable from TypeScript until ts-for-gir regenerates it, so routing the fix through
  JS would have made it wait on a types release to reach the platform it fixes. Since a draw that
  raises 0x502 draws nothing, this is also the most likely half of the BLACK WINDOW — but the
  second candidate is untouched and unproven either way: whether the `_gtkFboId` captured from
  `GL_FRAMEBUFFER_BINDING` is the framebuffer GTK presents on this backend. Re-run the
  `Adw.Application` reproducer before calling the black window closed.
- **The HiDPI path stays unproven on darwin.** The VM reports scale factor 1 (its LaunchAgent pins
  `res:1920x1080 scaling:off`), so `clientWidth × devicePixelRatio === canvas.width` holds
  trivially and this host cannot falsify the drawing-buffer bug class. Only a real HiDPI Mac can.
- **No CI leg runs the GL specs on macOS**, so only a hand run on a Mac shows a desktop-CORE
  regression. `on('Gl')` realizes a GDK GL context and asks (`@gjsify/unit`'s `canRealizeGl` +
  probe) rather than assuming `linux && DISPLAY`, so the specs do run wherever a display exists.
- **`framebufferTextureLayer` of an `ALPHA`/`LUMINANCE` 3D or array texture renders on a core
  profile.** WebGL says legacy formats are never color-renderable; the 2D attachment path refuses
  them from the recorded format, but `framebufferTextureLayer` goes straight to the driver with no
  JS attachment record, and the emulated R8/RG8 storage is renderable there.

Host diagnosis is repeatable: `gjsify run packages/framework/webgl/scripts/probe-gl-host.js`
(negotiated API/version, scale factor, logical-vs-device sizes, shader-dialect matrix, shader-free
pattern; exits non-zero when the GLArea does not realize). It needs a display, which is why it is a
script and not a spec — no CI runner here has one.


### WebGL deferred items (Workstream D)

- **Optional headless drawing-buffer pre-allocation.** `_init()` (`webgl-context-base.ts`) leaves the headless-gl-style `_allocateDrawingBuffer` call commented out because `GtkGLArea` owns the surface. Re-enable if/when a non-GTK output path is added.


### `@gjsify/webgl` on win32-x64 — PROMOTED; what it did NOT close

`prebuilds.yml` carries the PAIR — `webgl-vala-c-win32` (Linux, emits the Vala C
+ GIR) and `build-prebuilds-win32` (windows-latest, compiles that C with MSVC and
load-tests it through `@gjsify/node-gi`) — behind the package's
`prebuilt_vala_c` meson option. Both halves ran `workflow_dispatch`-only for as
long as it took to answer the questions below; they now run on every event,
`@gjsify/webgl` declares `win32-x64`, `@gjsify/webgl-win32-x64` holds the
artifact and `commit-prebuilds` lands it. The declared-vs-built invariant is
symmetric, which is why those four arrived in ONE change. The researched
rejection of valac-on-Windows/MinGW and the measured MSVC result live in that
block's header comment — do not duplicate them here.

**Two findings from the exploratory phase are kept because the guards they
produced are the only thing between them and a repeat.**

- **A DEBUG-CRT artifact went green, and "what remains is a DECLARATION
  decision, not an engineering unknown" was written here while it did.**
  `meson setup` ran without `--buildtype`, meson defaults to `debug`, and MSVC's
  reading of `debug` is `b_vscrt=mdd`. Measured on the win11-gjsify VM against
  the published artifact of the green run, `gwebgl.dll` imported
  `VCRUNTIME140D.dll` and `ucrtbased.dll` — images that ship only with Visual
  Studio and that Microsoft's terms forbid redistributing. Every other import
  (`epoxy-0`, `gdk_pixbuf-2.0-0`, `glib-2.0-0`, `gobject-2.0-0`) resolved from
  the batteries-included GTK bundle, so the library was two files short of
  working and said so as `Failed to load shared library 'gwebgl.dll'` — naming
  the dependent, never the missing dependency. The load test could not see it
  because `windows-latest` HAS Visual Studio: the one artifact no user could
  load is exactly the one the runner is equipped to load. Fixed by
  `--buildtype=release` plus an import-table assertion that runs BEFORE the load
  test, because the property is about redistribution and is answered by reading
  the file rather than by loading it. The general lesson is not "pass
  --buildtype": a CI host provisioned as a DEVELOPER machine silently satisfies
  developer-only dependencies, so any artifact leaving that host needs at least
  one check that INSPECTS rather than executes.
- **The blocker was one layer BELOW webgl, and a display-less runner cannot see
  that layer at all.** The load test proves `dlopen` + `…_get_type`, never
  RENDERING — the same gap the darwin note in
  `build-prebuilds-macos-experimental` records. Measured on the win11-gjsify VM,
  `Gdk.Display.create_gl_context()` failed with `No GL implementation is
  available`, so `three-geometry-teapot` opened a fully correct Adwaita window
  and painted that string where the teapot belongs — a `Gtk.GLArea` failure, not
  a `gi://Gwebgl` one. Cause (a) was the VM: a QEMU/QXL adapter with no OpenGL
  ICD registered under `HKLM\...\OpenGLDrivers`, so Windows offered only the GDI
  generic OpenGL 1.1 that GTK4 rejects. CLOSED by registering Mesa 26.1.6 as a
  system ICD (`mesa-dist-win`'s `systemwidedeploy.cmd 1`:
  `HKLM\…\OpenGLDrivers\MSOGL` → `mesadrv.dll`, the inbox `opengl32.dll` kept as
  the loader — no System32 binary replaced, uninstall is option `10`), which
  gives that VM **OpenGL 4.6, non-legacy**, and `three-geometry-teapot` RENDERS.
  **The `4.6 (Compatibility Profile)` this file once predicted for Mesa/win32 is
  not what apps get**: GDK asks for a CORE profile, so `is_legacy` is false and
  the `ensureDefaultVertexArray()` / `ARB_ES3_compatibility` reasoning in the
  WebGL entries applies on win32 exactly as it does on darwin.

**The prebuild's runtime closure is bigger than its tarball, and that is
DELIBERATE.** `gwebgl.dll` imports `epoxy-0.dll`; Windows has no system
libepoxy, so unlike the Linux and macOS artifacts this one is not loadable from
the host alone. It is not duplicated into the tarball either: the epoxy that
satisfies it already ships in `@gjsify/gtk-runtime-win32-x64` (GTK4 links it),
which every win32 consumer of `@gjsify/webgl` already has, because it is how
`@gjsify/node-gi` gets GObject at all. Two libepoxy images in one address space
is a worse failure than the one being solved, so the closure is DOCUMENTED (in
`@gjsify/webgl`'s README) rather than packaged around.

STILL OPEN, and NOT this prebuild's to close:

- **The batteries-included win32 bundle ships no GL implementation** — its DLLs
  include `epoxy-0.dll`, which is the GL *dispatch* layer and resolves nothing on
  its own. So on a Windows host WITHOUT a vendor or Mesa ICD (a GPU-less VM, an
  RDP session, CI) the GL showcases stay dark, and that is a property of the
  bundle, not of the webgl prebuild. The windowing builder's ANGLE seeds
  (`/^libEGL.*\.dll$/i` + `/^libGLESv2.*\.dll$/i`) matched NOTHING — the gvsbuild
  GTK4 release ZIP carries no ANGLE — which is how a bundle came to promise
  "windowing" while shipping no GL. **The proposed fix was wrong twice over**:
  the gvsbuild `epoxy-0.dll` is built with NO EGL support at all (measured on the
  shipped 0.34.0 bundle: no `epoxy_has_egl`, no `egl*` entry point), so
  `gdk_win32_display_get_egl_display()` can never engage no matter what
  `libEGL.dll` is present — that path needs libepoxy rebuilt with
  `-Degl=enabled`, a gvsbuild-side change. And the desktop-GL family is inert for
  a second, independent reason: epoxy resolves it with a bare
  `LoadLibraryA("OPENGL32")`, which Windows answers from the **application
  directory** then **System32**, never from `PATH` — the only search the loader's
  bundle wiring controls. Measured three ways on the VM: bundle-local
  `libEGL`+`libGLESv2`+`libgallium_wgl` → still none; bundle-local `opengl32.dll`
  preloaded by absolute path via `process.dlopen` → still none (Node *unloads* a
  DLL that fails to self-register, so the base-name-match trick needs the addon,
  not JS); the same `opengl32.dll` beside a copied `node.exe` → **GL 4.6, works**,
  which is what proves the mechanism is placement and nothing else. A bundled ICD
  therefore requires the ADDON to opt the process into
  `SetDefaultDllDirectories(…)` + `AddDllDirectory(<bundle>/bin)` — process-wide
  DLL-resolution surgery that would also stop other native modules resolving
  their deps from `PATH`, so it is a decision, not a detail. The
  positive-assertion half is DONE: the windowing builder probes the FINISHED
  `bin/` for a GL implementation, records it as `manifest.glImplementation` (with
  `dispatch` listed separately so epoxy's presence can never be misread as GL),
  and warns naming every pattern that matched nothing. `--require-gl` makes it
  fatal; it is off by default only because no gvsbuild prefix satisfies it yet,
  so the promotion that ships a GL implementation flips it in the same change.
  Tracked as #1097.

The two-job split generalises past webgl: every other Vala bridge in this
repository has the same "valac does not run on Windows" problem, and
`prebuilt_vala_c` is a per-package option today rather than a shared mechanism.
Lifting it is premature until a second bridge wants it — but the second one is
where the helper gets lifted, not the third.

