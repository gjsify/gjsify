// NativeScript port of the Expander Row story. Shares metadata with the GTK
// expander-row.story.ts and browser expander-row.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw } from '@gjsify/adwaita-nativescript';
import { expanderRowMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class ExpanderRowNsStory extends StoryView {
    private _row: Adw.ExpanderRow | null = null;

    constructor() {
        super(ExpanderRowNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return expanderRowMeta;
    }

    initialize(): void {
        this._row = new Adw.ExpanderRow();

        const hostRow = new Adw.EntryRow();
        hostRow.title = 'Host';
        hostRow.text = 'proxy.example.com';

        const authRow = new Adw.SwitchRow();
        authRow.title = 'Use authentication';

        this._row.addRow(hostRow);
        this._row.addRow(authRow);
        this._syncRow();

        const group = new Adw.PreferencesGroup();
        group.addRow(this._row);

        const clamp = new Adw.Clamp();
        clamp.maximumSize = 400;
        clamp.setChild(group);

        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncRow();
    }

    private _syncRow(): void {
        if (!this._row) return;
        this._row.title = this.args.title as string;
        this._row.subtitle = this.args.subtitle as string;
        this._row.expanded = this.args.expanded as boolean;
        // `showEnableSwitch` has no NS equivalent on Adw.ExpanderRow (no header
        // enable-switch in the widget set); the arg stays bound but is inert.
        void (this.args.showEnableSwitch as boolean);
    }
}

export const ExpanderRowNsStories: NsStoryModule = { stories: [ExpanderRowNsStory] };
