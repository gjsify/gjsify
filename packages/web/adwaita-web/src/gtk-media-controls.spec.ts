// DOM-level tests for <gtk-media-controls>. Two of the three blocks below test pure
// functions rather than DOM, and that is the point: `totem_time_to_string` is the one piece
// of non-trivial arithmetic in this widget, and getting its four shapes and its one-second
// bump wrong would produce a bar that reads plausibly and is off by one at every boundary.
// The DOM block covers what a string test cannot — that the bar is INSENSITIVE with no
// stream, which is the template's own `sensitive` 0.
import { describe, expect, it } from '@gjsify/unit';

import {
    GtkMediaControls,
    mediaTimeToString,
    volumeIconFor,
    type GtkMediaControls as GtkMediaControlsElement,
} from './elements/gtk-media-controls.js';

function mount(withMedia: boolean): { el: GtkMediaControlsElement; host: HTMLElement; media: HTMLVideoElement | null } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-media-controls') as GtkMediaControlsElement;
    let media: HTMLVideoElement | null = null;
    if (withMedia) {
        // The template's `controls_revealer` child: the controls bar lives INSIDE the video,
        // so the nearest ancestor video is the stream.
        const video = document.createElement('gtk-video');
        media = document.createElement('video');
        video.appendChild(media);
        video.appendChild(el);
        host.appendChild(video);
    } else {
        host.appendChild(el);
    }
    return { el, host, media };
}

