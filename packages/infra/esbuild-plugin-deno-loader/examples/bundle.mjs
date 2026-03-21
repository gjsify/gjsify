import * as esbuild from "esbuild";
import { denoPlugin } from "../dist/esm/mod.mjs"; // "@gjsify/esbuild-plugin-deno-loader";

await esbuild.build({
    plugins: [denoPlugin()],
    entryPoints: ["https://deno.land/std@0.150.0/hash/sha1.ts"],
    outfile: "./examples/dist/sha1.esm.js",
    bundle: true,
    format: "esm",
});
