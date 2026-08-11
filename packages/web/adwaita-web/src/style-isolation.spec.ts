// The boundary reset (scss/_reset.scss, ADR 0010): a host page's inherited typography must
// not leak into an adwaita-web widget. Also guards that the widget's tag is listed in the
// reset's `$adw-components` — without it the reset would not apply and these fail.
import { describe, expect, it } from '@gjsify/unit';

export const AdwStyleIsolationTest = async () => {
    await describe('style isolation (boundary reset)', async () => {
        await it('re-roots typography so a host font does not inherit into a widget', async () => {
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
