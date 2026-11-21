import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

import { ComposerBar } from '../src/composer-bar.js';
import { onSignal } from '../src/signals.js';

const META: StoryMeta = {
    title: 'Adwaita Extended/ComposerBar',
    description: 'The rounded message bar: slots, a growing multi-line entry and the round action button.',
    controls: [
        { name: 'placeholder', label: 'Placeholder', type: ControlType.TEXT, defaultValue: 'Write a message' },
        { name: 'maxLines', label: 'Max lines', type: ControlType.NUMBER, defaultValue: 5, min: 1, max: 12, step: 1 },
        { name: 'status', label: 'Status line', type: ControlType.TEXT, defaultValue: '' },
        { name: 'busy', label: 'Running (Stop)', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'enabled', label: 'Enabled', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};

export class ComposerBarStory extends StoryWidget {
    private bar: ComposerBar | null = null;
    private sent: Gtk.Label | null = null;

    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwStoryComposerBar' }, ComposerBarStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ComposerBarStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...META, component: ComposerBar.$gtype };
    }

    initialize(): void {
        const bar = new ComposerBar();
        bar.addStart(this.flatButton('mail-attachment-symbolic', 'Attach a file'));
        bar.addEnd(this.flatButton('face-smile-symbolic', 'Insert emoji'));
        const sent = new Gtk.Label({ halign: Gtk.Align.START, wrap: true, label: '' });
        onSignal(bar.entry, 'submit', (text: string) => {
            sent.set_label(`Sent: ${text}`);
            bar.entry.clear();
        });
        const column = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12, valign: Gtk.Align.END });
        column.append(sent);
        column.append(bar);
        this.addContent(column);
        this.bar = bar;
        this.sent = sent;
        this.refresh();
    }

    updateArgs(_args: StoryArgs): void {
        this.refresh();
    }

    private flatButton(iconName: string, label: string): Gtk.Button {
        const button = new Gtk.Button({ iconName, tooltipText: label, cssClasses: ['flat', 'circular'] });
        button.update_property([Gtk.AccessibleProperty.LABEL], [label]);
        return button;
    }

    private refresh(): void {
        const bar = this.bar;
        if (!bar || !this.sent) return;
        bar.entry.setPlaceholder(String(this.args.placeholder));
        bar.entry.setMaxLines(Number(this.args.maxLines));
        bar.entry.setSensitive(Boolean(this.args.enabled));
        bar.setStatus(String(this.args.status));
        bar.actionButton.setAction(
            this.args.busy
                ? { iconName: 'process-stop-symbolic', label: 'Stop', suggested: false }
                : { iconName: 'go-up-symbolic', label: 'Send', sensitive: Boolean(this.args.enabled) },
        );
    }
}

GObject.type_ensure(ComposerBarStory.$gtype);

export const ComposerBarStories: StoryModule = { stories: [ComposerBarStory] };
