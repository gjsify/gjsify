// THE ORACLE (ADR 0097 § 3): MENU_ACTION_VECTORS against real GTK. The probe is a button INSIDE the
// popover of a `Gtk.MenuButton`, because that is where a menu's rows live; its `action-name` is what a
// menu item's `action` becomes. A vector that fails here is a wrong vector: fix the vector.

import { describe, expect, it, on } from '@gjsify/unit';

import { driveMenuActionVectors, type MenuActionScene } from './conformance/menu-actions.js';

type Obj = Record<string, unknown>;
type Ctor = new (params?: Obj) => Obj;
interface GtkModule {
    init_check(): boolean;
    Box: Ctor;
    Button: Ctor;
    MenuButton: Ctor;
    Popover: Ctor;
    Window: Ctor;
}
interface GioModule {
    SimpleAction: new (params: { name: string; enabled: boolean }) => Obj;
    SimpleActionGroup: Ctor;
}

const call = (o: unknown, m: string, ...a: unknown[]) =>
    (o as Record<string, (...args: unknown[]) => unknown>)[m]!(...a);

export default async () => {
    await on('Gjs', async () => {
        const Gio = (await import('gi://Gio?version=2.0' as string)).default as GioModule;
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default as GtkModule;
        if (!Gtk.init_check()) return;
        const scene: MenuActionScene = {
            chain() {
                const probe = new Gtk.Button();
                const popover = new Gtk.Popover();
                call(popover, 'set_child', probe);
                const menuButton = new Gtk.MenuButton();
                call(menuButton, 'set_popover', popover);
                const box = new Gtk.Box();
                call(box, 'append', menuButton);
                const outer = new Gtk.Window();
                call(outer, 'set_child', box);
                return { outer, button: probe };
            },
            insertGroup(widget, prefix, actions, onActivate) {
                const group = new Gio.SimpleActionGroup();
                for (const [name, enabled] of Object.entries(actions)) {
                    const action = new Gio.SimpleAction({ name, enabled });
                    call(action, 'connect', 'activate', () => onActivate(name));
                    call(group, 'add_action', action);
                }
                call(widget, 'insert_action_group', prefix, group);
            },
            sensitive(button, detailed) {
                call(button, 'set_action_name', detailed);
                return call(button, 'get_sensitive') === true;
            },
            activate: (button, detailed) => void call(button, 'activate_action', detailed, null),
        };
        await driveMenuActionVectors('GJS (real Gtk.MenuButton popover)', scene, { describe, it, expect });
    });
};
