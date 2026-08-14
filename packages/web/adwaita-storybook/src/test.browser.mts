// Browser test entry for @gjsify/adwaita-storybook. Discovered and run by the
// tests/browser Playwright harness (see AGENTS.md → Browser tests), which drives
// Firefox in CI.
//
// This package had no test entry at all until the preview stopped scrolling — its
// output is layout, and layout is the one thing a state-and-class-names assertion
// cannot see.
import { run } from '@gjsify/unit';

import { AdwStorybookPreviewScrollTest } from './preview-scroll.spec.js';

run({ AdwStorybookPreviewScrollTest });
