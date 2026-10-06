// `@gjsify/gtksource-nativescript/builder` — teaches `@gjsify/adwaita-nativescript`'s shared-tree
// builder the `GtkSource` library, so `using GtkSource 5; GtkSource.View { … }` in a `.blp`
// builds. Import it once for its effect, beside `@gjsify/adwaita-nativescript/builder`.
//
// A SUBPATH OF ITS OWN, not a line in `index.ts`: the builder reaches every widget through the
// namespace barrels and so needs `@nativescript/core` at module scope, which the package root
// must not drag in for an app that never builds a tree.

import { registerBarrel } from '@gjsify/adwaita-nativescript/builder';

import * as GtkSource from './namespace/gtksource.js';

registerBarrel('gtksource', 'GtkSource', GtkSource);
