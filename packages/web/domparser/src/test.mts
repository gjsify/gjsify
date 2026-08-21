import { run } from '@gjsify/unit';

import htmlTokenizerTestSuite from './html-tokenizer.spec.js';
import domParserTestSuite from './index.spec.js';
import xmlShapeTestSuite from './xml-shape.spec.js';

run({ domParserTestSuite, xmlShapeTestSuite, htmlTokenizerTestSuite });
