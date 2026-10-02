// Browser port of the View Switcher Sidebar story — an <adw-view-switcher-sidebar> beside
// the <adw-view-stack> it drives, with the same sections, badge and unread dot as the GTK
// twin. Shares its metadata with view-switcher-sidebar.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import type { Adw } from '@gjsify/adwaita-web';
import {
    VIEW_SWITCHER_SIDEBAR_PAGES,
    viewSwitcherSidebarMeta,
} from '../../view-switching/view-switcher-sidebar.meta.js';

export class ViewSwitcherSidebarWebStory extends StoryElement {
    private _switcher: Adw.ViewSwitcherSidebar | null = null;

    constructor() {
        super(ViewSwitcherSidebarWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return viewSwitcherSidebarMeta;
    }

    initialize(): void {
        const stack = document.createElement('adw-view-stack') as Adw.ViewStack;
        stack.style.flex = '1';

        for (const spec of VIEW_SWITCHER_SIDEBAR_PAGES) {
            const page = document.createElement('adw-view-stack-page');
            page.setAttribute('name', spec.name);
            page.setAttribute('title', spec.title);
            page.setAttribute('icon-name', spec.icon);
            if (spec.sectionTitle) {
                // The section opens ON this page, and the heading is its own.
                page.setAttribute('starts-section', '');
                page.setAttribute('section-title', spec.sectionTitle);
            }
            if (spec.badgeNumber) page.setAttribute('badge-number', String(spec.badgeNumber));
            if (spec.needsAttention) page.setAttribute('needs-attention', '');
            page.appendChild(this._buildContent(spec.icon, spec.title));
            stack.appendChild(page);
        }

        const switcher = document.createElement('adw-view-switcher-sidebar') as Adw.ViewSwitcherSidebar;
        switcher.style.width = '200px';
        // The stack is the sibling declared right after the switcher, which is the
        // nearest one the element can find when the attribute names no id.
        this._switcher = switcher;

        const stage = document.createElement('div');
        stage.style.display = 'flex';
        stage.style.flexDirection = 'row';
        stage.style.width = '480px';
        stage.style.height = '340px';
        stage.append(switcher, stack);
        this.addContent(stage);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _buildContent(icon: string, title: string): HTMLElement {
        const status = document.createElement('adw-status-page');
        status.setAttribute('icon', icon.replace(/-symbolic$/, ''));
        status.setAttribute('title', title);
        return status;
    }

    private _apply(): void {
        const switcher = this._switcher;
        if (switcher === null) return;
        switcher.mode = (this.args.mode as boolean) ? 'page' : 'sidebar';
    }
}

export const ViewSwitcherSidebarWebStories: WebStoryModule = { stories: [ViewSwitcherSidebarWebStory] };
