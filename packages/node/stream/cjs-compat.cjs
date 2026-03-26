// CJS compatibility wrapper for npm packages that require('stream')
// In Node.js CJS, require('stream') returns the Stream constructor directly.
// When esbuild bundles ESM @gjsify/stream for CJS consumers, it returns a
// namespace object instead. This wrapper extracts the default export (the
// Stream class with all properties like Readable, Writable, etc. attached).
const mod = require('./lib/esm/index.js');
module.exports = mod.default || mod;
