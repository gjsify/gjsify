// Pure barrel — named exports only, no top-level side effects (AGENTS.md
// tree-shakeable-globals rule 1). `globalThis.{WebGLRenderingContext,
// WebGL2RenderingContext}` used to be written here at barrel-import time; that
// registration now lives in `./register.ts` (see ADR 0012) and is reached via
// `--globals auto`, an explicit `import '@gjsify/webgl/register'`, or
// `WebGLBridge.installGlobals()`.
import '@girs/gjs';
import '@girs/gio-2.0';
import '@girs/gtk-4.0';

export * from './html-canvas-element.js';
export * from './software-renderer.js';
export * from './webgl-bridge.js';
// export * from './linkable.js';
// export * from './utils.js';
export * from './webgl-active-info.js';
export * from './webgl-buffer.js';
export * from './webgl-context-attributes.js';
export * from './webgl-drawing-buffer-wrapper.js';
export * from './webgl-framebuffer.js';
export * from './webgl-program.js';
export * from './webgl-renderbuffer.js';
export * from './webgl-query.js';
export * from './webgl-context-base.js';
export * from './webgl-rendering-context.js';
export * from './webgl-sampler.js';
export * from './webgl-shader-precision-format.js';
export * from './webgl-sync.js';
export * from './webgl-transform-feedback.js';
export * from './webgl-vertex-array-object.js';
export * from './webgl2-rendering-context.js';
export * from './webgl-shader.js';
export * from './webgl-texture-unit.js';
export * from './webgl-texture.js';
export * from './webgl-uniform-location.js';
export * from './webgl-vertex-attribute.js';

// Extensions — exposed so consumers (and *.spec.ts) can use the concrete
// extension class as a type instead of `as any` casts on getExtension() results.
export * from './extensions/ext-blend-minmax.js';
export * from './extensions/ext-color-buffer-float.js';
export * from './extensions/ext-color-buffer-half-float.js';
export * from './extensions/ext-texture-filter-anisotropic.js';
export * from './extensions/oes-element-index-unit.js';
export * from './extensions/oes-standard-derivatives.js';
export * from './extensions/oes-texture-float-linear.js';
export * from './extensions/oes-texture-float.js';
export * from './extensions/oes-texture-half-float.js';
export * from './extensions/stackgl-destroy-context.js';
export * from './extensions/stackgl-resize-drawing-buffer.js';
export * from './extensions/webgl-debug-renderer-info.js';
