// SPDX-License-Identifier: MIT
// @gjsify/node-gi/gettext — the GJS `Gettext` module on Node.
//
// GJS exposes a built-in `gettext` module (`import Gettext from 'gettext'` /
// `imports.gettext`) — a convenience layer over GLib's gettext family. On Node
// we provide a no-translation passthrough: every lookup returns the untranslated
// msgid, which is exactly the correct fallback when no message catalog is bound
// (GLib's gettext degrades to the same passthrough with no catalog). This keeps
// GJS source that calls `Gettext.gettext(...)` at module load working unchanged
// on Node without pulling in a real gettext binding.
//
// This is the single source of truth for the Gettext surface: the legacy
// `imports.gettext` exposed by `@gjsify/node-gi/globals` re-uses this module's
// default export. The gjsify `--app node` build aliases the bare `gettext`
// specifier to this module (kept external — `ALIASES_GJS_FOR_NODE`).
//
// Reference: GJS's `gettext` module (refs/gjs/modules/esm/gettext.js +
// modules/core/_gettext.js). Signatures mirror that surface.

/** Look up `msgid` in the default domain. Passthrough — returns `msgid`. */
export function gettext(msgid) {
    return msgid;
}

/** Look up `msgid` in `domain`. Passthrough — returns `msgid`. */
export function dgettext(_domain, msgid) {
    return msgid;
}

/** Look up `msgid` in `domain`/`category`. Passthrough — returns `msgid`. */
export function dcgettext(_domain, msgid, _category) {
    return msgid;
}

/** Plural lookup in the default domain. Passthrough — singular for n===1, else plural. */
export function ngettext(msgid1, msgid2, n) {
    return n === 1 ? msgid1 : msgid2;
}

/** Plural lookup in `domain`. Passthrough — singular for n===1, else plural. */
export function dngettext(_domain, msgid1, msgid2, n) {
    return n === 1 ? msgid1 : msgid2;
}

/** Context lookup in the default domain. Passthrough — returns `msgid`. */
export function pgettext(_context, msgid) {
    return msgid;
}

/** Context lookup in `domain`. Passthrough — returns `msgid`. */
export function dpgettext(_domain, _context, msgid) {
    return msgid;
}

/**
 * Create gettext bindings bound to a particular translation domain. Mirrors
 * GJS's `Gettext.domain()` — returns an object with `gettext`/`ngettext`/
 * `pgettext` bound to `domainName` (passthrough here).
 */
export function domain(_domainName) {
    return {
        gettext(msgid) {
            return msgid;
        },
        ngettext(msgid1, msgid2, n) {
            return n === 1 ? msgid1 : msgid2;
        },
        pgettext(_context, msgid) {
            return msgid;
        },
    };
}

/** Set the locale for `category`. No-op on Node — returns null. */
export function setlocale(_category, _locale) {
    return null;
}

/** Set the default text domain. No-op on Node — returns null. */
export function textdomain(_domainName) {
    return null;
}

/** Bind a text domain to a directory. No-op on Node — returns null. */
export function bindtextdomain(_domainName, _dirName) {
    return null;
}

/** Set the output codeset for a text domain. No-op on Node — returns null. */
export function bindtextdomainCodeset(_domainName, _codeset) {
    return null;
}

/**
 * The `LocaleCategory` enum — the standard POSIX locale category constants GJS
 * surfaces via `GjsPrivate.LocaleCategory`.
 */
export const LocaleCategory = {
    CTYPE: 0,
    NUMERIC: 1,
    TIME: 2,
    COLLATE: 3,
    MONETARY: 4,
    MESSAGES: 5,
    ALL: 6,
};

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
