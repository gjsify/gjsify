import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { ChatActionButton } from './chat-action-button.js';
import { ChatEntry } from './chat-entry.js';
import { ensureStyles } from './styles.js';

/**
 * The rounded bar a message is written in:
 *
 *     ( [start slots] [ ChatEntry ........ ] [end slots] (●) )
 *       status line
 *
 * It only arranges. Slots take whatever the host puts there (attach, emoji, an account switcher),
 * the entry and the action button are the package's own, and nothing here knows what a message is
 * or when Send turns into Stop. Slots and the button sit on the bottom line, so they stay put while
 * the entry grows upwards. The status line is hidden while it is empty.
 */
export class ComposerBar extends Gtk.Box {
    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwComposerBar' }, ComposerBar);
    }

    readonly entry: ChatEntry;
    readonly actionButton: ChatActionButton;
    private readonly start = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 2,
        valign: Gtk.Align.END,
    });
    private readonly end = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 2, valign: Gtk.Align.END });
    private readonly statusLabel = new Gtk.Label({
        xalign: 0,
        wrap: true,
        visible: false,
        marginStart: 6,
        marginEnd: 6,
    });

    constructor() {
        super({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 });
        ensureStyles();
        this.add_css_class('gjsify-composer-bar');
        this.statusLabel.add_css_class('gjsify-composer-status');
        this.statusLabel.add_css_class('caption');

        this.entry = new ChatEntry();
        this.actionButton = new ChatActionButton();

        const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 4 });
        row.append(this.start);
        row.append(this.entry);
        row.append(this.end);
        row.append(this.actionButton);
        this.append(row);
        this.append(this.statusLabel);
    }

    /** Before the entry, in the order added. */
    addStart(widget: Gtk.Widget): void {
        this.start.append(widget);
    }

    /** Between the entry and the action button, in the order added. */
    addEnd(widget: Gtk.Widget): void {
        this.end.append(widget);
    }

    /** One line under the bar; an empty string hides it. */
    setStatus(text: string): void {
        this.statusLabel.set_label(text);
        this.statusLabel.set_visible(text !== '');
    }

    get status(): string {
        return this.statusLabel.get_label();
    }
}
