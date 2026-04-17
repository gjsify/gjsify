// WPT-ported tests for @gjsify/webrtc Phase 2 (Media API surface).
//
// Ported from refs/wpt/webrtc/* (W3C, BSD-3-Clause). Tests cover transceiver,
// sender, receiver, codec capabilities, track events, and media stream classes.
// All tests use addTransceiver('audio'/'video') with synthetic transceivers —
// no getUserMedia or real media hardware required.

import { describe, it, expect } from '@gjsify/unit';

import {
    RTCPeerConnection,
    RTCRtpSender,
    RTCRtpReceiver,
    RTCRtpTransceiver,
    RTCTrackEvent,
    MediaStream,
    MediaStreamTrack,
    MediaStreamTrackEvent,
} from './index.js';

import {
    createPeerConnection,
    exchangeOfferAnswer,
    closePeerConnections,
} from './wpt-helpers.js';

// Helper: generate a remote answer for a given offer using a second peer
async function generateAnswer(offer: any): Promise<any> {
    const pc = createPeerConnection();
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    closePeerConnections(pc);
    return answer;
}

export default async () => {

// ==========================================================================
// RTCTrackEvent-constructor.html (7 tests)
// ==========================================================================
await describe('RTCTrackEvent constructor (WPT)', async () => {
    await it('should construct with valid receiver, track, transceiver', async () => {
        const pc = createPeerConnection();
        const transceiver = pc.addTransceiver('audio');
        const { receiver } = transceiver;
        const { track } = receiver;

        const ev = new RTCTrackEvent('track', { receiver, track, transceiver });
        expect(ev.receiver).toBe(receiver);
        expect(ev.track).toBe(track);
        expect(ev.streams.length).toBe(0);
        expect(ev.transceiver).toBe(transceiver);
        expect(ev.type).toBe('track');
        expect(ev.bubbles).toBe(false);
        expect(ev.cancelable).toBe(false);
        closePeerConnections(pc);
    });

    await it('should construct with streams array', async () => {
        const pc = createPeerConnection();
        const transceiver = pc.addTransceiver('audio');
        const { receiver } = transceiver;
        const { track } = receiver;
        const stream = new MediaStream([track]);

        const ev = new RTCTrackEvent('track', {
            receiver, track, transceiver, streams: [stream],
        });
        expect(ev.streams.length).toBe(1);
        expect(ev.streams[0]).toBe(stream);
        closePeerConnections(pc);
    });

    await it('should construct with multiple streams', async () => {
        const pc = createPeerConnection();
        const transceiver = pc.addTransceiver('audio');
        const { receiver } = transceiver;
        const { track } = receiver;
        const s1 = new MediaStream([track]);
        const s2 = new MediaStream([track]);

        const ev = new RTCTrackEvent('track', {
            receiver, track, transceiver, streams: [s1, s2],
        });
        expect(ev.streams.length).toBe(2);
        closePeerConnections(pc);
    });

    await it('should construct with unrelated receiver, track, transceiver', async () => {
        const pc = createPeerConnection();
        const transceiver = pc.addTransceiver('audio');
        const receiver = pc.addTransceiver('audio').receiver;
        const track = pc.addTransceiver('audio').receiver.track;
        const stream = new MediaStream();

        const ev = new RTCTrackEvent('track', {
            receiver, track, transceiver, streams: [stream],
        });
        expect(ev.receiver).toBe(receiver);
        expect(ev.track).toBe(track);
        expect(ev.transceiver).toBe(transceiver);
        closePeerConnections(pc);
    });

    await it('should throw TypeError when transceiver is missing', async () => {
        const pc = createPeerConnection();
        const transceiver = pc.addTransceiver('audio');
        const { receiver } = transceiver;
        const { track } = receiver;

        expect(() => new RTCTrackEvent('track', { receiver, track } as any)).toThrow();
        closePeerConnections(pc);
    });

    await it('should throw TypeError when track is missing', async () => {
        const pc = createPeerConnection();
        const transceiver = pc.addTransceiver('audio');
        const { receiver } = transceiver;

        expect(() => new RTCTrackEvent('track', { receiver, transceiver } as any)).toThrow();
        closePeerConnections(pc);
    });

    await it('should throw TypeError when receiver is missing', async () => {
        const pc = createPeerConnection();
        const transceiver = pc.addTransceiver('audio');
        const { track } = transceiver.receiver;

        expect(() => new RTCTrackEvent('track', { track, transceiver } as any)).toThrow();
        closePeerConnections(pc);
    });
});

// ==========================================================================
// RTCPeerConnection-addTransceiver.https.html (12 of 14 tests)
// ==========================================================================
await describe('RTCPeerConnection.addTransceiver (WPT)', async () => {
    await it('should throw TypeError for invalid kind', async () => {
        const pc = createPeerConnection();
        expect(() => pc.addTransceiver('invalid' as any)).toThrow();
        closePeerConnections(pc);
    });

    await it('should create audio transceiver with default sendrecv direction', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        expect(t).toBeDefined();
        expect(t.mid).toBeNull();
        expect(t.stopped).toBe(false);
        expect(t.direction).toBe('sendrecv');
        expect(t.currentDirection).toBeNull();
        expect(t.sender).toBeDefined();
        expect(t.receiver).toBeDefined();
        expect(t.receiver.track).toBeDefined();
        expect(t.receiver.track.kind).toBe('audio');
        closePeerConnections(pc);
    });

    await it('should create video transceiver', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('video');
        expect(t.receiver.track.kind).toBe('video');
        closePeerConnections(pc);
    });

    await it('should add transceiver to getTransceivers list', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        const transceivers = pc.getTransceivers();
        expect(transceivers.length).toBe(1);
        expect(transceivers[0]).toBe(t);
        closePeerConnections(pc);
    });

    await it('should add sender to getSenders list', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        const senders = pc.getSenders();
        expect(senders.length).toBe(1);
        expect(senders[0]).toBe(t.sender);
        closePeerConnections(pc);
    });

    await it('should add receiver to getReceivers list', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        const receivers = pc.getReceivers();
        expect(receivers.length).toBe(1);
        expect(receivers[0]).toBe(t.receiver);
        closePeerConnections(pc);
    });

    await it('should respect direction option sendonly', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio', { direction: 'sendonly' });
        expect(t.direction).toBe('sendonly');
        closePeerConnections(pc);
    });

    await it('should respect direction option recvonly', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio', { direction: 'recvonly' });
        expect(t.direction).toBe('recvonly');
        closePeerConnections(pc);
    });

    await it('should respect direction option inactive', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio', { direction: 'inactive' });
        expect(t.direction).toBe('inactive');
        closePeerConnections(pc);
    });

    await it('should throw TypeError for invalid direction', async () => {
        const pc = createPeerConnection();
        expect(() => pc.addTransceiver('audio', { direction: 'invalid' as any })).toThrow();
        closePeerConnections(pc);
    });

    await it('should support multiple transceivers', async () => {
        const pc = createPeerConnection();
        pc.addTransceiver('audio');
        pc.addTransceiver('video');
        expect(pc.getTransceivers().length).toBe(2);
        expect(pc.getSenders().length).toBe(2);
        expect(pc.getReceivers().length).toBe(2);
        closePeerConnections(pc);
    });

    await it('should throw InvalidStateError after close', async () => {
        const pc = createPeerConnection();
        pc.close();
        expect(() => pc.addTransceiver('audio')).toThrow();
    });
});

