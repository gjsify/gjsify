import { run } from '@gjsify/unit';

import bytesTestSuite from './bytes.spec.js';
import sqlScanTestSuite from './sql-scan.spec.js';
import driverTestSuite from './driver.spec.js';

run({ bytesTestSuite, sqlScanTestSuite, driverTestSuite });
