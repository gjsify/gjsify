// Browser port of the GTK Header Bar story. Shares metadata with gtk-header-bar.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { gtkHeaderBarMeta } from '../../windows/gtk-header-bar.meta.js';

export class GtkHeaderBarWebStory extends StoryElement {
    private _bar: HTMLElement | null = null;
    private _titleLabel: HTMLElement | null = null;

    constructor() {
        super(GtkHeaderBarWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return gtkHeaderBarMeta;
    }

    initialize(): void {
        this._bar = document.createElement('gtk-header-bar');

        // The same three children in the same order as the GTK story — `pack_end` PREPENDS,
        // so the button added LAST sits nearest the edge (gtkheaderbar.c:843-861).
        for (const [slot, icon] of [
            ['end', 'open-menu-symbolic'],
            ['end', 'system-search-symbolic'],
            ['start', 'go-previous-symbolic'],
        ] as const) {
            const button = document.createElement('gtk-button');
            button.setAttribute('slot', slot);
            button.setAttribute('icon-name', icon);
            button.setAttribute('flat', '');
            this._bar.appendChild(button);
        }

        // `gtk_header_bar_set_title_widget` empties the centre bin for the widget and hands
        // the derived label back on NULL (gtkheaderbar.c:319-336) — so this child is
        // REMOVED rather than hidden, which is the only way the bar can rebuild the label.
        this._titleLabel = document.createElement('span');
        this._titleLabel.setAttribute('slot', 'title');
        this._titleLabel.textContent = 'Mailboxes';

        this.addContent(this._bar);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._bar) return;
        this._bar.setAttribute('decoration-layout', this.args.decorationLayout as string);
        this._bar.setAttribute('show-title-buttons', String(this.args.showTitleButtons as boolean));
        const custom = (this.args.titleWidget as string) === 'custom';
        const present = this._bar.querySelector('[slot="title"]') !== null;
        if (custom && !present) this._bar.appendChild(this._titleLabel as HTMLElement);
        if (!custom && present) (this._titleLabel as HTMLElement).remove();
    }
}

export const GtkHeaderBarWebStories: WebStoryModule = { stories: [GtkHeaderBarWebStory] };
