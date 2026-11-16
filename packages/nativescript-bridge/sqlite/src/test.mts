import { run } from '@gjsify/unit';

import sqlScanTestSuite from './sql-scan.spec.js';
import driverTestSuite from './driver.spec.js';

run({ sqlScanTestSuite, driverTestSuite });
