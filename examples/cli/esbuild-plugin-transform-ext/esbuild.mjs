// Run this with `node esbuild.mjs`

import esbuild from 'esbuild';
import { transformExtPlugin } from "@gjsify/esbuild-plugin-transform-ext";

await esbuild.build({
  plugins: [transformExtPlugin({ outExtension: {'.ts': '.js'}})],
  entryPoints: ["./src/index.ts"],
  outdir: "./dist/",
  bundle: false,
  format: "esm",
});
