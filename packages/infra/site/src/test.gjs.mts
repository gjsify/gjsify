// Every suite, including the ones that need a real image backend (GdkPixbuf).
// Built `--app gjs` for the gjs leg and `--app node` for the opt-in
// `test:gi-node` leg, which runs the SAME file through `@gjsify/node-gi`.
import { run } from '@gjsify/unit';

import i18nSuite from './render/i18n.spec.js';
import imagesSuite from './render/images.gjs.spec.js';
import pagesSuite from './render/pages.spec.js';
import platformSuite from './client/platform.spec.js';
import siteDataSuite from './site-data/site-data.spec.js';

run({ siteDataSuite, pagesSuite, imagesSuite, platformSuite, i18nSuite });
