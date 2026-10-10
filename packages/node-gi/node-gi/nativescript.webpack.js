// SPDX-License-Identifier: MIT
// @nativescript/webpack plugin hook (it discovers this exact file name in every dependency
// and `require()`s it). Adds the `nativescript` export condition so package.json `imports`
// (`#host`) resolves to host.nativescript.js; webpack's `target('node')` would otherwise
// pick the Node host.
//
// This package is `"type": "module"`, so the file is ESM: the `module.exports` export name
// is what `require()` of an ES module hands back as the CommonJS export (Node >= 22.12).
function hook(webpack) {
    webpack.chainWebpack((config) => {
        // `...` keeps webpack's own defaults (import/require/node/default, per request kind).
        config.resolve.set('conditionNames', ['nativescript', '...']);
    });
}

export { hook as 'module.exports' };
