import { readFileSync, writeFileSync } from 'fs';
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
export function registerToCommonJSPatch(build: PluginBuild): void {
    build.onEnd((result) => {
        if (result.errors.length > 0) return;

        const outfile = build.initialOptions.outfile;
        if (!outfile) return;

        try {
            let content = readFileSync(outfile, 'utf-8');

            const toCommonJSPattern =
                /var __toCommonJS = \(mod\d?\) => __copyProps\(__defProp\(\{\}, "__esModule", \{ value: true \}\), mod\d?\);/;

            if (toCommonJSPattern.test(content)) {
                content = content.replace(toCommonJSPattern,
                    `var __toCommonJS = (mod) => {
  var ns = __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  if (typeof ns.default !== "undefined") {
    var keys = Object.keys(ns);
    if (keys.length === 1 || (keys.length === 2 && keys.includes("__esModule"))) return ns.default;
  }
  return ns;
};`
                );
                writeFileSync(outfile, content);
            }
        } catch {
            // Non-critical: if patching fails, CJS-ESM interop issues may
            // surface at runtime but the build itself is not broken.
        }
    });
}
