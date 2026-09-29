import { run } from '@gjsify/unit';

import addonResolveSuite from './shims/addon-resolve.spec.js';
import rnRouteManifestSuite from './plugins/rn-route-manifest.spec.js';
import cssAsStringSuite from './plugins/css-as-string.spec.js';
import zipPathSuite from './utils/zip-path.spec.js';

run({ addonResolveSuite, cssAsStringSuite, rnRouteManifestSuite, zipPathSuite });
