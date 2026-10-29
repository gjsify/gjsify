// `glibTranslate` — the default-domain gettext calls, over a fake GLib (no GI stack needed).

import { describe, expect, it } from '@gjsify/unit';

import { glibTranslate } from './default-translate.js';

export default async () => {
    await describe('glibTranslate', async () => {
        const calls: string[] = [];
        const glib = {
            dgettext: (domain: string | null, text: string) => {
                calls.push(`d:${domain}:${text}`);
                return `de(${text})`;
            },
            dpgettext2: (domain: string | null, context: string, text: string) => {
                calls.push(`p:${domain}:${context}:${text}`);
                return `de(${context}|${text})`;
            },
        };
        let resolved = 0;
        const translate = glibTranslate(() => {
            resolved++;
            return glib;
        });

        await it('translates in the default domain', () => {
            expect(translate('Help')).toBe('de(Help)');
            expect(calls[0]).toBe('d:null:Help');
        });

        await it('passes the C_() context to dpgettext2', () => {
            expect(translate('Open', 'menu')).toBe('de(menu|Open)');
            expect(calls[1]).toBe('p:null:menu:Open');
        });

        await it('leaves an empty string alone and resolves GLib once', () => {
            expect(translate('')).toBe('');
            expect(resolved).toBe(1);
        });
    });
};
