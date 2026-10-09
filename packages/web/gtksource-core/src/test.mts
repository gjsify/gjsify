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
import managerOracleTestSuite from './managers-vectors.gjs.spec.js';
import viewOracleTestSuite from './view-vectors.gjs.spec.js';
import initTestSuite from './init.spec.js';
import initOracleTestSuite from './init.gjs.spec.js';

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
    managerOracleTestSuite,
    viewOracleTestSuite,
    initTestSuite,
    initOracleTestSuite,
});
