import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { emitSignal } from './signals.js';
import { _ } from './i18n.js';
import type { SizeClass } from './size-class.js';
import { ensureStyles } from './styles.js';
import { rowMinHeight, SWIPE_START_PX, swipeOutcome } from './swipe-rules.js';

const SETTLE_MS = 180;

/**
 * A row with two actions. Touch: swipe right runs the primary action (complete), swipe left the
 * secondary (postpone), once the drag passes the threshold of {@link swipeOutcome}. Pointer: the same
 * two actions appear as buttons while hovering. Everyone: a context menu (right click, long press,
 * Menu key). Actions exist only while `writable`; activating the row itself is always possible.
 *
 * Signals: `primary`, `secondary`, `activated`.
 */
export class SwipeRow extends Adw.Bin {
    static {
        GObject.registerClass(
            {
                GTypeName: 'GjsifyAdwSwipeRow',
                Properties: {
                    writable: GObject.ParamSpec.boolean(
                        'writable',
                        'Writable',
                        'Whether the row offers its actions',
                        GObject.ParamFlags.READWRITE,
                        true,
                    ),
                },
                Signals: { primary: {}, secondary: {}, activated: {} },
            },
            SwipeRow,
        );
    }

    private isWritable = true;
    private sizeClass: SizeClass = 'compact';
    private pointer = false;
    private offset = 0;
    private claimed = false;
    private primaryLabel = _('Complete');
    private secondaryLabel = _('Postpone');
    private readonly overlay = new Gtk.Overlay();
    private readonly slot = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    private readonly backdrop = new Gtk.CenterBox();
    private readonly primaryIcon = new Gtk.Image({ iconName: 'object-select-symbolic', pixelSize: 20 });
    private readonly secondaryIcon = new Gtk.Image({ iconName: 'x-office-calendar-symbolic', pixelSize: 20 });
    private readonly actions = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 });
    private readonly primaryButton = Gtk.Button.new_from_icon_name('object-select-symbolic');
    private readonly secondaryButton = Gtk.Button.new_from_icon_name('x-office-calendar-symbolic');
    private readonly group = new Gio.SimpleActionGroup();
    private animation: Adw.TimedAnimation | null = null;

    constructor() {
        super();
        ensureStyles();
        this.set_focusable(true);
        this.buildLayers();
        this.buildActions();
        this.buildInput();
        this.applyHeight();
        this.set_child(this.overlay);
    }

    get writable(): boolean {
        return this.isWritable;
    }

    set writable(value: boolean) {
        if (this.isWritable === value) return;
        this.isWritable = value;
        for (const name of ['primary', 'secondary']) {
            (this.group.lookup_action(name) as Gio.SimpleAction | null)?.set_enabled(value);
        }
        if (!value) this.actions.set_visible(false);
        this.notify('writable');
    }

    /** The row's own content; it is drawn on an opaque layer that slides over the action backdrop. */
    setContent(widget: Gtk.Widget | null): void {
        let child = this.slot.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this.slot.remove(child);
            child = next;
        }
        if (widget) this.slot.append(widget);
    }

    setSizeClass(sizeClass: SizeClass): void {
        this.sizeClass = sizeClass;
        this.applyHeight();
    }

    /** Names and icons of the two actions (tooltip, menu entry, accessible name). */
    setActionLabels(primary: string, secondary: string, primaryIcon?: string, secondaryIcon?: string): void {
        this.primaryLabel = primary;
        this.secondaryLabel = secondary;
        this.primaryButton.set_tooltip_text(primary);
        this.secondaryButton.set_tooltip_text(secondary);
        this.primaryButton.update_property([Gtk.AccessibleProperty.LABEL], [primary]);
        this.secondaryButton.update_property([Gtk.AccessibleProperty.LABEL], [secondary]);
        if (primaryIcon) {
            this.primaryButton.set_icon_name(primaryIcon);
            this.primaryIcon.set_from_icon_name(primaryIcon);
        }
        if (secondaryIcon) {
            this.secondaryButton.set_icon_name(secondaryIcon);
            this.secondaryIcon.set_from_icon_name(secondaryIcon);
        }
    }

    private buildLayers(): void {
        this.overlay.set_overflow(Gtk.Overflow.HIDDEN);
        this.backdrop.add_css_class('gjsify-swipe-backdrop');
        this.backdrop.set_visible(false);
        for (const icon of [this.primaryIcon, this.secondaryIcon]) {
            icon.set_margin_start(18);
            icon.set_margin_end(18);
        }
        this.backdrop.set_start_widget(this.primaryIcon);
        this.backdrop.set_end_widget(this.secondaryIcon);
        this.overlay.set_child(this.backdrop);

        this.slot.add_css_class('gjsify-swipe-content');
        this.overlay.add_overlay(this.slot);
        this.overlay.set_measure_overlay(this.slot, true);
        this.overlay.set_clip_overlay(this.slot, true);

        this.actions.add_css_class('gjsify-swipe-actions');
        this.actions.set_halign(Gtk.Align.END);
        this.actions.set_valign(Gtk.Align.CENTER);
        this.actions.set_margin_end(8);
        this.actions.set_visible(false);
        for (const b of [this.primaryButton, this.secondaryButton]) {
            b.add_css_class('flat');
            b.add_css_class('circular');
            this.actions.append(b);
        }
        this.setActionLabels(this.primaryLabel, this.secondaryLabel);
        this.primaryButton.connect('clicked', () => emitSignal(this, 'primary'));
        this.secondaryButton.connect('clicked', () => emitSignal(this, 'secondary'));
        this.overlay.add_overlay(this.actions);

        // The content layer slides; the actions stay where the default layout puts them.
        this.overlay.connect('get-child-position', (_o: Gtk.Overlay, child: Gtk.Widget, rect: Gdk.Rectangle) => {
            if (child !== this.slot) return false;
            rect.x = Math.round(this.offset);
            rect.y = 0;
            rect.width = this.overlay.get_width();
            rect.height = this.overlay.get_height();
            return true;
        });
    }

    private buildActions(): void {
        const add = (name: string, run: () => void) => {
            const action = new Gio.SimpleAction({ name });
            action.connect('activate', run);
            this.group.add_action(action);
        };
        add('primary', () => emitSignal(this, 'primary'));
        add('secondary', () => emitSignal(this, 'secondary'));
        add('open', () => emitSignal(this, 'activated'));
        this.insert_action_group('swipe', this.group);
    }

    private buildInput(): void {
        const drag = new Gtk.GestureDrag({ touchOnly: true });
        drag.connect('drag-begin', () => {
            this.pointer = false;
            this.applyHeight();
        });
        drag.connect('drag-update', (_g: Gtk.GestureDrag, dx: number, dy: number) => this.onDrag(drag, dx, dy));
        drag.connect('drag-end', () => this.onDragEnd());
        drag.connect('cancel', () => this.settle(null));
        this.add_controller(drag);

        const motion = new Gtk.EventControllerMotion();
        const hover = () => {
            const source = motion.get_current_event_device()?.get_source();
            if (source === Gdk.InputSource.TOUCHSCREEN) return;
            if (!this.pointer) {
                this.pointer = true;
                this.applyHeight();
            }
            this.actions.set_visible(this.isWritable);
        };
        motion.connect('enter', hover);
        motion.connect('motion', hover);
        motion.connect('leave', () => this.actions.set_visible(false));
        this.add_controller(motion);

        const click = new Gtk.GestureClick({ button: Gdk.BUTTON_PRIMARY });
        click.connect('released', () => emitSignal(this, 'activated'));
        this.add_controller(click);

        const secondaryClick = new Gtk.GestureClick({ button: Gdk.BUTTON_SECONDARY });
        secondaryClick.connect('pressed', (_g: Gtk.GestureClick, _n: number, x: number, y: number) =>
            this.popupMenu(x, y),
        );
        this.add_controller(secondaryClick);

        const press = new Gtk.GestureLongPress({ touchOnly: true });
        press.connect('pressed', (_g: Gtk.GestureLongPress, x: number, y: number) => this.popupMenu(x, y));
        this.add_controller(press);

        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_k: Gtk.EventControllerKey, keyval: number, _code: number, state: number) => {
            if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter) {
                emitSignal(this, 'activated');
                return true;
            }
            if (keyval === Gdk.KEY_Menu || (keyval === Gdk.KEY_F10 && (state & Gdk.ModifierType.SHIFT_MASK) !== 0)) {
                this.popupMenu(this.get_width() / 2, this.get_height() / 2);
                return true;
            }
            return false;
        });
        this.add_controller(keys);
    }

    private onDrag(drag: Gtk.GestureDrag, dx: number, dy: number): void {
        if (!this.isWritable) return;
        if (!this.claimed) {
            if (Math.abs(dx) < SWIPE_START_PX || Math.abs(dx) < Math.abs(dy) * 2) return;
            this.claimed = true;
            drag.set_state(Gtk.EventSequenceState.CLAIMED);
        }
        const width = this.get_width();
        this.setOffset(Math.max(-width, Math.min(width, dx)));
    }

    private onDragEnd(): void {
        if (!this.claimed) return;
        this.settle(swipeOutcome(this.offset, this.get_width()));
    }

    /** Slide back to rest, then report the outcome — the host may remove the row in its handler. */
    private settle(outcome: 'primary' | 'secondary' | 'none' | null): void {
        this.claimed = false;
        this.animation?.skip();
        const done = () => {
            this.setOffset(0);
            if (outcome === 'primary' || outcome === 'secondary') emitSignal(this, outcome);
        };
        if (this.offset === 0) {
            done();
            return;
        }
        const animation = new Adw.TimedAnimation({
            widget: this,
            valueFrom: this.offset,
            valueTo: 0,
            duration: SETTLE_MS,
            easing: Adw.Easing.EASE_OUT_CUBIC,
            target: new Adw.CallbackAnimationTarget((v: number) => this.setOffset(v)),
        });
        animation.connect('done', done);
        this.animation = animation;
        animation.play();
    }

    private setOffset(value: number): void {
        this.offset = value;
        const outcome = swipeOutcome(value, this.get_width());
        this.backdrop.set_visible(value !== 0);
        this.backdrop.remove_css_class(value > 0 ? 'secondary' : 'primary');
        this.backdrop.add_css_class(value > 0 ? 'primary' : 'secondary');
        if (outcome === 'none') this.backdrop.remove_css_class('armed');
        else this.backdrop.add_css_class('armed');
        this.overlay.queue_allocate();
    }

    private popupMenu(x: number, y: number): void {
        const menu = new Gio.Menu();
        if (this.isWritable) {
            menu.append(this.primaryLabel, 'swipe.primary');
            menu.append(this.secondaryLabel, 'swipe.secondary');
        }
        menu.append(_('Open'), 'swipe.open');
        const popover = new Gtk.PopoverMenu({ menuModel: menu, hasArrow: false });
        popover.set_parent(this);
        popover.set_pointing_to(new Gdk.Rectangle({ x: Math.round(x), y: Math.round(y), width: 1, height: 1 }));
        // A popover left parented would make this widget finalize with a child. GTK emits `closed`
        // before the clicked item's action runs, and the action is found through the parent: unparent later.
        popover.connect('closed', () =>
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                popover.unparent();
                return GLib.SOURCE_REMOVE;
            }),
        );
        popover.popup();
    }

    private applyHeight(): void {
        this.slot.set_size_request(-1, rowMinHeight(this.sizeClass, this.pointer));
    }
}
