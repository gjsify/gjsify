// NativeScript port of the Inline View Switcher story. Shares metadata with the
// GTK inline-view-switcher.story.ts and browser inline-view-switcher.web.ts
// (imported from the GTK showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { AdwInlineViewSwitcher, AdwStatusPage, type AdwViewPage } from '@gjsify/adwaita-nativescript';
import { inlineViewSwitcherMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

// The three pages, mirroring the native demo (Overview / Activity / Settings).
// `icon` is a glyph (AdwStatusPage has no icon-theme lookup in the CSS subset).
const PAGES: ReadonlyArray<{ title: string; icon: string; body: string }> = [
    { title: 'Overview', icon: '▦', body: 'A quick summary of your project.' },
    { title: 'Activity', icon: '✎', body: 'Recent edits and changes.' },
    { title: 'Settings', icon: '⚙', body: 'Configure how things behave.' },
];

export class InlineViewSwitcherNsStory extends StoryView {
    private _switcher: AdwInlineViewSwitcher | null = null;

    constructor() {
        super(InlineViewSwitcherNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return inlineViewSwitcherMeta;
    }

    initialize(): void {
        const switcher = new AdwInlineViewSwitcher();
        switcher.setViews(PAGES.map((page): AdwViewPage => ({ title: page.title, content: this._buildPage(page) })));
        this._switcher = switcher;
        // displayMode (labels / icons / both) has no NS equivalent — the switcher
        // buttons are always text labels (see fidelity note). Read it to keep the
        // control bound.
        void (this.args.displayMode as string);
        this.addContent(switcher);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._switcher) return;
        void (this.args.displayMode as string);
    }

    private _buildPage(page: { title: string; icon: string; body: string }): AdwStatusPage {
        const status = new AdwStatusPage();
        status.iconText = page.icon;
        status.title = page.title;
        status.description = page.body;
        return status;
    }
}

export const InlineViewSwitcherNsStories: NsStoryModule = { stories: [InlineViewSwitcherNsStory] };
