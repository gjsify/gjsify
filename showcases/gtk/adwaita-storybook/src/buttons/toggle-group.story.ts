// Adw.ToggleGroup — a linked set of Adw.Toggle buttons with a single active item.
// original implementation.

import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

const STYLE_CLASSES = ['flat', 'round'] as const;

/** Story: Adw.ToggleGroup populated with three Adw.Toggle items. */
export class ToggleGroupStory extends StoryWidget {
    private _toggleGroup: Adw.ToggleGroup | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookToggleGroup' }, ToggleGroupStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ToggleGroupStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return {
            title: 'Buttons/Toggle Group',
            description: 'Adw.ToggleGroup — a linked group of Adw.Toggle buttons where exactly one is active.',
            component: Adw.ToggleGroup.$gtype,
            controls: [
                {
                    name: 'active',
                    label: 'Active toggle',
                    type: ControlType.SELECT,
                    options: [
                        { label: 'List', value: 0 },
                        { label: 'Grid', value: 1 },
                        { label: 'Columns', value: 2 },
                    ],
                    defaultValue: 0,
                },
                {
                    name: 'style',
                    label: 'Style',
                    type: ControlType.SELECT,
                    options: [
                        { label: 'Default', value: 'default' },
                        { label: 'Flat', value: 'flat' },
                        { label: 'Round', value: 'round' },
                    ],
                    defaultValue: 'default',
                },
            ],
        };
    }

    initialize(): void {
        this._toggleGroup = new Adw.ToggleGroup();
        this._toggleGroup.add(new Adw.Toggle({ label: 'List', iconName: 'view-list-symbolic' }));
        this._toggleGroup.add(new Adw.Toggle({ label: 'Grid', iconName: 'view-grid-symbolic' }));
        this._toggleGroup.add(new Adw.Toggle({ label: 'Columns', iconName: 'view-columns-symbolic' }));
        this._toggleGroup.active = this.args.active as number;
        this._applyStyle(this.args.style as string);
        this.addContent(this._toggleGroup);
    }

    private _applyStyle(style: string): void {
        if (!this._toggleGroup) return;
        for (const cls of STYLE_CLASSES) {
            this._toggleGroup.remove_css_class(cls);
        }
        if (style !== 'default') {
            this._toggleGroup.add_css_class(style);
        }
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._toggleGroup) return;
        this._toggleGroup.active = this.args.active as number;
        this._applyStyle(this.args.style as string);
    }
}

GObject.type_ensure(ToggleGroupStory.$gtype);

export const ToggleGroupStories: StoryModule = { stories: [ToggleGroupStory] };
