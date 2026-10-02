// Gtk.DragIcon — the widget that follows the pointer, reached the only way it can be
// reached: a drag source. Drag the row; the icon that comes with the drag is this widget,
// and GTK destroys it when the drag ends. original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { dragIconMeta } from './drag-icon.meta.js';

/** The value the drag offers, as both renderers offer it: a string, a colour, or nothing. */
type DragValue = string | { red: number; green: number; blue: number; alpha: number } | null;

/** Story: a draggable row whose drag icon is a `GtkDragIcon`, with the value bound to args. */
export class DragIconStory extends StoryWidget {
    private _row: Gtk.Box | null = null;
    private _source: Gtk.DragSource | null = null;
    private _hint: Gtk.Label | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookDragIcon' }, DragIconStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(DragIconStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...dragIconMeta, component: Gtk.DragIcon.$gtype };
    }

    initialize(): void {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        this._hint = new Gtk.Label({ label: 'Drag the row and watch the pointer' });
        this._hint.add_css_class('dim-label');

        this._row = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            cssClasses: ['card'],
        });
        this._row.append(this._buildLabel());

        // `GtkDragSource` is an EVENT CONTROLLER, not a widget: the doc's own snippet
        // creates one, connects `prepare` and `drag-begin`, and hands it to
        // `gtk_widget_add_controller` (gtkdragsource.c:44-58).
        this._source = Gtk.DragSource.new();
        this._source.actions = (this.args.actions as string) === 'move' ? Gdk.DragAction.MOVE : Gdk.DragAction.COPY;
        this._source.connect('prepare', () => this._contentProvider());
        this._source.connect('drag-begin', (_source: Gtk.DragSource, drag: Gdk.Drag) => this._setIcon(drag));
        this._row.add_controller(this._source);

        this._apply();
        box.append(this._hint);
        box.append(this._row);
        this.addContent(box);
    }

    updateArgs(_args: StoryArgs): void {
        if (this._source === null) return;
        this._source.actions = (this.args.actions as string) === 'move' ? Gdk.DragAction.MOVE : Gdk.DragAction.COPY;
        this._apply();
    }

    /** What the drag offers, which is also what decides the icon — the two are one thing. */
    private _value(): DragValue {
        switch (this.args.value) {
            case 'rgba':
                return { red: 0.25, green: 0.55, blue: 0.95, alpha: 1 };
            case 'none':
                return null;
            default:
                return 'Report.odt';
        }
    }

    /** `::prepare` answers the content provider, set just in time rather than ahead. */
    private _contentProvider(): Gdk.ContentProvider | null {
        const value = this._value();
        return value === null ? null : Gdk.ContentProvider.new_for_value(value);
    }

    /**
     * `::drag-begin` is where an icon of your own is set: `gtk_drag_icon_get_for_drag`
     * (gtkdragicon.c:400-421) is the ONLY way to reach one, and
     * `gtk_drag_icon_create_widget_for_value` (:529-556) is what decides what a value shows.
     */
    private _setIcon(drag: Gdk.Drag): void {
        const value = this._value();
        const icon = Gtk.DragIcon.get_for_drag(drag);
        const child = value === null ? null : Gtk.DragIcon.create_widget_for_value(value);
        // `set_child` unparents the old child and shows the icon (:468-489), so this is
        // also how an icon that had none starts showing.
        icon.set_child(child);
    }

    private _buildLabel(): Gtk.Label {
        return new Gtk.Label({ label: 'Report.odt', cssClasses: ['heading'] });
    }

    private _apply(): void {
        if (this._hint === null) return;
        this._hint.label =
            this.args.value === 'none'
                ? 'Drag the row — no icon, because the value has no widget to show'
                : 'Drag the row and watch the pointer';
    }
}

GObject.type_ensure(DragIconStory.$gtype);

export const DragIconStories: StoryModule = { stories: [DragIconStory] };
