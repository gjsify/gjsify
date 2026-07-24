// Style-isolation regression test (browser axis). Guards the boundary reset
// (scss/_reset.scss, ADR 0010): a host page's inherited typography must not leak
// into an adwaita-web widget. It also guards that the widget's tag is listed in
// the reset's `$adw-components` — if it weren't, the reset wouldn't apply and
// these assertions would fail.
import { describe, expect, it } from '@gjsify/unit';

export const AdwStyleIsolationTest = async () => {
    await describe('style isolation (boundary reset)', async () => {
        await it('re-roots typography so a host font does not inherit into a widget', async () => {
            // A container styled like a hostile host theme.
            const host = document.createElement('div');
            host.style.fontFamily = 'Georgia, "Times New Roman", serif';
            host.style.color = 'rgb(255, 0, 255)';
            host.style.lineHeight = '2.4';
            host.style.letterSpacing = '3px';
            host.style.textTransform = 'uppercase';
            document.body.appendChild(host);

            const row = document.createElement('adw-switch-row');
            row.setAttribute('title', 'Wi-Fi');
            host.appendChild(row);

            const cs = getComputedStyle(row);
            // The boundary reset re-roots the inherited typography to Adwaita's,
            // so the host's serif / magenta / spacing / casing do not leak in.
            expect(cs.fontFamily.includes('Adwaita Sans')).toBe(true);
            expect(cs.fontFamily.includes('Georgia')).toBe(false);
            expect(cs.letterSpacing).toBe('normal');
            expect(cs.textTransform).toBe('none');
            expect(cs.color === 'rgb(255, 0, 255)').toBe(false);

            host.remove();
        });
    });
};
