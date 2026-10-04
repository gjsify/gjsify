// Browser port of the Drag Icon story. Shares metadata with drag-icon.story.ts.
//
// THE DRAG SOURCE IS A `draggable` ROW HERE, and that is the whole of the difference: a
// browser has no drag source object to attach to a widget, but it does have the HTML
// drag-and-drop events, and `dragstart` is the same moment as `GtkDragSource::drag-begin`.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
// The one place a story needs an element's VALUE: `getForDrag` and `createWidgetForValue`
// are the static half of `GtkDragIcon`'s API — an icon is not something a page declares and
// fills in, it is something a drag asks for. Everywhere else the stories create elements by
// tag, which needs no import at all.
import { Gtk } from '@gjsify/adwaita-web';
import { dragIconMeta } from '../../drawing/drag-icon.meta.js';

/** The `rgba()` a `GdkRGBA` value paints, as the colour swatch shows it. */
interface Rgba {
    readonly red: number;
    readonly green: number;
    readonly blue: number;
    readonly alpha?: number;
}

export class DragIconWebStory extends StoryElement {
    private _row: HTMLElement | null = null;
    private _hint: HTMLElement | null = null;

    constructor() {
        super(DragIconWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return dragIconMeta;
    }

    initialize(): void {
        const box = document.createElement('div');
        box.style.display = 'flex';
        box.style.flexDirection = 'column';
        box.style.alignItems = 'center';
        box.style.gap = '12px';

        const hint = document.createElement('p');
        hint.className = 'dim-label';
        this._hint = hint;
        box.append(hint);

        // The DRAGGABLE ROW. What `gtk_widget_add_controller (widget,
        // GTK_EVENT_CONTROLLER (drag_source))` is in GTK (gtkdragsource.c:44-58) is a
        // `draggable` element plus a `dragstart` handler in a browser.
        this._row = document.createElement('div');
        this._row.className = 'card';
        this._row.draggable = true;
        this._row.style.display = 'flex';
        this._row.style.alignItems = 'center';
        this._row.style.gap = '12px';
        this._row.style.padding = '12px';
        const label = document.createElement('span');
        label.className = 'heading';
        label.textContent = 'Report.odt';
        this._row.append(label);
        this._row.addEventListener('dragstart', (event) => this._onDragStart(event as DragEvent));
        box.append(this._row);

        this._apply();
        this.addContent(box);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    /** The value the drag offers, which is also what decides the icon — the two are one thing. */
    private _value(): string | Rgba | null {
        switch (this.args.value) {
            case 'rgba':
                return { red: 0.25, green: 0.55, blue: 0.95, alpha: 1 };
            case 'none':
                return null;
            default:
                return 'Report.odt';
        }
    }

    /**
     * `::drag-begin`: `GtkDragIcon.getForDrag` is the only way to reach an icon, and
     * `createWidgetForValue` is what decides what a value shows (gtkdragicon.c:529-556).
     */
    private _onDragStart(event: DragEvent): void {
        // `actions` on the source is the effect this drag may have; a browser states it as
        // `effectAllowed`, and 'copy' / 'move' are the two Gdk.DragAction bits of the story.
        if (event.dataTransfer !== null) {
            event.dataTransfer.effectAllowed = this.args.actions === 'move' ? 'move' : 'copy';
        }
        const value = this._value();
        if (value === null) return;
        const icon = Gtk.DragIcon.getForDrag(event);
        // `set_child` unparents the old child and shows the icon (:468-489), so this is also
        // how an icon that had none starts showing.
        icon.setChild(Gtk.DragIcon.createWidgetForValue(value));
    }

    private _apply(): void {
        if (this._hint === null || this._row === null) return;
        this._hint.textContent =
            this.args.value === 'none'
                ? 'Drag the row — no icon, because the value has no widget to show'
                : 'Drag the row and watch the pointer';
        this._row.title = 'Draggable — the icon that follows the pointer is a <gtk-drag-icon>';
    }
}

export const DragIconWebStories: WebStoryModule = { stories: [DragIconWebStory] };
