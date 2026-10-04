// <gtk-media-controls> — the transport bar under a video: play/pause, position, duration,
// volume. It owns NO playback. `GtkMediaControls` has exactly one GIR property and it is
// `media-stream`, an OBJECT (gtkmediacontrols.c:296-306) — so on this renderer the element
// has no scalar surface to observe at all, and every control it draws is a VIEW of the
// stream it was handed. That is a fact about the widget, not a shortfall in the port, and it
// is why this file has no `observedAttributes`.
//
// THE NODE TREE IS THE TEMPLATE, VERBATIM. refs/gtk/gtk/ui/gtkmediacontrols.ui builds
//   box (a GtkBox, `sensitive` 0, `spacing` 6)
//     ├── play_button  (GtkButton, `has-frame` 0, media-playback-start-symbolic)
//     ├── time_box     (GtkBox)
//     │   ├── time_label       (GtkLabel, `font-features "tnum=1"`)
//     │   ├── seek_scale       (GtkScale, hexpand, aria-label "Position")
//     │   └── duration_label   (GtkLabel, `font-features "tnum=1"`)
//     └── volume_button (GtkVolumeButton, aria-label "Volume")
// Every node above is a node here, in that order, with those two classes on it.
//
// `sensitive` 0 ON THE WHOLE BOX IS THE FIRST THING TO NOTICE. The template disables the
// entire container (ui/gtkmediacontrols.ui), and `gtk_media_controls_set_sensitive` is what
// re-enables it — the bar is inert until a stream is attached. So this element renders its
// controls INSENSITIVE by default and only becomes live once it has a media element to
// drive, which is the same observable consequence the C has: `gtk_media_controls_new()`
// produces a bar you cannot press.
//
// THE TIME FORMAT IS `totem_time_to_string`, AND IT IS NOT `Date`. The function
// (gtkmediacontrols.c:75-132) formats in seconds from a microsecond count, adds one second
// when it is showing what REMAINS, and then picks one of four shapes:
//
//   • `hour > 0 || force_hour` and NOT remaining → `%d:%02d:%02d`   ("9:05:02")
//   • `hour > 0 || force_hour` and remaining     → `-%d:%02d:%02d`  ("-9:05:02")
//   • remaining                                  → `-%d:%02d`      ("-5:02")
//   • otherwise                                  → `%d:%02d`       ("5:02")
//
// Three details in that are load-bearing and all three are in the port. `remaining` bumps
// the SECOND COUNT UP by one (`:81-82`) because the C wants `current + remaining = total`
// to hold exactly; the hour/minute split uses INTEGER division on the already-decremented
// remainder, not a floating-point `mm:ss` (`:86-88`); and the two long formats exist only
// when an HOUR is present or forced, so a two-hour video shows `2:00:00` while a
// one-hour-fifty video shows `1:50:00` and a one-minute video shows `1:02`. GTK calls it
// with `force_hour` FALSE everywhere (`:358, :364, :389`), so nothing here forces it — the
// parameter is kept because it is part of the function's own contract and a port that
// dropped it would be unable to answer what it is for.
//
// WHICH LABEL SHOWS WHAT CHANGES WITH THE DURATION, AND THAT IS NOT A TASTE DECISION.
// With no duration yet, the DURATION label shows the elapsed time
// (`totem_time_to_string (timestamp, FALSE, FALSE)`, :358-359) — the position takes the
// single label, because there is no total to compare it against. Once a duration is known
// the DURATION label shows what REMAINS, negatively, and is VISIBLE only when the duration
// is greater than zero (`:389-391`). So "duration label" is a misnomer: it is the remaining
// label, and the position label is the elapsed one.
//
// THE SEEK SCALE'S ADJUSTMENT IS NOT 0…1. `time_adjustment` has `upper` 10 and
// `step-increment` 1 and `page-increment` 10 (ui/gtkmediacontrols.ui), and every real
// duration arrives through `gtk_media_controls_set_duration`, which resets the adjustment's
// range to the media's own — so the numbers on the scale are SECONDS, and
// `time_adjustment_changed` writes the position from them. That is why the `<input
// type="range">` here is `min="0"`, `max` set to the duration in seconds and `step="1"`,
// and why a range with no duration is disabled rather than scaled to a default of 10: the
// template's `upper` 10 is a placeholder for the pre-stream state, not a range a user can
// seek within.
//
// VOLUME IS 0…1 AND IT IS MUTED BY ZERO. `volume_adjustment` has `upper` 1,
// `step-increment` 0.1, `page-increment` 1 and `value` 1 (ui/gtkmediacontrols.ui) — full
// scale, tenth steps, and FULL volume as the initial value. A `GtkVolumeButton`'s icon is
// derived from that value by GTK itself rather than by this template, which is why the icon
// here changes with the level the way it does in C: the element picks the one of four
// `audio-volume-*` names `GtkVolumeButton` would, and does nothing else with it.
//
// AND THE FOUR NAMES ARE THE SYMBOLIC ONES, IN AN ORDER THAT IS NOT THE ORDER OF THE
// LEVELS. `GtkVolumeButton:use-symbolic` defaults TRUE (gtkvolumebutton.c:186-188) and is a
// CONSTRUCT property, so `gtk_volume_button_set_property` swaps the template's list for
// `icons_symbolic` (`:142-148`) before anything reads it — the names in play are
// `audio-volume-{muted,high,low,medium}-symbolic` (`:74-77`), in THAT order. It is a
// `GtkScaleButton`, and `gtk_scale_button_update_icon` (gtkscalebutton.c:1066-1104) indexes
// that list: the exact `lower` takes `[0]`, the exact `upper` takes `[1]`, and everything
// between is `(guint)((value − lower) / step) + 2` with
// `step = (upper − lower) / (num_icons − 2)` — which for 0…1 and four icons is a HALF. So
// `high` belongs to full scale alone, `muted` to silence alone, and `low`/`medium` split at
// one half, not at thirds. `normalizeIconName` accepts either spelling, and the emitted
// names keep the suffix the C's own list carries.
//
// Reference: refs/gtk/gtk/ui/gtkmediacontrols.ui (the whole node tree and both adjustments)
// Reference: refs/gtk/gtk/gtkmediacontrols.c (`totem_time_to_string` :75-132,
//   `update_timestamp` :352-366, `update_duration` :380-392, the one object property
//   :296-306, `play_button_clicked`)
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

