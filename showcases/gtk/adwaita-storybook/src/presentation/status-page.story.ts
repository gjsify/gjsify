// Adw.StatusPage — a centred empty/placeholder state with an icon, title,
// description and an optional action. original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { statusPageMeta } from './status-page.meta.js';

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
        return { ...statusPageMeta, component: Adw.StatusPage.$gtype };
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
