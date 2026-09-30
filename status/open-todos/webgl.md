<!-- Authored Open-TODO sections — area: @gjsify/webgl.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### `@gjsify/webgl` on darwin — WebGL2 content draws and HiDPI holds; no CI leg, GLES 3.0 gaps

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
- ~~**The API-level GLES 3.0 features desktop GL 4.1 spells differently**~~ **CLOSED — both,
  and the ETC2/EAC half was not what this entry believed.** `GL_PRIMITIVE_RESTART_FIXED_INDEX`
  is the only draw-time gap left, and it is now SUPPLIED rather than left missing: WebGL 2.0
  removes the state and "behaves as though it were always enabled", so where the context has
  it the layer `Enable`s it — which has to be done, because GLES 3.0 gives the state the
  initial value DISABLED (desktop GL 3.1 gives `PRIMITIVE_RESTART` the opposite default, so
  neither can be assumed) — and where it does not (this host: no `ARB_ES3_compatibility`,
  `GL_VERSION` `4.1 Metal - 91.7`) it emulates ANGLE's shape, `GL_PRIMITIVE_RESTART` +
  `glPrimitiveRestartIndex(<max of the element type>)`, per draw from the element type. The
  predicate is the EXTENSION the shader rewrite above already asks, not the OS, so Linux's
  GLES 3.x context takes the native path and Mesa's win32 `4.6` compatibility profile is
  left alone. `Enable`/`Disable` of the removed state is `INVALID_ENUM` on every context,
  which is what keeps it from being a consumer's to switch off.
  **ETC2/EAC were never mandatory in WebGL 2.0** — this entry repeated the GLES 3.0 rule.
  WebGL 2.0 removes all ten ("No ETC2 and EAC compressed texture formats") and re-offers them
  through `WEBGL_compressed_texture_etc`, which this package does not implement, so the
  spec-correct answer is `INVALID_ENUM` on EVERY context, and `webgl2.idl` names none of
  them. Handing the number to the driver was not uniform: this host's GL 4.1 answers
  `INVALID_ENUM` anyway (measured), while a GLES 3.x host — every Linux CI runner — accepts
  all ten and the upload would have silently succeeded. All four compressed entry points and
  `getInternalformatParameter` refuse them now.
  Measured on macOS 27 / Apple M4 / GL 4.1 core through a LOCAL by-hand meson build of the
  library (not shipped here), `gjsify workspace @gjsify/webgl run test`: **192 passed**
  (182 before). The falsification is the measurement: same bundle, run twice — against the
  **committed prebuild** the far half reads `255,255,255,255` where a conformant context
  leaves the framebuffer clear, i.e. the driver assembled the triangle built from index 255,
  with `GL_PRIMITIVE_RESTART_INDEX` at 0 and `GL_PRIMITIVE_RESTART` off; against the
  **locally built library** the far half reads `0,0,255,255` (the clear colour, so the
  restart cut the primitive), `GL_PRIMITIVE_RESTART_INDEX` reads `0xff` / `0xffff` /
  `0xffffffff` for `_BYTE` / `_SHORT` / `_INT`, and `GL_PRIMITIVE_RESTART` is enabled.
  **No spec holds either behaviour yet** — the suite loads the PREBUILT `libgwebgl`, which
  still carries the previous Vala, so the spec is owed; the full assertions are written out
  in the next entry, and the condition for adding them is there too. **The committed
  `linux-*`/`win32-x64`/`darwin-arm64` prebuilds still carry the previous `libgwebgl`** —
  only `commit-prebuilds` refreshes them, and it does not run on `pull_request`.
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
- **HiDPI is measured correct on a real Retina Mac, and the gate that used to need opening by
  hand now opens itself.** `hidpi.spec.ts` passes all 14 cases against a real `Gtk.GLArea`
  (macOS 27, Apple Silicon, scale 2, 2026-09-24; see `packages/framework/webgl/README.md` §
  HiDPI) — `clientWidth × devicePixelRatio === canvas.width` holds against GTK's own `resize`
  signal and the framebuffer it actually presents, not just the arithmetic a stub would agree
  with trivially. The gate needed no change for that run: `canRealizeGl` in `@gjsify/unit`
  already probes for a real context instead of deciding by OS, so `on('Gl')` opens wherever a
  context can be realized.
