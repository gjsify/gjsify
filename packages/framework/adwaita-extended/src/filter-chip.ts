import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';

import { _ } from './i18n.js';
import { emitSignal } from './signals.js';
import { ELLIPSIZE_END, ensureStyles } from './styles.js';

/**
 * One narrowing that is in force, as a pill with its own `⊗`:
 *
 *     ( Assigned to me ⊗ )
 *
 * The cross is a real `Gtk.Button` rather than a gesture on the pill, so one press removes exactly
 * the filter whose name is on it — and its accessible label says which one, because a row of
 * crosses labelled only "close" tells a screen reader nothing. Signal `removed`.
 *
 * The chip only reports; it does not know what the filter means. The view that built it takes the
 * narrowing off and rebuilds the row.
 */
export class FilterChip extends Gtk.Box {
    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwFilterChip', Signals: { removed: {} } }, FilterChip);
    }

    private readonly caption = new Gtk.Label({ ellipsize: ELLIPSIZE_END, singleLineMode: true });
    private readonly cross = new Gtk.Button({
        iconName: 'window-close-symbolic',
        cssClasses: ['flat', 'circular'],
    });

    constructor(text = '') {
        super({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 4, valign: Gtk.Align.CENTER });
        ensureStyles();
        this.add_css_class('gjsify-filter-chip');
        this.caption.add_css_class('caption-heading');
        this.append(this.caption);
        this.append(this.cross);
        this.cross.connect('clicked', () => emitSignal(this, 'removed'));
        this.setLabel(text);
    }

    get text(): string {
        return this.caption.get_label();
    }

    setLabel(text: string): void {
        this.caption.set_label(text);
        const describe = _('Remove filter %s').replace('%s', text);
        this.cross.set_tooltip_text(describe);
        this.cross.update_property([Gtk.AccessibleProperty.LABEL], [describe]);
    }
}
