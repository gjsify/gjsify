import type { Canvas2DBridge } from '@gjsify/adwaita-nativescript/canvas2d';
import type { GtkSource } from '@gjsify/gtksource-nativescript';

export type Frame = Parameters<Canvas2DBridge['requestAnimationFrame']>[0];
export type SourceView = InstanceType<typeof GtkSource.View>;

import { type Adw, Gio, type Gtk } from '@gjsify/adwaita-nativescript';

// `Gio.ActionMap` on both application windows, typed (GIR: add_action, lookup_action, remove_action).
export function actionMap(gtkWindow: Gtk.ApplicationWindow, adwWindow: Adw.ApplicationWindow): unknown {
    gtkWindow.add_action(new Gio.SimpleAction({ name: 'x' }));
    adwWindow.add_action(new Gio.SimpleAction({ name: 'x' }));
    adwWindow.remove_action('x');
    gtkWindow.remove_action('x');
    return gtkWindow.lookup_action('x') ?? adwWindow.lookup_action('x');
}