export const GtkMediaControlsTest = async () => {
    await describe('totem_time_to_string', async () => {
        await it('formats elapsed time as m:ss, with the minutes UNPADDED', () => {
            // gtkmediacontrols.c:126-131 — `g_strdup_printf ("%d:%02d", min, sec)`. The
            // minutes are NOT `%02d`, so five minutes is "5:02" and not "05:02".
            expect(mediaTimeToString(0)).toBe('0:00');
            expect(mediaTimeToString(5)).toBe('0:05');
            expect(mediaTimeToString(302)).toBe('5:02');
            expect(mediaTimeToString(599)).toBe('9:59');
            expect(mediaTimeToString(600)).toBe('10:00');
        });

        await it('only grows an HOURS field when there is an hour to show', () => {
            // gtkmediacontrols.c:95 — `if (hour > 0 || force_hour)`. An eleven-minute video is
            // "11:03", not "0:11:03"; the hour field appears at one hour.
            expect(mediaTimeToString(660)).toBe('11:00');
            expect(mediaTimeToString(3599)).toBe('59:59');
            expect(mediaTimeToString(3600)).toBe('1:00:00');
            expect(mediaTimeToString(9 * 3600 + 5 * 60 + 2)).toBe('9:05:02');
        });

        await it("the remaining forms are NEGATIVE, which is the C's own sign", () => {
            // gtkmediacontrols.c:117-123 and :99-104 — "-%d:%02d" and "-%d:%02d:%02d".
            expect(mediaTimeToString(302, true)).toBe('-5:03');
            expect(mediaTimeToString(9 * 3600 + 302, true)).toBe('-9:05:03');
        });

        await it('BUMPS THE SECONDS BY ONE when showing what remains', () => {
            // gtkmediacontrols.c:81-82 — `if (remaining) _time++;` so that
            // `current + remaining = total` holds for a whole second of playback rather than
            // being one short at every boundary. Five minutes of a 5:02 video reads "-5:03".
            expect(mediaTimeToString(300, true)).toBe('-5:03');
            expect(mediaTimeToString(0, true)).toBe('-0:01');
        });

        await it('force_hour is the only thing that puts hours on a short video', () => {
            // gtkmediacontrols.c:95. GTK passes FALSE at every call site (:358, :364, :389),
            // so nothing in the widget forces it — it is part of the function's contract.
            expect(mediaTimeToString(302, false, true)).toBe('0:05:02');
            expect(mediaTimeToString(302, true, true)).toBe('-0:05:03');
        });

        await it('truncates rather than rounds, and floors a negative to zero', () => {
            // The C works in whole seconds throughout (`_time = (int) (usecs / G_USEC_PER_SEC)`,
            // :79) and its callers guard the subtraction themselves
            // (`duration > timestamp ? duration - timestamp : 0`, :364).
            expect(mediaTimeToString(59.9)).toBe('0:59');
            expect(mediaTimeToString(-5)).toBe('0:00');
        });
    });

    await describe('volumeIconFor', async () => {
        await it("picks the four audio-volume names GTK's volume button derives", () => {
            // `volume_adjustment` is `upper` 1 (ui/gtkmediacontrols.ui) and GtkVolumeButton
            // derives its icon from the level; a zero level is muted whatever else the range
            // says.
            expect(volumeIconFor(0)).toBe('audio-volume-muted');
            expect(volumeIconFor(0.2)).toBe('audio-volume-low');
            expect(volumeIconFor(0.5)).toBe('audio-volume-medium');
            expect(volumeIconFor(1)).toBe('audio-volume-high');
        });
    });

    await describe('<gtk-media-controls> the template tree', async () => {
        await it('builds the six nodes ui/gtkmediacontrols.ui declares, in order', () => {
            const { el, host } = mount(true);
            const box = el.querySelector('.adw-media-controls-box') as HTMLElement;
            expect(box.children[0].classList.contains('adw-media-controls-button')).toBe(true);
            const timeBox = box.children[1] as HTMLElement;
            expect(timeBox.querySelector('.adw-media-controls-time-label')).not.toBe(null);
            expect(timeBox.querySelector('.adw-media-controls-seek-scale')).not.toBe(null);
            expect(timeBox.querySelector('.adw-media-controls-duration-label')).not.toBe(null);
            expect(box.children[2].classList.contains('adw-media-controls-volume-button')).toBe(true);
            host.remove();
        });

        await it("carries the template's OWN accessibility labels", () => {
            // ui/gtkmediacontrols.ui — `label` "Position" on the scale, `label` "Volume" on
            // the volume button. Both are in the template's own <accessibility> blocks.
            const { el, host } = mount(true);
            const scale = el.querySelector('.adw-media-controls-seek-scale') as HTMLInputElement;
            const volume = el.querySelector('.adw-media-controls-volume-button') as HTMLButtonElement;
            expect(scale.getAttribute('aria-label')).toBe('Position');
            expect(volume.getAttribute('aria-label')).toBe('Volume');
            host.remove();
        });

        await it('puts the volume scale in a POPOVER, because GtkVolumeButton is one', () => {
            const { el, host } = mount(true);
            const popover = el.querySelector('.adw-media-controls-volume-popover') as HTMLElement;
            const scale = popover.querySelector('.adw-media-controls-volume-scale') as HTMLInputElement;
            expect(popover.hidden).toBe(true);
            // volume_adjustment: upper 1, step-increment 0.1, value 1.
            expect(scale.min).toBe('0');
            expect(scale.max).toBe('1');
            expect(scale.step).toBe('0.1');
            expect(scale.value).toBe('1');
            host.remove();
        });
    });

    await describe('<gtk-media-controls> sensitivity', async () => {
        await it("is INSENSITIVE with no stream, which is the template's `sensitive` 0", () => {
            // ui/gtkmediacontrols.ui — `<property name="sensitive">0</property>` on the box.
            // `gtk_media_controls_new()` therefore produces a bar you cannot press, and
            // `gtk_media_controls_set_sensitive` is what re-enables it.
            const { el, host } = mount(false);
            expect(el.sensitive).toBe(false);
            expect(el.classList.contains('insensitive')).toBe(true);
            expect((el.querySelector('.adw-media-controls-button') as HTMLButtonElement).disabled).toBe(true);
            expect((el.querySelector('.adw-media-controls-seek-scale') as HTMLInputElement).disabled).toBe(true);
            host.remove();
        });

        await it('is live once a media element is adopted from the enclosing video', () => {
            const { el, host } = mount(true);
            expect(el.sensitive).toBe(true);
            expect(el.classList.contains('insensitive')).toBe(false);
            expect((el.querySelector('.adw-media-controls-seek-scale') as HTMLInputElement).disabled).toBe(false);
            host.remove();
        });
    });

    await describe('<gtk-media-controls> the seek scale', async () => {
        await it("starts on the template's placeholder upper of 10, in SECONDS", () => {
            // time_adjustment in ui/gtkmediacontrols.ui: upper 10, step-increment 1,
            // page-increment 10. Every real duration arrives by resetting the range, so the
            // numbers on the scale are seconds — and 10 is the pre-stream placeholder, not a
            // range a user can seek within.
            const { el, host } = mount(true);
            const scale = el.querySelector('.adw-media-controls-seek-scale') as HTMLInputElement;
            expect(scale.min).toBe('0');
            expect(scale.max).toBe('10');
            expect(scale.step).toBe('1');
            host.remove();
        });

        await it('the DURATION label is hidden while there is no duration', () => {
            // gtkmediacontrols.c:391 — `gtk_widget_set_visible (controls->duration_label,
            // duration > 0)`. With no duration the POSITION label takes the elapsed time
            // alone (:358-359), because there is no total to compare it against.
            const { el, host } = mount(true);
            const duration = el.querySelector('.adw-media-controls-duration-label') as HTMLElement;
            expect(duration.hidden).toBe(true);
            expect(el.querySelector('.adw-media-controls-time-label')!.textContent).toBe('0:00');
            host.remove();
        });

        await it('the DURATION label shows what REMAINS, negatively, once a duration exists', () => {
            // gtkmediacontrols.c:389 — `totem_time_to_string (duration > timestamp ? … : 0,
            // TRUE, FALSE)`. So it is the REMAINING label, and the position label is the
            // elapsed one — the names are a misnomer worth stating.
            const { el, host, media } = mount(true);
            Object.defineProperty(media!, 'duration', { value: 362, configurable: true });
            media!.dispatchEvent(new Event('durationchange'));
            expect(el.querySelector('.adw-media-controls-duration-label')!.textContent).toBe('-6:03');
            expect(el.querySelector('.adw-media-controls-time-label')!.textContent).toBe('0:00');
            host.remove();
        });

        await it("a known duration RESETS the scale's range to the media's own", () => {
            const { el, host, media } = mount(true);
            Object.defineProperty(media!, 'duration', { value: 754, configurable: true });
            media!.dispatchEvent(new Event('durationchange'));
            const scale = el.querySelector('.adw-media-controls-seek-scale') as HTMLInputElement;
            expect(scale.max).toBe('754');
            host.remove();
        });

        await it('both labels use TABULAR figures, so the scale does not shift sideways', () => {
            // ui/gtkmediacontrols.ui — `font-features "tnum=1"` on BOTH labels. Load-bearing,
            // not cosmetic: a position counting 9→10 must not change its own width.
            const { el, host } = mount(true);
            const time = el.querySelector('.adw-media-controls-time-label') as HTMLElement;
            const duration = el.querySelector('.adw-media-controls-duration-label') as HTMLElement;
            expect(getComputedStyle(time).fontVariantNumeric).toBe('tabular-nums');
            expect(getComputedStyle(duration).fontVariantNumeric).toBe('tabular-nums');
            host.remove();
        });
    });

    await describe('<gtk-media-controls> the play button', async () => {
        await it('plays a paused media and pauses a playing one', () => {
            // ui/gtkmediacontrols.ui — `play_button_clicked` is the button's only action.
            const { el, host, media } = mount(true);
            let played = false;
            media!.play = () => {
                played = true;
                return Promise.resolve();
            };
            Object.defineProperty(media!, 'paused', { value: true, configurable: true });
            const button = el.querySelector('.adw-media-controls-button') as HTMLButtonElement;
            button.click();
            expect(played).toBe(true);

            let paused = false;
            Object.defineProperty(media!, 'paused', { value: false, configurable: true });
            media!.pause = () => {
                paused = true;
            };
            button.click();
            expect(paused).toBe(true);
            host.remove();
        });

        await it('shows the pause glyph while playing and the play glyph when stopped', () => {
            // ui/gtkvideo.ui's `play_button` carries `media-playback-start-symbolic`, and
            // `gtk_video_update_playing`'s counterpart swaps it while the media plays.
            const { el, host, media } = mount(true);
            const icon = () =>
                el.querySelector('.adw-media-controls-button gtk-image')?.getAttribute('icon-name') ?? null;
            expect(icon()).toBe('media-playback-start-symbolic');
            media!.dispatchEvent(new Event('play'));
            expect(icon()).toBe('media-playback-pause-symbolic');
            host.remove();
        });
    });
};
