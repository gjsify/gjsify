// NativeScript port of the Inline View Switcher story. Shares metadata with the
// GTK inline-view-switcher.story.ts and browser inline-view-switcher.web.ts
// (imported from the GTK showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw, type AdwViewPage } from '@gjsify/adwaita-nativescript';
import { documentEditSymbolic, viewGridSymbolic } from '@gjsify/adwaita-icons/actions';
import { preferencesSystemSymbolic } from '@gjsify/adwaita-icons/categories';
import { inlineViewSwitcherMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

// The three pages, mirroring the native demo (Overview / Activity / Settings).
// `icon` is a REAL Adwaita symbolic SVG string (rendered large by Adw.StatusPage).
const PAGES: ReadonlyArray<{ title: string; icon: string; body: string }> = [
    { title: 'Overview', icon: viewGridSymbolic, body: 'A quick summary of your project.' },
    { title: 'Activity', icon: documentEditSymbolic, body: 'Recent edits and changes.' },
    { title: 'Settings', icon: preferencesSystemSymbolic, body: 'Configure how things behave.' },
];

export class InlineViewSwitcherNsStory extends StoryView {
    private _switcher: Adw.InlineViewSwitcher | null = null;

    constructor() {
        super(InlineViewSwitcherNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return inlineViewSwitcherMeta;
    }

    initialize(): void {
        this._switcher = new Adw.InlineViewSwitcher();
        this._syncViews();
        this.addContent(this._switcher);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncViews();
    }

    /** Rebuild the switcher buttons honouring the displayMode control
     *  (labels / icons / both) — the native Adw.InlineViewSwitcher display modes. */
    private _syncViews(): void {
        if (!this._switcher) return;
        const mode = (this.args.displayMode as string) ?? 'both';
        this._switcher.setViews(
            PAGES.map(
                (page): AdwViewPage => ({
                    title: mode === 'icons' ? '' : page.title,
                    icon: mode === 'labels' ? undefined : page.icon,
                    content: this._buildPage(page),
                }),
            ),
        );
    }

    private _buildPage(page: { title: string; icon: string; body: string }): Adw.StatusPage {
        const status = new Adw.StatusPage();
        status.iconName = page.icon;
        status.title = page.title;
        status.description = page.body;
        return status;
    }
}

export const InlineViewSwitcherNsStories: NsStoryModule = { stories: [InlineViewSwitcherNsStory] };
