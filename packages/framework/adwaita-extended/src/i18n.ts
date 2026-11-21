/**
 * The package's own gettext domain, bound here so a host does not have to know it exists.
 *
 * A host sets its own `textdomain`; a bare `gettext()` in this package would look in the host's
 * catalogue and silently answer with the English msgid. So every lookup is `dgettext`-bound to
 * {@link TEXT_DOMAIN}. Binding happens when this module loads. GJS-only: it imports GJS's `gettext`.
 */

import Gettext from 'gettext';

export const TEXT_DOMAIN = 'gjsify-adwaita-extended';

/** `localeDir` wins; then `GJSIFY_LOCALE_DIR` (set by `gjsify ship`); then the system directory. */
export function initI18n(localeDir?: string): string | undefined {
    const dir = localeDir ?? process.env['GJSIFY_LOCALE_DIR'] ?? systemLocaleDir();
    if (dir !== undefined) Gettext.bindtextdomain(TEXT_DOMAIN, dir);
    return dir;
}

/** Nothing on macOS or Windows: `/usr/share/locale` there holds other data or does not exist. */
function systemLocaleDir(): string | undefined {
    return process.platform === 'darwin' || process.platform === 'win32' ? undefined : '/usr/share/locale';
}

initI18n();

export function _(msgid: string): string {
    return Gettext.dgettext(TEXT_DOMAIN, msgid);
}

export function _n(singular: string, plural: string, n: number): string {
    return Gettext.dngettext(TEXT_DOMAIN, singular, plural, n);
}
