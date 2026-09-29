// SPDX-License-Identifier: MIT
// @gjsify/gl-runtime-win32-x64 — where the optional OpenGL implementation is.
//
// A path helper and nothing else. @gjsify/node-gi resolves this package BY NAME (it never
// depends on it — ADR 0023) and preloads `openGLPath` only on a host with no OpenGL driver;
// see activateBundledOpenGL in node-gi's gtk-runtime.js.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The platform-arch this package carries an OpenGL implementation for. */
export const target = 'win32-x64';

/** Absolute path to the payload directory (the DLLs, their licences and the notice). */
export const binDir = join(here, 'bin');

/** Mesa's WGL front end — the file node-gi preloads; `libgallium_wgl.dll` sits beside it. */
export const openGLPath = join(binDir, 'opengl32.dll');

/** Whether the payload is actually present (it is fetched on CI, not committed). */
export const isPresent = existsSync(openGLPath) && existsSync(join(binDir, 'libgallium_wgl.dll'));

export default { target, binDir, openGLPath, isPresent };
