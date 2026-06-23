// Adw.Banner — a full-width bar for a single in-context message, with an
// optional action button. original implementation.

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import GObject from '@girs/gobject-2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

/** Story: Adw.Banner shown full-width inside a sized container. */
export class BannerStory extends StoryWidget {
    private _banner: Adw.Banner | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookBanner' }, BannerStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(BannerStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return {
            title: 'Presentation/Banner',
            description: 'Adw.Banner — a full-width strip carrying a status message and an optional action button.',
            component: Adw.Banner.$gtype,
            controls: [
                {
                    name: 'title',
                    label: 'Title',
                    type: ControlType.TEXT,
                    defaultValue: 'Metered connection — updates paused',
                },
                { name: 'buttonLabel', label: 'Button label', type: ControlType.TEXT, defaultValue: 'Resume' },
                { name: 'revealed', label: 'Revealed', type: ControlType.BOOLEAN, defaultValue: true },
                { name: 'useMarkup', label: 'Use markup', type: ControlType.BOOLEAN, defaultValue: false },
            ],
        };
    }

    initialize(): void {
        this._banner = new Adw.Banner({
            title: this.args.title as string,
            buttonLabel: this.args.buttonLabel as string,
            revealed: this.args.revealed as boolean,
            useMarkup: this.args.useMarkup as boolean,
        });

        const container = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            widthRequest: 460,
        });
        container.append(this._banner);
        this.addContent(container);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._banner) return;
        this._banner.title = this.args.title as string;
        this._banner.buttonLabel = this.args.buttonLabel as string;
        this._banner.revealed = this.args.revealed as boolean;
        this._banner.useMarkup = this.args.useMarkup as boolean;
    }
}

GObject.type_ensure(BannerStory.$gtype);

export const BannerStories: StoryModule = { stories: [BannerStory] };
