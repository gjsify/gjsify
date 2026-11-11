// DOM-level test for <adw-clamp>'s own box: its margins sit inside the space the parent gives it.
import { describe, expect, it } from '@gjsify/unit';

export const AdwClampTest = async () => {
    await describe('<adw-clamp> its own margins', async () => {
        await it('fits between its parent edges when it carries a margin', async () => {
            const host = document.createElement('div');
            host.style.width = '402px';
            document.body.appendChild(host);
            const clamp = document.createElement('adw-clamp');
            clamp.style.marginInline = '12px';
            clamp.appendChild(document.createElement('div'));
            host.appendChild(clamp);
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const box = clamp.getBoundingClientRect();
            const edge = host.getBoundingClientRect();
            expect(box.left - edge.left).toBe(12);
            expect(edge.right - box.right).toBe(12);
            host.remove();
        });
    });
};
