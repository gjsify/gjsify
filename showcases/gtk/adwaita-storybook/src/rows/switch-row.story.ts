// Adw.SwitchRow — a boxed-list row pairing a title/subtitle with a switch.
// original implementation.

import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

/** Story: Adw.SwitchRow inside a boxed list (Adw.PreferencesGroup). */
export class SwitchRowStory extends StoryWidget {
    private _row: Adw.SwitchRow | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookSwitchRow' }, SwitchRowStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(SwitchRowStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return {
            title: 'Boxed Lists/Switch Row',
            description: 'Adw.SwitchRow — a preferences row with a trailing switch, shown inside a boxed list.',
            component: Adw.SwitchRow.$gtype,
            controls: [
                { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Automatic updates' },
                {
                    name: 'subtitle',
                    label: 'Subtitle',
                    type: ControlType.TEXT,
                    defaultValue: 'Download and install updates without asking',
                },
                { name: 'active', label: 'Active', type: ControlType.BOOLEAN, defaultValue: true },
            ],
        };
    }

    initialize(): void {
        this._row = new Adw.SwitchRow({
            title: this.args.title as string,
            subtitle: this.args.subtitle as string,
            active: this.args.active as boolean,
        });

        const group = new Adw.PreferencesGroup();
        group.add(this._row);

        const clamp = new Adw.Clamp({ maximumSize: 400, child: group });
        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._row) return;
        this._row.title = this.args.title as string;
        this._row.subtitle = this.args.subtitle as string;
        this._row.active = this.args.active as boolean;
    }
}

GObject.type_ensure(SwitchRowStory.$gtype);

export const SwitchRowStories: StoryModule = { stories: [SwitchRowStory] };
