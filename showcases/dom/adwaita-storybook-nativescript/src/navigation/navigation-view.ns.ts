// NativeScript port of the Navigation View story. Shares metadata with the GTK
// navigation-view.story.ts and browser navigation-view.web.ts (imported from the
// GTK showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw, Gtk } from '@gjsify/adwaita-nativescript';
import { avatarDefaultSymbolic } from '@gjsify/adwaita-icons/status';
import { navigationViewMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class NavigationViewNsStory extends StoryView {
    private _view: Adw.NavigationView | null = null;
    private _rootHeader: Adw.HeaderBar | null = null;
    private _detailHeader: Adw.HeaderBar | null = null;
    private _detailStatus: Adw.StatusPage | null = null;

    constructor() {
        super(NavigationViewNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return navigationViewMeta;
    }

    initialize(): void {
        this._view = new Adw.NavigationView();
        this._view.width = 480;
        this._view.height = 340;

        // --- Detail page: a status page describing the contact. ---
        const detailTitle = this.args.detailTitle as string;
        this._detailHeader = new Adw.HeaderBar();
        this._detailHeader.title = detailTitle;

        this._detailStatus = new Adw.StatusPage();
        this._detailStatus.iconName = avatarDefaultSymbolic;
        this._detailStatus.title = detailTitle;
        this._detailStatus.description = 'Mathematician and writer, the first computer programmer.';

        const detailToolbar = new Adw.ToolbarView();
        detailToolbar.addTopBar(this._detailHeader);
        detailToolbar.setContent(this._detailStatus);

        // --- Root page: an "Open contact" pill button that pushes the detail. ---
        this._rootHeader = new Adw.HeaderBar();
        this._rootHeader.title = this.args.rootTitle as string;

        const openButton = new Gtk.Button();
        openButton.text = 'Open contact';
        openButton.cssClasses = 'pill';
        openButton.horizontalAlignment = 'center';
        openButton.verticalAlignment = 'middle';
        openButton.addEventListener('tap', () => {
            this._view?.push('detail');
        });

        const rootToolbar = new Adw.ToolbarView();
        rootToolbar.addTopBar(this._rootHeader);
        rootToolbar.setContent(openButton);

        // Root is registered first (auto-pushed); the detail is reachable via
        // push-by-tag from the root button.
        this._view.add(rootToolbar, 'root');
        this._view.add(detailToolbar, 'detail');

        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._view) return;
        this._view.animateTransitions = this.args.animateTransitions as boolean;
        if (this._rootHeader) this._rootHeader.title = this.args.rootTitle as string;
        const detailTitle = this.args.detailTitle as string;
        if (this._detailHeader) this._detailHeader.title = detailTitle;
        if (this._detailStatus) this._detailStatus.title = detailTitle;
    }
}

export const NavigationViewNsStories: NsStoryModule = { stories: [NavigationViewNsStory] };
