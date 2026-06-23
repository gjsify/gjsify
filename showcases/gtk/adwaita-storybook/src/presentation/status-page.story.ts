// Adw.StatusPage — a centred empty/placeholder state with an icon, title,
// description and an optional action. original implementation.

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import GObject from '@girs/gobject-2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

/** Story: Adw.StatusPage with a suggested-action pill button. */
export class StatusPageStory extends StoryWidget {
    private _statusPage: Adw.StatusPage | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookStatusPage' }, StatusPageStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(StatusPageStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return {
            title: 'Presentation/Status Page',
            description:
                'Adw.StatusPage — a full-page empty state with an icon, title, description and optional action.',
            component: Adw.StatusPage.$gtype,
            controls: [
                {
                    name: 'iconName',
                    label: 'Icon',
                    type: ControlType.SELECT,
                    options: [
                        { label: 'Folder', value: 'folder-symbolic' },
                        { label: 'Mail', value: 'mail-unread-symbolic' },
                        { label: 'Search', value: 'system-search-symbolic' },
                        { label: 'Star', value: 'starred-symbolic' },
                    ],
                    defaultValue: 'folder-symbolic',
                },
                { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'No Documents' },
                {
                    name: 'description',
                    label: 'Description',
                    type: ControlType.TEXT,
                    defaultValue: 'Documents you create or open will appear here.',
                },
            ],
        };
    }

    initialize(): void {
        const button = new Gtk.Button({
            label: 'New Document',
            halign: Gtk.Align.CENTER,
            cssClasses: ['pill', 'suggested-action'],
        });

        this._statusPage = new Adw.StatusPage({
            iconName: this.args.iconName as string,
            title: this.args.title as string,
            description: this.args.description as string,
            child: button,
            widthRequest: 460,
            heightRequest: 320,
        });

        this.addContent(this._statusPage);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._statusPage) return;
        this._statusPage.iconName = this.args.iconName as string;
        this._statusPage.title = this.args.title as string;
        this._statusPage.description = this.args.description as string;
    }
}

GObject.type_ensure(StatusPageStory.$gtype);

export const StatusPageStories: StoryModule = { stories: [StatusPageStory] };
