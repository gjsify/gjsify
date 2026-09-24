// SPDX-License-Identifier: MIT
/** The platform-arch this package carries an OpenGL implementation for. */
export const target: 'win32-x64';
/** Absolute path to the payload directory (the DLLs, their licences and the notice). */
export const binDir: string;
/** Mesa's WGL front end — the file node-gi preloads. */
export const openGLPath: string;
/** Whether the payload is actually present (it is fetched on CI, not committed). */
export const isPresent: boolean;
declare const _default: { target: typeof target; binDir: string; openGLPath: string; isPresent: boolean };
export default _default;
