import { run } from '@gjsify/unit';

import testSuiteConnectionLifetime from './connection-lifetime.gjs.spec.js';
import testSuiteDatabaseSync from './database-sync.spec.js';
import testSuiteErrors from './errors.spec.js';
import testSuiteStatementSync from './statement-sync.spec.js';
import testSuiteDataTypes from './data-types.spec.js';
import testSuiteParamBinding from './param-binding.spec.js';
import testSuiteSubquery from './subquery.spec.js';
import testSuiteStatementCache from './statement-cache.spec.js';
import testSuiteCte from './cte.spec.js';
import testSuiteIterate from './iterate.spec.js';

run({
    testSuiteConnectionLifetime,
    testSuiteDatabaseSync,
    testSuiteErrors,
    testSuiteStatementSync,
    testSuiteDataTypes,
    testSuiteParamBinding,
    testSuiteSubquery,
    testSuiteStatementCache,
    testSuiteCte,
    testSuiteIterate,
});
