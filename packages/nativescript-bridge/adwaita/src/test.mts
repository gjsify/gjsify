import { run } from '@gjsify/unit';

import adwaitaNativescriptTestSuite from './index.spec.js';
import svgPathTestSuite from './svg-path.spec.js';
import viewStackNsTestSuite from './view-stack.spec.js';
import navigationViewNsTestSuite from './navigation-view.spec.js';
import { AdwSidebarNsTest } from './sidebar.spec.js';
import { AdwEntryRowsNsTest } from './entry-rows.spec.js';
import { AdwSplitButtonNsTest } from './split-button.spec.js';

run({
    adwaitaNativescriptTestSuite,
    svgPathTestSuite,
    viewStackNsTestSuite,
    navigationViewNsTestSuite,
    AdwSidebarNsTest,
    AdwEntryRowsNsTest,
    AdwSplitButtonNsTest,
});
