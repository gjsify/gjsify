// NativeScript port of the View Switcher Bar story. Shares metadata with the GTK
// view-switcher-bar.story.ts and browser view-switcher-bar.web.ts (imported from
// the GTK showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw } from '@gjsify/adwaita-nativescript';
import { folderSymbolic } from '@gjsify/adwaita-icons/places';
import { mailUnreadSymbolic, starredSymbolic } from '@gjsify/adwaita-icons/status';
import { VIEW_SWITCHER_BAR_PAGES, viewSwitcherBarMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

// The GTK icon NAME the meta carries, resolved to the SVG string this renderer draws.
const ICONS: Record<string, string> = {
    'mail-unread-symbolic': mailUnreadSymbolic,
    'starred-symbolic': starredSymbolic,
    'folder-symbolic': folderSymbolic,
};

export class ViewSwitcherBarNsStory extends StoryView {
    private _bar: Adw.ViewSwitcherBar | null = null;

    constructor() {
        super(ViewSwitcherBarNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return viewSwitcherBarMeta;
    }

    initialize(): void {
        const stack = new Adw.ViewStack();
        for (const page of VIEW_SWITCHER_BAR_PAGES) {
            const status = new Adw.StatusPage();
            status.iconName = ICONS[page.icon] ?? '';
            status.title = page.title;
            status.description = `The ${page.title.toLowerCase()} page.`;
            stack.add(status, page.name, page.title, ICONS[page.icon]);
        }

        const bar = new Adw.ViewSwitcherBar();
        bar.stack = stack;
        // The NativeScript stack has no `items-changed`, so a bar bound before the
        // pages exist would render no buttons. `refresh()` is that missing signal,
        // spelled by hand — the widget's own header says so.
        bar.refresh();
        this._bar = bar;
        this._apply();

        // A toolbar view, so the bar sits at the bottom edge the way libadwaita
        // places it — and because `addContent` REPLACES the stage, so the stack and
        // the bar have to arrive as one view.
        const view = new Adw.ToolbarView();
        view.setContent(stack);
        view.addBottomBar(bar);
        this.addContent(view);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._bar) return;
        this._bar.reveal = this.args.reveal as boolean;
    }
}

export const ViewSwitcherBarNsStories: NsStoryModule = { stories: [ViewSwitcherBarNsStory] };
