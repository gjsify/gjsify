import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { ensureStyles } from './styles.js';

export interface ChatAction {
    iconName: string;
    /** Tooltip and accessible label, always the same words. */
    label: string;
    sensitive?: boolean;
    /** `suggested-action` styling; on by default, off for a destructive action such as Stop. */
    suggested?: boolean;
}

/**
 * The round button at the end of a composer: Send, and Stop while a reply runs.
 *
 * It holds no state. The host calls {@link setAction} when the meaning changes, and the icon,
 * tooltip and accessible label move together — an icon-only button whose label lagged behind its
 * icon would announce the wrong verb. Emits the inherited `clicked`.
 */
export class ChatActionButton extends Gtk.Button {
    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwChatActionButton' }, ChatActionButton);
    }

    constructor(action?: ChatAction) {
        super({ valign: Gtk.Align.END });
        ensureStyles();
        this.add_css_class('circular');
        this.add_css_class('gjsify-chat-action');
        if (action) this.setAction(action);
    }

    setAction(action: ChatAction): void {
        this.set_icon_name(action.iconName);
        this.set_tooltip_text(action.label);
        this.update_property([Gtk.AccessibleProperty.LABEL], [action.label]);
        this.set_sensitive(action.sensitive ?? true);
        if (action.suggested ?? true) this.add_css_class('suggested-action');
        else this.remove_css_class('suggested-action');
    }
}
