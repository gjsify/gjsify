import { build } from "esbuild";
import alias from 'esbuild-plugin-alias';
import { createRequire } from 'module';
import { dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const require = createRequire(import.meta.url);

const aliases = {
    path: require.resolve('path-browserify/'),
    util: require.resolve('util/'), // https://github.com/browserify/node-util
    buffer: require.resolve('buffer/'), // https://www.npmjs.com/package/buffer
    assert: require.resolve('assert/'), // https://github.com/browserify/commonjs-assert
    constants: require.resolve('constants-browserify/'), // https://github.com/juliangruber/constants-browserify
    crypto: require.resolve('crypto-browserify/'),
    domain: require.resolve('domain-browser/'),
    events: require.resolve('events/'),
    url: require.resolve('url/'), // https://github.com/defunctzombie/node-url
    stream: require.resolve('stream-browserify/'),
    string_decoder: require.resolve('string_decoder/'), // https://github.com/nodejs/string_decoder
    querystring: require.resolve('querystring-es3/'),
    zlib: require.resolve('browserify-zlib/'),
    tty: require.resolve('tty-browserify/'),
    fs: require.resolve('@gjsify/fs/'), // https://github.com/gjsify/fs
    os: require.resolve('@gjsify/os/'), // https://github.com/gjsify/os
    process: require.resolve('@gjsify/process/'), // https://github.com/gjsify/os
}

console.debug("aliases", aliases);

await build({
    entryPoints: ['tmp/index.js'],
    outfile: 'dist/index.js',
    bundle: true,
    // banner: {
    //     js: `import '../packages/node/global/index.js';`
    // },
    inject: [
        require.resolve('@gjsify/globals/'),
    ],
    // target: "firefox60", // Since GJS 1.53.90
    // target: "firefox68", // Since GJS 1.63.90
    // target: "firefox78", // Since GJS 1.65.90
    target: "firefox91", // Since GJS 1.71.1
    format: 'esm',
    // platform: 'node',
    external: ['gi://*'],
    plugins: [
        alias(aliases),
    ],
})