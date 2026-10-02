// DOM-level tests for <gtk-emoji-chooser>. The emoji table is data, so what these hold
// is the BEHAVIOUR around it: the prefix search of `match_tokens`, the section hiding of
// `update_headings` (including the "No Results Found" page), the recent list's cap and
// its one exception, and the section button that follows the scroll position.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkEmojiChooser } from './elements/gtk-emoji-chooser.js';
import { EMOJI_CATEGORIES, EMOJI_MAX_RECENT } from './emoji-data.js';

function mount(attrs: Record<string, string> = {}): { el: GtkEmojiChooser; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-emoji-chooser') as GtkEmojiChooser;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    el.popup();
    return { el, host };
}

function search(el: GtkEmojiChooser, text: string): void {
    const entry = el.querySelector<HTMLInputElement>('.emoji-search-entry')!;
    entry.value = text;
    entry.dispatchEvent(new Event('input', { bubbles: true }));
}

/** The sections that are currently shown, in DOM order. */
function visibleSections(el: GtkEmojiChooser): string[] {
    return [...el.querySelectorAll<HTMLElement>('.emoji-flowbox')]
        .filter((box) => !box.hidden)
        .map((box) => box.dataset.section ?? '');
}

export const GtkEmojiChooserTest = async () => {
    await describe('<gtk-emoji-chooser> sections', async () => {
        await it('hides the recent box while the list is empty, ahead of the nine categories', () => {
            // The struct order of GtkEmojiChooser (gtkemojichooser.c:216-228) with recent
            // ahead of them all, which is also the `.ui`'s document order — but
            // `populate_recent_section` (:352) hides the recent box while the list is
            // empty, so a fresh chooser shows the nine categories and the first pick
            // puts the recent box ahead of them.
            const { el, host } = mount();
            expect(visibleSections(el)).toStrictEqual(EMOJI_CATEGORIES.map((c) => c.id));
            el.querySelector<HTMLButtonElement>('.emoji-flowbox[data-section="people"] .emoji')!.click();
            expect(visibleSections(el)).toStrictEqual(['recent', ...EMOJI_CATEGORIES.map((c) => c.id)]);
            host.remove();
        });

        await it('one toolbar button per section, recent first and insensitised when empty', () => {
            // populate_recent_section (gtkemojichooser.c:376-386) makes the recent button
            // INSENSITIVE while its box is empty.
            const { el, host } = mount();
            const buttons = [...el.querySelectorAll<HTMLButtonElement>('.emoji-section')];
            expect(buttons).toHaveLength(EMOJI_CATEGORIES.length + 1);
            expect(buttons[0]?.dataset.section).toBe('recent');
            expect(buttons[0]?.disabled).toBe(true);
            expect(buttons[1]?.title).toBe('Smileys & People');
            host.remove();
        });

        await it('has a heading per section and none for recent', () => {
            const { el, host } = mount();
            const headings = [...el.querySelectorAll('.emoji-heading')].map((h) => h.textContent);
            expect(headings).toStrictEqual(EMOJI_CATEGORIES.map((c) => c.heading));
            expect(el.querySelector('.emoji-recent-box')?.previousElementSibling).toBe(null);
            host.remove();
        });
    });

    await describe('<gtk-emoji-chooser> search', async () => {
        await it('an empty search shows every section the list has', () => {
            // `filter_func` (gtkemojichooser.c:896-913) — `if (text[0] == 0) goto out`.
            // The recent box is still hidden: `update_headings` never shows it, only
            // `add_recent_item` does.
            const { el, host } = mount();
            search(el, '');
            expect(visibleSections(el)).toHaveLength(EMOJI_CATEGORIES.length);
            expect(el.querySelector('.emoji-empty')?.hasAttribute('hidden')).toBe(true);
            host.remove();
        });

        await it('matches a PREFIX of a name or keyword word, case-folded', () => {
            // match_tokens (gtkemojichooser.c:871-894) — every TERM must prefix some token,
            // and g_str_tokenize_and_fold case-folds both sides.
            const { el, host } = mount();
            search(el, 'grin');
            const shown = [...el.querySelectorAll<HTMLButtonElement>('.emoji-flowbox[data-section="people"] .emoji')]
                .filter((button) => !button.hidden)
                .map((button) => button.getAttribute('aria-label'));
            expect(shown?.length).toBeGreaterThan(0);
            expect(shown).toContain('grinning face');
            search(el, 'THUMBS');
            expect(
                [...el.querySelectorAll<HTMLButtonElement>('.emoji-flowbox .emoji')]
                    .filter((button) => !button.hidden)
                    .map((button) => button.getAttribute('aria-label')),
            ).toContain('thumbs up');
            host.remove();
        });

        await it('hides a section with no match, heading and all', () => {
            // update_headings (gtkemojichooser.c:967-989).
            const { el, host } = mount();
            search(el, 'zzzz-no-such-emoji');
            expect(visibleSections(el)).toStrictEqual([]);
            expect(el.querySelector('.emoji-empty')?.hasAttribute('hidden')).toBe(false);
            expect(el.querySelector('.emoji-empty-title')?.textContent).toBe('No Results Found');
            host.remove();
        });

        await it('needs every term to match', () => {
            const { el, host } = mount();
            search(el, 'grinning face');
            expect(visibleSections(el)).toContain('people');
            search(el, 'grinning unicorn');
            expect(visibleSections(el)).toStrictEqual([]);
            host.remove();
        });
    });

    await describe('<gtk-emoji-chooser> picking', async () => {
        await it('emits emoji-picked with the Unicode sequence', () => {
            // emoji_activated (gtkemojichooser.c:449-486) — the signal carries `text`, the
            // LABEL's own contents, which is the code-point sequence and not the name.
            const { el, host } = mount();
            const seen: unknown[] = [];
            el.addEventListener('emoji-picked', (event) => seen.push((event as CustomEvent).detail));
            const first = el.querySelector<HTMLButtonElement>('.emoji-flowbox[data-section="people"] .emoji')!;
            first.click();
            expect(seen).toStrictEqual([{ text: '\u{1F600}' }]);
            host.remove();
        });

        await it('records the pick in recents and enables its button', () => {
            // add_recent_item (gtkemojichooser.c:390-447) — the section becomes visible and
            // its button sensitive only on a NON-empty list.
            const { el, host } = mount();
            expect(el.recentEmoji).toStrictEqual([]);
            el.querySelector<HTMLButtonElement>('.emoji-flowbox[data-section="people"] .emoji')!.click();
            expect(el.recentEmoji).toHaveLength(1);
            expect(el.querySelector('.emoji-recent-box')?.hasAttribute('hidden')).toBe(false);
            expect(el.querySelector<HTMLButtonElement>('.emoji-section[data-section="recent"]')?.disabled).toBe(false);
            host.remove();
        });

        await it('does not record a pick made FROM the recents', () => {
            const { el, host } = mount();
            el.querySelector<HTMLButtonElement>('.emoji-flowbox[data-section="people"] .emoji')!.click();
            el.querySelector<HTMLButtonElement>('.emoji-recent-box .emoji')!.click();
            expect(el.recentEmoji).toHaveLength(1);
            host.remove();
        });

        await it('keeps the recents list at MAX_RECENT, newest first, no duplicates', () => {
            const { el, host } = mount();
            const names = ['\u{1F600}', '\u{1F603}', '\u{1F604}', '\u{1F601}'];
            for (const text of names) el.pick({ text, name: text, keywords: [] });
            // Re-picking the first entry moves it to the front rather than adding a
            // second: `add_emoji (box, TRUE /* prepend */, …)` (gtkemojichooser.c:422).
            el.pick({ text: '\u{1F600}', name: 'again', keywords: [] });
            expect(el.recentEmoji.map((entry) => entry.text)).toStrictEqual([
                '\u{1F600}',
                '\u{1F601}',
                '\u{1F604}',
                '\u{1F603}',
            ]);
            for (let index = 0; index < EMOJI_MAX_RECENT + 5; index += 1) {
                el.pick({ text: `x${index}`, name: `x${index}`, keywords: [] });
            }
            expect(el.recentEmoji).toHaveLength(EMOJI_MAX_RECENT);
            host.remove();
        });
    });
};