- **No CI leg runs the GL specs on macOS**, so only a hand run on a Mac shows a desktop-CORE
  regression. `on('Gl')` realizes a GDK GL context and asks (`@gjsify/unit`'s `canRealizeGl` +
  probe) rather than assuming `linux && DISPLAY`, so the specs do run wherever a display exists.
  For HiDPI specifically, the Linux `GDK_SCALE=2` step in `main.yml` is what holds the contract
  in CI meanwhile (under `GJSIFY_TEST_EXPECT_SCALE=2`, so a scale override that stops taking
  effect fails the step instead of letting it pass having drawn nothing).
- **`framebufferTextureLayer` of an `ALPHA`/`LUMINANCE` 3D or array texture renders on a core
  profile.** WebGL says legacy formats are never color-renderable; the 2D attachment path refuses
  them from the recorded format, but `framebufferTextureLayer` goes straight to the driver with no
  JS attachment record, and the emulated R8/RG8 storage is renderable there.

Host diagnosis is repeatable: `gjsify run packages/framework/webgl/scripts/probe-gl-host.js`
(negotiated API/version, scale factor, logical-vs-device sizes, shader-dialect matrix, shader-free
pattern; exits non-zero when the GLArea does not realize). It needs a display, which is why it is a
script and not a spec — no CI runner here has one.

### The GLES 3.0 restart / ETC2 refusal spec is OWED — the suite loads the prebuilt library

**The spec that was written with the fix above is not in the tree, and that is a debt, not a
decision.** It is reproduced in full at the end of this entry so nothing is lost: paste it back
as `packages/framework/webgl/src/ts/gles3-desktop-gl.spec.ts` and add the import + call in
`test.ts`.

**Why it could not land with the fix.** The `@gjsify/webgl` specs load the **PREBUILT**
`libgwebgl` (a 13 Aug tarball per target), never the Vala source under `src/vala/`. So a spec
asserting the NEW behaviour is a test of the binary, not of the commit. `main.yml`'s Test shard
runs webgl on Linux under `xvfb` + llvmpipe with `GJSIFY_TEST_EXPECT_AXES=Gl`, so the required
`CI gate (GJS)` goes RED on the new spec — and the prebuild that would make it green is
republished only by `commit-prebuilds`, which runs **after** the merge that the required gate
forbids. `ef4de8654` had the same shape and answered it by writing the spec to pass against
BOTH prebuild states, which pins nothing.

**Not done on purpose**, because `tests/AGENTS.md` forbids all three and each was a way to make
the gate green without the behaviour existing: no `it.skip` (hides forever, retires nothing), no
`if (platform)` guard around the test (the tolerance has to be inside the expectation), and
`it.failing` is not it either — it declares the assertion as expected-to-fail, which would keep
the run green while telling every reader the fix is unverified, and it fails the run the moment
the prebuild refreshes, i.e. a red gate that lands a day later instead of one now. No EXISTING
spec was weakened, skipped or deleted to get here: what was removed is a NEW spec that never
landed. Its assertions are in this entry, unedited.

**Condition under which it may be added — either of the two, not a preference between them:**

1. **The prebuild carries the new Vala.** Once `commit-prebuilds` has republished
   `linux-*` / `win32-x64` / `darwin-arm64` from a `main` that includes this fix, the spec
   passes against the binary and can be committed as-is. Check with the measurement below: on a
   host whose prebuild is stale the far half reads white; on a host whose prebuild is current it
   reads the clear colour.
2. **The test builds the library from source.** If the suite is changed to build
   `src/vala/` (meson) instead of dlopening the prebuild, the spec is decoupled from the bot's
   cadence and can land in the SAME PR as the fix — which is the better answer, and the one that
   makes this entry unnecessary rather than merely repeatable.

The spec verbatim, as it stood in `742d9159ca`:

