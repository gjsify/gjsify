// Following the desktop's appearance in a real browser (ADR 0078): the handoff
// tags, live JSON, the CSS system colour, and the precedence between them — all
// read back through the root's COMPUTED style, since the point is what reaches
// the cascade.
//
// Every test restores the root: the follower acts on `document.documentElement`,
// which every other suite in this bundle renders under.

import { describe, expect, it } from '@gjsify/unit';
import { ADW_ACCENT_BG_COLORS, renderAppearanceMeta } from '@gjsify/adwaita-core';
import { APPEARANCE_HANDOFF_VECTORS, NEAREST_ACCENT_VECTORS } from '@gjsify/adwaita-core/conformance';

import '@gjsify/adwaita-web';
import { ACCENT_BG_PROPERTY, applyAdwaitaAccent, clearAdwaitaAccent } from './accent.js';
import { adwaitaAccentSource, applyDesktopAppearance, applySystemAccent, readSystemAccent } from './appearance.js';

const root = () => document.documentElement;
const rootAccent = () => getComputedStyle(root()).getPropertyValue(ACCENT_BG_PROPERTY).trim();

/** MutationObserver callbacks are microtasks; one macrotask later they have run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function addMeta(name: string, content: string): HTMLMetaElement {
    const meta = document.createElement('meta');
    meta.name = name;
    meta.content = content;
    document.head.append(meta);
    return meta;
}

async function restore(...metas: HTMLMetaElement[]): Promise<void> {
    for (const meta of metas) meta.remove();
    await settle();
    applySystemAccent(false);
    applyDesktopAppearance({});
    clearAdwaitaAccent(root());
}

export const AdwAppearanceTest = async () => {
    await describe('desktop appearance: the <meta> handoff', async () => {
        await it('applies a handed-over accent without any code in the page', async () => {
            const defaultAccent = rootAccent();
            const meta = addMeta('adw-accent', 'purple');
            await settle();
            expect(rootAccent()).toBe(ADW_ACCENT_BG_COLORS.purple);
            expect(adwaitaAccentSource()).toBe('handoff');

            // Removing the tag hands the root back to the stylesheet.
            meta.remove();
            await settle();
            expect(rootAccent()).toBe(defaultAccent);
            expect(adwaitaAccentSource()).toBe('default');
            await restore();
        });

        await it('follows a changed content attribute', async () => {
            const meta = addMeta('adw-accent', 'teal');
            await settle();
            meta.content = 'orange';
            await settle();
            expect(rootAccent()).toBe(ADW_ACCENT_BG_COLORS.orange);
            await restore(meta);
        });

        await it('hands over the colour scheme as a theme class, and takes it back', async () => {
            const meta = addMeta('adw-color-scheme', 'dark');
            await settle();
            expect(root().classList.contains('theme-dark')).toBe(true);
            meta.content = 'no-preference';
            await settle();
            expect(root().classList.contains('theme-dark')).toBe(false);
            await restore(meta);
        });

        await it('does not re-read the tags for an unrelated <head> change', async () => {
            // A live JSON handoff must survive a framework injecting a <style>.
            applyDesktopAppearance({ accent: 'green' });
            document.head.append(document.createElement('style'));
            await settle();
            expect(rootAccent()).toBe(ADW_ACCENT_BG_COLORS.green);
            document.head.lastElementChild?.remove();
            await restore();
        });
    });

    await describe('desktop appearance: APPEARANCE_HANDOFF_VECTORS through a real <head>', async () => {
        for (const vector of APPEARANCE_HANDOFF_VECTORS) {
            await it(`${JSON.stringify(vector.meta)} paints ${vector.paints ?? 'the default'}`, async () => {
                const defaultAccent = rootAccent();
                const holder = document.createElement('template');
                holder.innerHTML = renderAppearanceMeta(vector.appearance);
                const metas = [...holder.content.children] as HTMLMetaElement[];
                document.head.append(...metas);
                await settle();
                expect(rootAccent()).toBe(vector.paints ? ADW_ACCENT_BG_COLORS[vector.paints] : defaultAccent);
                const themeClass = root().classList.contains('theme-dark')
                    ? 'theme-dark'
                    : root().classList.contains('theme-light')
                      ? 'theme-light'
                      : null;
                expect(themeClass).toBe(vector.themeClass);
                await restore(...metas);
            });
        }
    });

    await describe('desktop appearance: a colour-only handoff is snapped (NEAREST_ACCENT_VECTORS)', async () => {
        // A server that sends only `accentRgb` gets libadwaita's snapping in the page, read
        // back from the cascade: the table is held by what the page paints, not by the function.
        for (const vector of NEAREST_ACCENT_VECTORS) {
            await it(`${vector.source}: ${vector.color} paints ${vector.expected}`, async () => {
                applyDesktopAppearance({ accentRgb: vector.color });
                expect(rootAccent()).toBe(ADW_ACCENT_BG_COLORS[vector.expected]);
                await restore();
            });
        }
    });

    await describe('desktop appearance: live JSON and precedence', async () => {
        await it('applies validated JSON and ignores what is not an accent', async () => {
            applyDesktopAppearance({ accent: 'red', colorScheme: 'light' });
            expect(rootAccent()).toBe(ADW_ACCENT_BG_COLORS.red);
            applyDesktopAppearance({ accent: '"><script>' });
            expect(adwaitaAccentSource()).toBe('default');
            await restore();
        });

        await it("never overrides the app's own choice", async () => {
            applyAdwaitaAccent('yellow');
            applyDesktopAppearance({ accent: 'pink' });
            const meta = addMeta('adw-accent', 'slate');
            await settle();
            expect(rootAccent()).toBe(ADW_ACCENT_BG_COLORS.yellow);
            expect(adwaitaAccentSource()).toBe('app');

            // Clearing the app's choice hands the root back to the desktop.
            clearAdwaitaAccent(root());
            applyDesktopAppearance({ accent: 'pink' });
            expect(rootAccent()).toBe(ADW_ACCENT_BG_COLORS.pink);
            await restore(meta);
        });

        await it('ranks the handoff above the CSS system colour', async () => {
            applySystemAccent();
            applyDesktopAppearance({ accent: 'teal' });
            expect(adwaitaAccentSource()).toBe('handoff');
            expect(rootAccent()).toBe(ADW_ACCENT_BG_COLORS.teal);
            await restore();
        });
    });

    await describe('desktop appearance: the CSS system colour (#1821)', async () => {
        await it('snaps AccentColor to one of the nine where the engine resolves it, else keeps blue', async () => {
            // Both outcomes are asserted: support for `AccentColor` differs per engine and
            // per OS, and "unsupported" must leave the stylesheet's blue, not a guess.
            const defaultAccent = rootAccent();
            const system = readSystemAccent();
            const applied = applySystemAccent();
            expect(applied).toBe(system?.accent ?? null);
            if (system) {
                expect(adwaitaAccentSource()).toBe('system');
                expect(rootAccent()).toBe(ADW_ACCENT_BG_COLORS[system.accent]);
            } else {
                expect(adwaitaAccentSource()).toBe('default');
                expect(rootAccent()).toBe(defaultAccent);
            }
            await restore();
            expect(rootAccent()).toBe(defaultAccent);
        });

        await it('the meta keyword "system" asks for the same thing', async () => {
            const meta = addMeta('adw-accent', 'system');
            await settle();
            expect(adwaitaAccentSource()).toBe(readSystemAccent() ? 'system' : 'default');
            await restore(meta);
        });
    });
};
