// Adw.ButtonContent — an icon-plus-label child for a Gtk.Button, with optional
// shrinking. original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { buttonContentMeta } from './button-content.meta.js';

/** Story: Adw.ButtonContent placed inside a Gtk.Button. */
export class ButtonContentStory extends StoryWidget {
    private _content: Adw.ButtonContent | null = null;
    private _button: Gtk.Button | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookButtonContent' }, ButtonContentStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ButtonContentStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...buttonContentMeta, component: Adw.ButtonContent.$gtype };
    }

    initialize(): void {
        this._content = new Adw.ButtonContent({
            label: this.args.label as string,
            iconName: this.args.iconName as string,
            canShrink: this.args.canShrink as boolean,
        });
        this._button = new Gtk.Button({ child: this._content });
        this._button.add_css_class('suggested-action');
        this._button.add_css_class('pill');
        this.addContent(this._button);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._content) return;
        this._content.label = this.args.label as string;
        this._content.iconName = this.args.iconName as string;
        this._content.canShrink = this.args.canShrink as boolean;
    }
}

GObject.type_ensure(ButtonContentStory.$gtype);

export const ButtonContentStories: StoryModule = { stories: [ButtonContentStory] };
