// Gtk.Popover — the bubble-like surface, with arbitrary content.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { popoverMeta } from './popover.meta.js';

/**
 * Story: a Gtk.Popover over a button, holding a box of labels.
 *
 * `autohide` is the control worth trying: with it off the popover takes no grab
 * (gtkpopover.c:1245-1247), so an outside click and an Escape stop dismissing it — which is
 * what an entry's completion list needs.
 */
export class PopoverStory extends StoryWidget {
    private _anchor: Gtk.Button | null = null;
    private _popover: Gtk.Popover | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookPopover' }, PopoverStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(PopoverStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...popoverMeta, component: Gtk.Popover.$gtype };
    }

    initialize(): void {
        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 });
        box.append(new Gtk.Label({ label: 'Anything you like' }));
        box.append(new Gtk.Label({ label: 'in here' }));

        this._anchor = new Gtk.Button({ label: 'Show popover', halign: Gtk.Align.CENTER });
        this._popover = new Gtk.Popover({ child: box });
        this._popover.set_parent(this._anchor);
        this._apply();
        this.addContent(this._anchor);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._popover) return;
        const positions: Record<string, Gtk.PositionType> = {
            bottom: Gtk.PositionType.BOTTOM,
            top: Gtk.PositionType.TOP,
            start: Gtk.PositionType.LEFT,
            end: Gtk.PositionType.RIGHT,
        };
        this._popover.position = positions[this.args.position as string] ?? Gtk.PositionType.BOTTOM;
        if (this._anchor) {
            this._anchor.halign = (this.args.align as string) === 'end' ? Gtk.Align.END : Gtk.Align.START;
        }
        this._popover.autohide = this.args.autohide as boolean;
    }
}

GObject.type_ensure(PopoverStory.$gtype);

export const PopoverStories: StoryModule = { stories: [PopoverStory] };
