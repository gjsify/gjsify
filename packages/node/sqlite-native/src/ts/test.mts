import { run } from '@gjsify/unit';

import sqliteSuite from './sqlite.gjs.spec.js';

await run({ sqliteSuite });