// ==========================================================================
// RTCPeerConnection-getTransceivers.html (1 test)
// ==========================================================================
await describe('RTCPeerConnection.getTransceivers initial state (WPT)', async () => {
    await it('should return empty arrays initially', async () => {
        const pc = createPeerConnection();
        expect(pc.getSenders().length).toBe(0);
        expect(pc.getReceivers().length).toBe(0);
        expect(pc.getTransceivers().length).toBe(0);
        closePeerConnections(pc);
    });
});

// ==========================================================================
// RTCRtpTransceiver-direction.html (3 tests)
// ==========================================================================
await describe('RTCRtpTransceiver.direction (WPT)', async () => {
    await it('setting direction should change transceiver.direction', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        expect(t.direction).toBe('sendrecv');
        expect(t.currentDirection).toBeNull();

        t.direction = 'recvonly';
        expect(t.direction).toBe('recvonly');
        expect(t.currentDirection).toBeNull();
        closePeerConnections(pc);
    });

    await it('setting same direction should have no effect', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio', { direction: 'sendonly' });
        expect(t.direction).toBe('sendonly');
        t.direction = 'sendonly';
        expect(t.direction).toBe('sendonly');
        closePeerConnections(pc);
    });

    await it('setting direction independent of currentDirection', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio', { direction: 'recvonly' });
        expect(t.direction).toBe('recvonly');

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const answer = await generateAnswer(offer);
        await pc.setRemoteDescription(answer);

        t.direction = 'sendrecv';
        expect(t.direction).toBe('sendrecv');
        closePeerConnections(pc);
    });
});

