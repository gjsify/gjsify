// The GI-free suites. Runs on every runtime without the reverse bridge; the
// image suites need GdkPixbuf and live in `test.gjs.mts`.
import { run } from '@gjsify/unit';

import blogSuite from './render/blog.spec.js';
import colorSuite from './render/color.spec.js';
import developerSuite from './render/developer.spec.js';
import extensionPageSuite from './render/extension.spec.js';
import extensionSuite from './site-data/extension.spec.js';
import contentSuite from './site-data/content.spec.js';
import feedSuite from './render/feed.spec.js';
import listingSuite from './listing/listing.spec.js';
import iconsSuite from './render/icons.spec.js';
import i18nSuite from './render/i18n.spec.js';
import markdownSuite from './render/markdown.spec.js';
import pagesSuite from './render/pages.spec.js';
import platformSuite from './client/platform.spec.js';
import seoSuite from './render/seo.spec.js';
import siteDataSuite from './site-data/site-data.spec.js';

run({
    seoSuite,
    siteDataSuite,
    pagesSuite,
    colorSuite,
    platformSuite,
    iconsSuite,
    i18nSuite,
    listingSuite,
    markdownSuite,
    contentSuite,
    feedSuite,
    blogSuite,
    developerSuite,
    extensionSuite,
    extensionPageSuite,
});
