// Adw.LayoutSlot — the named hole a layout of an Adw.MultiLayoutView leaves for a child.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { layoutSlotMeta } from './layout-slot.meta.js';

/**
 * Story: one slot holding one child.
 *
 * A slot only ever exists inside a layout, and a layout only ever exists inside a
 * multi-layout view — the view is what inserts the child whose id matches the slot's. So
 * this story builds the whole pair and names the SLOT, which is the half a reader cannot
 * see anywhere else: the `visible` binding the view installs between the two
 * (adw-multi-layout-view.c:151).
 */
export class LayoutSlotStory extends StoryWidget {
    private _view: Adw.MultiLayoutView | null = null;
    private _slot: Adw.LayoutSlot | null = null;
    private _child: Adw.NavigationPage | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookLayoutSlot' }, LayoutSlotStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(LayoutSlotStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...layoutSlotMeta, component: Adw.LayoutSlot.$gtype };
    }

    initialize(): void {
        this._slot = Adw.LayoutSlot.new('primary');
        this._child = new Adw.NavigationPage({
            title: this.args.label as string,
            tag: 'primary',
            child: new Gtk.Label({ label: 'The child the view inserted here.' }),
        });

        this._view = new Adw.MultiLayoutView();
        const layout = Adw.Layout.new(this._slot);
        layout.name = 'only';
        this._view.add_layout(layout);
        this._view.set_child('primary', this._child);

        this._apply();
        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._child) return;
        this._child.title = this.args.label as string;
        // The binding is child → slot, one way: the slot cannot show what the child hides.
        this._child.visible = this.args.visible as boolean;
    }
}

GObject.type_ensure(LayoutSlotStory.$gtype);

export const LayoutSlotStories: StoryModule = { stories: [LayoutSlotStory] };
