// Gtk.Button style classes — .pill, .circular, .suggested-action,
// .destructive-action, .flat. original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { buttonStylesMeta } from './button-styles.meta.js';

const STYLE_CLASSES = ['pill', 'circular', 'suggested-action', 'destructive-action', 'flat'] as const;

/** Story: a row of Gtk.Buttons demonstrating the standard Adwaita style classes. */
export class ButtonStylesStory extends StoryWidget {
    private _demo: Gtk.Button | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookButtonStyles' }, ButtonStylesStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ButtonStylesStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...buttonStylesMeta, component: Gtk.Button.$gtype };
    }

    initialize(): void {
        // Adw.WrapBox so the row reflows onto multiple lines instead of
        // overflowing when the preview is narrow.
        const box = new Adw.WrapBox({ childSpacing: 12, lineSpacing: 12, halign: Gtk.Align.CENTER });

        const pill = new Gtk.Button({ label: 'Pill' });
        pill.add_css_class('pill');
        box.append(pill);

        const circular = new Gtk.Button({ iconName: 'list-add-symbolic' });
        circular.add_css_class('circular');
        box.append(circular);

        const suggested = new Gtk.Button({ label: 'Suggested' });
        suggested.add_css_class('suggested-action');
        box.append(suggested);

        const destructive = new Gtk.Button({ label: 'Delete' });
        destructive.add_css_class('destructive-action');
        box.append(destructive);

        const flat = new Gtk.Button({ label: 'Flat' });
        flat.add_css_class('flat');
        box.append(flat);

        this._demo = new Gtk.Button({ label: this.args.label as string });
        this._applyStyle(this.args.style as string);
        box.append(this._demo);

        this.addContent(box);
    }

    private _applyStyle(style: string): void {
        if (!this._demo) return;
        for (const cls of STYLE_CLASSES) {
            this._demo.remove_css_class(cls);
        }
        this._demo.add_css_class(style);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._demo) return;
        this._demo.label = this.args.label as string;
        this._applyStyle(this.args.style as string);
    }
}

GObject.type_ensure(ButtonStylesStory.$gtype);

export const ButtonStylesStories: StoryModule = { stories: [ButtonStylesStory] };
