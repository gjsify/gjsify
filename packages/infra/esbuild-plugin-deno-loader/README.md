# @gjsify/esbuild-plugin-deno-loader

Deno module resolution for `esbuild` for Node.js.

This fork makes the plugin executable in Node.js, while the [original plugin](https://github.com/lucacasonato/esbuild_deno_loader) is used in Deno.

## Example

This example bundles an entrypoint into a single ESM output.

```js
import * as esbuild from "esbuild";
import { denoPlugin } from "@gjsify/esbuild-plugin-deno-loader";

await esbuild.build({
    plugins: [denoPlugin()],
    entryPoints: ["https://deno.land/std@0.150.0/hash/sha1.ts"],
    outfile: "./examples/dist/sha1.esm.js",
    bundle: true,
    format: "esm",
});
```

The output `sha1.esm.js` will look like this:
```js
// https://deno.land/std@0.150.0/hash/sha1.ts
var HEX_CHARS = "0123456789abcdef".split("");
var EXTRA = [-2147483648, 8388608, 32768, 128];
var SHIFT = [24, 16, 8, 0];
var blocks = [];
var Sha1 = class {
  #blocks;
  #block;
  #start;
  #bytes;
  #hBytes;
  #finalized;
...
```