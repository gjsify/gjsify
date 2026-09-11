import { run } from '@gjsify/unit';

import guardsSuite from './guards.spec.js';
import utilsSuite from './utils.spec.js';
import xgettextSuite from './xgettext.spec.js';
import linguasSuite from './linguas.spec.js';
import catalogNamesSuite from './catalog-names.spec.js';
import gettextSuite from './gettext.spec.js';

run({ guardsSuite, utilsSuite, xgettextSuite, linguasSuite, catalogNamesSuite, gettextSuite });
