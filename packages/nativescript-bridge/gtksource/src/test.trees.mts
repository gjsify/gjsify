// The tree entry, apart from `./test.mts` for the reason `@gjsify/adwaita-nativescript`'s own
// `test.trees.mts` gives: the specs here build the real `GtkSource.View`, which opens with a value
// import of `@nativescript/core`, so these bundles alias it onto that package's platform double
// and the pure specs in `./test.mts` keep building without it.

import { run } from '@gjsify/unit';

import { GtkSourceViewTreeNsTest } from './view-tree.spec.js';

run({ GtkSourceViewTreeNsTest });
