// SPDX-License-Identifier: MIT
// @gjsify/node-gi/gettext — the GJS `Gettext` module on Node.
//
// GJS exposes a built-in `gettext` module (`import Gettext from 'gettext'` /
// `imports.gettext`) — a convenience layer over GLib's gettext family. This is the
// same layer with the same split of responsibilities as GJS's:
//   • LOOKUPS go to GLib (`g_dgettext` / `g_dngettext` / `g_dpgettext2`), which is
//     introspectable and therefore needs no native code here;
//   • the BINDERS (`setlocale` / `textdomain` / `bindtextdomain`) are libintl, which
//     has no GIR at all, so they come from the addon — the same reason GJS routes
//     them through GjsPrivate instead of `imports.gi.GLib`.
// Reference: refs/gjs/modules/core/_gettext.js, function for function.
//
// THIS MODULE USED TO BE A PASSTHROUGH — every lookup returned its msgid, every
// binder a no-op returning null. That is the right fallback when no catalog can be
// bound, and it was written when node-gi had no way to bind one; what made it a
// defect is that it stayed after the rest of the bridge could. It was also only
// HALF of what was wrong — the process locale (private.cc) had to be fixed too, or
// a real `bindtextdomain` would still have translated nothing.
//
// This is the single source of truth for the Gettext surface: the legacy
// `imports.gettext` exposed by `@gjsify/node-gi/globals` re-uses this module's
// default export. The gjsify `--app node` build aliases the bare `gettext`
// specifier to this module (kept external — `ALIASES_GJS_FOR_NODE`).
import * as native from './index.js';
import { requireGi } from './gi.js';

// GLib is resolved on first lookup, not at import: loading a namespace walks the
// typelib, and a module imported for its LocaleCategory alone should not pay for
// it. The addon itself is already loaded — `./index.js` above is what puts the
// process in the environment's locale, and that has to happen whether or not
// anything ever looks a string up.
let glib = null;
function GLib() {
    if (glib === null) glib = requireGi('GLib', '2.0');
    return glib;
}

// THE ADDON AND THIS JS CAN BE PAIRED ACROSS VERSIONS, so the binders are probed
// rather than assumed — the same reason `native-prebuilds.js` probes
// `prependLibraryPath`. `gtk-os-suites.yml`'s shipped-closure legs stage the
// PUBLISHED addon against THIS tree's JS deliberately ("the tarball a consumer
// actually receives"), and a bare `native.localeCategories()` died there with
// `TypeError: native.localeCategories is not a function` — taking the whole module
// down, and `globals.js` with it, because it is evaluated at import.
//
// Degrading means behaving exactly as an addon without the binders always did:
// lookups still work (they go through GLib, which every addon version has), and
// the binders are the no-ops they used to be. It is announced once, because a
// silently untranslated UI is the defect this file exists to close.
const haveLocaleBinders = typeof native.localeCategories === 'function';

let announcedStaleAddon = false;
function noLocaleBinders(fn) {
    if (!announcedStaleAddon) {
        announcedStaleAddon = true;
        process.emitWarning(
            `@gjsify/node-gi: the loaded native addon predates the gettext binders, so ` +
                `${fn}() cannot take effect and messages stay untranslated. Rebuild the addon ` +
                `(npm run rebuild) or update @gjsify/node-gi.`,
            'NodeGiStaleAddon',
        );
    }
    return null;
}

// The POSIX categories per C library, used ONLY when the addon cannot report its
// own. The addon is the source of truth precisely because these are C-library
// constants rather than a standard; this table exists so a stale pairing gets the
// right numbers for its platform instead of glibc's everywhere, which is the bug
// the module used to ship.
const FALLBACK_CATEGORIES = {
    // glibc
    linux: { CTYPE: 0, NUMERIC: 1, TIME: 2, COLLATE: 3, MONETARY: 4, MESSAGES: 5, ALL: 6 },
    // Darwin libc
    darwin: { ALL: 0, COLLATE: 1, CTYPE: 2, MONETARY: 3, NUMERIC: 4, TIME: 5, MESSAGES: 6 },
    // The MSVC CRT, which has no LC_MESSAGES — GNU gettext's <libintl.h> picks 1729.
    win32: { ALL: 0, COLLATE: 1, CTYPE: 2, MONETARY: 3, NUMERIC: 4, TIME: 5, MESSAGES: 1729 },
};

/** Look up `msgid` in the default domain (the one `textdomain()` last named). */
export function gettext(msgid) {
    return GLib().dgettext(null, msgid);
}

