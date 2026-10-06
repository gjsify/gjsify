// Browser test entry. The specs are pure TS (relative imports only), so the same files run
// unchanged here; `dist/test.browser.mjs` is auto-discovered by the `tests/browser/` suite.
import { run } from '@gjsify/unit';
import gtksourceCoreTestSuite from './gtksource-core.spec.js';
import tokenizerTestSuite from './tokenizer.spec.js';
import xmlTestSuite from './xml.spec.js';

run({
    xmlTestSuite,
    gtksourceCoreTestSuite,
    tokenizerTestSuite,
});
