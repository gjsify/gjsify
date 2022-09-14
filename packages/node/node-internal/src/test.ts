
import { run } from '@gjsify/unit';

import errorsTestSuite from './errors.spec.js';
import encodingHexTestSuite from './encoding/hex.spec.js';

run({ errorsTestSuite, encodingHexTestSuite });