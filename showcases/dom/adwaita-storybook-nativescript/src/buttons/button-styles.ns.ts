// NativeScript port of the Button Styles story. Shares metadata with the GTK
// button-styles.story.ts and browser button-styles.web.ts (imported from the
// GTK showcase's renderer-agnostic *.meta.ts barrel).
//
// Mirrors the native/browser twins: a wrapping row of buttons demonstrating the
// Adwaita style variants, plus a live demo button driven by the `style` control.

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw, Gtk, type AdwButtonVariant } from '@gjsify/adwaita-nativescript';
import { buttonStylesMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

// The storybook `style` value → Gtk.Button variant. `circular` is icon-only in
// the twins; the NS subset has no circular variant, so it falls back to `pill`
// with a glyph label (mirroring the icon-only intent of the native demo).
const VARIANT_BY_STYLE: Record<string, AdwButtonVariant> = {
    pill: 'pill',
    circular: 'pill',
    'suggested-action': 'suggested-action',
    'destructive-action': 'destructive-action',
    flat: 'flat',
};

function button(label: string, variant: AdwButtonVariant): Gtk.Button {
    const btn = new Gtk.Button();
    btn.text = label;
    btn.variant = variant;
    return btn;
}

export class ButtonStylesNsStory extends StoryView {
    private _demo: Gtk.Button | null = null;

    constructor() {
        super(ButtonStylesNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return buttonStylesMeta;
    }

    initialize(): void {
        // Adw.WrapBox mirrors the native Adw.WrapBox / browser flex-wrap row so the
        // demo reflows instead of overflowing in a narrow preview.
        const box = new Adw.WrapBox();
        box.childSpacing = 12;
        box.lineSpacing = 12;
        box.horizontalAlignment = 'center';

        box.add(button('Pill', 'pill'));
        // `circular` is icon-only in the twins; NS has no circular variant — use a
        // pill with a glyph as the closest icon-only equivalent.
        box.add(button('\u{2795}', 'pill')); // ➕ (list-add)
        box.add(button('Suggested', 'suggested-action'));
        box.add(button('Delete', 'destructive-action'));
        box.add(button('Flat', 'flat'));

        this._demo = button(this.args.label as string, 'default');
        this._applyStyle(this.args.style as string);
        box.add(this._demo);

        this.addContent(box);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._demo) return;
        this._applyStyle(this.args.style as string);
    }

    private _applyStyle(style: string): void {
        if (!this._demo) return;
        const variant = VARIANT_BY_STYLE[style] ?? 'default';
        this._demo.variant = variant;
        // The circular style is icon-only (no label), like the native demo.
        if (style === 'circular') {
            this._demo.text = '\u{2795}'; // ➕ (list-add)
        } else {
            this._demo.text = this.args.label as string;
        }
    }
}

export const ButtonStylesNsStories: NsStoryModule = { stories: [ButtonStylesNsStory] };
