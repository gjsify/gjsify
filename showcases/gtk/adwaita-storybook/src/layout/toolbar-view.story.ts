// Adw.ToolbarView — wraps content between revealable top and bottom toolbars.
// original implementation.

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import GObject from '@girs/gobject-2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

/** Story: Adw.ToolbarView with a header bar, status-page content and a bottom action bar. */
export class ToolbarViewStory extends StoryWidget {
    private _view: Adw.ToolbarView | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookToolbarView' }, ToolbarViewStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ToolbarViewStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return {
            title: 'Layout/Toolbar View',
            description:
                'Adw.ToolbarView pins a top header bar and a bottom toolbar around its content, each independently revealable.',
            component: Adw.ToolbarView.$gtype,
            controls: [
                { name: 'revealTopBars', label: 'Reveal top bars', type: ControlType.BOOLEAN, defaultValue: true },
                {
                    name: 'revealBottomBars',
                    label: 'Reveal bottom bars',
                    type: ControlType.BOOLEAN,
                    defaultValue: true,
                },
            ],
        };
    }

    initialize(): void {
        this._view = new Adw.ToolbarView({
            widthRequest: 460,
            heightRequest: 320,
            revealTopBars: this.args.revealTopBars as boolean,
            revealBottomBars: this.args.revealBottomBars as boolean,
        });

        const header = new Adw.HeaderBar({
            titleWidget: new Adw.WindowTitle({ title: 'Documents', subtitle: '12 items' }),
        });
        this._view.add_top_bar(header);

        const content = new Adw.StatusPage({
            iconName: 'folder-documents-symbolic',
            title: 'Your library',
            description: 'Content sits between the toolbars and scrolls independently of them.',
        });
        this._view.content = content;

        const bottomBar = new Gtk.ActionBar();
        const addButton = new Gtk.Button({ iconName: 'list-add-symbolic' });
        addButton.add_css_class('flat');
        const removeButton = new Gtk.Button({ iconName: 'list-remove-symbolic' });
        removeButton.add_css_class('flat');
        bottomBar.pack_start(addButton);
        bottomBar.pack_start(removeButton);
        bottomBar.set_center_widget(new Gtk.Label({ label: 'Selection: none' }));
        const shareButton = new Gtk.Button({ iconName: 'send-to-symbolic' });
        shareButton.add_css_class('flat');
        bottomBar.pack_end(shareButton);
        this._view.add_bottom_bar(bottomBar);

        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._view) return;
        this._view.revealTopBars = this.args.revealTopBars as boolean;
        this._view.revealBottomBars = this.args.revealBottomBars as boolean;
    }
}

GObject.type_ensure(ToolbarViewStory.$gtype);

export const ToolbarViewStories: StoryModule = { stories: [ToolbarViewStory] };
