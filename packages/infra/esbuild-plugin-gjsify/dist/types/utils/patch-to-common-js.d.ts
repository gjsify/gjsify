import type { PluginBuild } from 'esbuild';
/**
 * Fix CJS-ESM interop: esbuild's __toCommonJS wraps ESM modules in a
 * namespace object { __esModule, default, ...namedExports }. CJS code that
 * does `var fn = require('esm-pkg')` gets the namespace instead of the
 * default export. This breaks npm packages like is-promise, depd, etc.
 * that export a single default function consumed by CJS require().
 *
 * The patch makes __toCommonJS return the default export directly when
 * the module has no named exports (only __esModule + default).
 */
export declare function registerToCommonJSPatch(build: PluginBuild): void;
