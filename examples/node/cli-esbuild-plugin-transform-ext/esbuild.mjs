// Run this with `node esbuild.mjs`

import esbuild from 'esbuild';
import { transformExtPlugin } from "@gjsify/esbuild-plugin-transform-ext";

await esbuild.build({
  plugins: [transformExtPlugin({ outExtension: {'.ts': '.js'}})],
  // Keep modules unbundled and emit all source files to dist.
  entryPoints: ["./src/index.ts", "./src/a.ts", "./src/b.ts"],
  outdir: "./dist/",
  bundle: false,
  format: "esm",
});
