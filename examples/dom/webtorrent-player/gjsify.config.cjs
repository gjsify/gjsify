// Redirect random-access-file to its Node.js implementation.
// esbuild resolves `random-access-file` to browser.js (which throws) because
// our GJS build uses mainFields:['browser',...]. The Node.js index.js uses
// `require('fs')` which resolves to @gjsify/fs in the GJS bundle.
module.exports = {
  esbuild: {
    alias: {
      'random-access-file': require.resolve('random-access-file/index.js'),
    },
  },
};
