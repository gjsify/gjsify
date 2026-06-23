// Adw.WrapBox — a box that lays children out in a line, wrapping onto new lines as needed.
// original implementation.

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import GObject from '@girs/gobject-2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

/** Story: Adw.WrapBox flowing a set of chip-like buttons across multiple lines. */
export class WrapBoxStory extends StoryWidget {
    private _wrap: Adw.WrapBox | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookWrapBox' }, WrapBoxStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(WrapBoxStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return {
            title: 'Layout/Wrap Box',
            description:
                'Adw.WrapBox flows its children horizontally and wraps them onto new lines when they run out of room.',
            component: Adw.WrapBox.$gtype,
            controls: [
                {
                    name: 'childSpacing',
                    label: 'Child spacing',
                    type: ControlType.RANGE,
                    min: 0,
                    max: 36,
                    step: 1,
                    defaultValue: 8,
                },
                {
                    name: 'lineSpacing',
                    label: 'Line spacing',
                    type: ControlType.RANGE,
                    min: 0,
                    max: 36,
                    step: 1,
                    defaultValue: 8,
                },
            ],
        };
    }

    initialize(): void {
        this._wrap = new Adw.WrapBox({
            childSpacing: this.args.childSpacing as number,
            lineSpacing: this.args.lineSpacing as number,
            widthRequest: 460,
        });

        const tags = ['Design', 'Adwaita', 'GNOME', 'GTK', 'Typescript', 'Storybook', 'Wrapping', 'Layout'];
        for (const tag of tags) {
            const chip = new Gtk.Button({ label: tag });
            chip.add_css_class('pill');
            this._wrap.append(chip);
        }

        this.addContent(this._wrap);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._wrap) return;
        this._wrap.childSpacing = this.args.childSpacing as number;
        this._wrap.lineSpacing = this.args.lineSpacing as number;
    }
}

GObject.type_ensure(WrapBoxStory.$gtype);

export const WrapBoxStories: StoryModule = { stories: [WrapBoxStory] };