// The play/pause pair `ui/gtkvideo.ui`'s `play_button` carries, as constants for the same
// reason the video's four overlay glyphs are constants — `check-adwaita-icon-masks.mjs` finds
// an emitted name through a SCREAMING_SNAKE `…ICON` constant holding a plain literal, and a
// ternary of two literals inside a `setAttribute` is invisible to it.
const PLAY_ICON = 'media-playback-start-symbolic';
/** The playing state, and the only pause glyph either element draws. */
const PAUSE_ICON = 'media-playback-pause-symbolic';

/**
 * The four `audio-volume-*` names `GtkVolumeButton` derives from a 0…1 level, one constant
 * each rather than an array of them, in the ORDER `icons_symbolic` holds them
 * (gtkvolumebutton.c:74-77) — which is muted, HIGH, low, medium, and not the order of the
 * levels.
 *
 * The shape is load-bearing, not stylistic. `check-adwaita-icon-masks.mjs` reads an emitted
 * icon name out of the SOURCE with a regex for a SCREAMING_SNAKE constant whose name ends in
 * `ICON` or `ICON_NAME` and whose value is a plain string literal — that is how
 * `PASSWORD_REVEAL_ICON_NAME` and the about dialog's glyph are found. Four literals inside an
 * array are invisible to it, so its second arm would report four ICONS entries nothing emits
 * while all four really are emitted. The `-symbolic` suffix is likewise kept on the value:
 * `normalizeIconName` accepts either spelling, and dropping it buys nothing.
 */
export const VOLUME_MUTED_ICON = 'audio-volume-muted-symbolic';
/** The FULL-SCALE name — `[1]` in the list, so only the exact `upper` reaches it. */
export const VOLUME_HIGH_ICON = 'audio-volume-high-symbolic';
/** Below a half — `[2]`, the lower of the two middle names. */
export const VOLUME_LOW_ICON = 'audio-volume-low-symbolic';
/** From a half up to — but not at — full scale — `[3]`. */
export const VOLUME_MEDIUM_ICON = 'audio-volume-medium-symbolic';

/** `volume_adjustment`'s `lower` (ui/gtkmediacontrols.ui leaves it at the `GtkAdjustment`
 * default of 0) and its `upper` 1 — the two ends `gtk_scale_button_update_icon` tests for. */
const VOLUME_LOWER = 0;
const VOLUME_UPPER = 1;
/** How many names `icons_symbolic` carries — `num_icons` in `gtk_scale_button_update_icon`. */
const VOLUME_ICON_COUNT = 4;

