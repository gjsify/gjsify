// <gtk-video> — a playing surface with a play affordance and a controls bar, and NOTHING
// else. It owns no decoding, no pipeline and no transport of its own: `GtkVideo` is a
// `GtkWidget` with a `GtkMediaStream` on it and a three-node template over it
// (refs/gtk/gtk/ui/gtkvideo.ui), and every question of "what is playing" is answered by
// the stream.
//
// THE REPLICA IS A REAL `<video>`, AND SAYING SO IS THE POINT. GTK's `GtkMediaStream` is
// an abstract playback backend; the browser already ships one, and `<video>` is it. So the
// element takes a `<video>` as its light-DOM child, applies `autoplay` and `loop` to it as
// the two PROPERTIES are declared (gtkpicture's sibling `gtkvideo.c:407-414`, :432-439),
// and reflects its events back out. What it does NOT do is reimplement a transport: there
// is no buffering state model, no seek-pending flag, no `GstPipeline`, because the C has
// none either — those live in the backend behind `GtkMediaStream`, not in the widget.
//
// `autoplay` WAITS FOR PREPARED, WHICH IS A REAL DIFFERENCE FROM THE ATTRIBUTE. The C does
// not play on `set_autoplay`; it plays when the stream reports `prepared` AND the widget is
// mapped, and it re-checks that on every `prepared` notification
// (gtkvideo.c:684-690, `gtk_video_notify_cb`). Setting `autoplay` on a `<video>` element
// before its `src` is known therefore plays nothing, and setting it after `src` plays —
// the same order-dependence the C has, arrived at honestly, so the attribute is applied as
// the C applies it: the property is stored, and `play()` is called on the media's own
// readiness, never on the write.
//
// THE OVERLAY ICON IS A FOUR-WAY CHOICE AND THE ORDER IS THE POINT.
// `gtk_video_update_overlay_icon` (gtkvideo.c:626-646) picks in this order: no stream at
// all → `media-eject-symbolic`; a stream with an ERROR → `dialog-error-symbolic`; a stream
// that ENDED → `media-playlist-repeat-symbolic`; otherwise → `media-playback-start-symbolic`.
// No media stream is the FIRST arm and not the last, so an element that has not been given
// a `<video>` draws the eject glyph — the shape of "there is nothing here to play" — rather
// than a play glyph over nothing. `error` before `ended` matters too: a stream that both
// ended and failed shows the error.
//
// THE OVERLAY IS HIDDEN WHILE PLAYING, NOT SWAPPED. `gtk_video_update_playing` sets the
// overlay's VISIBILITY to `!playing` (gtkvideo.c:665) and restores the cursor at the same
// time. There is no pause icon in the overlay: a video that is playing shows the frames and
// nothing on top of them, and the controls bar is what carries the pause button. That is
// why this element has one overlay node and no per-state icon table of its own.
//
// THE CONTROLS REVEAL AND HIDE ON A TIMER. `gtk_video_reveal_controls` reveals the
// revealer and arms a 3-second timeout that hides it again (gtkvideo.c:125-133), and the
// motion controller calls it (gtkvideo.c:177-178). So the controls are shown on pointer
// movement and withdrawn three seconds after the last movement, and the SAME
// `revealControls()` is what a click on the video calls. `CONTROLS_HIDE_MS` is that 3000.
//
// `graphics-offload` IS A RENDERING HINT AND IS HONOURED AS ONE. `GtkGraphicsOffload` moves
// the child into a shared GL texture so a widget and its neighbours composite on the GPU;
// its `enabled` property is what `GtkVideo:graphics-offload` reads and writes
// (gtkvideo.c:988-992, :1010-1023). CSS has no equivalent — there is no compositor to move a
// subtree into — so the property is stored, readable and writable, and surfaced as a class,
// and NOTHING ELSE HAPPENS. That is declared rather than hidden: see `_video.scss`'s header.
//
// THE TEMPLATE'S THREE OVERLAY NODES ARE ALL PRESENT. `ui/gtkvideo.ui` puts an overlay
// icon, a `controls_revealer` and (implicitly, as the main child) the picture, inside a
// `GtkOverlay`. The overlay icon wears `.osd` AND `.circular`, and libadwaita gives
// `video image.osd` a 64px box with a 32px radius
// (refs/libadwaita/src/stylesheet/widgets/_misc.scss:75-81) — which is exactly what a
// `.circular` button already is at 34px, so the 64/32 pair is the video's own larger
// version of it and is stated in the stylesheet rather than invented here.
//
// Reference: refs/gtk/gtk/gtkvideo.c (the overlay-icon four-way choice :626-646,
//   `update_playing` hiding it :658-666, the autoplay-on-prepared check :679-690,
//   `gtk_video_reveal_controls` :125-133, the property table :400-445,
//   `graphics-offload` :976-1023)
// Reference: refs/gtk/gtk/ui/gtkvideo.ui (the three-node overlay template)
// Reference: refs/libadwaita/src/stylesheet/widgets/_misc.scss:74-81 (the 64/32 osd icon)
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** The four overlay glyphs, in the order `update_overlay_icon` tests them (gtkvideo.c:626-646). */
export type VideoOverlayIcon =
    | 'media-eject-symbolic'
    | 'dialog-error-symbolic'
    | 'media-playlist-repeat-symbolic'
    | 'media-playback-start-symbolic';