// ==========================================================================
// RTCRtpTransceiver-stop.html (selected tests)
// ==========================================================================
await describe('RTCRtpTransceiver.stop (WPT)', async () => {
    await it('stop should set stopped to true', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        expect(t.stopped).toBe(false);
        t.stop();
        expect(t.stopped).toBe(true);
        closePeerConnections(pc);
    });

    await it('stop should make direction return stopped', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        t.stop();
        expect(t.direction).toBe('stopped');
        closePeerConnections(pc);
    });

    await it('setting direction on stopped transceiver should throw', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        t.stop();
        expect(() => { t.direction = 'sendrecv'; }).toThrow();
        closePeerConnections(pc);
    });

    await it('stop should make mid return null', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        t.stop();
        expect(t.mid).toBeNull();
        closePeerConnections(pc);
    });

    await it('stop should make currentDirection return null', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        t.stop();
        expect(t.currentDirection).toBeNull();
        closePeerConnections(pc);
    });

    await it('stopping twice should be idempotent', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        t.stop();
        t.stop();
        expect(t.stopped).toBe(true);
        closePeerConnections(pc);
    });
});

// ==========================================================================
// RTCRtpSender-getCapabilities.html (3 tests)
// ==========================================================================
await describe('RTCRtpSender.getCapabilities (WPT)', async () => {
    await it('should return capabilities for audio', async () => {
        const caps = RTCRtpSender.getCapabilities('audio');
        expect(caps).toBeDefined();
        expect(caps).not.toBeNull();
        expect(Array.isArray(caps!.codecs)).toBe(true);
        expect(caps!.codecs.length).toBeGreaterThan(0);
        expect(Array.isArray(caps!.headerExtensions)).toBe(true);
        for (const codec of caps!.codecs) {
            expect(typeof codec.mimeType).toBe('string');
            expect(typeof codec.clockRate).toBe('number');
        }
    });

    await it('should return capabilities for video', async () => {
        const caps = RTCRtpSender.getCapabilities('video');
        expect(caps).toBeDefined();
        expect(caps).not.toBeNull();
        expect(caps!.codecs.length).toBeGreaterThan(0);
        for (const codec of caps!.codecs) {
            expect(typeof codec.mimeType).toBe('string');
            expect(typeof codec.clockRate).toBe('number');
        }
    });

    await it('should return null for unknown kind', async () => {
        const caps = RTCRtpSender.getCapabilities('dummy');
        expect(caps).toBeNull();
    });
});

// ==========================================================================
// RTCRtpReceiver-getCapabilities.html (3 tests)
// ==========================================================================
await describe('RTCRtpReceiver.getCapabilities (WPT)', async () => {
    await it('should return capabilities for audio', async () => {
        const caps = RTCRtpReceiver.getCapabilities('audio');
        expect(caps).not.toBeNull();
        expect(caps!.codecs.length).toBeGreaterThan(0);
        expect(caps!.headerExtensions.length).toBeGreaterThan(0);
    });

    await it('should return capabilities for video', async () => {
        const caps = RTCRtpReceiver.getCapabilities('video');
        expect(caps).not.toBeNull();
        expect(caps!.codecs.length).toBeGreaterThan(0);
    });

    await it('should return null for unknown kind', async () => {
        expect(RTCRtpReceiver.getCapabilities('dummy')).toBeNull();
    });
});

// ==========================================================================
// RTCRtpSender-setParameters.html (3 tests)
// ==========================================================================
await describe('RTCRtpSender.setParameters (WPT)', async () => {
    await it('getParameters should return valid structure', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        const params = t.sender.getParameters();
        expect(params).toBeDefined();
        expect(typeof params.transactionId).toBe('string');
        expect(Array.isArray(params.encodings)).toBe(true);
        expect(Array.isArray(params.codecs)).toBe(true);
        expect(Array.isArray(params.headerExtensions)).toBe(true);
        expect(typeof params.rtcp).toBe('object');
        closePeerConnections(pc);
    });

    await it('setParameters should resolve with same params', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        const params = t.sender.getParameters();
        await t.sender.setParameters(params);
        closePeerConnections(pc);
    });

    await it('setParameters should reject with mismatched transactionId', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        const params = t.sender.getParameters();
        params.transactionId = 'wrong-id';
        let threw = false;
        try {
            await t.sender.setParameters(params);
        } catch (e: any) {
            threw = true;
            expect(e.name).toBe('InvalidModificationError');
        }
        expect(threw).toBe(true);
        closePeerConnections(pc);
    });
});

