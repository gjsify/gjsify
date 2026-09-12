// SPDX-License-Identifier: MIT
// @gjsify/node-gi/gettext — types for the GJS `Gettext` module on Node.

/** Look up `msgid` in the default domain. */
export function gettext(msgid: string): string;
/** Look up `msgid` in `domain`. */
export function dgettext(domain: string | null, msgid: string): string;
/** Look up `msgid` in `domain`/`category`. */
export function dcgettext(domain: string | null, msgid: string, category: number): string;
/** Plural lookup in the default domain. */
export function ngettext(msgid1: string, msgid2: string, n: number): string;
/** Plural lookup in `domain`. */
export function dngettext(domain: string | null, msgid1: string, msgid2: string, n: number): string;
/** Context lookup in the default domain. */
export function pgettext(context: string, msgid: string): string;
/** Context lookup in `domain`. */
export function dpgettext(domain: string | null, context: string, msgid: string): string;
/** Domain-bound gettext bindings. */
export function domain(domainName: string): {
    gettext(msgid: string): string;
    ngettext(msgid1: string, msgid2: string, n: number): string;
    pgettext(context: string, msgid: string): string;
};
/** Set the locale for `category`, or report it when `locale` is null. */
export function setlocale(category: number, locale: string | null): string | null;
/** Set the default text domain, or report it when `domainName` is null. */
export function textdomain(domainName: string | null): string | null;
/** Bind a text domain to the directory its catalogs live in; pins UTF-8. */
export function bindtextdomain(domainName: string, dirName: string | null): string | null;
/** Set the output codeset for a text domain. No-op — `bindtextdomain` pins UTF-8. */
export function bindtextdomainCodeset(domainName: string, codeset: string | null): null;
/** The POSIX locale categories, read from the host C library's own <locale.h>. */
export const LocaleCategory: {
    CTYPE: number;
    NUMERIC: number;
    TIME: number;
    COLLATE: number;
    MONETARY: number;
    MESSAGES: number;
    ALL: number;
};

/** The GJS `Gettext` module object (`import Gettext from 'gettext'`). */
export interface GettextModule {
    gettext(msgid: string): string;
    dgettext(domain: string | null, msgid: string): string;
    dcgettext(domain: string | null, msgid: string, category: number): string;
    ngettext(msgid1: string, msgid2: string, n: number): string;
    dngettext(domain: string | null, msgid1: string, msgid2: string, n: number): string;
    pgettext(context: string, msgid: string): string;
    dpgettext(domain: string | null, context: string, msgid: string): string;
    domain(domainName: string): {
        gettext(msgid: string): string;
        ngettext(msgid1: string, msgid2: string, n: number): string;
        pgettext(context: string, msgid: string): string;
    };
    setlocale(category: number, locale: string | null): string | null;
    textdomain(domainName: string | null): string | null;
    bindtextdomain(domainName: string, dirName: string | null): string | null;
    bindtextdomainCodeset(domainName: string, codeset: string | null): null;
    LocaleCategory: typeof LocaleCategory;
}

declare const Gettext: GettextModule;
export default Gettext;