// FOUR CONSTANTS, NOT ONE TABLE, and not with a type annotation on the declaration. Both
// are load-bearing: `check-adwaita-icon-masks.mjs` finds an emitted icon name with a regex
// for a SCREAMING_SNAKE identifier ending in `ICON` or `ICON_NAME` whose `=` is followed by
// a plain string literal. A `const X: Type = '…'` puts a `: Type` between the name and the
// `=` and is invisible to it; so is one member of an array of literals. Either way the
// check's second arm reports ICONS entries nothing emits, while all four are emitted.

/**
 * The glyph a video with NO stream draws — the FIRST arm of the four-way choice
 * (gtkvideo.c:629), because "there is nothing here to play" is the state every GtkVideo
 * starts in.
 */
export const NO_STREAM_ICON = 'media-eject-symbolic';

/** The glyph a stream that FAILED draws (gtkvideo.c:633) — tested before `ended`. */
export const ERROR_ICON = 'dialog-error-symbolic';

/** The glyph a stream that has ENDED draws (gtkvideo.c:638-639). */
export const ENDED_ICON = 'media-playlist-repeat-symbolic';

/** The glyph a READY stream draws (gtkvideo.c:645) — the arm everything else falls through to. */
export const READY_ICON = 'media-playback-start-symbolic';

/** `gtk_video_reveal_controls`' timeout: 3 s (gtkvideo.c:130). */
export const CONTROLS_HIDE_MS = 3000;

export class GtkVideo extends HTMLElement {
    private _initialized = false;
    private _overlayIcon!: HTMLButtonElement;
    private _controlsRevealer!: HTMLDivElement;
    private _media: HTMLVideoElement | null = null;
    /** The listeners currently bound on `_media`, so `_detachMedia` removes the SAME ones. */
    private mediaListeners: [string, EventListener][] = [];
    private _hideTimer: number | null = null;
    /** What the media element last told us, in the four fields the overlay choice reads. */
    private _hasStream = false;
    private _error: string | null = null;
    private _ended = false;
    private _playing = false;

    static get observedAttributes() {
        return ['autoplay', 'graphics-offload', 'loop'];
    }

    /**
     * `GtkVideo:autoplay` (gtkvideo.c:407-414). Defaults to FALSE. The C plays on the
     * stream's `prepared` notification and not on this write — see the header — so this
     * setter records the flag and lets the media's own readiness decide.
     */
    get autoplay(): boolean {
        return this.hasAttribute('autoplay');
    }

    set autoplay(value: boolean) {
        this._write('autoplay', !!value);
        this._syncMedia();
    }

    /** `GtkVideo:loop` (gtkvideo.c:432-439). Defaults to FALSE. A plain `<video loop>`. */
    get loop(): boolean {
        return this.hasAttribute('loop');
    }

    set loop(value: boolean) {
        this._write('loop', !!value);
        this._syncMedia();
    }

    /**
     * `GtkVideo:graphics-offload` (gtkvideo.c:400-406, :1010-1023). Defaults to FALSE — the
     * template ships `<property name="enabled">disabled</property>` (ui/gtkvideo.ui), so the
     * C starts with the offload OFF and an application has to ask for it.
     *
     * Stored, readable and class-flagged, and NOTHING ELSE HAPPENS: CSS has no way to move a
     * subtree into a shared GPU texture, which is what `GtkGraphicsOffload` is. The class is
     * `graphics-offload` so a page can still target it, and `KNOWN_GAPS` in
     * `check-adwaita-element-properties.mjs` does not list it because the PROPERTY is
     * observed — what it does not buy is a faster composite.
     */
    get graphicsOffload(): boolean {
        return this.hasAttribute('graphics-offload');
    }

    set graphicsOffload(value: boolean) {
        this._write('graphics-offload', !!value);
    }

    /** The `<video>` this element drives — the browser's answer to a `GtkMediaStream`. */
    get media(): HTMLVideoElement | null {
        return this._media;
    }

    /** Whether the media reports itself playing — `GtkVideo:playing` (`gtk_video_get_playing`). */
    get playing(): boolean {
        return this._playing;
    }

