// Gtk.Switch — the light switch, with `active` and `state` shown apart.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { switchMeta } from './switch.meta.js';

/** Story: a Gtk.Switch whose `active` and `state` are driven separately, as the C allows. */
export class SwitchStory extends StoryWidget {
    private _switch: Gtk.Switch | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookSwitch' }, SwitchStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(SwitchStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...switchMeta, component: Gtk.Switch.$gtype };
    }

    initialize(): void {
        this._switch = new Gtk.Switch({ halign: Gtk.Align.CENTER });
        this._apply();
        this.addContent(this._switch);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._switch) return;
        // The ORDER is the story's point. `set_active` also sets `state`, because its
        // default `::state-set` handler does (gtkswitch.c:800, :558), so `active` goes
        // first and `state` second: a `state` of false on an `active` of true is the
        // delayed-change case, where the knob is where the user put it and the trough is
        // where the thing still is.
        this._switch.active = this.args.active as boolean;
        this._switch.state = this.args.state as boolean;
        this._switch.sensitive = !(this.args.disabled as boolean);
    }
}

GObject.type_ensure(SwitchStory.$gtype);

export const SwitchStories: StoryModule = { stories: [SwitchStory] };
