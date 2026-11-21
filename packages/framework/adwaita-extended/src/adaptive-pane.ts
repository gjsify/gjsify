import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { emitSignal } from './signals.js';
import { containerFor, type PaneContainer } from './adaptive-container.js';
import { _ } from './i18n.js';
import type { SizeClass } from './size-class.js';

/**
 * One content widget, shown where the window has room for it: wide → inspector on the end side,
 * medium → `Adw.Dialog`, compact → `Adw.BottomSheet`.
 *
 * The pane owns the inspector and the sheet, so the caller hands over its main content with
 * `setMain` instead of wiring three containers. A single `Adw.ToolbarView` (header + content) is
 * what moves between containers, so the content keeps its state (scroll, entries) when the size
 * class changes. Signal `closed` fires when the user dismisses the pane, not on `close()`.
 */
/** How wide the inspector is beside the content, px — the range libadwaita uses is 320…420. */
const INSPECTOR_WIDTH = 360;

/** How much of the pane the bottom sheet covers, and the floor below which it stops shrinking. */
const SHEET_HEIGHT_SHARE = 0.7;
const SHEET_MIN_HEIGHT = 320;

/** Room above the sheet's header, so the drag handle is not drawn across the title. */
const SHEET_HANDLE_SPACE = 14;

export class AdaptivePane extends Adw.Bin {
    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwAdaptivePane', Signals: { closed: {} } }, AdaptivePane);
    }

    private sizeClass: SizeClass = 'compact';
    private open: PaneContainer | null = null;
    private moving = false;
    /**
     * The inspector is a second child beside the content, not an `Adw.OverlaySplitView`: the pane
     * already sits inside the window's own split view, and a split view whose sidebar is shown
     * inside another one measures its content with a nonsense width (GTK logs
     * `gtk_widget_size_allocate(): … width -2147482688`). Nothing here needs the overlay — the
     * inspector never collapses; below `wide` the shell moves into the dialog or the sheet instead.
     */
    private readonly row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0 });
    private readonly divider = new Gtk.Separator({ orientation: Gtk.Orientation.VERTICAL });
    private readonly sheet = new Adw.BottomSheet({ showDragHandle: true, hexpand: true });
    private readonly shell = new Adw.ToolbarView();
    private readonly header = new Adw.HeaderBar({ showEndTitleButtons: false, showStartTitleButtons: false });
    private readonly title = new Adw.WindowTitle({ title: '', subtitle: '' });
    private dialog: Adw.Dialog | null = null;

    constructor() {
        super();
        this.title.set_title('');
        this.header.set_title_widget(this.title);
        const close = Gtk.Button.new_from_icon_name('window-close-symbolic');
        close.add_css_class('flat');
        close.set_tooltip_text(_('Close'));
        close.update_property([Gtk.AccessibleProperty.LABEL], [_('Close')]);
        close.connect('clicked', () => this.dismiss());
        this.header.pack_end(close);
        this.shell.add_top_bar(this.header);

        this.row.append(this.sheet);
        this.set_child(this.row);
        this.sheet.connect('notify::open', () => {
            if (!this.sheet.open && !this.moving && this.open === 'sheet') this.dismissed();
        });
    }

    setMain(widget: Gtk.Widget | null): void {
        this.sheet.set_content(widget);
    }

    get container(): PaneContainer | null {
        return this.open;
    }

    setSizeClass(sizeClass: SizeClass): void {
        this.sizeClass = sizeClass;
        if (this.open !== null && this.open !== containerFor(sizeClass)) this.place();
    }

    present(content: Gtk.Widget, title: string): void {
        this.shell.set_content(content);
        this.title.set_title(title);
        this.place();
    }

    /** Hides the pane without emitting `closed`; the content stays alive for the next `present`. */
    close(): void {
        this.remove();
        this.open = null;
    }

    private dismiss(): void {
        this.close();
        this.dismissed();
    }

    private dismissed(): void {
        this.open = null;
        emitSignal(this, 'closed');
    }

    private place(): void {
        const target = containerFor(this.sizeClass);
        this.moving = true;
        this.remove();
        switch (target) {
            case 'inspector':
                this.shell.set_size_request(INSPECTOR_WIDTH, -1);
                this.shell.set_margin_top(0);
                this.row.append(this.divider);
                this.row.append(this.shell);
                break;
            case 'sheet':
                // A bottom sheet is as tall as its sheet asks to be, and a scrolling detail asks for
                // almost nothing — without a height the sheet opens as a sliver showing only its header.
                this.shell.set_size_request(-1, this.sheetHeight());
                this.shell.set_margin_top(SHEET_HANDLE_SPACE);
                this.sheet.set_sheet(this.shell);
                this.sheet.set_open(true);
                break;
            case 'dialog': {
                this.shell.set_size_request(-1, -1);
                this.shell.set_margin_top(0);
                const dialog = new Adw.Dialog({ contentWidth: 480, contentHeight: 520 });
                dialog.set_child(this.shell);
                dialog.connect('closed', () => {
                    if (this.dialog === dialog && !this.moving) {
                        this.dialog = null;
                        this.dismissed();
                    }
                });
                this.dialog = dialog;
                dialog.present(this);
                break;
            }
        }
        this.open = target;
        this.moving = false;
    }

    /** How tall the sheet opens: most of the pane, but never less than `SHEET_MIN_HEIGHT`. */
    private sheetHeight(): number {
        return Math.max(SHEET_MIN_HEIGHT, Math.round(this.get_height() * SHEET_HEIGHT_SHARE));
    }

    /** Empties whichever container holds the shell, so it can be set into another. */
    private remove(): void {
        const was = this.moving;
        this.moving = true;
        if (this.dialog) {
            const dialog = this.dialog;
            this.dialog = null;
            dialog.set_child(null);
            dialog.force_close();
        }
        if (this.sheet.get_sheet() === this.shell) {
            this.sheet.set_open(false);
            this.sheet.set_sheet(null);
        }
        if (this.shell.get_parent() === this.row) {
            this.row.remove(this.divider);
            this.row.remove(this.shell);
        }
        this.moving = was;
    }
}
