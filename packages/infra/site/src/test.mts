// The GI-free suites. Runs on every runtime without the reverse bridge; the
// image suites need GdkPixbuf and live in `test.gjs.mts`.
import { run } from '@gjsify/unit';

import i18nSuite from './render/i18n.spec.js';
import pagesSuite from './render/pages.spec.js';
import platformSuite from './client/platform.spec.js';
import siteDataSuite from './site-data/site-data.spec.js';

run({ siteDataSuite, pagesSuite, platformSuite, i18nSuite });
