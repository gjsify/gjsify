import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { DueChip } from './due-chip.js';
import { _ } from './i18n.js';
import { emitSignal } from './signals.js';
import { SourceBadge } from './source-badge.js';
import { ELLIPSIZE_END, ensureStyles } from './styles.js';
import { Tint } from './tint.js';

export interface BoardCardData {
    id: string;
    title: string;
    sourceLabel: string;
    /** Source colour as `#rgb` / `#rrggbb`. */
    sourceColour: string;
    /** Initials of the assignees, own avatar first; at most {@link MAX_AVATARS} are drawn. */
    assignees: readonly string[];
    labels: readonly string[];
    due: Date | null;
    /** A card whose source cannot be written: never gets a drag grip (Phase 4). */
    readOnly: boolean;
}

export const MAX_AVATARS = 3;

/**
 * One kanban card:
 *
 *     ▍ Title, at most three lines
 *       ● Source   label  label
 *       <due chip>                 (AB) (CD)
 *
 * The whole card is a button: Tab reaches it, Enter and Space activate it, the accessible name
 * carries title, source, due state and assignees. Signal `card-activated(id)`.
 */
export class BoardCard extends Gtk.Button {
    static {
        GObject.registerClass(
            { GTypeName: 'GjsifyAdwBoardCard', Signals: { 'card-activated': { param_types: [GObject.TYPE_STRING] } } },
            BoardCard,
        );
    }

    private cardId = '';
    private isReadOnly = false;
    private readonly bar = new Gtk.Box();
    private readonly title = new Gtk.Label({ xalign: 0, wrap: true, lines: 3, ellipsize: ELLIPSIZE_END });
    private readonly badge = new SourceBadge();
    private readonly labels = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 4 });
    private readonly chip = new DueChip();
    private readonly lock = new Gtk.Image({ iconName: 'changes-prevent-symbolic', pixelSize: 12 });
    private readonly avatars = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 0,
        halign: Gtk.Align.END,
        hexpand: true,
    });
    private readonly tint: Tint;

    constructor() {
        super({ focusOnClick: true });
        ensureStyles();
        this.add_css_class('card');
        this.add_css_class('gjsify-board-card');
        this.bar.add_css_class('gjsify-board-bar');
        this.tint = new Tint(this.bar, 'board-bar', (cls, c) => `.${cls} { background-color: ${c}; }`);
        this.title.add_css_class('body');
        this.lock.add_css_class('dim-label');
        this.lock.set_tooltip_text(_('Read-only'));
        this.lock.set_visible(false);

        const meta = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
        meta.append(this.badge);
        meta.append(this.labels);

        const foot = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, valign: Gtk.Align.CENTER });
        foot.append(this.chip);
        foot.append(this.lock);
        foot.append(this.avatars);

        const text = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, hexpand: true });
        text.set_margin_start(10);
        text.set_margin_end(10);
        text.set_margin_top(8);
        text.set_margin_bottom(8);
        text.append(this.title);
        text.append(meta);
        text.append(foot);

        const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });
        row.append(this.bar);
        row.append(text);
        this.set_child(row);
        this.connect('clicked', () => emitSignal(this, 'card-activated', this.cardId));
    }

    get id(): string {
        return this.cardId;
    }

    get readOnly(): boolean {
        return this.isReadOnly;
    }

    setCard(card: BoardCardData, now: Date = new Date()): void {
        this.cardId = card.id;
        this.isReadOnly = card.readOnly;
        this.title.set_label(card.title);
        this.badge.setSource(card.sourceLabel, card.sourceColour);
        this.tint.set(card.sourceColour);
        this.chip.setDue(card.due, now);
        this.lock.set_visible(card.readOnly);

        clear(this.labels);
        for (const text of card.labels) {
            const label = new Gtk.Label({ label: text, ellipsize: ELLIPSIZE_END, singleLineMode: true });
            label.add_css_class('caption');
            label.add_css_class('dim-label');
            label.add_css_class('gjsify-board-label');
            this.labels.append(label);
        }
        this.labels.set_visible(card.labels.length > 0);

        clear(this.avatars);
        for (const initials of card.assignees.slice(0, MAX_AVATARS)) {
            // Adw.Avatar takes initials from the first letter of each word.
            const avatar = new Adw.Avatar({ size: 24, text: [...initials].join(' '), showInitials: true });
            avatar.add_css_class('gjsify-board-avatar');
            this.avatars.append(avatar);
        }
        this.avatars.set_visible(card.assignees.length > 0);

        const parts = [card.title];
        if (card.sourceLabel) parts.push(card.sourceLabel);
        if (this.chip.get_visible()) parts.push(this.chip.get_label());
        if (card.assignees.length > 0) parts.push(_('Assigned to %s').replace('%s', card.assignees.join(', ')));
        if (card.readOnly) parts.push(_('Read-only'));
        this.update_property([Gtk.AccessibleProperty.LABEL], [parts.join(', ')]);
    }
}

function clear(box: Gtk.Box): void {
    let child = box.get_first_child();
    while (child) {
        const next = child.get_next_sibling();
        box.remove(child);
        child = next;
    }
}
