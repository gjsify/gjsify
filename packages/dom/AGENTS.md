# AGENTS.md — `packages/dom/*` (DOM pillar)

> Scope: this directory tree. Repo-wide rules live in the [root AGENTS.md](../../AGENTS.md) — read that first.

## DOM Packages — `packages/dom/*`

| Pkg | Libs | Implements |
|-----|------|------------|
| dom-elements | GdkPixbuf, `@gjsify/canvas2d-core` | Node/Element/HTMLElement/Canvas/Image/Media/Video/Document/Text/Fragment/DOMTokenList, Mutation/Resize/IntersectionObserver, Attr/NamedNodeMap/NodeList. Auto-registers `globalThis.{Image,HTMLCanvasElement,document,self,…}` on import + the `'2d'` context factory via canvas2d-core |
| canvas2d-core | Cairo, PangoCairo (root) · Gdk 4 + GdkPixbuf (`/gdk` subpath only) | **Headless** CanvasRenderingContext2D, CanvasGradient/Pattern, Path2D, ImageData, color parser — NO GTK in the ROOT entry. **Pixel-interop seam** (`src/pixel-bridge.ts`): GJS's Cairo binds no pixel accessor (`refs/gjs/modules/cairo-image-surface.cpp` comments `getData` out) and the only introspectable Cairo⇄GdkPixbuf converters live in `Gdk-4.0` = `libgtk-4.so`, so pixel ops call an INJECTED `CanvasPixelBridge` instead of importing Gdk. The GDK impl is the side-effect subpath `@gjsify/canvas2d-core/gdk` (the package's ONLY `gi://Gdk` file, pinned in `sideEffects`), imported by `dom-elements/register/canvas` (cycle-free path) and by `@gjsify/canvas2d`. Unregistered + a pixel op → a `TypeError` naming the subpath, never silent blank pixels. Headless claim declared + machine-checked root-only (§ Runtime & platform model) so `/gdk` stays legal while a root Gdk import fails CI |
