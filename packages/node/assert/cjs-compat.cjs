// CJS compatibility wrapper for npm packages that require('assert')
// In Node.js CJS, require('assert') returns the assert function directly.
// When esbuild bundles ESM @gjsify/assert for CJS consumers, it returns a
// namespace object instead. This wrapper extracts the default export.
const mod = require('./lib/esm/index.js');
module.exports = mod.default || mod;