/**
 * The icon `GtkVolumeButton` shows at `volume` (0…1), as `gtk_scale_button_update_icon`
 * derives it (gtkscalebutton.c:1086-1104): the exact `lower` is `[0]` (muted), the exact
 * `upper` is `[1]` (high), and a value between them indexes `[2]`/`[3]` by
 * `(guint)((value − lower) / step) + 2` with `step = (upper − lower) / (num_icons − 2)` — a
 * HALF for a 0…1 adjustment over four icons.
 */
export function volumeIconFor(volume: number): string {
    const value = Math.min(VOLUME_UPPER, Math.max(VOLUME_LOWER, Number.isFinite(volume) ? volume : 1));
    if (value === VOLUME_LOWER) return VOLUME_MUTED_ICON;
    if (value === VOLUME_UPPER) return VOLUME_HIGH_ICON;
    const step = (VOLUME_UPPER - VOLUME_LOWER) / (VOLUME_ICON_COUNT - 2);
    // The C casts the quotient to `guint`, which truncates toward zero; the value is already
    // inside the range here, so that is the same as a floor.
    return Math.trunc((value - VOLUME_LOWER) / step) + 2 === 2 ? VOLUME_LOW_ICON : VOLUME_MEDIUM_ICON;
}

/**
 * `totem_time_to_string` (gtkmediacontrols.c:75-132), in seconds.
 *
 * The `remaining` bump is the C's own (`:81-82`) and it is not a rounding fudge: the C
 * computes the remaining time as `duration - timestamp` and then increments `_time` — the
 * WHOLE TOTAL, not the seconds field — so that `current + remaining = total` holds for a
 * whole second of playback rather than being one second short at every boundary. That is why
 * 300 s of remaining time reads `-5:01` and not `-5:00`: the seconds field only appears to
 * move when the input's own seconds are zero, and the increment carries at 59.
 *
 * NOTHING HERE FLOORS A NEGATIVE, because the C does not. `_time % 60` in C99 keeps the sign
 * of the dividend, so five seconds negative is zero minutes and `-5` seconds and the
 * function returns the nonsense `0:-5`; the C's CALLERS guard the subtraction instead
 * (`duration > timestamp ? duration - timestamp : 0`, :364), and so does every call site
 * here. The C's arithmetic is transcribed rather than repaired, so a caller that skips the
 * guard sees what GTK would have shown.
 *
 * The hour branch is `hour > 0 || force_hour` — an ELEVEN-MINUTE video is `11:03`, not
 * `0:11:03` — and `force_hour` is FALSE at every call site in the C (`:358, :364, :389`).
 * It stays a parameter because it is part of the function's contract, not because anything
 * here passes it.
 *
 * @param seconds total or remaining time, in seconds; a negative is NOT floored here, exactly
 *   as it is not in the C — see above.
 */