// ==========================================================================
// RTCRtpReceiver-jitterBufferTarget.html (14 tests)
// ==========================================================================
await describe('RTCRtpReceiver.jitterBufferTarget (WPT)', async () => {
    await it('default should be null for audio', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio', { direction: 'recvonly' });
        expect(t.receiver.jitterBufferTarget).toBeNull();
        closePeerConnections(pc);
    });

    await it('default should be null for video', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('video', { direction: 'recvonly' });
        expect(t.receiver.jitterBufferTarget).toBeNull();
        closePeerConnections(pc);
    });

    await it('should accept positive value', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio', { direction: 'recvonly' });
        t.receiver.jitterBufferTarget = 500;
        expect(t.receiver.jitterBufferTarget).toBe(500);
        closePeerConnections(pc);
    });

    await it('should accept 0', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio', { direction: 'recvonly' });
        t.receiver.jitterBufferTarget = 0;
        expect(t.receiver.jitterBufferTarget).toBe(0);
        closePeerConnections(pc);
    });

    await it('should accept 4000 (max)', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio', { direction: 'recvonly' });
        t.receiver.jitterBufferTarget = 4000;
        expect(t.receiver.jitterBufferTarget).toBe(4000);
        closePeerConnections(pc);
    });

    await it('should throw RangeError for > 4000', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio', { direction: 'recvonly' });
        expect(() => { t.receiver.jitterBufferTarget = 4001; }).toThrow();
        closePeerConnections(pc);
    });

    await it('should throw RangeError for negative value', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio', { direction: 'recvonly' });
        expect(() => { t.receiver.jitterBufferTarget = -1; }).toThrow();
        closePeerConnections(pc);
    });

    await it('should retain old value on error', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio', { direction: 'recvonly' });
        t.receiver.jitterBufferTarget = 200;
        try { t.receiver.jitterBufferTarget = -1; } catch {}
        expect(t.receiver.jitterBufferTarget).toBe(200);
        closePeerConnections(pc);
    });

    await it('should accept reset to null', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio', { direction: 'recvonly' });
        t.receiver.jitterBufferTarget = 500;
        t.receiver.jitterBufferTarget = null;
        expect(t.receiver.jitterBufferTarget).toBeNull();
        closePeerConnections(pc);
    });

    await it('should accept value for video receiver', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('video', { direction: 'recvonly' });
        t.receiver.jitterBufferTarget = 1000;
        expect(t.receiver.jitterBufferTarget).toBe(1000);
        closePeerConnections(pc);
    });
});

// ==========================================================================
// RTCRtpTransceiver-setCodecPreferences.html (selected tests)
// ==========================================================================
await describe('RTCRtpTransceiver.setCodecPreferences (WPT)', async () => {
    await it('should accept empty array (reset)', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        t.setCodecPreferences([]);
        closePeerConnections(pc);
    });

    await it('should accept valid audio codecs from getCapabilities', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        const caps = RTCRtpReceiver.getCapabilities('audio');
        t.setCodecPreferences(caps!.codecs);
        closePeerConnections(pc);
    });

    await it('should accept valid video codecs from getCapabilities', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('video');
        const caps = RTCRtpReceiver.getCapabilities('video');
        t.setCodecPreferences(caps!.codecs);
        closePeerConnections(pc);
    });

    await it('should accept reordered codecs', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        const caps = RTCRtpReceiver.getCapabilities('audio');
        const reversed = [...caps!.codecs].reverse();
        t.setCodecPreferences(reversed);
        closePeerConnections(pc);
    });

    await it('should throw for codec not in capabilities', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        expect(() => {
            t.setCodecPreferences([{
                mimeType: 'audio/nonexistent',
                clockRate: 48000,
            }]);
        }).toThrow();
        closePeerConnections(pc);
    });

    await it('should throw for modified clockRate', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        const caps = RTCRtpReceiver.getCapabilities('audio');
        const modified = [{ ...caps!.codecs[0], clockRate: 12345 }];
        expect(() => t.setCodecPreferences(modified)).toThrow();
        closePeerConnections(pc);
    });

    await it('should accept subset of codecs', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        const caps = RTCRtpReceiver.getCapabilities('audio');
        const subset = caps!.codecs.filter(c => c.mimeType.toLowerCase() === 'audio/opus');
        if (subset.length > 0) {
            t.setCodecPreferences(subset);
        }
        closePeerConnections(pc);
    });
});

