// CJS fixture bundled into the assert test suite to guard the `require('assert')`
// interop. A real npm dependency does exactly this — `@babel/helper-module-imports`
// is the measured one: `const assert = require("assert")` at module scope, then
// `assert(typeof importName === "string")` on the path of every Babel plugin that
// injects an import.
//
// Under `--app gjs` the bundler resolves `require('assert')` to `@gjsify/assert`
// and wraps it with the `__toCommonJS` helper. Without the `"module.exports"`
// string-export in `@gjsify/assert` that yields the ESM NAMESPACE OBJECT instead of
// the callable, and the first call throws `_assert is not a function` — which is how
// `babel-preset-solid` became uncompilable by a GJS-hosted bundler.
//
// oxlint-disable unicorn/prefer-node-protocol -- intentional: this fixture reproduces how
// real npm CJS deps require builtins by BARE name (`require('assert')`, not
// `require('node:assert')`) — the exact path the fix guards.
const assert = require('assert');
const strict = require('assert/strict');

// Calling at module scope makes merely IMPORTING this fixture the regression guard:
// on a regressed build the module aborts at load instead of failing an assertion
// later, and a bundle that cannot load is not a test that quietly passes.
assert(true);
assert.strictEqual(1, 1);
strict(true);
strict.strictEqual(1, 1);

module.exports = { assert, strict };
