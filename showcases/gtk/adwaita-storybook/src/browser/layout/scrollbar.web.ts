// Browser port of the Scrollbar story. Shares metadata with scrollbar.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { scrollbarMeta } from '../../layout/scrollbar.meta.js';

/** The scrollbar the web element IS: the adjustment plus the orientation. */
interface WebScrollbar extends HTMLElement {
    adjustment: Record<string, number>;
}

export class ScrollbarWebStory extends StoryElement {
    private _scrollbar: WebScrollbar | null = null;

    constructor() {
        super(ScrollbarWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return scrollbarMeta;
    }

    initialize(): void {
        const scrollbar = document.createElement('gtk-scrollbar') as WebScrollbar;
        // The element is a bar with no thickness of its own in a column, so the allocation is
        // the one GTK would give it inside a scrolled window.
        scrollbar.style.height = '240px';
        scrollbar.style.width = '24px';
        scrollbar.setAttribute('valign', 'center');
        this._scrollbar = scrollbar;
        this._apply();
        this.addContent(scrollbar);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        const scrollbar = this._scrollbar;
        if (!scrollbar) return;
        scrollbar.setAttribute('orientation', this.args.orientation as string);
        // One write for the whole adjustment, the way `gtk_adjustment_configure` takes it.
        scrollbar.adjustment = {
            value: Number(this.args.value),
            lower: 0,
            upper: Number(this.args.upper),
            stepIncrement: 10,
            pageIncrement: 80,
            pageSize: Number(this.args.pageSize),
        };
    }
}

export const ScrollbarWebStories: WebStoryModule = { stories: [ScrollbarWebStory] };
