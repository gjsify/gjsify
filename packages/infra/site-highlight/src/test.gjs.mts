// The GJS leg, and the one that matters: the JavaScript regex engine has to produce the same HTML
// on SpiderMonkey as on V8, because a site built here may be built on either.
import { run } from '@gjsify/unit';

import highlightSuite from './highlight.spec.js';

run({ highlightSuite });
