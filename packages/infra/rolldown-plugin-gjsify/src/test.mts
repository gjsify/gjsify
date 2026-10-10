import { run } from '@gjsify/unit';

import addonResolveSuite from './shims/addon-resolve.spec.js';
import nativescriptExternalSuite from './app/nativescript-external.spec.js';
import rnRouteManifestSuite from './plugins/rn-route-manifest.spec.js';
import cssAsStringSuite from './plugins/css-as-string.spec.js';
import giOptionalSuite from './plugins/gi-optional.spec.js';
import implicitGlobalAssignSuite from './plugins/implicit-global-assign.spec.js';
import entryWrapperSuite from './utils/entry-wrapper.spec.js';
import zipPathSuite from './utils/zip-path.spec.js';
import autoGlobalsSuite from './utils/auto-globals.spec.js';

run({
    addonResolveSuite,
    autoGlobalsSuite,
    cssAsStringSuite,
    entryWrapperSuite,
    giOptionalSuite,
    implicitGlobalAssignSuite,
    nativescriptExternalSuite,
    rnRouteManifestSuite,
    zipPathSuite,
});
