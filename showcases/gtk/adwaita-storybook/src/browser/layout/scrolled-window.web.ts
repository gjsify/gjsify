// Browser port of the Scrolled Window story. Shares metadata with scrolled-window.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { scrolledWindowMeta } from '../../layout/scrolled-window.meta.js';

export class ScrolledWindowWebStory extends StoryElement {
    private _window: HTMLElement | null = null;

    constructor() {
        super(ScrolledWindowWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return scrolledWindowMeta;
    }

    initialize(): void {
        const window = document.createElement('gtk-scrolled-window');
        // An ALLOCATION, which is what GTK hands this widget and what makes it scroll rather
        // than grow: an auto-height box grows with its content and has nothing to scroll.
        window.style.height = '240px';
        window.style.width = '260px';
        const box = document.createElement('gtk-box');
        box.setAttribute('orientation', 'vertical');
        box.setAttribute('spacing', '8');
        for (let i = 1; i <= 16; i++) {
            const label = document.createElement('gtk-label');
            label.setAttribute('label', `Row ${i}`);
            box.appendChild(label);
        }
        window.appendChild(box);
        this._window = window;
        this._apply();
        this.addContent(window);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        const window = this._window;
        if (!window) return;
        window.setAttribute('hscrollbar-policy', this.args.hPolicy as string);
        window.setAttribute('vscrollbar-policy', this.args.vPolicy as string);
        window.setAttribute('window-placement', this.args.placement as string);
        window.toggleAttribute('has-frame', this.args.frame as boolean);
        window.toggleAttribute('overlay-scrolling', this.args.overlayScrolling as boolean);
    }
}

export const ScrolledWindowWebStories: WebStoryModule = { stories: [ScrolledWindowWebStory] };
