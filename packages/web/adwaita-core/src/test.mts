import { run } from '@gjsify/unit';

import breakpointTestSuite from './breakpoint.spec.js';
import colorSchemeTestSuite from './color-scheme.spec.js';
import dialogTestSuite from './dialog.spec.js';
import rowsTestSuite from './rows.spec.js';
import toastTestSuite from './toast.spec.js';

run({ breakpointTestSuite, colorSchemeTestSuite, toastTestSuite, dialogTestSuite, rowsTestSuite });
