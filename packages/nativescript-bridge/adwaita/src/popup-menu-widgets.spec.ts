// ADR 0097 § 2 on the real widgets: `GtkMenuButton`, `AdwSplitButton` and `Gtk.PopoverMenu` open a
// `PopupMenu` through the surface seam, fire the chosen item's action through the registry of
// ADR 0098, and refuse by name what the surface cannot draw. Against a recording surface and the
// platform double: it shows what the widgets ask of the platform, never what Android draws.
import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';
import { SimpleAction, SimpleActionGroup, insertActionGroup } from './widgets/actions.js';
import type { PopupMenuItemLike, PopupMenuLike, PopupMenuSurface } from './widgets/popup-menu.js';
import { setPopupMenuSurfaceForTesting } from './widgets/popup-menu-view.js';

class Recorder implements PopupMenuLike {
    readonly rows: string[] = [];
    add(_group: number, id: number, _order: number, title: string): PopupMenuItemLike {
        this.rows.push(`${id}:${title}`);
        return { setEnabled: () => undefined, setCheckable: () => undefined, setChecked: () => undefined };
    }
    addSubMenu(): PopupMenuLike {
        return new Recorder();
    }
    setGroupCheckable(): void {}
}

interface Shown {
    readonly anchor: object;
    readonly menu: Recorder;
    click(id: number): boolean;
    dismiss(): void;
    dismissed: boolean;
}

function recordSurfaces(): { shown: Shown[]; restore(): void } {
    const shown: Shown[] = [];
    setPopupMenuSurfaceForTesting((anchor) => {
        let click: (id: number) => boolean = () => false;
        let onDismiss = (): void => {};
        const menu = new Recorder();
        const entry: Shown = {
            anchor,
            menu,
            click: (id) => click(id),
            dismiss: () => onDismiss(),
            dismissed: false,
        };
        shown.push(entry);
        const surface: PopupMenuSurface = {
            menu,
            apiLevel: 34,
            show: () => undefined,
            dismiss: () => {
                entry.dismissed = true;
                onDismiss();
            },
            onItemClick: (handler) => void (click = handler),
            onDismiss: (handler) => void (onDismiss = handler),
        };
        return surface;
    });
    return { shown, restore: () => setPopupMenuSurfaceForTesting(null) };
}

const tap = (view: object): void => (view as { notify(data: object): void }).notify({ eventName: 'tap', object: view });

const groupWith = (name: string, run: () => void): SimpleActionGroup => {
    const group = new SimpleActionGroup();
    const action = new SimpleAction({ name });
    action.connect('activate', run);
    group.add_action(action);
    return group;
};

export const PopupMenuWidgetsNsTest = async () => {
    await describe('PopupMenu widgets (ADR 0097 § 2)', async () => {
        await it('a menu button shows the menu at itself, fires the chosen action once and reports the item', () => {
            const { shown, restore } = recordSurfaces();
            try {
                const box = new Gtk.Box();
                const button = new Gtk.MenuButton();
                box.append(button as never);
                let ran = 0;
                insertActionGroup(
                    box as never,
                    'win',
                    groupWith('save', () => ran++),
                );
                button.menuModel = [{ label: 'Save', action: 'win.save', id: 'save' }, 'Quit'];
                const activated: string[] = [];
                button.connect('menuItemActivated', (_self, data) =>
                    activated.push(String((data as unknown as { id: string }).id)),
                );
                tap(button);
                expect(shown.length).toBe(1);
                expect(shown[0]?.anchor).toBe(button);
                expect(shown[0]?.menu.rows.join(',')).toBe('1:Save,2:Quit');
                expect(shown[0]?.click(1)).toBe(true);
                expect(ran).toBe(1);
                expect(activated.join(',')).toBe('save');
            } finally {
                restore();
            }
        });

        await it('a custom item or a section label is refused at the assignment, naming it', () => {
            const button = new Gtk.MenuButton();
            expect(() => (button.menuModel = [{ label: 'Zoom', custom: 'zoom' }])).toThrow('custom');
            expect(() => (button.menuModel = [{ label: 'Edit', section: ['Cut'] }])).toThrow('section-label');
        });

        await it('a radio run that shares a group with another row is refused when the menu opens', () => {
            const { shown, restore } = recordSurfaces();
            try {
                const button = new Gtk.MenuButton();
                button.menuModel = [
                    {
                        section: [
                            { label: 'A', action: 'win.v::a' },
                            { label: 'W', action: 'win.w' },
                        ],
                    },
                ];
                button.actions = { 'win.v': { state: 'a' }, 'win.w': { state: 'false' } };
                expect(() => tap(button)).toThrow('mixed-radio-section');
                expect(shown[0]?.menu.rows.length).toBe(0);
            } finally {
                restore();
            }
        });

        await it('the split button opens at its arrow half, and a dismissal closes its state', () => {
            const { shown, restore } = recordSurfaces();
            try {
                const split = new Adw.SplitButton({ label: 'Save' });
                split.menuModel = ['Save as…'];
                const dropdown = (split as unknown as { _dropdownPart: object })._dropdownPart;
                tap(dropdown);
                expect(shown.length).toBe(1);
                expect(shown[0]?.anchor).toBe(dropdown);
                shown[0]?.dismiss();
                tap(dropdown);
                expect(shown.length).toBe(2);
            } finally {
                restore();
            }
        });

        await it('a standalone popover menu is a PopupMenu at its parent: popup, closed, popdown', () => {
            const { shown, restore } = recordSurfaces();
            try {
                const parent = new Gtk.Box();
                const popover = new Gtk.PopoverMenu();
                popover.menuModel = ['Copy'];
                expect(() => popover.popup()).toThrow('set_parent');
                popover.set_parent(parent as never);
                let closed = 0;
                popover.connect('closed', () => closed++);
                popover.popup();
                popover.popup();
                expect(shown.length).toBe(1);
                expect(shown[0]?.anchor).toBe(parent);
                popover.popdown();
                expect(shown[0]?.dismissed).toBe(true);
                expect(closed).toBe(1);
                popover.popdown();
                expect(closed).toBe(1);
            } finally {
                restore();
            }
        });

        await it('a popover member a PopupMenu cannot express throws by name; GTK defaults are readable', () => {
            const popover = new Gtk.PopoverMenu();
            expect(popover.position).toBe('bottom');
            expect(popover.hasArrow).toBe(true);
            expect(popover.autohide).toBe(true);
            expect(() => popover.set_pointing_to({})).toThrow('pointing_to');
            expect(() => popover.pointingTo).toThrow('pointing_to');
            expect(() => (popover.position = 'top')).toThrow('position = top');
            expect(() => (popover.hasArrow = false)).toThrow('has_arrow = false');
            expect(() => (popover.autohide = false)).toThrow('autohide = false');
            expect(() => (popover.flags = 'sliding')).toThrow('flags = sliding');
            expect(() => popover.add_child({}, 'x')).toThrow('add_child');
        });

        await it('a PopoverMenuBar is refused by name', () => {
            expect(() => build({ tag: 'GtkPopoverMenuBar' } as SharedTreeNode)).toThrow('GtkPopoverMenuBar');
        });
    });
};