```ts
// WebGL 2.0's two GLES 3.0 behaviours a desktop-GL context spells differently,
// against a REAL `Gtk.GLArea` — the two the darwin ledger recorded as open.
//
// Both live in the Vala layer (`src/vala/`), so neither is reachable from
// TypeScript directly; everything below goes through the WebGL surface a consumer
// has, with one deliberate exception named where it is made.
//
//   1. PRIMITIVE_RESTART_FIXED_INDEX. WebGL 2.0 removes the state and "behaves
//      as though it were always enabled": an index equal to the maximum of its
//      data type cuts the primitive. Where the state exists that is one `Enable`
//      — and GLES 3.0 gives it the initial value DISABLED, so it has to be made.
//      Where it does not (macOS caps CGL at desktop GL 4.1 and offers no GLES
//      profile at all) the layer emulates it ANGLE's way, per draw and from the
//      element type.
//   2. The ten ETC2/EAC compressed formats. WebGL 2.0 REMOVES them — the ledger's
//      "mandatory ETC2/EAC" was the GLES 3.0 rule, not WebGL's — and re-offers
//      them through `WEBGL_compressed_texture_etc`, which this package does not
//      implement, so `webgl2.idl` names none of them. Refusing them has to be
//      THIS layer's doing: on the GLES 3.x context a Linux runner gets, every one
//      of the ten is a valid driver format and handing it to GL silently succeeds.
//
// The pixel witness is what makes (1) falsifiable. Two triangles TILE the
// viewport and share only the anti-diagonal, so a pixel in each half says which
// one the driver assembled; the second is built from the restart index. A driver
// without the behaviour paints the far half white, a conformant context leaves it
// the clear colour. It needs a 256-entry vertex buffer and nothing else — the
// restart index for UNSIGNED_BYTE is 255.

import { describe, it, expect, on } from '@gjsify/unit';
import type { WebGL2RenderingContext, WebGLRenderingContext } from '@gjsify/webgl';
import type { OurHTMLCanvasElement } from './html-canvas-element.js';
import { WebGLBridge } from '@gjsify/webgl';
import { makeTestFBO, destroyTestFBO } from './test-utils.js';
import GLib from '@girs/glib-2.0';
import Gtk from '@girs/gtk-4.0';

/** `GL_PRIMITIVE_RESTART_FIXED_INDEX`, `GL_PRIMITIVE_RESTART` and
 *  `GL_PRIMITIVE_RESTART_INDEX` — none of them WebGL enums, so spelled out. */
const PRIMITIVE_RESTART_FIXED_INDEX = 0x8f8d;
const GL_PRIMITIVE_RESTART = 0x8f9d;
const GL_PRIMITIVE_RESTART_INDEX = 0x8f9e;
const NUM_FORMATS = 0x86da;

/** The ten ETC2/EAC `internalformat` values, paired with the name WebGL gives
 *  them on the extension object this package does not implement. */
const ETC2_EAC: [number, string][] = [
    [0x9270, 'COMPRESSED_R11_EAC'],
    [0x9271, 'COMPRESSED_SIGNED_R11_EAC'],
    [0x9272, 'COMPRESSED_RG11_EAC'],
    [0x9273, 'COMPRESSED_SIGNED_RG11_EAC'],
    [0x9274, 'COMPRESSED_RGB8_ETC2'],
    [0x9275, 'COMPRESSED_SRGB8_ETC2'],
    [0x9276, 'COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2'],
    [0x9277, 'COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2'],
    [0x9278, 'COMPRESSED_RGBA8_ETC2_EAC'],
    [0x9279, 'COMPRESSED_SRGB8_ALPHA8_ETC2_EAC'],
];

/** One `vec3 position` carries both the clip position and the colour selector,
 *  so the whole fixture is a single attribute — the shape `makeProgram` and
 *  `drawTriangle` in `test-utils` already use, and one less thing between the
 *  spec and the pixels. */
const VS = `#version 300 es
in vec3 position;
out vec3 vColor;
void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
    vColor = vec3(position.z);
}`;

const FS = `#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 fragColor;
void main() { fragColor = vec4(vColor, 1.0); }
`;

/** The largest index UNSIGNED_BYTE can carry, and the vertex that carries it. */
const RESTART_INDEX = 255;
/** 256 entries so the restart index is IN RANGE — an out-of-bounds fetch is
 *  undefined rather than a difference we could read. */
const VERTEX_COUNT = 256;
const SIZE = 128;

/** Inside the real triangle (clip (-0.5, -0.5) — the lower-left quadrant). */
const LOWER_LEFT = [32, 32];
/** Only the restart-index triangle can reach it (clip (0.5, 0.5)). */
const UPPER_RIGHT = [96, 96];
const CLEAR_BLUE = '0,0,255,255';
/** The real triangle's colour: `position.z` 0 → black. */
const REAL_PIXEL = '0,0,0,255';

/** Spin the main loop until `done()` or `timeoutMs`; returns whether `done()` held. */
function spinUntil(done: () => boolean, timeoutMs = 10000): boolean {
    const ctx = GLib.MainContext.default();
    const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;
    const wakeup = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => GLib.SOURCE_CONTINUE);
    while (!done() && GLib.get_monotonic_time() < deadline) ctx.iteration(true);
    GLib.source_remove(wakeup);
    return done();
}

/**
 * The Gwebgl binding under the context — the one reader that bypasses this
 * package's JS shadow state. Needed for `GL_PRIMITIVE_RESTART_INDEX`, which is
 * not a WebGL pname and so has no WebGL-side answer at all.
 */
function nativeGl2(gl: WebGL2RenderingContext): { getParameteri(pname: number): number } {
    return (gl as unknown as { _native2: { getParameteri(pname: number): number } })._native2;
}

/**
 * Does this context have the GLES 3.0 state itself?
 *
 * The rule the spec states, read from the CONTEXT: GLES has it, and so does a
 * desktop context carrying `ARB_ES3_compatibility` (core from GL 4.3). Not the OS —
 * Mesa on win32 reports `4.6 (Compatibility Profile)` and has it, while macOS's
 * GL 4.1 has neither GLES nor the extension.
 */
function hasFixedRestartIndexState(gl: WebGL2RenderingContext): boolean {
    const version = String(gl.getParameter(gl.VERSION));
    if (version.startsWith('OpenGL ES ')) return true;
    const major = Number(version.split('.')[0]);
    const minor = Number(version.split('.')[1]);
    if (major > 4 || (major === 4 && minor >= 3)) return true;
    return gl.getSupportedExtensions().includes('GL_ARB_ES3_compatibility');
}

/** Element type → the largest index it can carry, i.e. what a restart cuts at. */
function maxIndexOf(type: number): number {
    if (type === 0x1405 /* UNSIGNED_INT */) return 0xffffffff;
    if (type === 0x1403 /* UNSIGNED_SHORT */) return 0xffff;
    return 0xff;
}

export default async () => {
    await on('Gl', async () => {
        Gtk.init();

        const win = new Gtk.Window({ default_width: SIZE, default_height: SIZE });
        const area = new WebGLBridge();
        win.set_child(area);

        let gl: WebGL2RenderingContext | null = null;
        area.onReady((canvas, _webgl1: WebGLRenderingContext) => {
            // The bridge hands over its WebGL 1 context; WebGL 2 is asked of the
            // canvas, exactly as a consumer would.
            gl = (canvas as unknown as OurHTMLCanvasElement).getContext('webgl2') as unknown as WebGL2RenderingContext;
        });
        win.present();
        spinUntil(() => gl !== null);
        expect(gl).not.toBeNull();
        const context = gl!;
        // Everything below runs OUTSIDE GTK's `render` signal, and a GLArea's
        // context is only current inside it: without this every GL call is a
        // silent no-op that `getError()` still reports as clean, so a draw that
        // drew nothing is indistinguishable from one that drew.
        area.make_current();
        const nativeState = hasFixedRestartIndexState(context);

        //
        // ── Fixture: two triangles tiling the viewport ────────────────────────
        //
        // Vertices 0/1/2 are the real (black) triangle, 3/4/255 the white one.
        // NO vertex is shared between them: a shared one would interpolate the
        // colour and read as a blend, which is neither answer.
        const vertices = new Float32Array(VERTEX_COUNT * 3);
        const put = (index: number, x: number, y: number, white: number) => {
            vertices[index * 3] = x;
            vertices[index * 3 + 1] = y;
            vertices[index * 3 + 2] = white;
        };
        put(0, -1, -1, 0);
        put(1, 1, -1, 0);
        put(2, -1, 1, 0);
        put(3, 1, -1, 1);
        put(4, -1, 1, 1);
        put(RESTART_INDEX, 1, 1, 1);

        // An FBO of our own is what makes the framebuffer readable at all outside
        // GTK's `render` signal — GtkGLArea's own FBO is not (see test-utils).
        const target = makeTestFBO(context, SIZE, SIZE);

        const program = context.createProgram()!;
        const vs = context.createShader(context.VERTEX_SHADER)!;
        context.shaderSource(vs, VS);
        context.compileShader(vs);
        const fs = context.createShader(context.FRAGMENT_SHADER)!;
        context.shaderSource(fs, FS);
        context.compileShader(fs);
        expect(context.getShaderParameter(vs, context.COMPILE_STATUS)).toBeTruthy();
        expect(context.getShaderParameter(fs, context.COMPILE_STATUS)).toBeTruthy();
        context.attachShader(program, vs);
        context.attachShader(program, fs);
        context.bindAttribLocation(program, 0, 'position');
        context.linkProgram(program);
        expect(context.getProgramParameter(program, context.LINK_STATUS)).toBeTruthy();
        context.useProgram(program);

        const vertexBuffer = context.createBuffer()!;
        context.bindBuffer(context.ARRAY_BUFFER, vertexBuffer);
        context.bufferData(context.ARRAY_BUFFER, vertices, context.STATIC_DRAW);
        context.enableVertexAttribArray(0);
        context.vertexAttribPointer(0, 3, context.FLOAT, false, 3 * 4, 0);

        const indexBuffer = context.createBuffer()!;

        /** Clear to blue and draw both triangles from `indices`. */
        const drawBothTriangles = (indices: ArrayBufferView, type: number) => {
            context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, indexBuffer);
            context.bufferData(context.ELEMENT_ARRAY_BUFFER, indices, context.STATIC_DRAW);
            context.clearColor(0, 0, 1, 1);
            context.clear(context.COLOR_BUFFER_BIT);
            context.drawElements(context.TRIANGLES, 6, type, 0);
            context.finish();
            expect(context.getError()).toBe(context.NO_ERROR);
        };

        /** `GL_PRIMITIVE_RESTART_INDEX` read through GL, which returns it SIGNED
         *  — `glGetIntegerv` has no unsigned form, so 0xFFFFFFFF arrives as -1. */
        const restartIndex = (): number => nativeGl2(context).getParameteri(GL_PRIMITIVE_RESTART_INDEX) >>> 0;

        const pixelAt = (x: number, y: number): number[] => {
            const out = new Uint8Array(4);
            context.readPixels(x, y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, out);
            return Array.from(out);
        };

        await describe('WebGL2 primitive restart is always enabled', async () => {
            await it('cuts the primitive at the restart index instead of drawing it', async () => {
                // The real triangle is the witness that the DRAW happened at all: a
                // blank frame would satisfy "the far half is untouched" just as well.
                drawBothTriangles(new Uint8Array([0, 1, 2, RESTART_INDEX, 3, 4]), context.UNSIGNED_BYTE);
                // A white pixel in the far half (255,255,255,255 — `position.z` 1) is the restart
                // NOT happening, which a conformant context never paints.
                expect(pixelAt(...LOWER_LEFT).join(',')).toBe(REAL_PIXEL);
                expect(pixelAt(...UPPER_RIGHT).join(',')).toBe(CLEAR_BLUE);
            });

            await it('reaches the instanced draw path too', async () => {
                // A SEPARATE native entry point (`glDrawElementsInstanced`, which is
                // what three.js' `InstancedMesh` reaches) and a separate WebGL 2
                // method, so it is its own draw with its own restart index — the
                // first version of this left it at whatever the last draw set.
                context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, indexBuffer);
                context.bufferData(
                    context.ELEMENT_ARRAY_BUFFER,
                    new Uint8Array([0, 1, 2, RESTART_INDEX, 3, 4]),
                    context.STATIC_DRAW,
                );
                context.clearColor(0, 0, 1, 1);
                context.clear(context.COLOR_BUFFER_BIT);
                context.drawElementsInstanced(context.TRIANGLES, 6, context.UNSIGNED_BYTE, 0, 2);
                context.finish();
                expect(context.getError()).toBe(context.NO_ERROR);
                expect(pixelAt(...LOWER_LEFT).join(',')).toBe(REAL_PIXEL);
                expect(pixelAt(...UPPER_RIGHT).join(',')).toBe(CLEAR_BLUE);
                if (!nativeState) expect(restartIndex()).toBe(maxIndexOf(context.UNSIGNED_BYTE));
            });

            await it('takes the restart index from the element type of each draw', async () => {
                // Per draw, because one index buffer can be drawn as more than one
                // type and the comparison value is a function of the type. Read
                // through the native pname: `GL_PRIMITIVE_RESTART_INDEX` is not a
                // WebGL query, so there is no other way to see it.
                const before = restartIndex();
                for (const [indices, type] of [
                    [new Uint8Array([0, 1, 2, RESTART_INDEX, 3, 4]), context.UNSIGNED_BYTE],
                    [new Uint16Array([0, 1, 2, RESTART_INDEX, 3, 4]), context.UNSIGNED_SHORT],
                    [new Uint32Array([0, 1, 2, RESTART_INDEX, 3, 4]), context.UNSIGNED_INT],
                ] as const) {
                    drawBothTriangles(indices, type);
                    const after = restartIndex();
                    if (nativeState) {
                        // This context HAS the state, so the layer must not touch the
                        // desktop-GL emulation state on it at all.
                        expect(after).toBe(before);
                    } else {
                        expect(after).toBe(maxIndexOf(type));
                    }
                }
            });

            await it('enables PRIMITIVE_RESTART only where the state is emulated', async () => {
                drawBothTriangles(new Uint8Array([0, 1, 2, RESTART_INDEX, 3, 4]), context.UNSIGNED_BYTE);
                const enabled = nativeGl2(context).getParameteri(GL_PRIMITIVE_RESTART) === 1;
                expect(enabled).toBe(!nativeState);
            });

            await it('refuses Enable/Disable of the state WebGL 2.0 removed', async () => {
                // "Not supported in WebGL 2.0" is an `INVALID_ENUM`, and WebGL 1.0
                // has no such enum either, so both contexts answer it the same way.
                // Leaving it to the driver answers it on the hosts that reject the
                // enum and not on the ones that do not — and those are the ones
                // where the state would otherwise be a consumer's to switch off.
                const raw = context as unknown as {
                    enable(cap: number): void;
                    disable(cap: number): void;
                };
                raw.enable(PRIMITIVE_RESTART_FIXED_INDEX);
                expect(context.getError()).toBe(context.INVALID_ENUM);
                raw.disable(PRIMITIVE_RESTART_FIXED_INDEX);
                expect(context.getError()).toBe(context.INVALID_ENUM);
            });
        });

        await describe('WebGL2 does not expose ETC2/EAC compressed formats', async () => {
            await it('advertises none of them in COMPRESSED_TEXTURE_FORMATS', async () => {
                const formats = context.getParameter(context.COMPRESSED_TEXTURE_FORMATS) as Uint32Array | number[];
                const advertised = Array.from(formats as ArrayLike<number>);
                for (const [format] of ETC2_EAC) {
                    expect(advertised).not.toContain(format);
                }
            });

            await it('names none of them on the context', async () => {
                // The names belong to the `WEBGL_compressed_texture_etc` extension
                // object, so a consumer cannot even name them — only pass the number.
                const named = context as unknown as Record<string, unknown>;
                for (const [, name] of ETC2_EAC) {
                    expect(named[name]).toBeUndefined();
                }
            });

            await it('does not offer the extension that would re-expose them', async () => {
                expect(context.getSupportedExtensions()).not.toContain('WEBGL_compressed_texture_etc');
            });

            await it('refuses every one of them with INVALID_ENUM on upload', async () => {
                const texture = context.createTexture()!;
                context.bindTexture(context.TEXTURE_2D, texture);
                const data = new Uint8Array(64);
                for (const [format] of ETC2_EAC) {
                    context.compressedTexImage2D(context.TEXTURE_2D, 0, format, 4, 4, 0, data);
                    expect(context.getError()).toBe(context.INVALID_ENUM);
                    context.compressedTexSubImage2D(context.TEXTURE_2D, 0, 0, 0, 4, 4, format, data);
                    expect(context.getError()).toBe(context.INVALID_ENUM);
                    context.compressedTexImage3D(
                        context.TEXTURE_2D,
                        0,
                        format,
                        4,
                        4,
                        4,
                        0,
                        0 /* imageSize, ignored by the native side */,
                        data,
                    );
                    expect(context.getError()).toBe(context.INVALID_ENUM);
                    context.compressedTexSubImage3D(
                        context.TEXTURE_2D,
                        0,
                        0,
                        0,
                        0,
                        4,
                        4,
                        4,
                        format,
                        0 /* imageSize, ignored by the native side */,
                        data,
                    );
                    expect(context.getError()).toBe(context.INVALID_ENUM);
                }
            });

            await it('refuses to describe them with getInternalformatParameter', async () => {
                // The other way the number leaks: the driver answers for any enum it
                // knows, so a GLES 3.x host reports the ten — and their properties —
                // for a format WebGL 2.0 does not expose.
                for (const [format] of ETC2_EAC) {
                    context.getInternalformatParameter(context.TEXTURE_2D, format, NUM_FORMATS);
                    expect(context.getError()).toBe(context.INVALID_ENUM);
                }
            });
        });

        context.bindFramebuffer(context.FRAMEBUFFER, null);
        destroyTestFBO(context, target);
        win.destroy();
    });
};
```


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

