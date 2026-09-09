// NativeScript port of the View Switcher Bar story. Shares metadata with the GTK
// view-switcher-bar.story.ts and browser view-switcher-bar.web.ts (imported from
// the GTK showcase's renderer-agnostic *.meta.ts barrel).

// The story's `iconName` control offers THEME NAMES, and since `icon-theme.ts` the port
// resolves one — so the local name-to-SVG map that used to sit here is gone. Seven of
// these existed across this showcase, each re-implementing the `-symbolic` strip and a
// switch over three or four names, each with its own fallback.

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw } from '@gjsify/adwaita-nativescript';
import { VIEW_SWITCHER_BAR_PAGES, viewSwitcherBarMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';


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
            status.iconName = page.icon;
            status.title = page.title;
            status.description = `The ${page.title.toLowerCase()} page.`;
            stack.add(status, page.name, page.title, page.icon);
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
        view.set_content(stack);
        view.add_bottom_bar(bar);
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
