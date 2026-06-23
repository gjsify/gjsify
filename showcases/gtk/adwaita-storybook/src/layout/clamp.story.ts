// Adw.Clamp — constrains its child to a maximum size, centring it within wider space.
// original implementation.

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import GObject from '@girs/gobject-2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

/** Story: Adw.Clamp constraining a wide child so the clamping is visible. */
export class ClampStory extends StoryWidget {
    private _clamp: Adw.Clamp | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookClamp' }, ClampStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ClampStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return {
            title: 'Layout/Clamp',
            description:
                'Adw.Clamp limits its child to a maximum width and centres it, tightening the layout as space shrinks.',
            component: Adw.Clamp.$gtype,
            controls: [
                {
                    name: 'maximumSize',
                    label: 'Maximum size',
                    type: ControlType.RANGE,
                    min: 200,
                    max: 600,
                    step: 10,
                    defaultValue: 400,
                },
                {
                    name: 'tighteningThreshold',
                    label: 'Tightening threshold',
                    type: ControlType.RANGE,
                    min: 100,
                    max: 600,
                    step: 10,
                    defaultValue: 300,
                },
            ],
        };
    }

    initialize(): void {
        const inner = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, widthRequest: 520 });
        inner.add_css_class('card');

        const label = new Gtk.Label({
            label: 'This content is clamped — it stops growing past the maximum size and stays centred.',
            wrap: true,
            xalign: 0,
            hexpand: true,
            marginTop: 18,
            marginBottom: 18,
            marginStart: 18,
            marginEnd: 18,
        });
        inner.append(label);

        this._clamp = new Adw.Clamp({
            maximumSize: this.args.maximumSize as number,
            tighteningThreshold: this.args.tighteningThreshold as number,
            child: inner,
        });
        this.addContent(this._clamp);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._clamp) return;
        this._clamp.maximumSize = this.args.maximumSize as number;
        this._clamp.tighteningThreshold = this.args.tighteningThreshold as number;
    }
}

GObject.type_ensure(ClampStory.$gtype);

export const ClampStories: StoryModule = { stories: [ClampStory] };