// ==========================================================================
// MediaStream (basic tests)
// ==========================================================================
await describe('MediaStream', async () => {
    await it('should create empty stream', async () => {
        const s = new MediaStream();
        expect(s.id).toBeDefined();
        expect(typeof s.id).toBe('string');
        expect(s.active).toBe(false);
        expect(s.getTracks().length).toBe(0);
    });

    await it('should create stream from tracks array', async () => {
        const track = new MediaStreamTrack({ kind: 'audio' });
        const s = new MediaStream([track]);
        expect(s.getTracks().length).toBe(1);
        expect(s.getAudioTracks().length).toBe(1);
        expect(s.getVideoTracks().length).toBe(0);
        expect(s.active).toBe(true);
    });

    await it('should clone stream', async () => {
        const track = new MediaStreamTrack({ kind: 'video' });
        const s1 = new MediaStream([track]);
        const s2 = s1.clone();
        expect(s2.id).not.toBe(s1.id);
        expect(s2.getTracks().length).toBe(1);
        expect(s2.getTracks()[0].id).not.toBe(track.id);
    });

    await it('should getTrackById', async () => {
        const track = new MediaStreamTrack({ kind: 'audio' });
        const s = new MediaStream([track]);
        expect(s.getTrackById(track.id)).toBe(track);
        expect(s.getTrackById('nonexistent')).toBeNull();
    });

    await it('should addTrack and fire event', async () => {
        const s = new MediaStream();
        const track = new MediaStreamTrack({ kind: 'audio' });
        let fired = false;
        s.addEventListener('addtrack', (ev: Event) => {
            fired = true;
            expect((ev as MediaStreamTrackEvent).track).toBe(track);
        });
        s.addTrack(track);
        expect(s.getTracks().length).toBe(1);
        expect(fired).toBe(true);
    });

    await it('should removeTrack and fire event', async () => {
        const track = new MediaStreamTrack({ kind: 'audio' });
        const s = new MediaStream([track]);
        let fired = false;
        s.addEventListener('removetrack', () => { fired = true; });
        s.removeTrack(track);
        expect(s.getTracks().length).toBe(0);
        expect(fired).toBe(true);
    });

    await it('should not add duplicate track', async () => {
        const track = new MediaStreamTrack({ kind: 'audio' });
        const s = new MediaStream([track]);
        s.addTrack(track);
        expect(s.getTracks().length).toBe(1);
    });
});

// ==========================================================================
// MediaStreamTrack (basic tests)
// ==========================================================================
await describe('MediaStreamTrack', async () => {
    await it('should have correct initial properties', async () => {
        const t = new MediaStreamTrack({ kind: 'audio', label: 'mic' });
        expect(t.kind).toBe('audio');
        expect(t.label).toBe('mic');
        expect(t.readyState).toBe('live');
        expect(t.enabled).toBe(true);
        expect(t.muted).toBe(false);
        expect(typeof t.id).toBe('string');
    });

    await it('should clone with new id', async () => {
        const t = new MediaStreamTrack({ kind: 'video' });
        const c = t.clone();
        expect(c.kind).toBe('video');
        expect(c.id).not.toBe(t.id);
        expect(c.readyState).toBe('live');
    });

    await it('stop should set readyState to ended', async () => {
        const t = new MediaStreamTrack({ kind: 'audio' });
        t.stop();
        expect(t.readyState).toBe('ended');
    });

    await it('should toggle enabled', async () => {
        const t = new MediaStreamTrack({ kind: 'audio' });
        t.enabled = false;
        expect(t.enabled).toBe(false);
        t.enabled = true;
        expect(t.enabled).toBe(true);
    });

    await it('should validate contentHint for audio', async () => {
        const t = new MediaStreamTrack({ kind: 'audio' });
        t.contentHint = 'speech';
        expect(t.contentHint).toBe('speech');
        t.contentHint = 'invalid';
        expect(t.contentHint).toBe('speech');
        t.contentHint = '';
        expect(t.contentHint).toBe('');
    });

    await it('should validate contentHint for video', async () => {
        const t = new MediaStreamTrack({ kind: 'video' });
        t.contentHint = 'motion';
        expect(t.contentHint).toBe('motion');
        t.contentHint = 'speech';
        expect(t.contentHint).toBe('motion');
    });

    await it('getCapabilities should return empty object', async () => {
        const t = new MediaStreamTrack({ kind: 'audio' });
        const caps = t.getCapabilities();
        expect(typeof caps).toBe('object');
    });
});

// ==========================================================================
// RTCRtpReceiver.getParameters (basic test)
// ==========================================================================
await describe('RTCRtpReceiver.getParameters (WPT)', async () => {
    await it('should return valid parameter structure', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        const params = t.receiver.getParameters();
        expect(params).toBeDefined();
        expect(Array.isArray(params.codecs)).toBe(true);
        expect(Array.isArray(params.headerExtensions)).toBe(true);
        expect(typeof params.rtcp).toBe('object');
        closePeerConnections(pc);
    });
});

