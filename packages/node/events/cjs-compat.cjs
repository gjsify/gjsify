// CJS compatibility wrapper for npm packages that require('events')
// In Node.js CJS, require('events') returns the EventEmitter class directly.
// When esbuild bundles ESM @gjsify/events for CJS consumers, it returns a
// namespace object instead. This wrapper extracts the default export.
const mod = require('./lib/esm/index.js');
module.exports = mod.default || mod;
