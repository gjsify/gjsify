import { run } from '@gjsify/unit';

import clientSuite from './client.spec.js';
import paginateSuite from './paginate.spec.js';

run({ clientSuite, paginateSuite });
