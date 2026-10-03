// Adw.BreakpointBin — a bin whose one child rearranges itself at a size threshold.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { breakpointBinMeta } from './breakpoint-bin.meta.js';

/** Story: a label that reads "Narrow" below the condition and "Wide" above it. */
export class BreakpointBinStory extends StoryWidget {
    private _bin: Adw.BreakpointBin | null = null;
    private _label: Gtk.Label | null = null;
    private _breakpoint: Adw.Breakpoint | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookBreakpointBin' }, BreakpointBinStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(BreakpointBinStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...breakpointBinMeta, component: Adw.BreakpointBin.$gtype };
    }

    initialize(): void {
        this._label = new Gtk.Label({ label: this.args.wideLabel as string, ellipsize: 3 /* PANGO_ELLIPSIZE_END */ });
        this._label.add_css_class('title-1');
        this._bin = new Adw.BreakpointBin();
        // The C's own advice: a bin carrying breakpoints has no minimum size, so the stage
        // is what decides how much room there is (adw-breakpoint-bin.c:57-61).
        this._bin.set_size_request(150, 60);
        this._bin.set_child(this._label);

        this._apply();
        this.addContent(this._bin);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    /** Rebuild the one breakpoint from the controls, then re-add it to the bin. */
    private _apply(): void {
        if (!this._bin || !this._label) return;
        const condition = Adw.BreakpointCondition.parse(this.args.condition as string);
        if (condition === null) return;
        if (this._breakpoint !== null) this._bin.remove_breakpoint(this._breakpoint);
        this._breakpoint = new Adw.Breakpoint(condition);
        this._breakpoint.add_setter(this._label, 'label', this.args.narrowLabel as string);
        this._bin.add_breakpoint(this._breakpoint);
        // The wide value is what the markup declared, so a rebuild restores to it rather
        // than to whatever the previous breakpoint left behind.
        this._label.label = this.args.wideLabel as string;
    }
}

GObject.type_ensure(BreakpointBinStory.$gtype);

export const BreakpointBinStories: StoryModule = { stories: [BreakpointBinStory] };
