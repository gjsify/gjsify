# @gjsify/example-esbuild-plugin-transform-ext

This example demonstrates the usage of the esbuild plugin "@gjsify/example-esbuild-plugin-transform-ext".

input:
```ts
import { a } from './a.ts';
import { b } from './b.ts';
a();
b();
```

output:
```js
import { a } from "./a.js";
import { b } from "./b.js";
a();
b();
```