// `node:fs/promises` surface of the bridge. Own subpath because bundlers alias `fs` by prefix,
// so `fs/promises` otherwise resolves to `<bridge>/promises`.
import { readFile, writeFile, readdir, stat, mkdir, unlink, exists, promises } from './index.js';

export { readFile, writeFile, readdir, stat, mkdir, unlink, exists };

export default promises;
