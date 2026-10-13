import { run } from '@gjsify/unit';

import i18nSuite from './build/i18n.spec.js';
import imagesSuite from './build/images.spec.js';
import pagesSuite from './build/pages.spec.js';
import platformSuite from './client/platform.spec.js';
import siteDataSuite from './site-data/site-data.spec.js';

run({ siteDataSuite, pagesSuite, imagesSuite, platformSuite, i18nSuite });
