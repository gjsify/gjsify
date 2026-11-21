import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';

import { BoardCard, type BoardCardData } from './board-card.js';
import { CARD_SPACING, type CardExtent } from './board-rules.js';
import { _, _n } from './i18n.js';
import { emitSignal, onSignal } from './signals.js';
import { ELLIPSIZE_END, ensureStyles } from './styles.js';

export interface BoardColumnData {
    id: string;
    title: string;
    cards: readonly BoardCardData[];
}

const DROP_ABOVE = 'gjsify-board-drop-above';
const DROP_BELOW = 'gjsify-board-drop-below';
const DROP_INTO = 'gjsify-board-drop-into';

/** "3 cards", for the accessible name of a column and its switcher button. */
export function cardCountText(count: number): string {
    return _n('%d card', '%d cards', count).replace('%d', String(count));
}

/**
 * One column: a header with the title and the card count, then its own scrolling list of cards.
 * An empty column shows a quiet line, not a status page. Signal `card-activated(id)`.
 */
export class BoardColumn extends Gtk.Box {
    static {
        GObject.registerClass(
            {
                GTypeName: 'GjsifyAdwBoardColumn',
                Signals: { 'card-activated': { param_types: [GObject.TYPE_STRING] } },
            },
            BoardColumn,
        );
    }

    private columnId = '';
    private heading = '';
    private readonly titleLabel = new Gtk.Label({
        xalign: 0,
        hexpand: true,
        ellipsize: ELLIPSIZE_END,
        singleLineMode: true,
    });
    private readonly count = new Gtk.Label({ valign: Gtk.Align.CENTER });
    private readonly list = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: CARD_SPACING,
        valign: Gtk.Align.START,
    });
    private readonly empty = new Gtk.Label({ label: _('No cards'), vexpand: false });
    private cardWidgets: BoardCard[] = [];

    constructor() {
        super({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, vexpand: true, hexpand: true });
        ensureStyles();
        this.add_css_class('gjsify-board-column');
        this.titleLabel.add_css_class('heading');
        this.count.add_css_class('caption-heading');
        this.count.add_css_class('numeric');
        this.count.add_css_class('dim-label');
        this.empty.add_css_class('dim-label');
        this.empty.set_margin_top(24);
        this.empty.set_margin_bottom(24);

        const head = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
        head.set_margin_start(12);
        head.set_margin_end(12);
        head.set_margin_top(10);
        head.set_margin_bottom(6);
        head.append(this.titleLabel);
        head.append(this.count);

        this.list.set_margin_start(8);
        this.list.set_margin_end(8);
        this.list.set_margin_bottom(8);
        this.list.append(this.empty);
        const scroller = new Gtk.ScrolledWindow({
            hscrollbarPolicy: Gtk.PolicyType.NEVER,
            vexpand: true,
            propagateNaturalHeight: false,
        });
        scroller.set_child(this.list);
        this.append(head);
        this.append(scroller);
    }

    get id(): string {
        return this.columnId;
    }

    get title(): string {
        return this.heading;
    }

    /** The cards in order; the board moves focus between them and decorates them for dragging. */
    get cards(): readonly BoardCard[] {
        return this.cardWidgets;
    }

    /**
     * The widget the drop target attaches to: the whole column, not the box that holds the cards.
     * That box is only as tall as its cards (`valign: START`), so the room below the last card —
     * all of an empty column but a line of text — would not take a drop at all.
     */
    get dropArea(): Gtk.Widget {
        return this;
    }

    /**
     * Where the cards sit inside {@link dropArea}, in that widget's own coordinates, so a drop at
     * `y` can be turned into an index by `dropIndex`. Empty before the column has been allocated —
     * a drop cannot happen before then, because nothing is on screen to drop onto.
     */
    get cardExtents(): CardExtent[] {
        const extents: CardExtent[] = [];
        for (const card of this.cardWidgets) {
            const [ok, bounds] = card.compute_bounds(this);
            if (!ok) return [];
            extents.push({ top: bounds.get_y(), height: bounds.get_height() });
        }
        return extents;
    }

    /**
     * Shows where a drop would land: a line above the card at `index`, below the last one when
     * `index` is past the end, the whole column outlined when it has no cards, and nothing at all
     * for `null`. Drawn with `box-shadow`, which takes no space, so the cards do not jump about
     * under the pointer while it moves.
     */
    markDrop(index: number | null): void {
        this.remove_css_class(DROP_INTO);
        for (const card of this.cardWidgets) {
            card.remove_css_class(DROP_ABOVE);
            card.remove_css_class(DROP_BELOW);
        }
        if (index === null) return;
        if (this.cardWidgets.length === 0) {
            this.add_css_class(DROP_INTO);
            return;
        }
        if (index >= this.cardWidgets.length) this.cardWidgets[this.cardWidgets.length - 1]?.add_css_class(DROP_BELOW);
        else this.cardWidgets[Math.max(0, index)]?.add_css_class(DROP_ABOVE);
    }

    setColumn(column: BoardColumnData, now: Date = new Date()): void {
        this.columnId = column.id;
        this.heading = column.title;
        this.titleLabel.set_label(column.title);
        this.count.set_label(String(column.cards.length));
        this.update_property(
            [Gtk.AccessibleProperty.LABEL],
            [`${column.title}, ${cardCountText(column.cards.length)}`],
        );
        for (const card of this.cardWidgets) this.list.remove(card);
        this.cardWidgets = column.cards.map((data) => {
            const card = new BoardCard();
            card.setCard(data, now);
            onSignal(card, 'card-activated', (id: string) => emitSignal(this, 'card-activated', id));
            this.list.append(card);
            return card;
        });
        this.empty.set_visible(column.cards.length === 0);
        this.remove_css_class(DROP_INTO);
    }
}
