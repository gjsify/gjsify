import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { _ } from './i18n.js';
import { dueState, type DueState } from './due-state.js';

/** libadwaita's own colour classes, so the chip follows the theme and dark mode. */
const STATE_CLASS: Record<DueState, string[]> = {
    overdue: ['error'],
    today: ['warning'],
    soon: ['accent'],
    later: ['dim-label'],
    none: [],
};

function stateText(state: DueState): string {
    switch (state) {
        case 'overdue':
            return _('Overdue');
        case 'today':
            return _('Today');
        case 'soon':
            return _('Soon');
        case 'later':
            return _('Later');
        case 'none':
            return '';
    }
}

/** A pill label for a due date; hidden while there is none. */
export class DueChip extends Gtk.Label {
    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwDueChip' }, DueChip);
    }

    private shown: DueState = 'none';

    constructor() {
        super({ useMarkup: false, valign: Gtk.Align.CENTER });
        this.add_css_class('caption-heading');
        this.add_css_class('due-chip');
        this.setState('none');
    }

    get state(): DueState {
        return this.shown;
    }

    setDue(due: Date | null, now: Date = new Date()): void {
        this.setState(dueState(due, now));
    }

    setState(state: DueState): void {
        for (const css of ['overdue', 'today', 'soon', 'later', 'none'] as const) {
            this.remove_css_class(`due-chip-${css}`);
            for (const c of STATE_CLASS[css]) this.remove_css_class(c);
        }
        this.shown = state;
        this.add_css_class(`due-chip-${state}`);
        for (const c of STATE_CLASS[state]) this.add_css_class(c);
        this.set_label(stateText(state));
        this.set_visible(state !== 'none');
    }
}
