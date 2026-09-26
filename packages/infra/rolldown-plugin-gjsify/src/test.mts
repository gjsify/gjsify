import { run } from '@gjsify/unit';

import rnRouteManifestSuite from './plugins/rn-route-manifest.spec.js';
import zipPathSuite from './utils/zip-path.spec.js';

run({ rnRouteManifestSuite, zipPathSuite });
