// @gjsify/adwaita-app — the GJS-ONLY test entry.
//
// `test.mts` beside it aggregates the pure-logic suites and is built for BOTH runtimes.
// This one cannot be: `icon-theme.spec.ts` imports `gi://Gtk`, which the `--app node`
// bundle has no answer for, and the suite's whole subject is what GTK's icon machinery
// resolves a name to. It needs no DISPLAY though — see that file's header — so it runs
// wherever gjs and gtk4 are installed, CI included.
import { run } from '@gjsify/unit';

import iconThemeSuite from './icon-theme.spec.js';

run({ iconThemeSuite });
