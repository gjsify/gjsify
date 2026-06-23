// Adw.Toast — a transient notification shown over content via Adw.ToastOverlay.
// original implementation.

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import GObject from '@girs/gobject-2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

/** Story: Adw.Toast presented through an Adw.ToastOverlay on button press. */
export class ToastStory extends StoryWidget {
    private _overlay: Adw.ToastOverlay | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookToast' }, ToastStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ToastStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return {
            title: 'Feedback/Toast',
            description:
                'Adw.Toast — a transient notification, with an optional action button, shown over an Adw.ToastOverlay.',
            component: Adw.Toast.$gtype,
            controls: [
                { name: 'title', label: 'Toast text', type: ControlType.TEXT, defaultValue: 'File moved to Trash' },
                {
                    name: 'timeout',
                    label: 'Timeout (s)',
                    type: ControlType.NUMBER,
                    min: 0,
                    max: 10,
                    step: 1,
                    defaultValue: 3,
                },
                { name: 'hasButton', label: 'Action button', type: ControlType.BOOLEAN, defaultValue: true },
                { name: 'buttonLabel', label: 'Button label', type: ControlType.TEXT, defaultValue: 'Undo' },
            ],
        };
    }

    initialize(): void {
        const button = new Gtk.Button({
            label: 'Show toast',
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        button.add_css_class('pill');
        button.add_css_class('suggested-action');
        button.connect('clicked', () => this._showToast());

        this._overlay = new Adw.ToastOverlay({
            child: button,
            widthRequest: 360,
            heightRequest: 220,
        });
        this.addContent(this._overlay);
    }

    private _showToast(): void {
        if (!this._overlay) return;

        const toast = new Adw.Toast({
            title: this.args.title as string,
            timeout: this.args.timeout as number,
        });

        if (this.args.hasButton as boolean) {
            toast.buttonLabel = this.args.buttonLabel as string;
        }

        this._overlay.add_toast(toast);
    }

    updateArgs(_args: StoryArgs): void {
        // Toasts are built on demand in _showToast(); nothing to re-apply to the overlay.
    }
}

GObject.type_ensure(ToastStory.$gtype);

export const ToastStories: StoryModule = { stories: [ToastStory] };
