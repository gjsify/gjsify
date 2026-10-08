// The lowering of a menu to a `PopupMenu` plan (ADR 0097 § 2), held to the shared vectors.
import { describe, expect, it } from '@gjsify/unit';

import { POPUP_MENU_PLAN_VECTORS, popupMenuOutline } from './conformance/popup-menu-plan.js';
import { normalizeMenuModel } from './menu.js';
import { assertPopupMenuPlan, planPopupMenu } from './popup-menu-plan.js';

export default async () => {
    await describe('PopupMenu plan (ADR 0097 § 2)', async () => {
        for (const { actions, input, outline, refused, rule } of POPUP_MENU_PLAN_VECTORS) {
            await it(rule, () => {
                const plan = planPopupMenu(normalizeMenuModel(input), actions);
                expect(popupMenuOutline(plan.level)).toStrictEqual([...outline]);
                expect(plan.refusals.map((refusal) => refusal.what)).toStrictEqual([...refused]);
            });
        }

        await it('assertPopupMenuPlan names every refusal and passes a clean plan', () => {
            const clean = planPopupMenu(normalizeMenuModel(['Open']));
            assertPopupMenuPlan(clean);
            const bad = planPopupMenu(
                normalizeMenuModel([
                    { label: 'Zoom', custom: 'z' },
                    { label: 'E', section: ['x'] },
                ]),
            );
            expect(() => assertPopupMenuPlan(bad)).toThrow('custom');
            expect(() => assertPopupMenuPlan(bad)).toThrow('section-label');
        });
    });
};
