import type { WebGLContextBase } from '../webgl-context-base.js';

/**
 * Each WebGL extension exposes its own heterogeneous surface (GL enum constants
 * plus extension-specific methods). The factory returns a concrete extension
 * class instance whose exact shape varies per extension; consumers narrow with
 * `instanceof` when they need a specific extension's API.
 */
export type ExtensionInstance = object;

export type ExtensionFactory = (context: WebGLContextBase) => ExtensionInstance | null;
