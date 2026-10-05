import { run } from '@gjsify/unit';
import gtksourceCoreTestSuite from './gtksource-core.spec.js';
import xmlTestSuite from './xml.spec.js';

run({
    xmlTestSuite,
    gtksourceCoreTestSuite,
});
