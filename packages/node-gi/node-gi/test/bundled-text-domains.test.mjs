// SPDX-License-Identifier: MIT
// The windowing bundle's own catalogs survive GTK's and libadwaita's init — see
// `armBundledTextDomains` in gi.js.
//
// gtk_init and adw_init bind their domains to a directory compiled into the build host,
// so a binding made before `startup` is undone. Measured in a shipped macOS app under a
// sandbox denying /opt/homebrew: GTK's strings stayed English under a German locale.
// This asserts the binding AFTER `register()` emitted `startup`, i.e. the one the
// widgets will translate with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';
import { bindtextdomain } from '../gettext.js';
import { bundledLocaleDir } from '../gtk-runtime.js';

const dir = bundledLocaleDir();

test(
    'GTK and libadwaita domains point into the bundle after startup',
    { skip: dir === undefined && 'no windowing bundle with share/locale is active in this process' },
    () => {
        const Gio = requireGi('Gio', '2.0');
        const Adw = requireGi('Adw', '1');
        const app = new Adw.Application({
            application_id: 'org.gjsify.NodeGiTextDomains',
            flags: Gio.ApplicationFlags.NON_UNIQUE,
        });
        app.register(null);
        for (const domain of ['gtk40', 'libadwaita', 'glib20']) {
            assert.equal(bindtextdomain(domain, null), dir, `${domain} still bound to the build host`);
        }
    },
);
