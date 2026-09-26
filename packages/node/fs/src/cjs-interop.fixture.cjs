// CJS fixture bundled into the fs test suite to guard `require('fs')` interop.
// graceful-fs (under fs-extra, web-ext, …) takes `require('fs')` and patches it in
// place. Under `--app gjs` the bundler hands a CJS `require('fs')` the ESM namespace
// unless `@gjsify/fs` exports a `"module.exports"` object, and assigning to a
// namespace property throws `setting getter-only property "close"` — at LOAD, so
// merely importing this fixture from the bundled spec is the regression guard.
// oxlint-disable unicorn/prefer-node-protocol -- intentional: graceful-fs requires the
// builtin by BARE name, which is the path under test.
const fs = require('fs');

const original = fs.close;
function patchedClose(fd, cb) {
    return original.call(fs, fd, cb);
}
fs.close = patchedClose;
const patched = fs.close === patchedClose;
fs.close = original;

module.exports = { patched, restored: fs.close === original, hasReadFile: typeof fs.readFileSync === 'function' };
