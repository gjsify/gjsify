// <gtk-emoji-chooser> — the browser counterpart of `GtkEmojiChooser`, GTK's emoji
// popover: a search entry over a scrolled list of emoji in ten sections (recent first),
// with a toolbar of section buttons that both JUMP to a section (`scroll_to_section`) and
// follow the scroll position (`adj_value_changed`), and an `emoji-picked` signal.
//
// The SURFACE is `<gtk-popover>`'s — this element extends `GtkPopover`, so the surface
// node, the Escape dismissal, the outside-click popdown and the focus return are the ones
// `gtk-popover.ts` already owns, and the CSS-node contract upstream names (`popover`,
// `.emoji-searchbar`, `.emoji-toolbar`, `.emoji-section`, `emoji`) is reproduced by the
// class names below rather than by a second surface.
//
// WHAT IS PORTED FROM `gtkemojichooser.c`
//
//   · the CSS node tree (the `ui/gtkemojichooser.ui` template): a searchbar box holding
//     the entry, a stack of `list` / `empty`, a scrolled `.view` holding one flow box per
//     section with a heading label above each, and a toolbar of `.emoji-section` buttons;
//   · `filter_func` (:896-958) + `match_tokens` (:871-894): the search text is tokenised,
//     case-folded, and an emoji matches when EVERY term is a PREFIX of a token of its name
//     or of one of its keywords. Empty text matches everything
//     (`if (text[0] == 0) goto out`);
//   · `search_changed` (:991) + `update_headings` (:967): a section with no match hides
//     its heading AND its emoji, and a search that empties every section shows the
//     "No Results Found" page instead of the list;
//   · `emoji_activated` (:449-486): picking an emoji emits `emoji-picked` with the text,
//     records it in the recent list unless it came FROM the recent list, and pops the
//     popover down — unless Ctrl is held, which keeps it open to pick several;
//   · `add_recent_item` (:390-447): the recent list is at most `MAX_RECENT` (21) entries,
//     an entry already in it moves to the front, and the section's button becomes
//     sensitive and the section visible (both of which it only does on a NON-empty list);
//   · `gtk_emoji_chooser_scroll_section` (:1198) behind Ctrl+N / Ctrl+P
//     (`gtk_widget_class_add_binding_action`, :1452-1456) and `activate_search` (:1019),
//     which picks the first result of the first non-empty section;
//   · `adj_value_changed` (:814-870): the section whose heading the scroll position has
//     passed is the CHECKED one and every other button is unchecked;
//   · `gtk_emoji_chooser_show` (:1122-1133): showing the popover resets the scroll
//     position to 0 and CLEARS the search text, which is why re-opening starts over;
//   · `has_variations` (:489) / `show_variations` (:508-548): a SECOND click on an emoji
//     that carries a skin-tone slot opens the six variants beside it, and picking one of
//     them picks that variant. GTK opens them with a long press or the third mouse button;
//     a second click is the same affordance where a long press is not available.
//
// NOT PORTED, and it is not a browser limit: the emoji table itself. GTK's is a compiled
// 1.2 MB GVariant per language, so `src/emoji-data.ts` carries a curated table with the
// same shape; every rule above runs on it unchanged.
//
// Attributes: `open`, `position`, `align`, `role`, `menu` from `<gtk-popover>`. This
// element adds NONE of its own — `GtkEmojiChooser` declares no properties in the GIR.
//
// Events: `emoji-picked` (bubbling CustomEvent, detail `{ text }`), plus the popover's
// `notify::open` and `popover-item-activated`.
//
// A11y: the surface is a `listbox` (a grid of choices, not a menu), each emoji is a
// `button` labelled with the English name — the name the search reads — and the section
// headings are headings rather than presentational labels.
//
// Reference: refs/gtk/gtk/gtkemojichooser.c (every rule above, by line)
// Reference: refs/gtk/gtk/ui/gtkemojichooser.ui (the node tree, the headings, the tooltips)
// Reference: refs/libadwaita/src/stylesheet/widgets/_emoji-chooser.scss
// Copyright (c) 2021-2024 The GTK authors. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the surface is
// <gtk-popover>; the emoji table is packages/web/adwaita-web/src/emoji-data.ts.

import {
    EMOJI_CATEGORIES,
    EMOJI_MAX_RECENT,
    EMOJI_SKIN_TONES,
    type EmojiEntry,
    emojiTooltip,
    hasVariations,
} from '../emoji-data.js';