// ==========================================================================
// Receiver/Sender track properties
// ==========================================================================
await describe('Receiver and Sender track properties', async () => {
    await it('receiver track should be audio for audio transceiver', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        expect(t.receiver.track.kind).toBe('audio');
        expect(t.receiver.track.readyState).toBe('live');
        expect(t.receiver.track.muted).toBe(true);
        closePeerConnections(pc);
    });

    await it('receiver track should be video for video transceiver', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('video');
        expect(t.receiver.track.kind).toBe('video');
        closePeerConnections(pc);
    });

    await it('sender track should be null initially', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        expect(t.sender.track).toBeNull();
        closePeerConnections(pc);
    });

    await it('sender dtmf should be null', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        expect(t.sender.dtmf).toBeNull();
        closePeerConnections(pc);
    });

    await it('receiver transport should be null', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        expect(t.receiver.transport).toBeNull();
        closePeerConnections(pc);
    });

    await it('sender transport should be null', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        expect(t.sender.transport).toBeNull();
        closePeerConnections(pc);
    });
});

// ==========================================================================
// Receiver media flow (Phase 2.5)
// ==========================================================================
await describe('Receiver media pipeline (Phase 2.5)', async () => {
    await it('receiver has _connectToPad method', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        expect(typeof t.receiver._connectToPad).toBe('function');
        expect(typeof t.receiver._dispose).toBe('function');
        closePeerConnections(pc);
    });

    await it('receiver track starts muted', async () => {
        const pc = createPeerConnection();
        const t = pc.addTransceiver('audio');
        expect(t.receiver.track.muted).toBe(true);
        closePeerConnections(pc);
    });

    await it('_setMuted(false) dispatches unmute event', async () => {
        const track = new MediaStreamTrack({ kind: 'audio', muted: true });
        expect(track.muted).toBe(true);
        let unmuted = false;
        track.addEventListener('unmute', () => { unmuted = true; });
        track._setMuted(false);
        expect(track.muted).toBe(false);
        expect(unmuted).toBe(true);
    });

    await it('_setMuted(true) dispatches mute event', async () => {
        const track = new MediaStreamTrack({ kind: 'audio', muted: false });
        let muted = false;
        track.addEventListener('mute', () => { muted = true; });
        track._setMuted(true);
        expect(track.muted).toBe(true);
        expect(muted).toBe(true);
    });

    await it('close disposes receiver bridges without error', async () => {
        const pc = createPeerConnection();
        pc.addTransceiver('audio');
        pc.addTransceiver('video');
        pc.close();
    });
});

// ── Phase 3: addTrack ──────────────────────────────────────────────────

await describe('addTrack (Phase 3)', async () => {
    await it('should return a sender with the track assigned', async () => {
        const pc = createPeerConnection();
        const track = new MediaStreamTrack({ kind: 'audio' });
        const sender = pc.addTrack(track);
        expect(sender).toBeDefined();
        expect(sender.track).toBe(track);
        closePeerConnections(pc);
    });

    await it('should throw TypeError for non-MediaStreamTrack argument', async () => {
        const pc = createPeerConnection();
        expect(() => (pc as any).addTrack('audio')).toThrow();
        expect(() => (pc as any).addTrack({})).toThrow();
        closePeerConnections(pc);
    });

    await it('should throw InvalidAccessError if track already added', async () => {
        const pc = createPeerConnection();
        const track = new MediaStreamTrack({ kind: 'audio' });
        pc.addTrack(track);
        let threw = false;
        try {
            pc.addTrack(track);
        } catch (e: any) {
            threw = true;
            expect(e.name).toBe('InvalidAccessError');
        }
        expect(threw).toBe(true);
        closePeerConnections(pc);
    });

    await it('should reuse inactive transceiver with matching kind', async () => {
        const pc = createPeerConnection();
        pc.addTransceiver('audio', { direction: 'recvonly' });
        expect(pc.getTransceivers().length).toBe(1);

        const track = new MediaStreamTrack({ kind: 'audio' });
        const sender = pc.addTrack(track);
        // Should reuse, not create a new transceiver
        expect(pc.getTransceivers().length).toBe(1);
        expect(sender.track).toBe(track);
        closePeerConnections(pc);
    });

    await it('should create new transceiver when no reusable one exists', async () => {
        const pc = createPeerConnection();
        // sendrecv transceiver already has send — not reusable
        pc.addTransceiver('audio', { direction: 'sendrecv' });
        expect(pc.getTransceivers().length).toBe(1);

        const track = new MediaStreamTrack({ kind: 'audio' });
        pc.addTrack(track);
        expect(pc.getTransceivers().length).toBe(2);
        closePeerConnections(pc);
    });

    await it('should create transceiver with sendrecv direction', async () => {
        const pc = createPeerConnection();
        const track = new MediaStreamTrack({ kind: 'video' });
        pc.addTrack(track);
        const trans = pc.getTransceivers();
        expect(trans.length).toBe(1);
        expect(trans[0].direction).toBe('sendrecv');
        closePeerConnections(pc);
    });

    await it('should add sender to getSenders list', async () => {
        const pc = createPeerConnection();
        const track = new MediaStreamTrack({ kind: 'audio' });
        const sender = pc.addTrack(track);
        expect(pc.getSenders()).toContain(sender);
        closePeerConnections(pc);
    });

    await it('should throw InvalidStateError after close', async () => {
        const pc = createPeerConnection();
        pc.close();
        const track = new MediaStreamTrack({ kind: 'audio' });
        expect(() => pc.addTrack(track)).toThrow();
    });
});

