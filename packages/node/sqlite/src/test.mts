import { run } from '@gjsify/unit';

import testSuiteDatabaseSync from './database-sync.spec.js';
import testSuiteStatementSync from './statement-sync.spec.js';
import testSuiteDataTypes from './data-types.spec.js';
import testSuiteParamBinding from './param-binding.spec.js';

run({ testSuiteDatabaseSync, testSuiteStatementSync, testSuiteDataTypes, testSuiteParamBinding });
