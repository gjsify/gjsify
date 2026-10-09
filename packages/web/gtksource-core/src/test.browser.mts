// Browser test entry. The specs are pure TS (relative imports only), so the same files run
// unchanged here; `dist/test.browser.mjs` is auto-discovered by the `tests/browser/` suite.
import { run } from '@gjsify/unit';
import gtksourceCoreTestSuite from './gtksource-core.spec.js';
import tokenizerTestSuite from './tokenizer.spec.js';
import xmlTestSuite from './xml.spec.js';
import bufferTestSuite from './buffer.spec.js';
import highlighterTestSuite from './highlighter.spec.js';
import managersTestSuite from './managers.spec.js';
import sessionTestSuite from './editor-session.spec.js';
import gutterTestSuite from './gutter.spec.js';
import managerVectorsTestSuite from './managers-vectors.spec.js';
import bufferVectorsTestSuite from './buffer-vectors.spec.js';
import initTestSuite from './init.spec.js';
import stopVectorsTestSuite from './signal-stop-vectors.spec.js';

run({
    xmlTestSuite,
    gtksourceCoreTestSuite,
    tokenizerTestSuite,
    bufferTestSuite,
    highlighterTestSuite,
    managersTestSuite,
    sessionTestSuite,
    gutterTestSuite,
    managerVectorsTestSuite,
    bufferVectorsTestSuite,
    initTestSuite,
    stopVectorsTestSuite,
});
