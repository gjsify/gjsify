// Adw.SplitButton — a button with a main action plus an attached dropdown menu.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { splitButtonFlatMeta, splitButtonMeta } from './split-button.meta.js';

/** Builds the shared dropdown menu model used by both split-button variants. */
function buildMenu(): Gio.Menu {
    const menu = new Gio.Menu();
    menu.append('Save as…', 'app.save-as');
    menu.append('Export', 'app.export');
    menu.append('Print', 'app.print');
    return menu;
}

/** Story: Adw.SplitButton with a primary action and a dropdown menu. */
export class SplitButtonStory extends StoryWidget {
    private _widget: Adw.SplitButton | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookSplitButton' }, SplitButtonStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(SplitButtonStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...splitButtonMeta, component: Adw.SplitButton.$gtype };
    }

    initialize(): void {
        this._widget = new Adw.SplitButton({
            label: this.args.label as string,
            menuModel: buildMenu(),
        });
        const iconName = this.args.iconName as string;
        if (iconName) {
            this._widget.iconName = iconName;
        }
        this.addContent(this._widget);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._widget) return;
        const iconName = this.args.iconName as string;
        if (iconName) {
            this._widget.iconName = iconName;
        } else {
            this._widget.label = this.args.label as string;
        }
    }
}

GObject.type_ensure(SplitButtonStory.$gtype);

/** Story: a flat-styled Adw.SplitButton, suited to header bars and toolbars. */
export class SplitButtonFlatStory extends StoryWidget {
    private _widget: Adw.SplitButton | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookSplitButtonFlat' }, SplitButtonFlatStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(SplitButtonFlatStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...splitButtonFlatMeta, component: Adw.SplitButton.$gtype };
    }

    initialize(): void {
        this._widget = new Adw.SplitButton({
            label: this.args.label as string,
            menuModel: buildMenu(),
        });
        this._widget.add_css_class('flat');
        const iconName = this.args.iconName as string;
        if (iconName) {
            this._widget.iconName = iconName;
        }
        this.addContent(this._widget);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._widget) return;
        const iconName = this.args.iconName as string;
        if (iconName) {
            this._widget.iconName = iconName;
        } else {
            this._widget.label = this.args.label as string;
        }
    }
}

GObject.type_ensure(SplitButtonFlatStory.$gtype);

export const SplitButtonStories: StoryModule = { stories: [SplitButtonStory, SplitButtonFlatStory] };
