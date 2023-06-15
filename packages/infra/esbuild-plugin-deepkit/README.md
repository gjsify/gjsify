# @gjsify/esbuild-plugin-deepkit

A [esbuild](https://esbuild.github.io/) plugin for the the compiler/transformer of [@deepkit/type](https://deepkit.io/library/type).

## Example

src/index.ts:
```ts
import { deserialize } from '@deepkit/type';

interface Config {
    color: string;
}

interface User {
    id: number;
    createdAt: Date;
    firstName?: string;
    lastName?: string;
    config: Config;
    username: string;
}

//deserialize JSON object to real instances
const user = deserialize<User>({
    id: 0,
    username: 'peter',
    createdAt: '2021-06-26T12:34:41.061Z',
    config: {color: '#221122'},
});


console.log(user.createdAt instanceof Date); // true
```

esbuild.mjs:
```js
import { build } from 'esbuild';
import { deepkitPlugin } from '@gjsify/esbuild-plugin-deepkit';

build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    minify: true,
    outfile: 'dist/index.js',
    format: 'esm',
    platform: "node",
    external: ['@deepkit/type'],
    plugins: [deepkitPlugin()],
});
```
Start:
```bash
node dist/index.js
-> true
```