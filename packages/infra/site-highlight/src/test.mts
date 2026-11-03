// The Node leg. This package reaches no typelib, so the suite is the whole suite — the gjs leg
// (`test.gjs.mts`) runs the same one, and if this file ever had to split the reason would be a
// GI-only test, which does not belong in a highlighter.
import { run } from '@gjsify/unit';

import highlightSuite from './highlight.spec.js';

run({ highlightSuite });
