// SPDX-License-Identifier: MIT
// Stage the node-gyp-built addon as a portable per-platform prebuild.
//
// The addon is Node-API (NAPI_VERSION 8), so its ABI is stable across Node, Bun
// and Deno and across their versions — ONE binary per <platform>-<arch> is enough,
// no prebuildify per-ABI matrix needed. index.js#nativeCandidates() loads this
// path before a local build/, so a published tarball that ships prebuilds/ needs
// no C toolchain on the consumer (the only install path Deno supports — it runs no
// postinstall build script).
//
// Run AFTER node-gyp has built build/Release/node_gi.node (the build:prebuild
// npm script chains them). Prints the staged path.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(pkgRoot, 'build', 'Release', 'node_gi.node');
const destDir = join(pkgRoot, 'prebuilds', `${process.platform}-${process.arch}`);
const dest = join(destDir, 'node_gi.node');

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`node-gi: staged prebuild -> prebuilds/${process.platform}-${process.arch}/node_gi.node`);
