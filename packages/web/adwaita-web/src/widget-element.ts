// `Gtk.Widget`'s `visible` and `tooltip-text` on the element classes, once, so the types of every
// widget carry them and so does a plain `document.createElement()`, not only a built tree.
//
// `WidgetElement` is `HTMLElement` plus `gtk_widget_get_visible` / `gtk_widget_set_visible` over
// the DOM's `hidden` attribute, TRUE until hidden as GtkWidget's default is, and the `map` /
// `unmap` signals with `gtk_widget_get_mapped` (`widget-mapping.ts`); `installVisible`
// (`gobject-elements.ts`) gives the same to a class that does not extend it. It notifies only
// where the element declares `notify::visible`. A subclass with its own `visible`
// (`<gtk-stack-page>`, `<adw-sidebar>`) keeps its own.
//
// `TooltipElement` adds `Gtk.Widget:tooltip-text` for the elements that render the
// `tooltip-text` attribute: a button, and the rows (`row-tooltip.ts`). It reflects that attribute
// and the element's `attributeChangedCallback` draws it, so a widget that does not draw it does
// not extend this class.
//
// Reference: GTK gtk/gtkwidget.c (gtk_widget_set_visible, gtk_widget_set_tooltip_text)
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import { WIDGET_VISIBLE_GETTERS, notifyElement } from './gobject-elements.js';
import { dispatchedSignalsOf, type DispatchedSignals } from './signals.js';
import { isMapped } from './widget-mapping.js';

export class WidgetElement extends HTMLElement {
    /** `Gtk.Widget::map` / `::unmap`, which every subclass inherits (`dispatchedSignalsOf`). */
    static readonly signals: DispatchedSignals = { map: 'map', unmap: 'unmap' };

    /** `Gtk.Widget:visible`. */
    get visible(): boolean {
        return !this.hidden;
    }
    set visible(value: boolean) {
        const before = !this.hidden;
        this.toggleAttribute('hidden', !value);
        if (!this.hidden !== before && 'notify::visible' in dispatchedSignalsOf(this)) notifyElement(this, 'visible');
    }
    /** `gtk_widget_get_visible`. */
    get_visible(): boolean {
        return this.visible;
    }
    /** `gtk_widget_set_visible`. */
    set_visible(visible: boolean): void {
        this.visible = visible;
    }
    /** `gtk_widget_get_mapped`: on screen, which is in the document and rendered. */
    get_mapped(): boolean {
        return isMapped(this);
    }
}

WIDGET_VISIBLE_GETTERS.add(Object.getOwnPropertyDescriptor(WidgetElement.prototype, 'visible')!.get!);

export class TooltipElement extends WidgetElement {
    /** `Gtk.Widget:tooltip-text`, the `tooltip-text` attribute; `null` while unset. */
    get tooltip_text(): string | null {
        return this.getAttribute('tooltip-text');
    }
    set tooltip_text(value: string | null) {
        if (value === null || value === undefined) this.removeAttribute('tooltip-text');
        else this.setAttribute('tooltip-text', value);
    }
    get tooltipText(): string | null {
        return this.tooltip_text;
    }
    set tooltipText(value: string | null) {
        this.tooltip_text = value;
    }
    /** `gtk_widget_get_tooltip_text`. */
    get_tooltip_text(): string | null {
        return this.tooltip_text;
    }
    /** `gtk_widget_set_tooltip_text`. */
    set_tooltip_text(text: string | null): void {
        this.tooltip_text = text;
    }
}
