// W3C RTCDTMFSender for GJS.
//
// Implements tone insertion, validation, and tonechange event dispatch.
// Actual DTMF RTP packet generation requires GStreamer dtmfsrc integration
// (Phase 4.6+); the timer-based event loop is spec-compliant regardless.
//
// Reference: W3C WebRTC spec § 7
// Reference: refs/wpt/webrtc/RTCDTMFSender-insertDTMF.https.html
// Reference: refs/wpt/webrtc/RTCDTMFSender-helper.js

import '@gjsify/dom-events/register/event-target';

const VALID_DTMF_CHARS = new Set('0123456789ABCDabcd#*,');
const MIN_DURATION = 40;
const MAX_DURATION = 6000;
const DEFAULT_DURATION = 100;
const MIN_INTER_TONE_GAP = 30;
const DEFAULT_INTER_TONE_GAP = 70;
const COMMA_DELAY = 2000;

type EventHandler = ((ev: Event) => void) | null;

export interface RTCDTMFToneChangeEventInit extends EventInit {
    tone?: string;
}

export class RTCDTMFToneChangeEvent extends Event {
    readonly tone: string;

    constructor(type: string, init: RTCDTMFToneChangeEventInit = {}) {
        super(type, init);
        this.tone = init.tone ?? '';
    }
}

export class RTCDTMFSender extends EventTarget {
    private _toneBuffer = '';
    private _duration = DEFAULT_DURATION;
    private _interToneGap = DEFAULT_INTER_TONE_GAP;
    private _timerId: ReturnType<typeof setTimeout> | null = null;
    private _canInsert = true;
    private _ontonechange: EventHandler = null;

    /** @internal — back-references set by RTCRtpSender */
    _isStopped: () => boolean = () => false;
    _getCurrentDirection: () => string | null = () => null;

    get toneBuffer(): string { return this._toneBuffer; }
    get canInsertDTMF(): boolean { return this._canInsert; }

    get ontonechange(): EventHandler { return this._ontonechange; }
    set ontonechange(v: EventHandler) { this._ontonechange = v; }

    insertDTMF(tones: string, duration?: number, interToneGap?: number): void {
        // Step 3: If transceiver.stopped is true, throw InvalidStateError
        if (this._isStopped()) {
            throw new DOMException(
                "Failed to execute 'insertDTMF': The associated transceiver is stopped",
                'InvalidStateError',
            );
        }

        // Step 4: If currentDirection is recvonly or inactive, throw InvalidStateError
        const dir = this._getCurrentDirection();
        if (dir === 'recvonly' || dir === 'inactive') {
            throw new DOMException(
                "Failed to execute 'insertDTMF': The associated transceiver direction does not allow sending",
                'InvalidStateError',
            );
        }

        // Step 6: If tones contains invalid characters, throw InvalidCharacterError
        for (const ch of tones) {
            if (!VALID_DTMF_CHARS.has(ch)) {
                throw new DOMException(
                    `Failed to execute 'insertDTMF': Invalid DTMF character '${ch}'`,
                    'InvalidCharacterError',
                );
            }
        }

        // Normalize a-d to uppercase
        tones = tones.replace(/[a-d]/g, c => c.toUpperCase());

        // Clamp duration to [40, 6000]
        const d = duration ?? DEFAULT_DURATION;
        this._duration = Math.max(MIN_DURATION, Math.min(MAX_DURATION, d));

        // Clamp interToneGap to [30, ...]
        const g = interToneGap ?? DEFAULT_INTER_TONE_GAP;
        this._interToneGap = Math.max(MIN_INTER_TONE_GAP, g);

        // Step 9: Set the object's toneBuffer to tones
        this._toneBuffer = tones;

        // Step 10: If toneBuffer was empty before, start the playout task
        if (this._timerId !== null) {
            clearTimeout(this._timerId);
            this._timerId = null;
        }
        if (tones.length > 0) {
            this._scheduleNextTone(0);
        }
    }

    private _scheduleNextTone(delay: number): void {
        this._timerId = setTimeout(() => {
            this._timerId = null;
            this._playNextTone();
        }, delay);
    }

    private _playNextTone(): void {
        if (this._toneBuffer.length === 0) {
            // Spec: fire one final tonechange with empty tone
            this._fireToneChange('');
            return;
        }

        const tone = this._toneBuffer[0];
        this._toneBuffer = this._toneBuffer.slice(1);

        // Fire tonechange event for this tone
        this._fireToneChange(tone);

        // Schedule next tone after duration + interToneGap (comma = 2s delay)
        const delay = tone === ',' ? COMMA_DELAY : (this._duration + this._interToneGap);
        this._scheduleNextTone(delay);
    }

    private _fireToneChange(tone: string): void {
        const ev = new RTCDTMFToneChangeEvent('tonechange', { tone });
        this._ontonechange?.call(this, ev);
        this.dispatchEvent(ev);
    }

    /** @internal — called by RTCRtpSender on cleanup */
    _stop(): void {
        if (this._timerId !== null) {
            clearTimeout(this._timerId);
            this._timerId = null;
        }
        this._toneBuffer = '';
        this._canInsert = false;
    }
}
