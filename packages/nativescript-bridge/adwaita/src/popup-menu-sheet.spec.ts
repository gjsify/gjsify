// The tree a flat action-sheet surface (iOS) is built from, filled by the REAL driver. NOT a
// measurement of UIKit: the sheet itself is verified on the simulator.
import { describe, expect, it } from '@gjsify/unit';

import { normalizeMenuModel, planPopupMenu } from '@gjsify/adwaita-core';
import { fillPopupMenu } from './widgets/popup-menu.js';
import { SheetMenu, sheetTitle } from './widgets/popup-menu-sheet.js';

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
    });
};
