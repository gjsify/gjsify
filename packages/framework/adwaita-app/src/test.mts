// @gjsify/adwaita-app — test entry. Aggregates the pure-logic suites that run on
// both GJS and Node. The GTK widget modules (application/nav-shell/dialogs/
// toast/file-dialog) are type-checked + built but need a display to exercise.

import { run } from '@gjsify/unit';

import devHooksSuite from './dev-hooks.spec.js';
import navModelSuite from './nav-model.spec.js';
import viewLoaderSuite from './view-loader.spec.js';

run({
    devHooksSuite,
    navModelSuite,
    viewLoaderSuite,
});
