// @gjsify/adwaita-app — the GJS-ONLY test entry.
//
// `test.mts` beside it aggregates the pure-logic suites and is built for BOTH runtimes.
// This one cannot be: `icon-theme.spec.ts` imports `gi://Gtk`, which the `--app node`
// bundle has no answer for, and the suite's whole subject is what GTK's icon machinery
// resolves a name to. `about-dialog.spec.ts` joins it for the same reason — its subject is
// which properties land on a real `Adw.AboutDialog`, which only a GTK runtime can answer.
// Neither needs a DISPLAY though — see those files' headers — so both run wherever gjs and
// gtk4 are installed, CI included.
import { run } from '@gjsify/unit';

import aboutDialogSuite from './about-dialog.spec.js';
import appearanceReaderSuite from './appearance/reader.spec.js';
import iconThemeSuite from './icon-theme.spec.js';

run({ aboutDialogSuite, appearanceReaderSuite, iconThemeSuite });
