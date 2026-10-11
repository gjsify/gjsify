// How the web door reaches the platform for `Gtk.StyleContext`, `Gtk.Settings`, `Gtk.show_uri` and
// `Gtk.EventControllerKey` (the behaviour is in `@gjsify/adwaita-core`, `gtk-platform.ts`).
//
//   - styles: one `<style>` element per provider, kept in priority order at the end of `<head>`.
//   - uris: `window.open` with `noopener`; a popup blocker may refuse it outside a user gesture.
//   - keys: `keydown` / `keyup` on the element; a handled key gets `preventDefault()`.

import type { HostKeyEvent, PlatformHost } from '@gjsify/adwaita-core';

const SHIFT_MASK = 1 << 0;
const CONTROL_MASK = 1 << 2;
const ALT_MASK = 1 << 3;
const SUPER_MASK = 1 << 26;

const sheets = new Map<object, HTMLStyleElement>();

function modifierState(event: KeyboardEvent): number {
    return (
        (event.shiftKey ? SHIFT_MASK : 0) |
        (event.ctrlKey ? CONTROL_MASK : 0) |
        (event.altKey ? ALT_MASK : 0) |
        (event.metaKey ? SUPER_MASK : 0)
    );
}

export const webPlatformHost: PlatformHost = {
    setStyles(list) {
        if (typeof document === 'undefined') return;
        const keep = new Set(list.map((entry) => entry.owner));
        for (const [owner, element] of sheets) {
            if (keep.has(owner)) continue;
            element.remove();
            sheets.delete(owner);
        }
        // Re-appending in order is what makes the later sheet win at equal specificity.
        for (const { owner, css, priority } of list) {
            let element = sheets.get(owner);
            if (!element) {
                element = document.createElement('style');
                sheets.set(owner, element);
            }
            element.dataset.gtkPriority = String(priority);
            if (element.textContent !== css) element.textContent = css;
            document.head.append(element);
        }
    },

    openUri(uri) {
        if (typeof window === 'undefined') return;
        window.open(uri, '_blank', 'noopener');
    },

    fontName() {
        if (typeof document === 'undefined' || !document.body) return null;
        const style = getComputedStyle(document.body);
        const family = style.fontFamily
            .split(',')[0]
            ?.trim()
            .replace(/^["']|["']$/g, '');
        const px = Number.parseFloat(style.fontSize);
        if (!family || !Number.isFinite(px)) return null;
        return `${family} ${Math.round(px * 0.75 * 10) / 10}`;
    },

    listenKeys(widget, handler) {
        const element = widget as HTMLElement;
        // A bare element takes no keys until it can be focused.
        if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
        const listen = (pressed: boolean) => (event: Event) => {
            const key = event as KeyboardEvent;
            const host: HostKeyEvent = {
                key: key.key,
                keycode: key.keyCode,
                state: modifierState(key),
                pressed,
            };
            if (handler(host)) key.preventDefault();
        };
        const down = listen(true);
        const up = listen(false);
        element.addEventListener('keydown', down);
        element.addEventListener('keyup', up);
        return () => {
            element.removeEventListener('keydown', down);
            element.removeEventListener('keyup', up);
        };
    },
};
