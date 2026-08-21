import { run } from '@gjsify/unit';

import htmlTokenizerTestSuite from './html-tokenizer.spec.js';
import domParserTestSuite from './index.spec.js';

run({ domParserTestSuite, htmlTokenizerTestSuite });
