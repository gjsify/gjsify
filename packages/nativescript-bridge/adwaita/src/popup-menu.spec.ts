// The `PopupMenu` driver (ADR 0097 § 2) against a recording `Menu`, driven by the shared plan vectors
// and the 0098 action resolution. NOT a measurement of Android: the platform mapping is verified on a
// device or emulator before the NativeScript cell of the ADR says `implemented`.
import { describe, expect, it } from '@gjsify/unit';

import {
    ActionRegistry,
    SimpleAction,
    activateMenuItem,
    insertActionGroup,
    menuActionsFor,
    menuItemAt,
    normalizeMenuModel,
} from '@gjsify/adwaita-core';
import { POPUP_MENU_PLAN_VECTORS } from '@gjsify/adwaita-core/conformance';
import {
    openPopupMenu,
    type PopupMenuItemLike,
    type PopupMenuLike,
    type PopupMenuSurface,
} from './widgets/popup-menu.js';

/**
 * Records the calls AND keeps Android's checked state, because the state is where the platform
 * surprises: in an exclusive group `MenuItemImpl.setChecked` calls `setExclusiveItemChecked`
 * whatever the value, so `setChecked(false)` checks the item and unchecks its siblings.
 */
class RecordingMenu implements PopupMenuLike {
    readonly name: string;
    readonly log: string[];
    private readonly items: Array<{ group: number; title: string; checked: boolean }> = [];
    private readonly exclusive = new Set<number>();
    constructor(name: string, log: string[]) {
        this.name = name;
        this.log = log;
    }
    add(group: number, id: number, order: number, title: string): PopupMenuItemLike {
        this.log.push(`${this.name}.add(${group},${id},${order},${title})`);
        const log = this.log;
        const row = { group, title, checked: false };
        this.items.push(row);
        return {
            setEnabled: (value) => void log.push(`${title}.enabled=${value}`),
            setCheckable: (value) => void log.push(`${title}.checkable=${value}`),
            setChecked: (value) => {
                log.push(`${title}.checked=${value}`);
                if (!this.exclusive.has(group)) row.checked = value;
                else for (const other of this.items) if (other.group === group) other.checked = other === row;
            },
        };
    }
    /** The titles Android would draw as checked. */
    checked(): string[] {
        return this.items.filter((row) => row.checked).map((row) => row.title);
    }
    addSubMenu(group: number, id: number, order: number, title: string): PopupMenuLike {
        this.log.push(`${this.name}.addSubMenu(${group},${id},${order},${title})`);
        return new RecordingMenu(title, this.log);
    }
    setGroupCheckable(group: number, checkable: boolean, exclusive: boolean): void {
        this.log.push(`${this.name}.setGroupCheckable(${group},${checkable},${exclusive})`);
        if (exclusive) this.exclusive.add(group);
    }
    setGroupDividerEnabled(enabled: boolean): void {
        this.log.push(`${this.name}.setGroupDividerEnabled(${enabled})`);
    }
}

function surfaceOf(log: string[], apiLevel = 34) {
    let click: (id: number) => boolean = () => false;
    const surface: PopupMenuSurface = {
        menu: new RecordingMenu('root', log),
        apiLevel,
        show: () => void log.push('show'),
        dismiss: () => void log.push('dismiss'),
        onItemClick: (handler) => void (click = handler),
        onDismiss: () => {},
    };
    return { surface, tap: (id: number) => click(id) };
}

export default async () => {
    await describe('PopupMenu driver (ADR 0097 § 2)', async () => {
        await it('maps sections to groups with a divider, and a radio run to an exclusive checkable group', () => {
            const log: string[] = [];
            const { surface } = surfaceOf(log);
            const model = normalizeMenuModel([
                'Open',
                {
                    section: [
                        { label: 'List', action: 'win.view::list' },
                        { label: 'Grid', action: 'win.view::grid' },
                    ],
                },
            ]);
            openPopupMenu({ surface, model, actions: { 'win.view': { state: 'grid' } }, activate: () => {} });
            expect(log).toStrictEqual([
                'root.add(1,1,0,Open)',
                'root.add(2,2,1,List)',
                'root.add(2,3,2,Grid)',
                'root.setGroupCheckable(2,true,true)',
                'Grid.checked=true',
                'root.setGroupDividerEnabled(true)',
                'show',
            ]);
        });

        await it('checks the radio the state names even when it is not the last one', () => {
            const log: string[] = [];
            const { surface } = surfaceOf(log);
            const model = normalizeMenuModel([
                {
                    section: [
                        { label: 'List', action: 'win.view::list' },
                        { label: 'Grid', action: 'win.view::grid' },
                    ],
                },
            ]);
            openPopupMenu({ surface, model, actions: { 'win.view': { state: 'list' } }, activate: () => {} });
            expect((surface.menu as RecordingMenu).checked()).toStrictEqual(['List']);
        });

        await it('inlines sections without a rule below API 28', () => {
            const log: string[] = [];
            const { surface } = surfaceOf(log, 26);
            openPopupMenu({ surface, model: normalizeMenuModel(['A', { section: ['B'] }]), activate: () => {} });
            expect(log.some((line) => line.includes('Divider'))).toBe(false);
        });

        await it('shows an insensitive item disabled and writes a submenu as addSubMenu', () => {
            const log: string[] = [];
            const { surface } = surfaceOf(log);
            const model = normalizeMenuModel([
                { label: 'Paste', action: 'win.paste' },
                { label: 'More', submenu: ['Deep'] },
            ]);
            openPopupMenu({ surface, model, actions: { 'win.paste': { enabled: false } }, activate: () => {} });
            expect(log.slice(0, 4)).toStrictEqual([
                'root.add(1,1,0,Paste)',
                'Paste.enabled=false',
                'root.addSubMenu(1,2,1,More)',
                'More.add(1,3,0,Deep)',
            ]);
        });

        await it('refuses what PopupMenu cannot draw before anything is shown, naming it', () => {
            for (const vector of POPUP_MENU_PLAN_VECTORS.filter((row) => row.refused.length > 0)) {
                const log: string[] = [];
                const { surface } = surfaceOf(log);
                const model = normalizeMenuModel(vector.input);
                expect(() => openPopupMenu({ surface, model, actions: vector.actions, activate: () => {} })).toThrow(
                    vector.refused[0] as string,
                );
                expect(log.includes('show')).toBe(false);
            }
        });

        await it('a tap fires the action through the registry of ADR 0098, once; a submenu row fires nothing', () => {
            const owner = {};
            const button = {};
            const parents = new WeakMap<object, object>([[button, owner]]);
            const parent = (node: object) => parents.get(node);
            const fired: string[] = [];
            const registry = new ActionRegistry();
            const save = new SimpleAction({ name: 'save' });
            save.connect('activate', () => fired.push('save'));
            registry.add(save);
            insertActionGroup(owner, 'win', registry);

            const log: string[] = [];
            const { surface, tap } = surfaceOf(log);
            const model = normalizeMenuModel([
                { label: 'Save', action: 'win.save' },
                { label: 'More', submenu: ['Deep'] },
            ]);
            openPopupMenu({
                surface,
                model,
                actions: menuActionsFor(model, button, parent),
                activate: (path) => {
                    const item = menuItemAt(model, path);
                    if (item !== null) activateMenuItem(item, button, parent);
                },
            });
            expect(tap(2)).toBe(false);
            expect(tap(1)).toBe(true);
            expect(fired.join(',')).toBe('save');
        });
    });
};
