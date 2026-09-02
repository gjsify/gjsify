// Adw.ButtonRow — a boxed-list row that behaves like a button, with an optional
// start icon and an applied style class. original implementation.

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { buttonRowMeta } from './button-row.meta.js';

const STYLE_CLASSES = ['suggested-action', 'destructive-action'];

/** Story: Adw.ButtonRow inside a boxed list, with a switchable style class. */
export class ButtonRowStory extends StoryWidget {
    private _row: Adw.ButtonRow | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookButtonRow' }, ButtonRowStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ButtonRowStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...buttonRowMeta, component: Adw.ButtonRow.$gtype };
    }

    initialize(): void {
        this._row = new Adw.ButtonRow({
            title: this.args.title as string,
            startIconName: this.args.startIconName as string,
        });
        this._applyStyle(this.args.style as string);

        const group = new Adw.PreferencesGroup();
        group.add(this._row);

        const clamp = new Adw.Clamp({ maximumSize: 400, child: group });
        this.addContent(clamp);
    }

    private _applyStyle(style: string): void {
        if (!this._row) return;
        for (const cls of STYLE_CLASSES) {
            this._row.remove_css_class(cls);
        }
        if (style !== 'none') {
            this._row.add_css_class(style);
        }
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._row) return;
        this._row.title = this.args.title as string;
        this._row.startIconName = this.args.startIconName as string;
        this._applyStyle(this.args.style as string);
    }
}

GObject.type_ensure(ButtonRowStory.$gtype);

export const ButtonRowStories: StoryModule = { stories: [ButtonRowStory] };
