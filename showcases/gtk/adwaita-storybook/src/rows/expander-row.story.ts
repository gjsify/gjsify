// Adw.ExpanderRow — a boxed-list row that reveals nested rows when expanded, with
// an optional enable switch. original implementation.

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { expanderRowMeta } from './expander-row.meta.js';

/** Story: Adw.ExpanderRow with two nested rows inside a boxed list. */
export class ExpanderRowStory extends StoryWidget {
    private _row: Adw.ExpanderRow | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookExpanderRow' }, ExpanderRowStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ExpanderRowStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...expanderRowMeta, component: Adw.ExpanderRow.$gtype };
    }

    initialize(): void {
        this._row = new Adw.ExpanderRow({
            title: this.args.title as string,
            subtitle: this.args.subtitle as string,
            expanded: this.args.expanded as boolean,
            showEnableSwitch: this.args.showEnableSwitch as boolean,
        });

        this._row.add_row(new Adw.EntryRow({ title: 'Host', text: 'proxy.example.com' }));
        this._row.add_row(new Adw.SwitchRow({ title: 'Use authentication', active: false }));

        const group = new Adw.PreferencesGroup();
        group.add(this._row);

        const clamp = new Adw.Clamp({ maximumSize: 400, child: group });
        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._row) return;
        this._row.title = this.args.title as string;
        this._row.subtitle = this.args.subtitle as string;
        this._row.expanded = this.args.expanded as boolean;
        this._row.showEnableSwitch = this.args.showEnableSwitch as boolean;
    }
}

GObject.type_ensure(ExpanderRowStory.$gtype);

export const ExpanderRowStories: StoryModule = { stories: [ExpanderRowStory] };
