// Node-side test entry for @gjsify/cli.
// Built once via `gjsify build src/test.mts --app node --outfile dist/test.node.mjs`,
// run via `node dist/test.node.mjs`.

import { run } from '@gjsify/unit';
import bundlerPickSuite from './bundler-pick.spec.js';
import barrelsGenerateSuite from './barrels-generate.spec.js';

run({
    bundlerPickSuite,
    barrelsGenerateSuite,
});
