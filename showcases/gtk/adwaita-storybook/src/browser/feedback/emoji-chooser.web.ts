// Browser port of the Emoji Chooser story. Shares metadata with emoji-chooser.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { emojiChooserMeta } from '../../feedback/emoji-chooser.meta.js';

/** The half of `<gtk-emoji-chooser>` the markup cannot spell. */
interface EmojiChooserElement extends HTMLElement {
    popup(): void;
    popdown(): void;
}

/** The search entry the chooser builds inside itself. */
function searchEntryOf(chooser: HTMLElement): HTMLInputElement | null {
    return chooser.querySelector<HTMLInputElement>('.emoji-search-entry');
}

export class EmojiChooserWebStory extends StoryElement {
    private _entry: HTMLInputElement | null = null;
    private _button: HTMLElement | null = null;
    private _chooser: EmojiChooserElement | null = null;

    constructor() {
        super(EmojiChooserWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return emojiChooserMeta;
    }

    initialize(): void {
        const row = document.createElement('div');
        row.className = 'sb-emoji-row';

        this._entry = document.createElement('input');
        this._entry.className = 'sb-emoji-entry';
        this._entry.type = 'text';
        this._entry.placeholder = 'Type a message…';
        row.appendChild(this._entry);

        // The chooser is a POPOVER, so it needs something to pop up from — the same shape
        // the GTK story builds: a button in the entry, the chooser as its child.
        const anchor = document.createElement('div');
        anchor.className = 'sb-emoji-anchor';
        this._button = document.createElement('button');
        this._button.className = 'adw-button flat circular';
        this._button.setAttribute('aria-label', 'Insert an emoji');
        const icon = document.createElement('gtk-image');
        icon.setAttribute('icon-name', 'face-smile');
        this._button.appendChild(icon);
        this._button.addEventListener('click', () => {
            this._chooser?.popup();
            searchEntryOf(this._chooser as HTMLElement)?.focus();
        });
        anchor.appendChild(this._button);
        row.appendChild(anchor);

        this._chooser = document.createElement('gtk-emoji-chooser') as EmojiChooserElement;
        this._chooser.setAttribute('position', 'bottom');
        this._chooser.setAttribute('align', 'end');
        // `GtkPopover` positions against the widget it is a child of; here that is the
        // button, which is NOT its DOM parent (the wrapper is), so the anchor is set.
        (this._chooser as HTMLElement & { anchor: HTMLElement | null }).anchor = this._button;
        this._chooser.addEventListener('emoji-picked', (event) => {
            const { text } = (event as CustomEvent).detail as { text: string };
            if (this._entry !== null) this._entry.value += text;
        });
        anchor.appendChild(this._chooser);

        this.addContent(row);
        this._applySearch(this.args.search as string);
        this._chooser.popup();
    }

    private _applySearch(text: string): void {
        const entry = this._chooser === null ? null : searchEntryOf(this._chooser);
        if (entry === null) return;
        entry.value = text;
        entry.dispatchEvent(new Event('input', { bubbles: true }));
    }

    updateArgs(args: StoryArgs): void {
        if (typeof args.search === 'string') this._applySearch(args.search);
    }

    teardown(): void {
        this._chooser?.popdown();
        this._chooser = null;
        this._entry = null;
        this._button = null;
    }
}

export const EmojiChooserWebStories: WebStoryModule = { stories: [EmojiChooserWebStory] };
