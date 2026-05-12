// Minimal ESM fixture for the self-host loop.
//
// The GJS-CLI bundles this with --app gjs; the resulting bundle must
// print '7' under `gjs -m` (constant-folded, no `imports.gi` references).
const sum = 1 + 2 + 4;
console.log(sum);
