// Gtk.Inscription — text held to a size in characters and lines.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import Pango from 'gi://Pango?version=1.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { inscriptionMeta } from './inscription.meta.js';

/** Story: a Gtk.Inscription inside a fixed frame, so its counts are the only thing that moves. */
export class InscriptionStory extends StoryWidget {
    private _inscription: Gtk.Inscription | null = null;
    private _frame: Gtk.Frame | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookInscription' }, InscriptionStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(InscriptionStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...inscriptionMeta, component: Gtk.Inscription.$gtype };
    }

    initialize(): void {
        // The widget's CSS name is `label` (gtkinscription.c:780), so a Gtk.Frame around it
        // gives the fixed box the counts are supposed to show off — without a frame the
        // inscription shrinks to its minimum every time and the nat counts do nothing.
        this._inscription = new Gtk.Inscription();
        this._frame = new Gtk.Frame({ child: this._inscription, halign: Gtk.Align.CENTER });
        this._apply();
        this.addContent(this._frame);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._inscription || !this._frame) return;
        // The ORDER is the measure: `nat_chars` only ever WIDENS a widget, and the natural is
        // `MAX (min_chars, nat_chars)` (gtkinscription.c:348) — so a `min_chars` written
        // after a large `nat_chars` still leaves the natural at the larger of the two. Both
        // counts go before the text for the same reason the level bar's endpoints go before
        // its value.
        this._inscription.min_chars = this.args.minChars as number;
        this._inscription.nat_chars = this.args.natChars as number;
        this._inscription.min_lines = this.args.minLines as number;
        this._inscription.nat_lines = this.args.natLines as number;
        this._inscription.text = this.args.text as string;
        this._inscription.wrap_mode = this.args.wrapMode as Pango.WrapMode;
        this._inscription.text_overflow = this.args.textOverflow as Gtk.InscriptionOverflow;
        this._inscription.xalign = this.args.xalign as number;
        this._inscription.yalign = this.args.yalign as number;
        this._frame.width_request = 320;
        this._frame.height_request = 160;
    }
}

GObject.type_ensure(InscriptionStory.$gtype);

export const InscriptionStories: StoryModule = { stories: [InscriptionStory] };
