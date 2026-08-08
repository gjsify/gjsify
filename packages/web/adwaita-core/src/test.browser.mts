// Browser test entry. The core specs are pure TS — they import only the
// package's own modules via relative paths (no platform imports, no DOM/Node
// globals) — so they run unchanged in the browser, unlike the Web-API packages
// whose specs exercise browser globals directly. We therefore reuse the same
// spec files here (the `@gjsify/storybook-core` precedent). The bundle at
// `dist/test.browser.mjs` is auto-discovered by the `tests/browser/`
// Playwright suite (`scripts/discover-bundles.mjs` scans `packages/web/*`).

import { run } from '@gjsify/unit';

import viewStackTestSuite from './view-stack.spec.js';
import navigationViewTestSuite from './navigation-view.spec.js';
import sidebarTestSuite from './sidebar.spec.js';
import entryRowTestSuite from './entry-row.spec.js';
import splitViewTestSuite from './split-view.spec.js';
import splitButtonTestSuite from './split-button.spec.js';
import avatarTestSuite from './avatar.spec.js';
import breakpointTestSuite from './breakpoint.spec.js';
import colorSchemeTestSuite from './color-scheme.spec.js';
import dialogTestSuite from './dialog.spec.js';
import rowsTestSuite from './rows.spec.js';
import toastTestSuite from './toast.spec.js';

run({
    breakpointTestSuite,
    colorSchemeTestSuite,
    toastTestSuite,
    dialogTestSuite,
    rowsTestSuite,
    avatarTestSuite,
    viewStackTestSuite,
    navigationViewTestSuite,
    sidebarTestSuite,
    entryRowTestSuite,
    splitViewTestSuite,
    splitButtonTestSuite,
});
