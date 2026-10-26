// The GI-free suites. Runs on every runtime without the reverse bridge; the
// image suites need GdkPixbuf and live in `test.gjs.mts`.
import { run } from '@gjsify/unit';

import blogSuite from './render/blog.spec.js';
import colorSuite from './render/color.spec.js';
import developerSuite from './render/developer.spec.js';
import contentSuite from './site-data/content.spec.js';
import feedSuite from './render/feed.spec.js';
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
    i18nSuite,
    markdownSuite,
    contentSuite,
    feedSuite,
    blogSuite,
    developerSuite,
});
