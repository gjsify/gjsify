// Adw.SplitButton — a button with a main action plus an attached dropdown menu.
// original implementation.

import Adw from '@girs/adw-1';
import Gio from '@girs/gio-2.0';
import GObject from '@girs/gobject-2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

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
        return {
            title: 'Buttons/Split Button',
            description: 'Adw.SplitButton — a primary action button paired with a dropdown menu of related actions.',
            component: Adw.SplitButton.$gtype,
            controls: [
                { name: 'label', label: 'Label', type: ControlType.TEXT, defaultValue: 'Save' },
                {
                    name: 'iconName',
                    label: 'Icon',
                    type: ControlType.SELECT,
                    options: [
                        { label: 'None', value: '' },
                        { label: 'Save', value: 'document-save-symbolic' },
                        { label: 'Send', value: 'mail-send-symbolic' },
                        { label: 'Add', value: 'list-add-symbolic' },
                    ],
                    defaultValue: 'document-save-symbolic',
                },
            ],
        };
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
        return {
            title: 'Buttons/Split Button Flat',
            description: 'Adw.SplitButton with the .flat style class, as used inside header bars and toolbars.',
            component: Adw.SplitButton.$gtype,
            controls: [
                { name: 'label', label: 'Label', type: ControlType.TEXT, defaultValue: 'Reply' },
                {
                    name: 'iconName',
                    label: 'Icon',
                    type: ControlType.SELECT,
                    options: [
                        { label: 'None', value: '' },
                        { label: 'Reply', value: 'mail-reply-sender-symbolic' },
                        { label: 'Edit', value: 'document-edit-symbolic' },
                        { label: 'Open', value: 'document-open-symbolic' },
                    ],
                    defaultValue: 'mail-reply-sender-symbolic',
                },
            ],
        };
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