/** Look up `msgid` in `domain`. */
export function dgettext(domain, msgid) {
    return GLib().dgettext(domain, msgid);
}

/** Look up `msgid` in `domain` for `category`. */
export function dcgettext(domain, msgid, category) {
    return GLib().dcgettext(domain, msgid, category);
}

/** Plural lookup in the default domain. */
export function ngettext(msgid1, msgid2, n) {
    return GLib().dngettext(null, msgid1, msgid2, n);
}

/** Plural lookup in `domain`. */
export function dngettext(domain, msgid1, msgid2, n) {
    return GLib().dngettext(domain, msgid1, msgid2, n);
}

/** Context lookup in the default domain. */
export function pgettext(context, msgid) {
    return GLib().dpgettext2(null, context, msgid);
}

/** Context lookup in `domain`. */
export function dpgettext(domain, context, msgid) {
    return GLib().dpgettext2(domain, context, msgid);
}

/**
 * Create gettext bindings bound to a particular translation domain. Mirrors
 * GJS's `Gettext.domain()` — returns an object with `gettext`/`ngettext`/
 * `pgettext` bound to `domainName`.
 */
export function domain(domainName) {
    return {
        gettext(msgid) {
            return GLib().dgettext(domainName, msgid);
        },
        ngettext(msgid1, msgid2, n) {
            return GLib().dngettext(domainName, msgid1, msgid2, n);
        },
        pgettext(context, msgid) {
            return GLib().dpgettext2(domainName, context, msgid);
        },
    };
}

/**
 * Set the locale for `category`, or report it when `locale` is null.
 *
 * Thread-local, as GJS's is (`GjsPrivate.set_thread_locale` → `uselocale`), and it
 * inherits GJS's reporting quirk with it: a query answers with the name that was
 * in effect BEFORE the last successful set on this thread, because the report
 * comes from the global locale `uselocale` does not touch. Measured against
 * gjs 1.88 — setting LC_MESSAGES to "C" stops translation immediately while the
 * next query still answers the old name.
 *
 * @returns {string|null} the prior locale name, or null if it could not be set
 */
export function setlocale(category, locale) {
    if (!haveLocaleBinders) return noLocaleBinders('setlocale');
    return native.setThreadLocale(category, locale ?? null);
}

/** Set the default text domain, or report it when `domainName` is null. */
export function textdomain(domainName) {
    if (!haveLocaleBinders) return noLocaleBinders('textdomain');
    return native.textdomain(domainName ?? null);
}

/**
 * Bind a text domain to the directory its catalogs live in.
 *
 * The codeset is pinned to UTF-8 alongside the bind, exactly as
 * `gjs_bindtextdomain` does — see the note in private.cc.
 */
export function bindtextdomain(domainName, dirName) {
    if (!haveLocaleBinders) return noLocaleBinders('bindtextdomain');
    return native.bindtextdomain(domainName, dirName ?? null);
}

/**
 * Set the output codeset for a text domain.
 *
 * `bindtextdomain()` already pins UTF-8, which is what every string crossing this
 * bridge must be, so this stays a no-op returning null. It is the one member of
 * the surface GJS does not implement either — it is absent from
 * refs/gjs/modules/core/_gettext.js — and is kept for source that calls it.
 */
export function bindtextdomainCodeset(_domainName, _codeset) {
    return null;
}

/**
 * The `LocaleCategory` enum — the POSIX locale categories GJS surfaces via
 * `GjsPrivate.LocaleCategory`.
 *
 * Read from THIS platform's `<locale.h>` rather than written down: the numbers are
 * C-library constants, not a standard (LC_MESSAGES is 5 on glibc and 6 on darwin),
 * so the literal table this module used to carry addressed LC_TIME on macOS while
 * claiming to address LC_MESSAGES — on two of the three platforms the translation
 * blocker was reported from.
 */
export const LocaleCategory = haveLocaleBinders
    ? native.localeCategories()
    : (FALLBACK_CATEGORIES[process.platform] ?? FALLBACK_CATEGORIES.linux);

/**
 * The GJS `Gettext` module as a default export — the object shape
 * `import Gettext from 'gettext'` returns.
 */
const Gettext = {
    gettext,
    dgettext,
    dcgettext,
    ngettext,
    dngettext,
    pgettext,
    dpgettext,
    domain,
    setlocale,
    textdomain,
    bindtextdomain,
    bindtextdomainCodeset,
    LocaleCategory,
};

export default Gettext;
