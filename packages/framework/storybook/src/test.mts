import { run } from '@gjsify/unit';

import discoverSuite from './discover.spec.js';
import registrySuite from './registry.spec.js';
import storyWidgetSuite from './story-widget.gjs.spec.js';

run({
    discoverSuite,
    registrySuite,
    storyWidgetSuite,
});