// ── Phase 3: removeTrack ───────────────────────────────────────────────

await describe('removeTrack (Phase 3)', async () => {
    await it('should set sender.track to null', async () => {
        const pc = createPeerConnection();
        const track = new MediaStreamTrack({ kind: 'audio' });
        const sender = pc.addTrack(track);
        pc.removeTrack(sender);
        expect(sender.track).toBeNull();
        closePeerConnections(pc);
    });

    await it('should throw for sender from different connection', async () => {
        const pc1 = createPeerConnection();
        const pc2 = createPeerConnection();
        const track = new MediaStreamTrack({ kind: 'audio' });
        const sender = pc1.addTrack(track);
        expect(() => pc2.removeTrack(sender)).toThrow();
        closePeerConnections(pc1, pc2);
    });
});

// ── Phase 3: replaceTrack ──────────────────────────────────────────────

await describe('replaceTrack (Phase 3)', async () => {
    await it('should replace track on sender', async () => {
        const pc = createPeerConnection();
        const track1 = new MediaStreamTrack({ kind: 'audio' });
        const sender = pc.addTrack(track1);
        const track2 = new MediaStreamTrack({ kind: 'audio' });
        await sender.replaceTrack(track2);
        expect(sender.track).toBe(track2);
        closePeerConnections(pc);
    });

    await it('should accept null to remove track', async () => {
        const pc = createPeerConnection();
        const track = new MediaStreamTrack({ kind: 'audio' });
        const sender = pc.addTrack(track);
        await sender.replaceTrack(null);
        expect(sender.track).toBeNull();
        closePeerConnections(pc);
    });

    await it('should throw for different kind', async () => {
        const pc = createPeerConnection();
        const audio = new MediaStreamTrack({ kind: 'audio' });
        const sender = pc.addTrack(audio);
        const video = new MediaStreamTrack({ kind: 'video' });
        let threw = false;
        try {
            await sender.replaceTrack(video);
        } catch {
            threw = true;
        }
        expect(threw).toBe(true);
        closePeerConnections(pc);
    });
});

// ── Phase 3: getUserMedia ──────────────────────────────────────────────

await describe('getUserMedia (Phase 3)', async () => {
    const { getUserMedia } = await import('./get-user-media.js');

    await it('should return MediaStream with audio track', async () => {
        const stream = await getUserMedia({ audio: true });
        expect(stream).toBeDefined();
        expect(stream.getAudioTracks().length).toBe(1);
        expect(stream.getVideoTracks().length).toBe(0);
        const track = stream.getAudioTracks()[0];
        expect(track.kind).toBe('audio');
        expect(track.readyState).toBe('live');
        stream.getTracks().forEach(t => t.stop());
    });

    await it('should return MediaStream with video track', async () => {
        const stream = await getUserMedia({ video: true });
        expect(stream).toBeDefined();
        expect(stream.getVideoTracks().length).toBe(1);
        const track = stream.getVideoTracks()[0];
        expect(track.kind).toBe('video');
        stream.getTracks().forEach(t => t.stop());
    });

    await it('should return MediaStream with both audio and video', async () => {
        const stream = await getUserMedia({ audio: true, video: true });
        expect(stream.getAudioTracks().length).toBe(1);
        expect(stream.getVideoTracks().length).toBe(1);
        stream.getTracks().forEach(t => t.stop());
    });

    await it('should throw TypeError without audio or video', async () => {
        let threw = false;
        try {
            await getUserMedia({});
        } catch (e: any) {
            threw = true;
        }
        expect(threw).toBe(true);
    });

    await it('track should have GStreamer source backing', async () => {
        const stream = await getUserMedia({ audio: true });
        const track = stream.getAudioTracks()[0];
        expect((track as any)._gstSource).toBeDefined();
        expect((track as any)._gstSource).not.toBeNull();
        stream.getTracks().forEach(t => t.stop());
    });

    await it('stop should set readyState to ended and dispatch event', async () => {
        const stream = await getUserMedia({ audio: true });
        const track = stream.getAudioTracks()[0];
        let ended = false;
        track.addEventListener('ended', () => { ended = true; });
        track.stop();
        expect(track.readyState).toBe('ended');
        expect(ended).toBe(true);
    });
});

