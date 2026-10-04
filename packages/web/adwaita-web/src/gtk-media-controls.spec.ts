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

        await it('BUMPS THE TOTAL BY ONE when showing what remains', () => {
            // gtkmediacontrols.c:81-82 — `if (remaining) _time++;`, and `_time` is the whole
            // count, not the seconds field. So the increment is only VISIBLE in the seconds
            // when the input's own seconds are zero, and it CARRIES at 59 the way any
            // increment does: 300 s of remaining is "-5:01", and 359 s is a flat "6:00".
            // Reading the C's line as "+1 to the seconds" gives "-5:03" for 300 s, which is
            // one second more than the count GTK actually holds.
            expect(mediaTimeToString(300, true)).toBe('-5:01');
            // 359 s + 1 s is 360 s, so the minute field carries to 6 and the sign stays —
            // `remaining` is still set, and the short remaining form is `-%d:%02d`.
            expect(mediaTimeToString(359, true)).toBe('-6:00');
            expect(mediaTimeToString(0, true)).toBe('-0:01');
            // An hour-carrying remainder carries too: 3599 s + 1 s is 3600, an hour, so the
            // long format appears — the same hour branch the elapsed form takes, and the
            // negative sign rides along with it because `remaining` is still set.
            expect(mediaTimeToString(3599, true)).toBe('-1:00:00');
        });

        await it('force_hour is the only thing that puts hours on a short video', () => {
            // gtkmediacontrols.c:95. GTK passes FALSE at every call site (:358, :364, :389),
            // so nothing in the widget forces it — it is part of the function's contract.
            expect(mediaTimeToString(302, false, true)).toBe('0:05:02');
            expect(mediaTimeToString(302, true, true)).toBe('-0:05:03');
        });

        await it('truncates rather than rounds', () => {
            // The C works in whole seconds throughout (`_time = (int) (usecs / G_USEC_PER_SEC)`,
            // :79), so 59.9 s is the 59th second and not the 60th.
            expect(mediaTimeToString(59.9)).toBe('0:59');
            expect(mediaTimeToString(0.999)).toBe('0:00');
        });

        await it('passes a negative through as the C does, because the C guards upstream', () => {
            // `totem_time_to_string` does NOT floor, and `%` in C99 keeps the sign of the
            // dividend: for -5 the second is -5, `0 - (-5)` leaves `_time` at 0, and both the
            // minute and the hour come out zero — so the C formats `%d:%02d` of 0 and -5, which
            // is the nonsense `0:-5`. There is no clamp here to borrow, and adding one would be
            // a fix the C does not have. The guard is in the CALLER instead
            // (`duration > timestamp ? duration - timestamp : 0`, :364), which is where this
            // port has it too — so a negative never reaches the formatter from the widget.
            expect(mediaTimeToString(-5)).toBe('0:-5');
        });
    });

    await describe('volumeIconFor', async () => {
        await it('takes the four NAMES from GtkVolumeButton, in ITS order', () => {
            // `GtkVolumeButton:use-symbolic` defaults TRUE and is a CONSTRUCT property, so
            // `gtk_volume_button_set_property` installs `icons_symbolic` before anything
            // reads it (gtkvolumebutton.c:142-148, :186-188). The names in play therefore
            // CARRY the suffix — the template's own list at gtk/ui/gtkvolumebutton.ui:12-15
            // is what a non-symbolic button would use, and it is not what GTK ends up with.
            expect(volumeIconFor(0)).toBe('audio-volume-muted-symbolic');
            expect(volumeIconFor(0.2)).toBe('audio-volume-low-symbolic');
            expect(volumeIconFor(0.5)).toBe('audio-volume-medium-symbolic');
            expect(volumeIconFor(1)).toBe('audio-volume-high-symbolic');
        });

        await it('splits at a HALF, because the icon list has four entries and two ends', () => {
            // gtkscalebutton.c:1098-1101 — `step = (upper − lower) / (num_icons − 2)`, and the
            // list's `[0]` and `[1]` are already spoken for by the exact `lower` and the exact
            // `upper`. For `volume_adjustment`'s 0…1 that leaves a step of 0.5, NOT thirds.
            // `high` is full scale alone; `low` is the lower half, `medium` the upper one.
            expect(volumeIconFor(0.499)).toBe('audio-volume-low-symbolic');
            expect(volumeIconFor(0.5)).toBe('audio-volume-medium-symbolic');
            expect(volumeIconFor(0.999)).toBe('audio-volume-medium-symbolic');
            // The C's `(guint)` cast truncates rather than rounds, so just under a half is
            // still `low` and just under 1 is still `medium`.
            expect(volumeIconFor(0.9)).toBe('audio-volume-medium-symbolic');
        });

        await it('is silent at the bottom whatever the range says, which is the muted arm', () => {
            // gtkscalebutton.c:1088-1090 — `value == get_lower` takes `icons[0]`, and
            // `icons[0]` of the volume button is the muted name. Out-of-range levels clamp to
            // the adjustment's own ends, so a negative level is silence rather than the low name.
            expect(volumeIconFor(-1)).toBe('audio-volume-muted-symbolic');
            expect(volumeIconFor(0)).toBe('audio-volume-muted-symbolic');
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
