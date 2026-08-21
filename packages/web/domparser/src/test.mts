import { run } from '@gjsify/unit';

import entitiesTestSuite from './entities.spec.js';
import htmlTestSuite from './html.spec.js';
import htmlTokenizerTestSuite from './html-tokenizer.spec.js';
import domParserTestSuite from './index.spec.js';
import selectorsTestSuite from './selectors.spec.js';
import selectorsDomTestSuite from './selectors-dom.spec.js';
import xmlShapeTestSuite from './xml-shape.spec.js';

run({
    domParserTestSuite,
    xmlShapeTestSuite,
    entitiesTestSuite,
    htmlTokenizerTestSuite,
    htmlTestSuite,
    selectorsTestSuite,
    selectorsDomTestSuite,
});
