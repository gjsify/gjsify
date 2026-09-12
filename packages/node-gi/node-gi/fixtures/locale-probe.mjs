// SPDX-License-Identifier: MIT
// Child-process probe for the locale tests: report what a FRESH node-gi process
// sees, as JSON on stdout.
//
// It has to be a child. `setlocale` is process-global and the addon adopts the
// environment locale once, at load — so a test that flipped env vars in-process
// would be measuring a locale some earlier test already set. Each case gets its
// own process, its own environment, and one observation.
//
// Usage: node locale-probe.mjs <localeDir> <domain> <msgid>
import Gettext from '../gettext.js';
import { requireGi } from '../gi.js';

const [localeDir, domain, msgid] = process.argv.slice(2);
const GLib = requireGi('GLib', '2.0');

// Read the locale BEFORE anything here can change it: this is the value the addon
// left the process in, which is the whole question.
const startupMessages = Gettext.setlocale(Gettext.LocaleCategory.MESSAGES, null);
const startupAll = Gettext.setlocale(Gettext.LocaleCategory.ALL, null);

Gettext.bindtextdomain(domain, localeDir);
Gettext.textdomain(domain);

// Discriminator for the category constants: with LC_MESSAGES forced back to C the
// lookups below must return their msgids again. If they still translate, the
// constant handed to setlocale addressed some OTHER category.
if (process.env.NODE_GI_TEST_MESSAGES_C === '1') {
    Gettext.setlocale(Gettext.LocaleCategory.MESSAGES, 'C');
}

process.stdout.write(
    JSON.stringify({
        startupMessages,
        startupAll,
        languageNames: GLib.get_language_names(),
        // The C function, reached through introspection — the path that has nothing
        // to do with the JS shim, so a green here means the PROCESS is translating.
        glibDgettext: GLib.dgettext(domain, msgid),
        // The GJS-facing surface, each spelling an app actually uses.
        gettext: Gettext.gettext(msgid),
        dgettext: Gettext.dgettext(domain, msgid),
        domainGettext: Gettext.domain(domain).gettext(msgid),
        ngettextOne: Gettext.ngettext('%d file', '%d files', 1),
        ngettextMany: Gettext.ngettext('%d file', '%d files', 4),
        pgettext: Gettext.pgettext('toolbar', 'Open'),
        // Same msgid, no context: proves the context key is honoured rather than
        // the plain entry being returned for both.
        gettextOpen: Gettext.gettext('Open'),
    }),
);
