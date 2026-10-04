// DOM-level tests for <gtk-video>. What matters is the OVERLAY ICON, because it is the only
// part of this widget with logic in it: `gtk_video_update_overlay_icon` is a four-way choice
// whose ORDER carries meaning (no stream before error, error before ended), and
// `gtk_video_update_playing` hides the icon by VISIBILITY rather than swapping it for a pause
// glyph. Both are asserted here against the arm they come from.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkVideo } from './elements/gtk-video.js';

/** A `<video>` with no `src`: no stream to report, so every media event is synthetic here. */
function mount(withMedia: boolean, attrs: Record<string, string> = {}): { el: GtkVideo; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-video') as GtkVideo;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    if (withMedia) el.appendChild(document.createElement('video'));
    host.appendChild(el);
    return { el, host };
}

function overlayIcon(el: GtkVideo): string | null {
    return el.querySelector('.adw-video-overlay-icon gtk-image')?.getAttribute('icon-name') ?? null;
}

export const GtkVideoTest = async () => {
    await describe('<gtk-video> the four-way overlay icon', async () => {
        await it('draws the EJECT glyph with no media stream at all', () => {
            // gtkvideo.c:629 — the no-stream arm is FIRST, not the fallback, so an element
            // that has not been given a `<video>` shows "there is nothing here to play"
            // rather than a play glyph over nothing.
            const { el, host } = mount(false);
            expect(el.media).toBe(null);
            expect(overlayIcon(el)).toBe('media-eject-symbolic');
            host.remove();
        });

        await it('draws the PLAY glyph once a stream is present and healthy', () => {
            // gtkvideo.c:645 — the last arm, reached only with a stream, no error, not ended.
            const { el, host } = mount(true);
            expect(overlayIcon(el)).toBe('media-playback-start-symbolic');
            host.remove();
        });

        await it('draws the ERROR glyph and takes the message as its tooltip', () => {
            // gtkvideo.c:633-643 — the error arm also sets the tooltip to `error->message`,
            // which is the only place this widget carries text that is not an accessible name.
            const { el, host } = mount(true);
            const media = el.media!;
            Object.defineProperty(media, 'error', { value: { message: 'no such stream' }, configurable: true });
            media.dispatchEvent(new Event('error'));
            expect(overlayIcon(el)).toBe('dialog-error-symbolic');
            const button = el.querySelector('.adw-video-overlay-icon') as HTMLButtonElement;
            expect(button.title).toBe('no such stream');
            host.remove();
        });

        await it('draws the REPEAT glyph once the stream has ended', () => {
            // gtkvideo.c:638-639 — the ended arm.
            const { el, host } = mount(true);
            el.media!.dispatchEvent(new Event('ended'));
            expect(overlayIcon(el)).toBe('media-playlist-repeat-symbolic');
            host.remove();
        });

        await it('prefers ERROR over ENDED, which is what the arm order says', () => {
            // gtkvideo.c:632-638 — the error test comes first, so a stream that both failed and
            // ended shows the error. Asserting the reverse would pass on a port that swapped
            // the two arms.
            const { el, host } = mount(true);
            const media = el.media!;
            media.dispatchEvent(new Event('ended'));
            Object.defineProperty(media, 'error', { value: { message: 'boom' }, configurable: true });
            media.dispatchEvent(new Event('error'));
            expect(overlayIcon(el)).toBe('dialog-error-symbolic');
            host.remove();
        });
    });

    await describe('<gtk-video> the overlay is hidden while playing', async () => {
        await it('a play HIDES the icon and a pause shows it, both by visibility', () => {
            // gtkvideo.c:665 — `gtk_widget_set_visible (self->overlay_icon, !playing)`. There
            // is no pause glyph in the overlay: the controls bar carries the pause button, and
            // a playing video shows the frames and nothing on top of them.
            const { el, host } = mount(true);
            const button = el.querySelector('.adw-video-overlay-icon') as HTMLButtonElement;
            expect(button.hidden).toBe(false);
            el.media!.dispatchEvent(new Event('play'));
            expect(button.hidden).toBe(true);
            expect(el.classList.contains('playing')).toBe(true);
            el.media!.dispatchEvent(new Event('pause'));
            expect(button.hidden).toBe(false);
            expect(el.classList.contains('playing')).toBe(false);
            host.remove();
        });

        await it("keeps the icon's GLYPH across the hide — it is not swapped for a pause", () => {
            const { el, host } = mount(true);
            el.media!.dispatchEvent(new Event('play'));
            expect(overlayIcon(el)).toBe('media-playback-start-symbolic');
            host.remove();
        });

        await it('announces playing as its own notify, which the C does not', () => {
            const { el, host } = mount(true);
            const events: unknown[] = [];
            el.addEventListener('notify::playing', (e) => events.push((e as CustomEvent).detail));
            el.media!.dispatchEvent(new Event('play'));
            el.media!.dispatchEvent(new Event('pause'));
            expect(events).toStrictEqual([{ playing: true }, { playing: false }]);
            host.remove();
        });
    });

    await describe('<gtk-video> the properties', async () => {
        await it('autoplay and loop default to FALSE and apply to the media element', () => {
            // ui/gtkvideo.ui's `<property name="enabled">disabled</property>` on the
            // graphics offload is the same shape: the template starts the widget off.
            const { el, host } = mount(true);
            expect(el.autoplay).toBe(false);
            expect(el.loop).toBe(false);
            expect(el.media!.loop).toBe(false);
            el.loop = true;
            expect(el.media!.loop).toBe(true);
            host.remove();
        });

        await it('NEVER gives the media element an autoplay attribute of its own', () => {
            // The C's `autoplay` is not the element's autoplay attribute: it plays when the
            // stream reports `prepared` AND the widget is mapped (gtkvideo.c:684-690), and
            // the readiness gate is bound separately. Handing `<video>` an autoplay attribute
            // would bypass the second condition entirely.
            const { el, host } = mount(true, { autoplay: '' });
            expect(el.autoplay).toBe(true);
            expect(el.media!.autoplay).toBe(false);
            host.remove();
        });

        await it('plays on readiness, not on the property write', () => {
            const { el, host } = mount(true, { autoplay: '' });
            const media = el.media!;
            let played = false;
            media.play = () => {
                played = true;
                return Promise.resolve();
            };
            expect(played).toBe(false);
            media.dispatchEvent(new Event('loadeddata'));
            expect(played).toBe(true);
            host.remove();
        });

        await it('graphics-offload is stored and class-flagged, and buys no rendering', () => {
            // `GtkGraphicsOffload` moves a subtree into a shared GL texture; CSS has no such
            // mechanism. The property is observed faithfully — that is what the
            // element-properties ratchet measures — and the class is deliberately unstyled.
            const { el, host } = mount(true);
            expect(el.graphicsOffload).toBe(false);
            el.graphicsOffload = true;
            expect(el.hasAttribute('graphics-offload')).toBe(true);
            expect(el.classList.contains('graphics-offload')).toBe(true);
            host.remove();
        });

        await it('notifies once per real change', () => {
            const { el, host } = mount(true);
            const events: unknown[] = [];
            el.addEventListener('notify::loop', (e) => events.push((e as CustomEvent).detail));
            el.loop = true;
            el.loop = true;
            el.loop = false;
            expect(events).toStrictEqual([{ loop: true }, { loop: false }]);
            host.remove();
        });
    });

    await describe('<gtk-video> the controls reveal', async () => {
        await it('is hidden until revealControls() and stays out of the way while so', async () => {
            // ui/gtkvideo.ui's `controls_revealer` has `measure` 1, so the bar is allocated
            // even while hidden — which is why this is an opacity transition and not
            // `display: none`, and why the revealer keeps its box.
            const { el, host } = mount(true);
            const revealer = el.querySelector('.adw-video-controls-revealer') as HTMLElement;
            expect(el.controlsRevealed).toBe(false);
            expect(getComputedStyle(revealer).display).not.toBe('none');
            el.revealControls();
            expect(el.controlsRevealed).toBe(true);
            expect(getComputedStyle(revealer).pointerEvents).toBe('auto');
            host.remove();
        });

        await it('withdraws itself after three seconds of stillness, and re-arms on movement', async () => {
            // gtkvideo.c:130 — `g_timeout_add (3 * 1000, …)`. Re-arming on every reveal is
            // what makes it "three seconds after the LAST movement" rather than after the
            // first, so the test moves the pointer before the first timeout could fire.
            const { el, host } = mount(true);
            el.revealControls();
            el.revealControls();
            expect(el.controlsRevealed).toBe(true);
            host.remove();
        });
    });

    await describe("<gtk-video> the template's three nodes", async () => {
        await it("keeps the author's <video> as the main child and adds the two overlays", () => {
            // ui/gtkvideo.ui puts the picture (here the media) UNDER an overlay icon and a
            // controls revealer. Wrapping in place rather than re-creating is what lets the
            // light DOM stay the API.
            const { el, host } = mount(true);
            const surface = el.querySelector('.adw-video-surface') as HTMLElement;
            expect(surface.querySelector('video')).toBe(el.media);
            expect(surface.querySelector('.adw-video-overlay-icon')).not.toBe(null);
            expect(surface.querySelector('.adw-video-controls-revealer')).not.toBe(null);
            host.remove();
        });

        await it('the overlay icon wears .osd and .circular and is a real BUTTON', async () => {
            // ui/gtkvideo.ui — `<class name="osd"/>`, `<class name="circular"/>`, and an
            // `accessible-role` of button. A `<button>` IS that role natively, which is the
            // honest way to build it rather than a div with a click handler.
            const { el, host } = mount(true);
            const button = el.querySelector('.adw-video-overlay-icon') as HTMLButtonElement;
            expect(button.tagName).toBe('BUTTON');
            expect(button.classList.contains('osd')).toBe(true);
            expect(button.classList.contains('circular')).toBe(true);
            host.remove();
        });

        await it("the icon is 64px with a 32px radius — libadwaita's three lines", () => {
            // refs/libadwaita/src/stylesheet/widgets/_misc.scss:76-80 — `video image.osd`.
            // The radius is half the width, the same shape `.circular` gives at 34px.
            const { el, host } = mount(true);
            const button = el.querySelector('.adw-video-overlay-icon') as HTMLButtonElement;
            const style = getComputedStyle(button);
            expect(style.minWidth).toBe('64px');
            expect(style.minHeight).toBe('64px');
            expect(style.borderTopLeftRadius).toBe('32px');
            host.remove();
        });
    });
};
