// Barrel for the focused method-group modules that compose WebGLContextBase.
// Each module exports an `install*Methods(proto)` function plus a TypeScript
// `*Methods` interface that augments the WebGLContextBase declaration.
//
// The base file calls `installAllContextMethods(WebGLContextBase.prototype)`
// after the class declaration runs — this avoids the circular-dependency hazard
// that prototype-merge mixins would otherwise hit at module-load time.

import { installStateMethods } from './state.js';
import { installBufferBindingMethods } from './buffer-binding.js';
import { installTextureManagementMethods } from './texture-management.js';
import { installFramebufferMethods } from './framebuffer.js';
import { installShaderProgramMethods } from './shader-program.js';
import { installDrawingMethods } from './drawing.js';

// Re-export interfaces so the declaration-merging in each module is reachable
// through this single entry point.
export type { StateMethods } from './state.js';
export type { BufferBindingMethods } from './buffer-binding.js';
export type { TextureManagementMethods } from './texture-management.js';
export type { FramebufferMethods } from './framebuffer.js';
export type { ShaderProgramMethods } from './shader-program.js';
export type { DrawingMethods } from './drawing.js';

export function installAllContextMethods(proto: object): void {
    installStateMethods(proto);
    installBufferBindingMethods(proto);
    installTextureManagementMethods(proto);
    installFramebufferMethods(proto);
    installShaderProgramMethods(proto);
    installDrawingMethods(proto);
}
