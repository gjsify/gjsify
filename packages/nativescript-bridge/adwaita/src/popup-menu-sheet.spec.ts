// The tree a flat action-sheet surface (iOS) is built from, filled by the REAL driver. NOT a
// measurement of UIKit: the sheet itself is verified on the simulator.
import { describe, expect, it } from '@gjsify/unit';

import { normalizeMenuModel, planPopupMenu } from '@gjsify/adwaita-core';
import { fillPopupMenu } from './widgets/popup-menu.js';
import { SheetMenu, SheetSession, sheetTitle } from './widgets/popup-menu-sheet.js';

const planOf = (model: Parameters<typeof normalizeMenuModel>[0]) => planPopupMenu(normalizeMenuModel(model)).level;

export default async () => {
    await describe('SheetMenu (flat action-sheet surface)', async () => {
        await it('keeps rows in order with ids the driver maps back to model paths', () => {
            const menu = new SheetMenu();
            const paths = fillPopupMenu(menu, planOf(['Open', { section: ['Save', 'Quit'] }]), 0);
            expect(menu.entries.map((entry) => entry.title)).toStrictEqual(['Open', 'Save', 'Quit']);
            expect(menu.entries.map((entry) => entry.group)).toStrictEqual([1, 2, 2]);
            expect(paths.size).toBe(3);
        });

        await it('nests a submenu and gives it no path of its own', () => {
            const menu = new SheetMenu();
            const paths = fillPopupMenu(menu, planOf([{ label: 'More', submenu: ['A', 'B'] }]), 0);
            expect(menu.entries[0].children?.entries.map((entry) => entry.title)).toStrictEqual(['A', 'B']);
            expect(sheetTitle(menu.entries[0])).toBe('More ›');
            expect(paths.size).toBe(2);
        });

        await it('marks a checked row in its title and keeps a disabled one disabled', () => {
            const menu = new SheetMenu();
            const item = menu.add(1, 1, 0, 'Dark');
            item.setCheckable(true);
            item.setChecked(true);
            menu.add(1, 2, 1, 'Light').setEnabled(false);
            expect(sheetTitle(menu.entries[0])).toBe('✓ Dark');
            expect(menu.entries[1].enabled).toBe(false);
        });

        await it('holds an empty menu as no rows at all (the sheet then shows only Cancel)', () => {
            const menu = new SheetMenu();
            fillPopupMenu(menu, planOf([]), 0);
            expect(menu.entries.length).toBe(0);
        });

        await it('keeps a radio run as plain rows with exactly one checked', () => {
            const menu = new SheetMenu();
            const a = menu.add(1, 1, 0, 'A');
            a.setCheckable(true);
            a.setChecked(false);
            const b = menu.add(1, 2, 1, 'B');
            b.setCheckable(true);
            b.setChecked(true);
            menu.add(1, 3, 2, 'C').setCheckable(true);
            expect(menu.entries.map(sheetTitle)).toStrictEqual(['A', '✓ B', 'C']);
        });

        await it('draws an unchecked checkable row like a plain action', () => {
            const menu = new SheetMenu();
            const item = menu.add(1, 1, 0, 'Grid');
            item.setCheckable(true);
            expect(menu.entries[0].checkable).toBe(true);
            expect(sheetTitle(menu.entries[0])).toBe('Grid');
        });

        await it('nests a second level and titles each submenu row', () => {
            const menu = new SheetMenu();
            fillPopupMenu(menu, planOf([{ label: 'More', submenu: [{ label: 'Deeper', submenu: ['X'] }] }]), 0);
            const deeper = menu.entries[0].children?.entries[0];
            expect(sheetTitle(deeper!)).toBe('Deeper ›');
            expect(deeper?.children?.entries[0].title).toBe('X');
        });
    });

    await describe('SheetSession (when a sheet menu is open)', async () => {
        const make = () => {
            const log: string[] = [];
            const session = new SheetSession({
                click: (id) => void log.push(`click ${id}`),
                dismissed: () => void log.push('dismissed'),
            });
            const root = new SheetMenu();
            root.add(1, 7, 0, 'Leaf');
            const sub = root.addSubMenu(1, 8, 1, 'More') as SheetMenu;
            sub.add(1, 9, 0, 'Inner');
            const deeper = sub.addSubMenu(1, 10, 1, 'Deeper') as SheetMenu;
            deeper.add(1, 11, 0, 'Deepest');
            return { log, session, root, sub, deeper };
        };

        await it('reports a leaf click, then dismisses once', () => {
            const { log, session, root } = make();
            session.open(root);
            expect(session.choose(root.entries[0])).toBe(null);
            expect(log).toStrictEqual(['click 7', 'dismissed']);
            expect(session.isOpen).toBe(false);
        });

        await it('dismisses once on Cancel in a submenu', () => {
            const { log, session, root, sub } = make();
            session.open(root);
            expect(session.choose(root.entries[1])).toBe(sub);
            expect(session.depth).toBe(2);
            session.cancel();
            expect(log).toStrictEqual(['dismissed']);
            expect(session.depth).toBe(0);
        });

        await it('follows a second level and dismisses once from it', () => {
            const { log, session, root, sub, deeper } = make();
            session.open(root);
            session.choose(root.entries[1]);
            expect(session.choose(sub.entries[1])).toBe(deeper);
            expect(session.depth).toBe(3);
            session.choose(deeper.entries[0]);
            expect(log).toStrictEqual(['click 11', 'dismissed']);
        });

        await it('dismisses once however many doors report the same sheet going away', () => {
            const { log, session, root } = make();
            session.open(root);
            session.cancel();
            session.uikitDismissed(root);
            session.close();
            session.cancel();
            expect(log).toStrictEqual(['dismissed']);
        });

        await it('dismisses on a tap outside the root sheet', () => {
            const { log, session, root } = make();
            session.open(root);
            session.uikitDismissed(root);
            expect(log).toStrictEqual(['dismissed']);
        });

        await it('ignores the late dismissal of a sheet its submenu replaced', () => {
            const { log, session, root, sub } = make();
            session.open(root);
            session.choose(root.entries[1]);
            session.uikitDismissed(root);
            expect(session.isOpen).toBe(true);
            expect(log).toStrictEqual([]);
            session.uikitDismissed(sub);
            expect(log).toStrictEqual(['dismissed']);
        });

        await it('opens again after any dismissal, and not while open', () => {
            const { log, session, root } = make();
            expect(session.open(root)).toBe(true);
            expect(session.open(root)).toBe(false);
            session.uikitDismissed(root);
            expect(session.open(root)).toBe(true);
            session.close();
            expect(session.open(root)).toBe(true);
            expect(log).toStrictEqual(['dismissed', 'dismissed']);
        });

        await it('still dismisses when the click handler throws', () => {
            const log: string[] = [];
            const session = new SheetSession({
                click: () => {
                    throw new Error('boom');
                },
                dismissed: () => void log.push('dismissed'),
            });
            const root = new SheetMenu();
            root.add(1, 1, 0, 'Leaf');
            session.open(root);
            expect(() => session.choose(root.entries[0])).toThrow();
            expect(log).toStrictEqual(['dismissed']);
        });

        await it('ignores a row tap while closed', () => {
            const { log, session, root } = make();
            expect(session.choose(root.entries[0])).toBe(null);
            expect(log).toStrictEqual([]);
        });
    });
};