import { createGtkImage } from './gtk-image.js';
import { GtkPopover } from './gtk-popover.js';

/** One section of the list: its heading, its flow box and its toolbar button. */
interface EmojiSection {
    readonly id: string;
    readonly heading: HTMLElement | null;
    readonly box: HTMLDivElement;
    readonly button: HTMLButtonElement | null;
    /** `GtkFlowBox`'s `empty` latch: set by `invalidate_section`, cleared by any match. */
    empty: boolean;
}

/** `BOX_SPACE` (gtkemojichooser.c:92) — the gap `scroll_to_section` leaves above a heading. */
const BOX_SPACE = 6;

export class GtkEmojiChooser extends GtkPopover {
    private _built = false;
    private _entry!: HTMLInputElement;
    private _listEl!: HTMLDivElement;
    private _emptyEl!: HTMLElement;
    private _sections = new Map<string, EmojiSection>();
    /** The entry a button was built from — `emoji-data` has no reverse lookup. */
    private _entryOf = new WeakMap<HTMLElement, EmojiEntry>();
    /** `recently-used-emoji` — the GSettings key, held in memory here (see the header). */
    private _recent: EmojiEntry[] = [];
    /**
     * The Ctrl state `should_close` reads off the keyboard (:433-448). A DOM event's
     * `ctrlKey` says what the key that caused IT was, and a `click` synthesised from a
     * keyboard activation carries no modifier at all, so the state is tracked from the key
     * events themselves — which is what `gdk_device_get_modifier_state` answers.
     */
    private _ctrl = false;

    connectedCallback(): void {
        super.connectedCallback();
        if (this._built) return;
        this._built = true;

        // A grid of choices, not a menu: `role="listbox"` is what the popover's own rows
        // (`popover-item-activated`) and the a11y layer are told to expect.
        if (!this.hasAttribute('role')) this.setAttribute('role', 'listbox');

        const root = document.createElement('div');
        root.className = 'emoji-picker-root';
        root.appendChild(this._buildSearchbar());

        this._listEl = document.createElement('div');
        this._listEl.className = 'emoji-list';
        this._emptyEl = this._buildEmptyPage();
        const stack = document.createElement('div');
        stack.className = 'emoji-stack';
        stack.append(this._listEl, this._emptyEl);
        root.appendChild(stack);

        this.replaceChildren(root);

        // DOCUMENT ORDER IS SECTION ORDER: `recent.box` first, because the `.ui` puts it
        // above the nine categories and `gtk_flow_box` wraps by DOM order.
        const recentBox = document.createElement('div');
        recentBox.className = 'emoji-flowbox emoji-recent-box';
        recentBox.dataset.section = 'recent';
        this._listEl.appendChild(recentBox);
        this._sections.set('recent', { id: 'recent', heading: null, box: recentBox, button: null, empty: true });

        this._buildSections();
        this._buildToolbar(root);
        this._renderRecents();

        // `adj_value_changed` is connected to the scrolled window's adjustment in the C;
        // the scroll event is the DOM's name for the same notification.
        this._listEl.addEventListener('scroll', () => this._markSection(this._currentSection()));
        this.addEventListener('keydown', (event) => (this._ctrl = event.ctrlKey));
        this.addEventListener('keyup', (event) => (this._ctrl = event.ctrlKey));
        // `gtk_emoji_chooser_show` (:1122-1133): the search is CLEARED and the list is back
        // at the top every time the popover appears, which is why re-opening it starts over
        // rather than continuing where the last search left off. The base class's own state
        // change is what says it appeared — `popup()` is not the only way in.
        this.subscribe((open) => {
            if (!open) return;
            this._entry.value = '';
            this._filter();
            this._listEl.scrollTop = 0;
            this._markSection('recent');
        });
        this._markSection('recent');
    }

    /** The emoji picked most recently, newest first — what `recently-used-emoji` holds. */
    get recentEmoji(): EmojiEntry[] {
        return [...this._recent];
    }

    /**
     * Pick an entry the flow box's `child-activated` would have delivered — which is what
     * a consumer inserting an emoji from elsewhere needs, and what a test drives the recents
     * with. `fromRecent` is `emoji_activated`'s own half of the recent check: an entry
     * picked out of the recent list is not recorded a second time.
     */
    pick(entry: EmojiEntry, fromRecent = false): void {
        this._activate(entry, null, fromRecent);
    }

    // ------------------------------------------------------------- building

