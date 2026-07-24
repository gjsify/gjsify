// adw-view-switcher-bar visibility regression (browser axis). Guards that the
// `revealed` flag actually shows/hides the bar. The bar's base scss sets
// `display: block`, an AUTHOR rule that would defeat the UA `[hidden]{display:none}`
// the component relies on (cascade origin beats specificity) — so an unrevealed
// bar rendered visible until scss/_view_switcher_bar.scss re-asserted
// `&[hidden] { display: none }`. This test pins that fix.
import { describe, expect, it } from '@gjsify/unit';

export const AdwViewSwitcherBarTest = async () => {
    await describe('adw-view-switcher-bar revealed → visibility', async () => {
        await it('is display:none by default (not revealed) and block once revealed', async () => {
            const bar = document.createElement('adw-view-switcher-bar');
            document.body.appendChild(bar);

            // Default: `revealed` absent → the component sets `hidden`, and the
            // scss `[hidden]` author rule must win over the base `display: block`.
            expect(bar.hasAttribute('revealed')).toBe(false);
            expect(getComputedStyle(bar).display).toBe('none');

            // Reveal it → shown.
            bar.setAttribute('revealed', '');
            expect(getComputedStyle(bar).display).toBe('block');

            // Hide it again → back to none (the round-trip, not a one-way latch).
            bar.removeAttribute('revealed');
            expect(getComputedStyle(bar).display).toBe('none');

            bar.remove();
        });
    });
};
