import { rollup } from 'rollup';
import commonjs from '@rollup/plugin-commonjs';
import esbuild from 'rollup-plugin-esbuild';
import { nodeResolve } from '@rollup/plugin-node-resolve'; // https://github.com/rollup/plugins/tree/master/packages/node-resolve
import { EXTERNALS_NODE } from '@gjsify/resolve-npm';

const inputConfig = {
  input: 'src/index.ts',
  // external: [...EXTERNALS_NODE],
  plugins: [
    esbuild(),
    nodeResolve({
      // Do not bundle node.js internal modules like events, buffer, stream, ...
      preferBuiltins: true
    }),
    commonjs(),
  ]
};

const outputConfigs = {
  esm: {
    file: 'lib/stream.mjs',
    format: 'esm',
    exports: 'auto',
		preferConst: true,
		// preserveModules: true,
    plugins: [

    ]
  },
  cjs: {
    file: 'lib/stream.cjs',
    format: 'cjs',
    exports: 'auto',
		preferConst: true,
		// preserveModules: true,
    plugins: [

    ]
  }
}
const bundle = await rollup(inputConfig);

await bundle.write(outputConfigs.esm);
await bundle.write(outputConfigs.cjs);


// console.log("cjsOutput", cjsOutputs);


// for (const esmOutput of esmOutputs) {
//   console.log("esmOutput", esmOutput);
// }