**The GL layer below it has an OPT-IN answer (#1097, PR #1789)** — kept here because the
readings that each looked right are the reason the fix has the shape it has:

- **The seed that matched nothing.** The windowing builder seeded ANGLE
  (`/^libEGL.*\.dll$/i` + `/^libGLESv2.*\.dll$/i`), the gvsbuild ZIP carries no ANGLE,
  and four releases shipped `windowing: true` bundles with GL *dispatch* (`epoxy-0.dll`)
  and no implementation, hidden on every Windows leg by `GSK_RENDERER=cairo`. The builder
  records `manifest.glImplementation` with `dispatch` apart.
- **ANGLE is unreachable, not just absent**: gvsbuild builds GTK 4.22.4 and libepoxy
  without EGL. The implementation is Mesa's WGL build, pinned + sha256-checked
  (`scripts/fetch-gl-implementation.mjs`) — and at ~22 MB per tarball it is the OPTIONAL
  package `@gjsify/gl-runtime-win32-x64` (Pascal's decision), never the base bundle and
  never a node-gi dependency. **First publish not yet done** (`status/pending-npm-bootstrap.json`).
- **A DLL on disk does nothing by itself**: `gtk-4-1.dll` imports `OPENGL32` statically and
  epoxy loads it by bare name; Windows answers from loaded modules, the app directory,
  System32 — never `PATH` (VM: on PATH → none; `process.dlopen` → none; beside `node.exe` →
  GL 4.6). So the ADDON preloads it by absolute path (`src/opengl-win32.cc`,
  `activateBundledOpenGL`) before GTK loads, only when the host has no ICD (display-driver
  UMD ICD via `D3DKMTQueryAdapterInfo`, or `HKLM\…\OpenGLDrivers`). Without the package on
  such a host a windowing process gets ONE `GJSIFY_OPENGL_MISSING` warning naming it.
  `GJSIFY_OPENGL=bundle|system` overrides.

Measured on `windows-latest` (`test/win32-opengl.test.mjs`, the one Windows step without
`GSK_RENDERER=cairo`): no ICD, Mesa preloaded, GDK context **4.6 core**, `GL_RENDERER`
`D3D12 (Microsoft Basic Render Driver)`; the `GJSIFY_OPENGL=system` child on the same runner:
`No GL implementation is available`. **GSK still picks cairo by default, and that is
GTK's policy, not a gap**: `Failed to realize renderer 'GskGLRenderer' … OpenGL requires
Direct Composition` — GTK's win32 GL renderer draws through DComp, which GTK makes opt-in
(`GDK_DEBUG=dcomp`, "black borders"). The test asserts that reason, and asserts GL under
`GDK_DEBUG=dcomp`.

STILL OPEN: **real-GPU hardware is unmeasured** — the "keep the vendor driver" branch never
ran on a machine with one. What it unlocks and nobody has run yet: a RENDERING proof for
`@gjsify/webgl` on win32 (`webgl-glarea`/`excalibur-webgl` need a realizable GL context,
which the windows runner has with the package installed).

The two-job split generalises past webgl: every other Vala bridge in this
repository has the same "valac does not run on Windows" problem, and
`prebuilt_vala_c` is a per-package option today rather than a shared mechanism.
Lifting it is premature until a second bridge wants it — but the second one is
where the helper gets lifted, not the third.

