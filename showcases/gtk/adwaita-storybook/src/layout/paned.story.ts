// Gtk.Paned — a draggable divider between two boxes.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { panedMeta } from './paned.meta.js';

function pane(label: string, request: number): Gtk.Box {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        margin_top: 12,
        margin_bottom: 12,
        margin_start: 12,
        margin_end: 12,
    });
    box.append(new Gtk.Label({ label }));
    const hint = new Gtk.Label({ label: `${request}px of size request` });
    hint.add_css_class('dim-label');
    box.append(hint);
    return box;
}

/** Story: a Gtk.Paned whose panes have visibly different requests, so the split is legible. */
export class PanedStory extends StoryWidget {
    private _paned: Gtk.Paned | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookPaned' }, PanedStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(PanedStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...panedMeta, component: Gtk.Paned.$gtype };
    }

    initialize(): void {
        this._paned = new Gtk.Paned({ orientation: Gtk.Orientation.HORIZONTAL });
        this._paned.set_start_child(pane('First child', 100));
        this._paned.set_end_child(pane('Second child', 300));
        this._paned.set_size_request(400, 140);
        this._apply();
        this.addContent(this._paned);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._paned) return;
        this._paned.orientation =
            this.args.orientation === 'vertical' ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL;
        this._paned.wide_handle = this.args.wideHandle as boolean;
        this._paned.resize_start_child = this.args.resizeStartChild as boolean;
        this._paned.resize_end_child = this.args.resizeEndChild as boolean;
        this._paned.shrink_start_child = this.args.shrinkStartChild as boolean;
        // `set_position (-1)` is the C's own "let the size requests decide" (gtkpaned.c:1874),
        // which is why the control's floor is -1 rather than 0.
        this._paned.position = Number(this.args.position);
    }
}

GObject.type_ensure(PanedStory.$gtype);

export const PanedStories: StoryModule = { stories: [PanedStory] };