// ── Phase 3: MediaDevices ──────────────────────────────────────────────

await describe('MediaDevices (Phase 3)', async () => {
    const { MediaDevices } = await import('./media-devices.js');

    await it('should have getUserMedia method', async () => {
        const md = new MediaDevices();
        expect(typeof md.getUserMedia).toBe('function');
    });

    await it('should have enumerateDevices method', async () => {
        const md = new MediaDevices();
        const devices = await md.enumerateDevices();
        expect(Array.isArray(devices)).toBe(true);
    });

    await it('should have getSupportedConstraints method', async () => {
        const md = new MediaDevices();
        const sc = md.getSupportedConstraints();
        expect(typeof sc).toBe('object');
    });

    await it('getUserMedia should throw without constraints', async () => {
        const md = new MediaDevices();
        let threw = false;
        try {
            await md.getUserMedia();
        } catch {
            threw = true;
        }
        expect(threw).toBe(true);
    });
});

// ── RTCRtpParameters structure validation ────────────────────────────
// Ported from refs/wpt/webrtc/RTCRtpParameters-codecs.html,
// RTCRtpParameters-encodings.html, RTCRtpParameters-headerExtensions.html

await describe('RTCRtpParameters structure (WPT)', async () => {
    await it('getParameters().encodings entries have active boolean', async () => {
        const pc = createPeerConnection();
        try {
            const t = pc.addTransceiver('audio');
            const params = t.sender.getParameters();
            expect(Array.isArray(params.encodings)).toBeTruthy();
            for (const enc of params.encodings) {
                expect(typeof enc.active).toBe('boolean');
            }
        } finally { pc.close(); }
    });

    await it('getParameters().codecs entries have mimeType, clockRate, payloadType', async () => {
        const pc1 = createPeerConnection();
        const pc2 = createPeerConnection();
        try {
            pc1.addTransceiver('audio');
            await exchangeOfferAnswer(pc1, pc2);
            const sender = pc1.getSenders()[0];
            const params = sender.getParameters();
            expect(params.codecs.length).toBeGreaterThan(0);
            for (const codec of params.codecs) {
                expect(typeof codec.mimeType).toBe('string');
                expect(typeof codec.clockRate).toBe('number');
                expect(typeof codec.payloadType).toBe('number');
            }
        } finally { closePeerConnections(pc1, pc2); }
    });

    await it('getParameters().headerExtensions entries have uri and id', async () => {
        const pc1 = createPeerConnection();
        const pc2 = createPeerConnection();
        try {
            pc1.addTransceiver('audio');
            await exchangeOfferAnswer(pc1, pc2);
            const sender = pc1.getSenders()[0];
            const params = sender.getParameters();
            // headerExtensions may be empty before negotiation on some impls
            for (const ext of params.headerExtensions) {
                expect(typeof ext.uri).toBe('string');
                expect(typeof ext.id).toBe('number');
            }
        } finally { closePeerConnections(pc1, pc2); }
    });

    await it('after negotiation codecs array is non-empty', async () => {
        const pc1 = createPeerConnection();
        const pc2 = createPeerConnection();
        try {
            pc1.addTransceiver('audio');
            await exchangeOfferAnswer(pc1, pc2);
            const sender = pc1.getSenders()[0];
            const params = sender.getParameters();
            expect(params.codecs.length).toBeGreaterThan(0);
        } finally { closePeerConnections(pc1, pc2); }
    });

    await it('getParameters().rtcp has cname string', async () => {
        const pc1 = createPeerConnection();
        const pc2 = createPeerConnection();
        try {
            pc1.addTransceiver('audio');
            await exchangeOfferAnswer(pc1, pc2);
            const sender = pc1.getSenders()[0];
            const params = sender.getParameters();
            if (params.rtcp) {
                expect(typeof params.rtcp.cname).toBe('string');
            }
        } finally { closePeerConnections(pc1, pc2); }
    });
});

};
