import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';

import { ELLIPSIZE_END, ensureStyles } from './styles.js';
import { Tint } from './tint.js';

/** A filled dot in a source colour; also the leading mark of a read-only task row. */
export class SourceDot extends Gtk.Box {
    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwSourceDot' }, SourceDot);
    }

    private readonly tint: Tint;

    constructor(large = false) {
        super({ valign: Gtk.Align.CENTER, halign: Gtk.Align.CENTER });
        ensureStyles();
        this.add_css_class('gjsify-source-dot');
        if (large) this.add_css_class('large');
        this.tint = new Tint(this, 'dot', (cls, c) => `.${cls} { background-color: ${c}; }`);
    }

    setColour(colour: string | null): void {
        this.tint.set(colour);
    }
}

/** Small inline marker for a task row's meta line: a coloured dot and the source name, dimmed. */
export class SourceBadge extends Gtk.Box {
    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwSourceBadge' }, SourceBadge);
    }

    private readonly dot = new SourceDot();
    private readonly label = new Gtk.Label({ xalign: 0, ellipsize: ELLIPSIZE_END, singleLineMode: true });

    constructor(name = '', colour: string | null = null) {
        super({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 4, valign: Gtk.Align.CENTER });
        this.label.add_css_class('caption');
        this.label.add_css_class('dim-label');
        this.append(this.dot);
        this.append(this.label);
        this.setSource(name, colour);
    }

    setSource(name: string, colour: string | null): void {
        this.label.set_label(name);
        this.dot.setColour(colour);
        this.set_visible(name !== '');
    }
}
