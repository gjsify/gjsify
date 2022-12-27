# @gjsify/esbuild-plugin-transform-ext

Transform import file extensions plugin for `esbuild`.
This can be useful if you want to bundle a module for Deno and Node.js. 

## Example

This example transforms the typescript entrypoint with `.ts` imports into a javascript file with `.js` imports.

index:ts:
```ts
import { a } from './a.ts';
import { b } from './b.ts';
a();
b();
```

esbuild.mjs:
```js
import esbuild from 'esbuild';
import { transformExtPlugin } from "@gjsify/esbuild-plugin-transform-ext";

await esbuild.build({
  plugins: [transformExtPlugin({ outExtension: {'.ts': '.js'}})],
  entryPoints: ["./src/index.ts"],
  outdir: "./dist/",
  bundle: false,
  format: "esm",
});
```

output index:js:
```ts
import { a } from './a.js';
import { b } from './b.js';
a();
b();
```