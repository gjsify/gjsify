// Browser port of the View Switcher Bar story. Shares metadata with
// view-switcher-bar.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
// TYPE-ONLY: the bar is driven through `setStack()`/`reveal`, not attributes, and a
// hand-written structural interface here would be a second copy of that API that
// nothing keeps in step. The import erases, so the bundle keeps no edge to the package.
import type { Adw } from '@gjsify/adwaita-web';
import { VIEW_SWITCHER_BAR_PAGES, viewSwitcherBarMeta } from '../../view-switching/view-switcher-bar.meta.js';

export class ViewSwitcherBarWebStory extends StoryElement {
    private _bar: Adw.ViewSwitcherBar | null = null;

    constructor() {
        super(ViewSwitcherBarWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return viewSwitcherBarMeta;
    }

    initialize(): void {
        const stack = document.createElement('adw-view-stack') as Adw.ViewStack;
        stack.style.flex = '1';
        for (const page of VIEW_SWITCHER_BAR_PAGES) {
            const status = document.createElement('adw-status-page');
            status.setAttribute('icon', page.icon.replace(/-symbolic$/, ''));
            status.setAttribute('title', page.title);
            status.setAttribute('description', `The ${page.title.toLowerCase()} page.`);
            const child = document.createElement('adw-view-stack-page');
            child.setAttribute('name', page.name);
            child.setAttribute('title', page.title);
            child.setAttribute('icon-name', page.icon.replace(/-symbolic$/, ''));
            child.appendChild(status);
            stack.appendChild(child);
        }

        const bar = document.createElement('adw-view-switcher-bar') as Adw.ViewSwitcherBar;
        bar.setAttribute('slot', 'bottom');

        // A toolbar view, so the bar sits where libadwaita puts it — at the bottom
        // edge — rather than floating in the middle of the preview.
        const view = document.createElement('adw-toolbar-view');
        view.style.width = '360px';
        view.style.height = '360px';
        view.append(stack, bar);
        this.addContent(view);

        // Bound AFTER the stack is in the document: the bar derives its buttons from
        // the stack's pages, and those only exist once the `<adw-view-stack-page>`
        // children have upgraded.
        bar.setStack(stack);
        this._bar = bar;
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._bar) return;
        this._bar.reveal = this.args.reveal as boolean;
    }
}

export const ViewSwitcherBarWebStories: WebStoryModule = { stories: [ViewSwitcherBarWebStory] };
