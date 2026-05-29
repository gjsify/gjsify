// Texture-management methods for WebGLContextBase — barrel + composite
// install function. Same `install*Methods(proto)` shape as the sibling
// `buffer-binding.ts` / `state.ts` splits. The actual method bodies live in
// per-concern sibling modules under `texture-management/`, each
// declaration-merging its own `<Group>Methods` interface into
// `WebGLContextBase` via `declare module '../webgl-context-base.js'`.
//
// Each install function is imported twice — once as a named import for the
// `installTextureManagementMethods` call site and once as a bare side-effect
// import so tsc preserves the augmentation in the emitted `.d.ts` (same
// technique as PR #309 / PR #273 / the canvas2d-core split in PR #262).
//
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Reimplemented for GJS using @girs/gwebgl-0.1 — original in webgl-context-base.ts.

import './texture-management/lifecycle.js';
import './texture-management/tex-image.js';
import './texture-management/copy-and-compressed.js';
import './texture-management/parameters.js';
import './texture-management/introspection.js';

import { installTextureLifecycleMethods, type TextureLifecycleMethods } from './texture-management/lifecycle.js';
import { installTexImage2DMethods, type TexImage2DMethods } from './texture-management/tex-image.js';
import {
    installCopyAndCompressedTextureMethods,
    type CopyAndCompressedTextureMethods,
} from './texture-management/copy-and-compressed.js';
import { installTextureParameterMethods, type TextureParameterMethods } from './texture-management/parameters.js';
import {
    installTextureIntrospectionMethods,
    type TextureIntrospectionMethods,
} from './texture-management/introspection.js';

export type { TextureLifecycleMethods } from './texture-management/lifecycle.js';
export type { TexImage2DMethods } from './texture-management/tex-image.js';
export type { CopyAndCompressedTextureMethods } from './texture-management/copy-and-compressed.js';
export type { TextureParameterMethods } from './texture-management/parameters.js';
export type { TextureIntrospectionMethods } from './texture-management/introspection.js';

/**
 * Aggregate `WebGLContextBase` augmentation contributed by every sibling
 * `texture-management/<group>.ts` module. Mirrors the per-group `declare
 * module` augmentations they already emit — kept as a single re-exported
 * interface so callers depending only on `TextureManagementMethods` keep
 * compiling.
 */
export interface TextureManagementMethods
    extends TextureLifecycleMethods,
        TexImage2DMethods,
        CopyAndCompressedTextureMethods,
        TextureParameterMethods,
        TextureIntrospectionMethods {}

/** Install every texture-management method group on the given prototype. Called from `context/index.ts`. */
export function installTextureManagementMethods(proto: object): void {
    installTextureLifecycleMethods(proto);
    installTexImage2DMethods(proto);
    installCopyAndCompressedTextureMethods(proto);
    installTextureParameterMethods(proto);
    installTextureIntrospectionMethods(proto);
}