export function mediaTimeToString(seconds: number, remaining = false, forceHour = false): string {
    let time = Math.trunc(seconds);
    if (remaining) time++;

    const sec = time % 60;
    time -= sec;
    const min = (time % 3600) / 60;
    time -= min * 60;
    const hour = time / 3600;

    if (hour > 0 || forceHour) {
        // `%d:%02d:%02d` and its negated form — the two "long time format" cases.
        return remaining
            ? `-${hour}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
            : `${hour}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
    if (remaining) return `-${min}:${String(sec).padStart(2, '0')}`;
    return `${min}:${String(sec).padStart(2, '0')}`;
}

export class GtkMediaControls extends HTMLElement {
    private _initialized = false;
    private _playButton!: HTMLButtonElement;
    private _timeLabel!: HTMLSpanElement;
    private _seekScale!: HTMLInputElement;
    private _durationLabel!: HTMLSpanElement;
    private _volumeButton!: HTMLButtonElement;
    /** The icon node INSIDE the volume button — the popover is its sibling child. */
    private _volumeIcon!: HTMLSpanElement;
    private _volumePopover!: HTMLElement;
    private _volumeScale!: HTMLInputElement;
    private _media: HTMLVideoElement | null = null;
    /** Whether the user is dragging the seek scale — the C's own re-entrancy guard. */
    private _seeking = false;
    private _volume = 1;

    connectedCallback() {
        if (this._initialized) {
            this._adoptMedia();
            return;
        }
        this._initialized = true;

        // `box` — the template's GtkBox, `sensitive` 0 and `spacing` 6
        // (ui/gtkmediacontrols.ui). `insensitive` is the state the C's `sensitive` 0 puts
        // it in, and it is what makes every control inside inert until a stream is attached.
        const box = document.createElement('div');
        box.className = 'adw-media-controls-box';

        // `play_button` — GtkButton with `has-frame` 0, which is libadwaita's flat button.
        this._playButton = document.createElement('button');
        this._playButton.className = 'adw-media-controls-button adw-flat';
        this._playButton.type = 'button';
        this._playButton.title = 'Play';
        this._playButton.setAttribute('aria-label', 'Play');
        this._playButton.addEventListener('click', () => this._togglePlay());

        // `time_box` — the middle GtkBox holding the two labels and the scale between them.
        const timeBox = document.createElement('div');
        timeBox.className = 'adw-media-controls-time-box';

        // Both labels carry `font-features "tnum=1"` (ui/gtkmediacontrols.ui): tabular
        // figures, so a position that counts 9→10 does not shift the scale sideways. That is
        // `_media_controls.scss`'s `font-variant-numeric: tabular-nums`, and it is the reason
        // this is a real class rather than a comment.
        this._timeLabel = document.createElement('span');
        this._timeLabel.className = 'adw-media-controls-time-label';

        // `seek_scale` — the GtkScale. `min` is the adjustment's 0 and `max` starts at the
        // template's placeholder 10 (ui/gtkmediacontrols.ui), replaced by the real duration
        // the moment one is known; `step` is the adjustment's `step-increment` of 1 second.
        this._seekScale = document.createElement('input');
        this._seekScale.className = 'adw-media-controls-seek-scale';
        this._seekScale.type = 'range';
        this._seekScale.min = '0';
        this._seekScale.max = '10';
        this._seekScale.step = '1';
        this._seekScale.value = '0';
        // The template's own accessibility block: `label` "Position" on the scale.
        this._seekScale.setAttribute('aria-label', 'Position');
        this._seekScale.addEventListener('input', () => this._onSeekInput());

        this._durationLabel = document.createElement('span');
        this._durationLabel.className = 'adw-media-controls-duration-label';

        timeBox.append(this._timeLabel, this._seekScale, this._durationLabel);

        // `volume_button` — a GtkVolumeButton, which is a GtkMenuButton whose popover holds
        // the volume adjustment. Built as a button plus its own popover rather than
        // `<gtk-menu-button>` so the popover is this widget's own surface and no second
        // element's open/close machinery is involved.
        this._volumeButton = document.createElement('button');
        this._volumeButton.className = 'adw-media-controls-button adw-media-controls-volume-button adw-flat';
        this._volumeButton.type = 'button';
        // The template's own accessibility block: `label` "Volume" on the volume button.
        this._volumeButton.setAttribute('aria-label', 'Volume');
        this._volumeButton.addEventListener('click', () => this._toggleVolumePopover());
        this._volumeIcon = document.createElement('span');
        this._volumeIcon.className = 'adw-media-controls-volume-icon';

        // The popover holds `volume_adjustment`: `upper` 1, `step-increment` 0.1,
        // `page-increment` 1, `value` 1 (ui/gtkmediacontrols.ui).
        // A real `<gtk-popover>`, not a div wearing a borrowed class: `_popover.scss` is the
        // ONE popover surface in this package and its header records that three hand-rolled
        // copies of the plate disagreed with libadwaita and with each other before it was
        // lifted out. `GtkVolumeButton`'s adjustment popover is exactly that surface, so the
        // volume slide goes in one.
        this._volumePopover = document.createElement('gtk-popover');
        this._volumePopover.className = 'adw-media-controls-volume-popover';
        this._volumeScale = document.createElement('input');
        this._volumeScale.className = 'adw-media-controls-volume-scale';
        this._volumeScale.type = 'range';
        this._volumeScale.min = '0';
        this._volumeScale.max = '1';
        this._volumeScale.step = '0.1';
        this._volumeScale.value = '1';
        this._volumeScale.setAttribute('aria-label', 'Volume');
        this._volumeScale.addEventListener('input', () => this._onVolumeInput());
        this._volumePopover.append(this._volumeScale);
        // A click on the SLIDE is not a click on the ANCHOR: without this, dragging the
        // volume would close the popover under the pointer on every input event.
        this._volumePopover.addEventListener('click', (event) => event.stopPropagation());

        this._volumeButton.append(this._volumeIcon, this._volumePopover);

        box.append(this._playButton, timeBox, this._volumeButton);
        this.replaceChildren(box);
        this._renderVolume();
        this._adoptMedia();
    }

    /** The `<video>` these controls drive — the browser's answer to a `GtkMediaStream`. */
    get media(): HTMLVideoElement | null {
        return this._media;
    }

    /** The current position in seconds. */
    get timestamp(): number {
        return this._media?.currentTime ?? 0;
    }

    /** The media's duration in seconds, or 0 while unknown. */
    get duration(): number {
        const value = this._media?.duration ?? 0;
        return Number.isFinite(value) ? value : 0;
    }

    /** The volume level, 0…1, matching `volume_adjustment`'s range. */
    get volume(): number {
        return this._volume;
    }

    set volume(value: number) {
        this._setVolume(value);
    }

    /**
     * Whether the bar is live — the C's `gtk_media_controls_set_sensitive`.
     *
     * Loosely typed on purpose: `_adoptMedia` coerces its optional chain to `null`, and this
     * answers "is there a stream" for any field state rather than only the two the coercion
     * produces. A `!== null` test here read `undefined` as a stream.
     */
    get sensitive(): boolean {
        return this._media != null;
    }

    /** `play_button_clicked` (ui/gtkmediacontrols.ui) — the button's only action. */
    private _togglePlay(): void {
        // `!= null`, not `!== null`: an `undefined` `_media` is "no stream" here for the same
        // reason it is in `sensitive`.
        const media = this._media ?? null;
        if (media === null) return;
        if (media.paused) void media.play().catch(() => {});
        else media.pause();
    }

    /**
     * `time_adjustment_changed` (ui/gtkmediacontrols.ui): the scale's value IS the position,
     * in seconds. The `_seeking` guard is the C's own — `update_timestamp` writes the scale
     * from the stream, so without it a drag would fight the playback it is dragging through.
     */
    private _onSeekInput(): void {
        this._seeking = true;
        if (this._media) this._media.currentTime = Number.parseFloat(this._seekScale.value);
        this._seeking = false;
        this._updateTimestamp();
    }

    private _onVolumeInput(): void {
        this._setVolume(Number.parseFloat(this._volumeScale.value));
    }

    private _setVolume(value: number): void {
        const level = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
        this._volume = level;
        if (this._media) this._media.volume = level;
        this._renderVolume();
    }

    private _renderVolume(): void {
        if (this._volumeScale) this._volumeScale.value = String(this._volume);
        // The ICON node is replaced, never the button's children: the button also holds the
        // popover (a `GtkVolumeButton` is a `GtkMenuButton`), and a `replaceChildren` here
        // would take the volume slide with it on every level change.
        const icon = document.createElement('gtk-image');
        icon.setAttribute('icon-name', volumeIconFor(this._volume));
        this._volumeIcon?.replaceChildren(icon);
    }

    private _toggleVolumePopover(): void {
        if (!this._volumePopover) return;
        this._volumePopover.hidden = !this._volumePopover.hidden;
    }

    /**
     * The media element these controls drive. A `<gtk-media-controls>` normally sits INSIDE a
     * `<gtk-video>` (the template's `controls_revealer` child), so the nearest ancestor video
     * is the stream — and a controls bar used on its own names one with a `for` attribute
     * holding an id.
     *
     * The optional chain's `undefined` IS COERCED TO `null`, and that is not tidiness: `?? null`
     * is what keeps `_media` in the domain `sensitive` and `_render` compare against. A bar with
     * no enclosing video used to store `undefined` here, `undefined !== null` then reported the
     * template's `sensitive` 0 bar as LIVE, and the `!this._media.paused` at the end of
     * `_render` threw `can't access property "paused", this._media is undefined` — which is the
     * uncaught error `tests/browser/specs/adwaita-upgrade-order.spec.ts` fails on. `null` is
     * what `gtk_media_controls_new()` leaves behind: the template has no stream at all, and
     * `sensitive` is 0 until one is set (ui/gtkmediacontrols.ui).
     */
    private _adoptMedia(): void {
        const id = this.getAttribute('for');
        // Narrowed at BOTH lookups rather than after them: `getElementById` answers
        // `HTMLElement | null` and `querySelector` answers `Element | null`, while the whole
        // point of the media is that it has `currentTime`, `volume` and `play`. An id that
        // names something else is no media at all, which is the same answer `null` gives.
        const byId = id ? this.ownerDocument.getElementById(id) : null;
        const media =
            (byId instanceof HTMLVideoElement ? byId : null) ??
            this.closest('gtk-video')?.querySelector<HTMLVideoElement>('video') ??
            null;
        if (media === this._media) {
            this._render();
            return;
        }
        if (this._media) this._detachMedia();
        this._media = media;
        if (media) {
            this._mediaListeners = [
                ['timeupdate', () => this._updateTimestamp()],
                ['durationchange', () => this._updateDuration()],
                ['play', () => this._updatePlaying(true)],
                ['pause', () => this._updatePlaying(false)],
                ['seeked', () => this._updateTimestamp()],
            ];
            for (const [type, handler] of this._mediaListeners) media.addEventListener(type, handler);
            // The adjustment's `value` is 1 (ui/gtkmediacontrols.ui) and the C applies the
            // adjustment's own value to the stream when a stream is attached, so full volume
            // is the state a freshly attached bar starts in.
            this._setVolume(media.volume);
        }
        this._render();
    }

    /** The listeners bound on `_media`, so `_detachMedia` removes the SAME ones. */
    private _mediaListeners: [string, EventListener][] = [];

    private _detachMedia(): void {
        if (this._media) {
            for (const [type, handler] of this._mediaListeners) this._media.removeEventListener(type, handler);
        }
        this._mediaListeners = [];
    }

    /**
     * `update_timestamp` (gtkmediacontrols.c:352-366). TWO cases and they are not
     * symmetric: with no duration, the POSITION label shows the elapsed time and the
     * DURATION label is hidden (`:358-359`); with a duration, the DURATION label shows the
     * NEGATIVE remaining time and is visible only when the duration is greater than zero
     * (`:389-391`).
     */
    private _updateTimestamp(): void {
        if (!this._initialized) return;
        const timestamp = this.timestamp;
        const duration = this.duration;
        // The scale follows the stream unless the user has hold of it.
        if (!this._seeking && duration > 0) this._seekScale.value = String(timestamp);
        this._timeLabel.textContent = mediaTimeToString(timestamp);
        this._durationLabel.textContent = mediaTimeToString(duration > timestamp ? duration - timestamp : 0, true);
        this._durationLabel.hidden = duration <= 0;
    }

    /** `gtk_media_controls_set_duration` (gtkmediacontrols.c:380-392): the scale's range is
     * the media's own duration, and the `upper` 10 of the template is only the pre-stream
     * placeholder. */
    private _updateDuration(): void {
        if (!this._initialized) return;
        this._seekScale.max = String(this.duration > 0 ? this.duration : 10);
        this._updateTimestamp();
    }

    /** The play button's icon, `play_button_clicked`'s counterpart in `ui/gtkvideo.ui`'s
     * `gtk_video_update_playing`: `media-playback-start-symbolic` stopped,
     * `media-playback-pause-symbolic` playing. */
    private _updatePlaying(playing: boolean): void {
        if (!this._initialized) return;
        const image = document.createElement('gtk-image');
        // `ui/gtkvideo.ui`'s `play_button` carries `media-playback-start-symbolic`, and the
        // pause glyph is its counterpart — the same two names the video's overlay icon uses,
        // which is why the two elements share the glyphs rather than inventing their own.
        image.setAttribute('icon-name', playing ? PAUSE_ICON : PLAY_ICON);
        this._playButton.replaceChildren(image);
        this._playButton.title = playing ? 'Pause' : 'Play';
        this._playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }

    /**
     * The whole bar's sensitivity. The template ships `sensitive` 0
     * (ui/gtkmediacontrols.ui), so an unattached bar is inert — which is what `insensitive`
     * carries here, and why the spec can assert it before any media is adopted.
     */
    private _render(): void {
        if (!this._initialized) return;
        // One truth, one expression. The live test was spelled out a second time at the
        // `!this._media.paused` call below, where an `_media` of `undefined` — which is what
        // an optional chain hands back when there is no enclosing `<gtk-video>` — passes
        // `!== null` and then throws on the property read. Deriving the playing state from the
        // same narrowing makes that unrepresentable.
        const media = this._media ?? null;
        const live = media !== null;
        this.classList.toggle('insensitive', !live);
        this._playButton.disabled = !live;
        this._seekScale.disabled = !live;
        this._volumeButton.disabled = !live;
        this._volumeScale.disabled = !live;
        this._updateDuration();
        this._updateTimestamp();
        this._updatePlaying(live && !media.paused);
    }
}

customElements.define('gtk-media-controls', GtkMediaControls);