    /** The current position in SECONDS — the C's `timestamp`, in microseconds × 1000. */
    get timestamp(): number {
        return this._media?.currentTime ?? 0;
    }

    /** The media's duration in SECONDS — the C's `duration`; 0 while it is unknown. */
    get duration(): number {
        const value = this._media?.duration ?? 0;
        return Number.isFinite(value) ? value : 0;
    }

    /** Whether the overlay controls bar is currently revealed. */
    get controlsRevealed(): boolean {
        return this._controlsRevealer?.classList.contains('revealed') ?? false;
    }

    private _write(name: string, value: boolean): void {
        this.toggleAttribute(name, value);
    }

    connectedCallback() {
        if (this._initialized) {
            this._adoptMedia();
            return;
        }
        this._initialized = true;

        // `ui/gtkvideo.ui`'s overlay icon is a GtkImage wearing `.osd` and `.circular` with
        // an accessible role of BUTTON (the gesture is what makes it a button). A `<button>`
        // IS that role natively, which is the honest way to build it rather than a div with
        // a click handler and an ARIA keyword.
        this._overlayIcon = document.createElement('button');
        this._overlayIcon.className = 'adw-video-overlay-icon osd circular';
        this._overlayIcon.type = 'button';
        this._overlayIcon.setAttribute('aria-label', 'Play');
        this._overlayIcon.title = 'Play';
        this._overlayIcon.addEventListener('click', () => this._overlayClicked());

        this._controlsRevealer = document.createElement('div');
        this._controlsRevealer.className = 'adw-video-controls-revealer';

        this._wrap();
        this._adoptMedia();
        // `gtk_video_motion` (ui/gtkvideo.ui) — the motion controller's only job. Bound on
        // the element rather than on the surface so a pointer anywhere over the video (the
        // surface, the controls bar, the overlay icon) counts, which is what GTK's
        // `GtkEventControllerMotion` on the template's root does.
        this.addEventListener('pointermove', this._onPointerMove);
    }

    /**
     * `ui/gtkvideo.ui` keeps the author's `<video>` as the MAIN child of the overlay and adds
     * the two overlay children around it. Wrapping in place rather than re-creating is what
     * lets the light DOM stay the API: a page writes `<gtk-video><video src=…></video></gtk-video>`
     * and the element never has to be told where the media is.
     */
    private _wrap(): void {
        const media = this.querySelector<HTMLVideoElement>(':scope > video');
        const surface = document.createElement('div');
        surface.className = 'adw-video-surface';
        this.replaceChildren(surface);
        if (media) surface.appendChild(media);
        surface.append(this._overlayIcon, this._controlsRevealer);
    }

    private _adoptMedia(): void {
        // Narrowed at the selector: `querySelector` answers `Element`, and the whole point of the
        // media is that it has `play`, `paused` and `error`.
        const media = this.querySelector<HTMLVideoElement>(':scope > .adw-video-surface > video');
        if (media === this._media) {
            this._syncMedia();
            return;
        }
        if (this._media) this._detachMedia(this._media);
        this._media = media;
        // No stream is the FIRST arm of the four-way overlay choice (gtkvideo.c:629), so an
        // element with no `<video>` child draws the eject glyph from the start rather than
        // flashing a play glyph over nothing.
        this._hasStream = media !== null;
        if (media) {
            const onPlay = () => this._updatePlaying(true);
            const onPause = () => this._updatePlaying(false);
            const onEnded = () => {
                this._ended = true;
                this._updateOverlayIcon();
            };
            const onError = () => {
                this._error = media.error?.message ?? 'Playback failed';
                this._updateOverlayIcon();
            };
            const onMetadata = () => {
                // A stream that reports a NEW duration is no longer ended, exactly as
                // `gtk_video_update_ended` re-reads the stream on every notification.
                this._ended = false;
                this._error = null;
                this._updateOverlayIcon();
            };
            // `gtk_video_notify_cb`'s `prepared` arm (gtkvideo.c:679-690): autoplay plays
            // here and NOT on the property write, so the flag and the readiness are two
            // independent conditions and the C checks both.
            const onPrepared = () => {
                if (this.autoplay) void media.play().catch(() => {});
            };
            this.mediaListeners = [
                ['play', onPlay],
                ['pause', onPause],
                ['ended', onEnded],
                ['error', onError],
                ['loadedmetadata', onMetadata],
                ['loadeddata', onPrepared],
            ];
            for (const [type, handler] of this.mediaListeners) media.addEventListener(type, handler);
        }
        this._syncMedia();
        this._updateOverlayIcon();
    }

