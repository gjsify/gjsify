// Gtk.Overlay — a card with a badge pinned to its bottom end corner.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { overlayMeta } from './overlay.meta.js';

/** `Gtk.Align` for a story arg — `fill` is the DEFAULT and has no `Gtk.Align` member. */
const ALIGNMENTS: Record<string, Gtk.Align> = {
    start: Gtk.Align.START,
    center: Gtk.Align.CENTER,
    end: Gtk.Align.END,
};

/** Story: a Gtk.Overlay whose main child is a frame, with a badge over one of its corners. */
export class OverlayStory extends StoryWidget {
    private _overlay: Gtk.Overlay | null = null;
    private _main: Gtk.Frame | null = null;
    private _badge: Gtk.Box | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookOverlay' }, OverlayStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(OverlayStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...overlayMeta, component: Gtk.Overlay.$gtype };
    }

    initialize(): void {
        this._main = new Gtk.Frame({ width_request: 260, height_request: 160, margin_top: 12, margin_bottom: 12 });
        const mainText = new Gtk.Label({ label: 'Main child — its size is the overlay' });
        mainText.add_css_class('dim-label');
        this._main.set_child(mainText);

        this._badge = new Gtk.Box({ valign: Gtk.Align.END, halign: Gtk.Align.END });
        this._badge.set_css_classes(['osd', 'flat']);
        this._badge.append(new Gtk.Label({ label: '2' }));

        this._overlay = new Gtk.Overlay();
        this._overlay.set_child(this._main);
        this._overlay.add_overlay(this._badge);
        this._apply();
        this.addContent(this._overlay);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._badge) return;
        // `fill` is `GtkWidget`'s DEFAULT alignment and has no `Gtk.Align` member, so it is
        // spelled as an absent property — the same choice the web element reads as "no
        // halign attribute".
        const halign = ALIGNMENTS[String(this.args.halign)];
        const valign = ALIGNMENTS[String(this.args.valign)];
        if (halign === undefined) this._badge.unset_property('halign');
        else this._badge.halign = halign;
        if (valign === undefined) this._badge.unset_property('valign');
        else this._badge.valign = valign;
        this._badge.visible = this.args.showLabel as boolean;
    }
}

GObject.type_ensure(OverlayStory.$gtype);

export const OverlayStories: StoryModule = { stories: [OverlayStory] };
