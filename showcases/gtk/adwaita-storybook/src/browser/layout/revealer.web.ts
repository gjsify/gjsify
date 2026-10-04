// Browser port of the Revealer story. Shares metadata with revealer.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { revealerMeta } from '../../layout/revealer.meta.js';

export class RevealerWebStory extends StoryElement {
    private _revealer: HTMLElement | null = null;

    constructor() {
        super(RevealerWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return revealerMeta;
    }

    initialize(): void {
        this._revealer = document.createElement('gtk-revealer');

        const content = document.createElement('gtk-box');
        content.setAttribute('orientation', 'vertical');
        content.setAttribute('spacing', '6');
        content.style.padding = '12px';

        const title = document.createElement('gtk-label');
        title.setAttribute('label', 'The revealed child');
        content.appendChild(title);

        const hint = document.createElement('gtk-label');
        hint.setAttribute('label', 'Use the controls to change the transition');
        hint.classList.add('dimmed');
        content.appendChild(hint);

        this._revealer.appendChild(content);
        this._apply();
        this.addContent(this._revealer);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._revealer) return;
        // The nicks ARE the attribute values, which is the whole reason the control's options
        // spell them the way the GIR does.
        this._revealer.setAttribute('transition-type', String(this.args.transitionType));
        this._revealer.setAttribute('transition-duration', String(this.args.transitionDuration));
        this._revealer.toggleAttribute('reveal-child', this.args.revealChild as boolean);
    }
}

export const RevealerWebStories: WebStoryModule = { stories: [RevealerWebStory] };
