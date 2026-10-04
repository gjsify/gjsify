// Browser port of the Expander story. Shares metadata with expander.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { expanderMeta } from '../../layout/expander.meta.js';

export class ExpanderWebStory extends StoryElement {
    private _expander: HTMLElement | null = null;

    constructor() {
        super(ExpanderWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return expanderMeta;
    }

    initialize(): void {
        this._expander = document.createElement('gtk-expander');
        this._expander.style.width = '320px';

        const content = document.createElement('gtk-box');
        content.setAttribute('orientation', 'vertical');
        content.setAttribute('spacing', '6');
        content.style.padding = '12px';
        for (const line of ['Notifications', 'Sound', 'Network']) {
            const label = document.createElement('gtk-label');
            label.setAttribute('label', line);
            content.appendChild(label);
        }
        this._expander.appendChild(content);

        this._apply();
        this.addContent(this._expander);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._expander) return;
        // `set_label` builds a real GtkLabel out of the string with `use_underline` and
        // `use_markup` forwarded to it (gtkexpander.c:974-979), so the two flags are set
        // BEFORE the text — the order the C's own docs give.
        this._expander.toggleAttribute('use-underline', this.args.useUnderline as boolean);
        this._expander.setAttribute('label', String(this.args.label));
        this._expander.toggleAttribute('resize-toplevel', this.args.resizeToplevel as boolean);
        this._expander.toggleAttribute('expanded', this.args.expanded as boolean);
    }
}

export const ExpanderWebStories: WebStoryModule = { stories: [ExpanderWebStory] };
