// Gtk.FlowBox — the same selectable rows a list box holds, reflowed into as many per line
// as the width fits.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { FLOW_BOX_CELLS, flowBoxMeta } from './flow-box.meta.js';

/** Story: a Gtk.FlowBox of GtkFlowBoxChild cells, its line arithmetic driven by args. */
export class FlowBoxStory extends StoryWidget {
    private _box: Gtk.FlowBox | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookFlowBox' }, FlowBoxStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(FlowBoxStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...flowBoxMeta, component: Gtk.FlowBox.$gtype };
    }

    initialize(): void {
        this._box = new Gtk.FlowBox({ hexpand: true, vexpand: true });
        // `GtkFlowBoxChild` is a Bin, so the wrapped widget goes through `set_child()` — the
        // wrapper the markup form writes as `<gtk-flow-box-child>`.
        for (const name of FLOW_BOX_CELLS) {
            this._box.append(new Gtk.FlowBoxChild({ child: new Gtk.Label({ label: name }) }));
        }
        this._apply();
        this.addContent(this._box);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._box) return;
        this._box.selection_mode = this._selectionMode();
        // HORIZONTAL is the default (gtkflowbox.c:3981) and the default the meta starts from,
        // so the arg only has to write the property, not its absence.
        this._box.orientation =
            (this.args.orientation as string) === 'vertical' ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL;
        // The ParamSpec minimum is 1 (gtkflowbox.c:3767-3770), so 0 from a cleared arg is
        // clamped the way the setter would clamp it rather than silently wrapping everything
        // onto one line.
        this._box.max_children_per_line = Math.max(1, Math.trunc(this.args.maxChildrenPerLine as number));
        this._box.homogeneous = this.args.homogeneous as boolean;
        this._box.row_spacing = Math.max(0, Math.trunc(this.args.rowSpacing as number));
    }

    private _selectionMode(): Gtk.SelectionMode {
        switch (this.args.selectionMode as string) {
            case 'single':
                return Gtk.SelectionMode.SINGLE;
            case 'browse':
                return Gtk.SelectionMode.BROWSE;
            case 'none':
                return Gtk.SelectionMode.NONE;
            default:
                return Gtk.SelectionMode.MULTIPLE;
        }
    }
}

GObject.type_ensure(FlowBoxStory.$gtype);

export const FlowBoxStories: StoryModule = { stories: [FlowBoxStory] };
