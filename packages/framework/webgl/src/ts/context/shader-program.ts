// Shader/program method-group root for WebGLContextBase. The implementations
// live in per-concern modules under `./shader-program/` — each augments this
// file's `ShaderProgramMethods` interface via `declare module` and exports an
// `install<Group>Methods(proto)` function. `installShaderProgramMethods(proto)`
// just composes those install functions in the same order PR #309 + PR #273
// established for `webgl2-rendering-context.ts`.
//
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Reimplemented for GJS using @girs/gwebgl-0.1.

// Side-effect imports paired with the named imports below so tsc preserves the
// `declare module` augmentations from each sub-module in the emitted `.d.ts` —
// downstream consumers need them loaded to see the merged method shapes on the
// published `WebGLContextBase` / `WebGLRenderingContext` type. Same pattern as
// `webgl2-rendering-context.ts` post PR #309 + PR #273.
import './shader-program/shader-lifecycle.js';
import { installShaderLifecycleMethods } from './shader-program/shader-lifecycle.js';
import './shader-program/program-lifecycle.js';
import { installProgramLifecycleMethods } from './shader-program/program-lifecycle.js';
import './shader-program/introspection.js';
import { installIntrospectionMethods } from './shader-program/introspection.js';
import './shader-program/uniforms.js';
import { installUniformsMethods } from './shader-program/uniforms.js';

/**
 * Aggregate of every method-group interface that contributes to the shader /
 * program surface. Each sub-module extends this interface via `declare module
 * './shader-program.js' { interface ShaderProgramMethods extends <Group>Methods {} }`.
 */
export interface ShaderProgramMethods {}

declare module '../webgl-context-base.js' {
    interface WebGLContextBase extends ShaderProgramMethods {}
}

/** Install every shader / program method group on the given prototype. */
export function installShaderProgramMethods(proto: object): void {
    installShaderLifecycleMethods(proto);
    installProgramLifecycleMethods(proto);
    installIntrospectionMethods(proto);
    installUniformsMethods(proto);
}

// Re-export so a consumer that wants to install one group without the rest can
// reach the focused entry points without traversing internal paths.
export {
    installShaderLifecycleMethods,
    installProgramLifecycleMethods,
    installIntrospectionMethods,
    installUniformsMethods,
};