    /** The `.emoji-searchbar` box: the magnifying glyph and the search entry. */
    private _buildSearchbar(): HTMLElement {
        const bar = document.createElement('div');
        bar.className = 'emoji-searchbar';

        const icon = createGtkImage('edit-find', 'emoji-search-icon');

        this._entry = document.createElement('input');
        this._entry.type = 'search';
        this._entry.className = 'emoji-search-entry';
        this._entry.placeholder = 'Search emoji';
        this._entry.setAttribute('aria-label', 'Search emoji');
        // `search_changed` — every keystroke re-filters, and an empty search restores all.
        this._entry.addEventListener('input', () => this._filter());
        // `stop_search` is Escape and belongs to the popover; `activate_search` is Enter,
        // and picks the first result of the first non-empty section.
        this._entry.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this._activateFirstResult();
                return;
            }
            // `gtk_widget_class_add_binding_action (…, GDK_KEY_n / GDK_KEY_p,
            // GDK_CONTROL_MASK, "scroll.section", "i", ±1)` — the only two shortcuts the
            // widget declares besides Enter.
            if (event.ctrlKey && (event.key === 'n' || event.key === 'p')) {
                event.preventDefault();
                this._scrollSection(event.key === 'n' ? 1 : -1);
            }
        });

        bar.append(icon, this._entry);
        return bar;
    }

    /** The `empty` stack page: the big glyph and the two lines under it. */
    private _buildEmptyPage(): HTMLElement {
        const empty = document.createElement('div');
        empty.className = 'emoji-empty';
        empty.hidden = true;
        empty.appendChild(createGtkImage('edit-find', 'emoji-empty-icon'));
        const title = document.createElement('div');
        title.className = 'emoji-empty-title';
        title.textContent = 'No Results Found';
        const hint = document.createElement('div');
        hint.className = 'emoji-empty-hint';
        hint.textContent = 'Try a different search';
        empty.append(title, hint);
        return empty;
    }

    /** One flow box per category, each under its own heading label. */
    private _buildSections(): void {
        for (const category of EMOJI_CATEGORIES) {
            const heading = document.createElement('div');
            heading.className = 'emoji-heading';
            heading.textContent = category.heading;

            const box = document.createElement('div');
            box.className = 'emoji-flowbox';
            box.dataset.section = category.id;
            for (const entry of category.entries) box.appendChild(this._emojiButton(entry));

            this._listEl.append(heading, box);
            this._sections.set(category.id, { id: category.id, heading, box, button: null, empty: true });
        }
    }

    /**
     * The toolbar: one `.emoji-section` button per section, recent FIRST (the struct
     * order), each with its own symbolic and the `.ui`'s tooltip.
     *
     * The icons are written out one call per section rather than looked up from a table:
     * each name is USED there, which is what makes it a name this stylesheet has to be
     * able to draw — `scripts/check-adwaita-icon-masks.mjs` reads exactly that.
     */
    private _buildToolbar(root: HTMLElement): void {
        const toolbar = document.createElement('div');
        toolbar.className = 'emoji-toolbar';

        const buttons: Array<[string, HTMLButtonElement]> = [
            [
                'recent',
                this._sectionButton(
                    'recent',
                    createGtkImage('emoji-recent', 'emoji-section-icon'),
                    emojiTooltip('recent'),
                ),
            ],
            [
                'people',
                this._sectionButton(
                    'people',
                    createGtkImage('emoji-people', 'emoji-section-icon'),
                    emojiTooltip('people'),
                ),
            ],
            [
                'body',
                this._sectionButton('body', createGtkImage('emoji-body', 'emoji-section-icon'), emojiTooltip('body')),
            ],
            [
                'nature',
                this._sectionButton(
                    'nature',
                    createGtkImage('emoji-nature', 'emoji-section-icon'),
                    emojiTooltip('nature'),
                ),
            ],
            [
                'food',
                this._sectionButton('food', createGtkImage('emoji-food', 'emoji-section-icon'), emojiTooltip('food')),
            ],
            [
                'travel',
                this._sectionButton(
                    'travel',
                    createGtkImage('emoji-travel', 'emoji-section-icon'),
                    emojiTooltip('travel'),
                ),
            ],
            [
                'activities',
                this._sectionButton(
                    'activities',
                    createGtkImage('emoji-activities', 'emoji-section-icon'),
                    emojiTooltip('activities'),
                ),
            ],
            [
                'objects',
                this._sectionButton(
                    'objects',
                    createGtkImage('emoji-objects', 'emoji-section-icon'),
                    emojiTooltip('objects'),
                ),
            ],
            [
                'symbols',
                this._sectionButton(
                    'symbols',
                    createGtkImage('emoji-symbols', 'emoji-section-icon'),
                    emojiTooltip('symbols'),
                ),
            ],
            [
                'flags',
                this._sectionButton(
                    'flags',
                    createGtkImage('emoji-flags', 'emoji-section-icon'),
                    emojiTooltip('flags'),
                ),
            ],
        ];

        for (const [id, button] of buttons) {
            button.addEventListener('click', () => this._scrollTo(id));
            const section = this._sections.get(id);
            if (section !== undefined) this._sections.set(id, { ...section, button });
        }

        toolbar.append(...buttons.map(([, button]) => button));
        root.appendChild(toolbar);
    }

    /** `button.image-button.emoji-section` — flat, circular, 32px, with a tooltip. */
    private _sectionButton(id: string, icon: HTMLElement, tooltip: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'emoji-section';
        button.dataset.section = id;
        button.title = tooltip;
        button.setAttribute('aria-label', tooltip);
        button.appendChild(icon);
        return button;
    }

    /**
     * One emoji: a `<button>` holding the glyph at `PANGO_SCALE_X_LARGE`, labelled with
     * the English name — the name the search reads, so it is the accessible name too.
     */
    private _emojiButton(entry: EmojiEntry): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'emoji';
        button.textContent = entry.text;
        button.title = entry.name;
        button.setAttribute('aria-label', entry.name);
        this._entryOf.set(button, entry);
        // `emoji_activated` (:449) — pick.
        button.addEventListener('click', (event) => {
            this._closeVariations();
            // A second click on an emoji with skin tones opens them, which is what
            // `pressed_cb` (:571) does with the third mouse button.
            if (event.detail > 1 && hasVariations(entry)) {
                this._showVariations(entry, button);
                return;
            }
            this._activate(entry, button);
        });
        return button;
    }

    // ------------------------------------------------------------- behaviour

    /** `filter_func` + `match_tokens`: EVERY term must be a PREFIX of a token of the name
     * or of one of the keywords. `g_str_tokenize_and_fold` case-folds, hence lower-casing
     * both sides. */
    private _matches(entry: EmojiEntry, terms: readonly string[]): boolean {
        if (terms.length === 0) return true;
        const tokens = `${entry.name} ${entry.keywords.join(' ')}`.toLowerCase().split(/\s+/);
        return terms.every((term) => tokens.some((token) => token.startsWith(term)));
    }

    /** `search_changed` — invalidate every section, then `update_headings`. */
    private _filter(): void {
        const terms = this._entry.value
            .toLowerCase()
            .split(/\s+/)
            .filter((term) => term.length > 0);
        for (const section of this._sections.values()) {
            let matched = 0;
            for (const node of section.box.querySelectorAll<HTMLButtonElement>('.emoji')) {
                const entry = this._entryOf.get(node);
                const show = entry !== undefined && this._matches(entry, terms);
                node.hidden = !show;
                if (show) matched += 1;
            }
            // `update_headings` (:967): a section with no match hides BOTH its heading and
            // its emoji, and `empty` is what the section buttons read — an invisible
            // section is not a jumpable one. The recent box is NOT in that function's
            // list: its visibility is `populate_recent_section`'s alone (hidden while
            // the list is empty, shown on the first pick), so filtering never hides it.
            section.empty = matched === 0;
            if (section.heading !== null) section.heading.hidden = section.empty;
            if (section.id !== 'recent') section.box.hidden = section.empty;
        }
        // …and the stack shows `empty` when EVERY section is, `list` otherwise (:984-989).
        const allEmpty = [...this._sections.values()].every((section) => section.empty);
        this._listEl.hidden = allEmpty;
        this._emptyEl.hidden = !allEmpty;
        this._markSection(this._currentSection());
    }

    /** `emoji_activated` — emit, remember, and pop down unless Ctrl is held. */
    private _activate(entry: EmojiEntry, from: HTMLElement | null, fromRecent = false): void {
        if (!fromRecent && from?.parentElement?.dataset.section !== 'recent') this._remember(entry);
        this.dispatchEvent(new CustomEvent('emoji-picked', { bubbles: true, detail: { text: entry.text } }));
        // `should_close` (:433-448): Ctrl held means "keep picking", which is why the
        // popover stays up — and why the entry keeps what was typed into it.
        if (!this._ctrl) this.popdown();
    }

    /** `add_recent_item` (:390) — newest first, no duplicates, at most `MAX_RECENT`. */
    private _remember(entry: EmojiEntry): void {
        this._recent = [entry, ...this._recent.filter((candidate) => candidate.text !== entry.text)].slice(
            0,
            EMOJI_MAX_RECENT,
        );
        this._renderRecents();
    }

    /** `populate_recent_section` (:366-388): the list, its visibility and its button. */
    private _renderRecents(): void {
        const section = this._sections.get('recent');
        if (section === undefined) return;
        section.box.replaceChildren(...this._recent.map((entry) => this._emojiButton(entry)));
        const empty = this._recent.length === 0;
        section.box.hidden = empty;
        section.empty = empty;
        if (section.button !== null) section.button.disabled = empty;
    }

    /**
     * `show_variations` (:508-548): the plain form and the five skin tones
     * (`add_emoji (box, FALSE, emoji_data, 0, …)` then `1F3FB`…`1F3FF`), in a popover over
     * the emoji — and only for an emoji that HAS them, which is `has_variations` (:489).
     */
    private _showVariations(entry: EmojiEntry, anchor: HTMLElement): void {
        this._closeVariations();
        const popover = document.createElement('div');
        popover.className = 'emoji-variations';
        const row = document.createElement('div');
        row.className = 'emoji-variations-row';
        const base = [...entry.text].filter((character) => !EMOJI_SKIN_TONES.includes(character)).join('');
        for (const text of [base, ...EMOJI_SKIN_TONES.map((tone) => base + tone)]) {
            const variant = document.createElement('button');
            variant.type = 'button';
            variant.className = 'emoji';
            variant.textContent = text;
            variant.addEventListener('click', (event) => {
                event.stopPropagation();
                this._closeVariations();
                this._activate({ ...entry, text }, variant);
            });
            row.appendChild(variant);
        }
        popover.appendChild(row);
        anchor.insertAdjacentElement('afterend', popover);
    }

    private _closeVariations(): void {
        for (const popover of this.querySelectorAll('.emoji-variations')) popover.remove();
    }

    /** `scroll_to_section` (:312-330) — to the heading, minus `BOX_SPACE`. */
    private _scrollTo(id: string): void {
        const section = this._sections.get(id);
        if (section === undefined || section.empty) return;
        const target = section.heading ?? section.box;
        this._listEl.scrollTo({ top: target.offsetTop - BOX_SPACE, behavior: 'smooth' });
        this._markSection(id);
    }

    /** `gtk_emoji_chooser_scroll_section` (:1198) — Ctrl+N / Ctrl+P over the visible ones. */
    private _scrollSection(direction: 1 | -1): void {
        const order = [...this._sections.values()].filter((section) => !section.empty);
        if (order.length === 0) return;
        const at = order.findIndex((section) => section.id === this._currentSection());
        const next = order[Math.min(Math.max((at < 0 ? 0 : at) + direction, 0), order.length - 1)]!;
        this._scrollTo(next.id);
    }

    /** `activate_search` (:1019) — the first result of the first non-empty section. */
    private _activateFirstResult(): void {
        for (const section of this._sections.values()) {
            if (section.empty) continue;
            const first = [...section.box.querySelectorAll<HTMLButtonElement>('.emoji')].find((node) => !node.hidden);
            if (first === undefined) continue;
            this._activate(
                this._entryOf.get(first) ?? { text: first.textContent ?? '', name: '', keywords: [] },
                first,
            );
            return;
        }
    }

    /**
     * `adj_value_changed` (:814-870): the section the scroll position is INSIDE is the
     * checked one, so the toolbar follows the list without any interaction of its own.
     */
    private _sectionAt(offset: number): string {
        let selected = 'recent';
        for (const section of this._sections.values()) {
            if (section.empty || section.box.hidden) continue;
            const target = section.heading ?? section.box;
            if (offset < target.offsetTop - BOX_SPACE) break;
            selected = section.id;
        }
        return selected;
    }

    private _currentSection(): string {
        return this._sectionAt(this._listEl.scrollTop);
    }

    private _markSection(id: string): void {
        for (const section of this._sections.values()) {
            // `:checked` is a state a `<button>` cannot raise, so the class stands in for
            // it — the same spelling `<gtk-check-button>` uses for the same reason.
            section.button?.classList.toggle('checked', section.id === id);
        }
    }
}

customElements.define('gtk-emoji-chooser', GtkEmojiChooser);
