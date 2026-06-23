// Adw.NavigationView — a stack of navigation pages with push/pop and an
// automatic back button. original implementation.

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import GObject from '@girs/gobject-2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

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
        return {
            title: 'Navigation/Navigation View',
            description:
                'Adw.NavigationView — a navigation stack. The root page pushes a detail page, which gets an automatic back button.',
            component: Adw.NavigationView.$gtype,
            controls: [
                { name: 'rootTitle', label: 'Root title', type: ControlType.TEXT, defaultValue: 'Contacts' },
                { name: 'detailTitle', label: 'Detail title', type: ControlType.TEXT, defaultValue: 'Ada Lovelace' },
                {
                    name: 'animateTransitions',
                    label: 'Animate transitions',
                    type: ControlType.BOOLEAN,
                    defaultValue: true,
                },
            ],
        };
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
