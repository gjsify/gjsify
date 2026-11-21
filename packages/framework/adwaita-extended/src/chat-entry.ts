import Gdk from 'gi://Gdk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import {
    DEFAULT_MAX_LINES,
    DEFAULT_MIN_LINES,
    entryHeightRange,
    entryKeyAction,
    submittableText,
} from './chat-entry-rules.js';
import { _ } from './i18n.js';
import { emitSignal } from './signals.js';
import { ensureStyles } from './styles.js';

const ENTER_KEYS: ReadonlySet<number> = new Set([Gdk.KEY_Return, Gdk.KEY_KP_Enter, Gdk.KEY_ISO_Enter]);

/**
 * A multi-line message field: Enter submits, Shift+Enter and Ctrl+Enter break the line
 * (`entryKeyAction` decides). It grows with the text up to {@link setMaxLines} lines, then scrolls.
 *
 * A `Gtk.TextView` has no placeholder, so the hint is a label in a `Gtk.Overlay` that lets every
 * click through. Signals: `submit(text)` for a non-blank text — the entry does not clear itself,
 * since only the host knows whether the send went out — and `changed`.
 */
export class ChatEntry extends Gtk.Box {
    static {
        GObject.registerClass(
            {
                GTypeName: 'GjsifyAdwChatEntry',
                Signals: { submit: { param_types: [GObject.TYPE_STRING] }, changed: {} },
            },
            ChatEntry,
        );
    }

    private readonly view = new Gtk.TextView({
        wrapMode: Gtk.WrapMode.WORD_CHAR,
        acceptsTab: false,
        topMargin: 6,
        bottomMargin: 6,
        leftMargin: 6,
        rightMargin: 6,
        hexpand: true,
    });
    private readonly scroller: Gtk.ScrolledWindow;
    private readonly hint = new Gtk.Label({
        xalign: 0,
        halign: Gtk.Align.START,
        valign: Gtk.Align.START,
        marginStart: 6,
        marginTop: 6,
        canTarget: false,
        // A long hint must not widen the entry past its window.
        ellipsize: 3,
        singleLineMode: true,
    });
    private placeholder = '';
    private accessibleLabel: string | null = null;

    constructor(placeholder?: string) {
        super({ orientation: Gtk.Orientation.VERTICAL, hexpand: true });
        ensureStyles();
        this.add_css_class('gjsify-chat-entry');
        this.view.add_css_class('gjsify-chat-text');
        this.hint.add_css_class('gjsify-chat-placeholder');

        this.scroller = new Gtk.ScrolledWindow({
            child: this.view,
            hexpand: true,
            hscrollbarPolicy: Gtk.PolicyType.NEVER,
            // EXTERNAL, not AUTOMATIC: the automatic bar forces a ~58 px minimum even when empty.
            vscrollbarPolicy: Gtk.PolicyType.EXTERNAL,
            propagateNaturalHeight: true,
        });
        this.setLines(DEFAULT_MIN_LINES, DEFAULT_MAX_LINES);

        const overlay = new Gtk.Overlay({ child: this.scroller, hexpand: true });
        overlay.add_overlay(this.hint);
        this.append(overlay);

        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_c, keyval, _code, state) => this.onKey(keyval, state));
        this.view.add_controller(keys);

        this.view.get_buffer().connect('changed', () => {
            this.syncHint();
            emitSignal(this, 'changed');
        });

        this.setPlaceholder(placeholder ?? _('Write a message'));
    }

    getText(): string {
        const buffer = this.view.get_buffer();
        return buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), false);
    }

    setText(text: string): void {
        this.view.get_buffer().set_text(text, -1);
    }

    clear(): void {
        this.setText('');
    }

    setPlaceholder(text: string): void {
        this.placeholder = text;
        this.hint.set_label(text);
        this.applyAccessibleLabel();
        this.syncHint();
    }

    /** Name for assistive technology; without one the placeholder serves, then "Message". */
    setAccessibleLabel(text: string | null): void {
        this.accessibleLabel = text;
        this.applyAccessibleLabel();
    }

    /** Visible lines before the field scrolls (`max`) and the floor it never shrinks under (`min`). */
    setLines(min: number, max: number): void {
        const range = entryHeightRange(min, max);
        this.scroller.set_min_content_height(range.min);
        this.scroller.set_max_content_height(range.max);
    }

    setMaxLines(max: number): void {
        this.setLines(DEFAULT_MIN_LINES, max);
    }

    setSensitive(on: boolean): void {
        this.view.set_editable(on);
        this.view.set_cursor_visible(on);
        this.set_sensitive(on);
    }

    grabFocus(): boolean {
        return this.view.grab_focus();
    }

    /** The inner `Gtk.TextView`, for what a host attaches to the editing widget (paste, drop). */
    get textView(): Gtk.TextView {
        return this.view;
    }

    private syncHint(): void {
        this.hint.set_visible(this.view.get_buffer().get_char_count() === 0 && this.placeholder !== '');
    }

    private applyAccessibleLabel(): void {
        const label = this.accessibleLabel ?? (this.placeholder || _('Message'));
        this.view.update_property([Gtk.AccessibleProperty.LABEL], [label]);
    }

    private onKey(keyval: number, state: Gdk.ModifierType): boolean {
        const action = entryKeyAction(ENTER_KEYS.has(keyval), {
            shift: (state & Gdk.ModifierType.SHIFT_MASK) !== 0,
            ctrl: (state & Gdk.ModifierType.CONTROL_MASK) !== 0,
            alt: (state & Gdk.ModifierType.ALT_MASK) !== 0,
            meta: (state & Gdk.ModifierType.META_MASK) !== 0,
        });
        if (action === 'pass') return false;
        if (action === 'newline') {
            const buffer = this.view.get_buffer();
            buffer.delete_selection(true, true);
            buffer.insert_at_cursor('\n', -1);
            return true;
        }
        const text = submittableText(this.getText());
        if (text !== null) emitSignal(this, 'submit', text);
        return true;
    }
}
