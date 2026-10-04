// Gtk.GraphicsOffload — one child, handed to the compositor as it is.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { graphicsOffloadMeta } from './graphics-offload.meta.js';

/** Story: a Gtk.GraphicsOffload around one child, with `enabled` and the black rect bound to args. */
export class GraphicsOffloadStory extends StoryWidget {
    private _offload: Gtk.GraphicsOffload | null = null;
    private _box: Gtk.Box | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookGraphicsOffload' }, GraphicsOffloadStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(GraphicsOffloadStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...graphicsOffloadMeta, component: Gtk.GraphicsOffload.$gtype };
    }

    initialize(): void {
        this._offload = new Gtk.GraphicsOffload({ widthRequest: 280, heightRequest: 96 });
        // The order is the property order (gtkgraphicsoffload.c:366-380, :423-437): `enabled`
        // first — it syncs the subsurface — then the black rectangle, which paints before the child.
        this._offload.enabled = (this.args.enabled as string) === 'disabled' ? 1 : 0;
        this._offload.black_background = this.args.blackBackground as boolean;
        this._box = new Gtk.Box({ halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER });
        this._box.append(this._offload);
        this._applyChild();
        this.addContent(this._box);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._offload) return;
        this._offload.enabled = (this.args.enabled as string) === 'disabled' ? 1 : 0;
        this._offload.black_background = this.args.blackBackground as boolean;
        this._applyChild();
    }

    /** The wrapper holds exactly ONE child, so changing it means replacing it. */
    private _applyChild(): void {
        if (!this._offload) return;
        let child: Gtk.Widget;
        switch (this.args.child) {
            case 'label':
                child = new Gtk.Label({ label: 'The child of an offloaded layer' });
                break;
            case 'box': {
                // A row of three labels, centred — the bin layout hands it the whole
                // allocation whatever its own request is.
                const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12 });
                for (const text of ['One', 'Two', 'Three']) row.append(new Gtk.Label({ label: text }));
                child = new Gtk.CenterBox();
                (child as Gtk.CenterBox).set_center_widget(row);
                break;
            }
            default:
                child = new Gtk.Image({ iconName: 'camera-photo-symbolic', pixelSize: 48 });
                break;
        }
        // `set_child` unparents the old one and notifies (gtkgraphicsoffload.c:317-336).
        this._offload.child = child;
    }
}

GObject.type_ensure(GraphicsOffloadStory.$gtype);

export const GraphicsOffloadStories: StoryModule = { stories: [GraphicsOffloadStory] };
