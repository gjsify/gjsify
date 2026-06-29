// SPDX-License-Identifier: MIT
// @gjsify/node-gi/gettext — types for the GJS `Gettext` module on Node.

/** Look up `msgid` in the default domain (passthrough). */
export function gettext(msgid: string): string;
/** Look up `msgid` in `domain` (passthrough). */
export function dgettext(domain: string | null, msgid: string): string;
/** Look up `msgid` in `domain`/`category` (passthrough). */
export function dcgettext(domain: string | null, msgid: string, category: number): string;
/** Plural lookup in the default domain (passthrough). */
export function ngettext(msgid1: string, msgid2: string, n: number): string;
/** Plural lookup in `domain` (passthrough). */
export function dngettext(domain: string | null, msgid1: string, msgid2: string, n: number): string;
/** Context lookup in the default domain (passthrough). */
export function pgettext(context: string, msgid: string): string;
/** Context lookup in `domain` (passthrough). */
export function dpgettext(domain: string | null, context: string, msgid: string): string;
/** Domain-bound gettext bindings. */
export function domain(domainName: string): {
  gettext(msgid: string): string;
  ngettext(msgid1: string, msgid2: string, n: number): string;
  pgettext(context: string, msgid: string): string;
};
/** Set the locale for `category` (no-op on Node). */
export function setlocale(category: number, locale: string | null): null;
/** Set the default text domain (no-op on Node). */
export function textdomain(domainName: string | null): null;
/** Bind a text domain to a directory (no-op on Node). */
export function bindtextdomain(domainName: string, dirName: string | null): null;
/** Set the output codeset for a text domain (no-op on Node). */
export function bindtextdomainCodeset(domainName: string, codeset: string | null): null;
/** The standard POSIX locale category constants. */
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
  setlocale(category: number, locale: string | null): null;
  textdomain(domainName: string | null): null;
  bindtextdomain(domainName: string, dirName: string | null): null;
  bindtextdomainCodeset(domainName: string, codeset: string | null): null;
  LocaleCategory: typeof LocaleCategory;
}

declare const Gettext: GettextModule;
export default Gettext;
