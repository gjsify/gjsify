// Adw.NavigationView — a stack of navigation pages with push/pop and an
// automatic back button. original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { navigationViewMeta } from './navigation-view.meta.js';

/** Story: Adw.NavigationView with a root page that pushes a detail page. */
export class NavigationViewStory extends StoryWidget {
    private _view: Adw.NavigationView | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookNavigationView' }, NavigationViewStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(NavigationViewStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...navigationViewMeta, component: Adw.NavigationView.$gtype };
    }

    private buildPage(title: string, body: Gtk.Widget): Adw.NavigationPage {
        const toolbarView = new Adw.ToolbarView();
        toolbarView.add_top_bar(new Adw.HeaderBar());
        toolbarView.content = body;
        return new Adw.NavigationPage({ title, child: toolbarView });
    }

    initialize(): void {
        this._view = new Adw.NavigationView({
            animateTransitions: this.args.animateTransitions as boolean,
            widthRequest: 480,
            heightRequest: 340,
        });

        const detail = this.buildPage(
            this.args.detailTitle as string,
            new Adw.StatusPage({
                iconName: 'avatar-default-symbolic',
                title: this.args.detailTitle as string,
                description: 'Mathematician and writer, the first computer programmer.',
                vexpand: true,
            }),
        );

        const openButton = new Gtk.Button({
            label: 'Open contact',
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            vexpand: true,
        });
        openButton.add_css_class('pill');
        openButton.add_css_class('suggested-action');
        openButton.connect('clicked', () => {
            this._view?.push(detail);
        });

        const root = this.buildPage(this.args.rootTitle as string, openButton);

        this._view.add(root);
        this._view.add(detail);
        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._view) return;
        this._view.animateTransitions = this.args.animateTransitions as boolean;
    }
}

GObject.type_ensure(NavigationViewStory.$gtype);

export const NavigationViewStories: StoryModule = { stories: [NavigationViewStory] };