    private _detachMedia(media: HTMLVideoElement): void {
        // The listeners are held rather than re-created per event: `_adoptMedia` runs on
        // every reconnect and a `() => …` handler removed here would not be the same
        // function the one added there bound, so a re-parented `<video>` would end up with
        // two handlers per event and two `notify::playing` per play.
        for (const [type, handler] of this.mediaListeners) media.removeEventListener(type, handler);
        this.mediaListeners = [];
    }

    /** `autoplay` and `loop` are declared PROPERTIES of the widget, so they are applied to
     * the media rather than left to the author's markup — `ui/gtkvideo.ui` does the same by
     * binding them on the template. */
    private _syncMedia(): void {
        if (!this._media) return;
        this._media.loop = this.loop;
        // The C's `autoplay` is NOT the element's autoplay attribute, so the media is
        // never given one: a `preload`/autoplay element the author did not ask for is
        // exactly the "plays when the stream becomes prepared" behaviour the C has, and the
        // readiness gate is already on `loadeddata` above.
        this._media.autoplay = false;
        this.classList.toggle('graphics-offload', this.graphicsOffload);
    }

    private _overlayClicked(): void {
        // `overlay_clicked_cb` (ui/gtkvideo.ui) toggles: it plays when stopped and pauses
        // when playing, which is the overlay's whole contract — it is only VISIBLE when
        // stopped, so the pause branch is reachable only from the controls bar's own button.
        if (!this._media) return;
        if (this._media.paused) void this._media.play().catch(() => {});
        else this._media.pause();
    }

    /**
     * `gtk_video_reveal_controls` (gtkvideo.c:125-133): reveal, then arm a 3 s timeout that
     * hides it again. Re-arming on every call is what makes it a "three seconds after the
     * LAST movement" rather than a "three seconds after the first".
     */
    revealControls(): void {
        if (!this._controlsRevealer) return;
        this._controlsRevealer.classList.add('revealed');
        if (this._hideTimer !== null) clearTimeout(this._hideTimer);
        this._hideTimer = setTimeout(() => this._hideControls(), CONTROLS_HIDE_MS) as unknown as number;
    }

    private _hideControls(): void {
        this._hideTimer = null;
        this._controlsRevealer?.classList.remove('revealed');
    }

    /** `gtk_video_motion` (ui/gtkvideo.ui) — the motion controller's only job. */
    private _onPointerMove = (): void => {
        this.revealControls();
    };

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'graphics-offload') this._syncMedia();
        this.dispatchEvent(
            new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: this._property(name) } }),
        );
    }

    /** The `notify::` detail for `name`: the PROPERTY, parsed, not the raw attribute. */
    private _property(name: string): boolean {
        switch (name) {
            case 'autoplay':
                return this.autoplay;
            case 'loop':
                return this.loop;
            default:
                return this.graphicsOffload;
        }
    }

    /** `gtk_video_update_playing` (gtkvideo.c:658-666) — VISIBILITY, not an icon swap. */
    private _updatePlaying(playing: boolean): void {
        this._playing = playing;
        if (this._overlayIcon) this._overlayIcon.hidden = playing;
        this.classList.toggle('playing', playing);
        this.dispatchEvent(new CustomEvent('notify::playing', { bubbles: true, detail: { playing } }));
    }

    /** `gtk_video_update_overlay_icon` (gtkvideo.c:626-646), arm by arm. */
    private _updateOverlayIcon(): void {
        if (!this._overlayIcon) return;
        let icon: VideoOverlayIcon;
        let tooltip: string | null = null;
        if (!this._hasStream) icon = NO_STREAM_ICON;
        else if (this._error !== null) {
            icon = ERROR_ICON;
            tooltip = this._error;
        } else if (this._ended) icon = ENDED_ICON;
        else icon = READY_ICON;

        const image = document.createElement('gtk-image');
        // The four names carry their `-symbolic` suffix already — `normalizeIconName` accepts
        // either spelling and the mask classes are keyed on the bare name, see `gtk-image.ts`.
        image.setAttribute('icon-name', icon);
        // `icon-size` 2 in the template (ui/gtkvideo.ui) is GTK's ICON_SIZE dialog-scale,
        // which libadwaita renders at 64px through the `video image.osd` rule; the web's own
        // size is the stylesheet's, so nothing is set here and the rule wins as it should.
        this._overlayIcon.replaceChildren(image);
        if (tooltip) this._overlayIcon.title = tooltip;
        else this._overlayIcon.title = '';
        this._overlayIcon.classList.toggle('error', this._error !== null);
    }

    disconnectedCallback() {
        if (this._hideTimer !== null) clearTimeout(this._hideTimer);
        this._hideTimer = null;
    }
}

customElements.define('gtk-video', GtkVideo);
