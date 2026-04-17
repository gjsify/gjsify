// WebRTC API tests — GJS only (requires GStreamer + webrtcbin).
//
// The loopback test is the primary smoke test: two local peers exchange
// offer/answer + ICE candidates in a single process and open a data channel.

import Gst from 'gi://Gst?version=1.0';
import { describe, it, expect } from '@gjsify/unit';

import {
    RTCPeerConnection,
    RTCSessionDescription,
    RTCIceCandidate,
    RTCDataChannel,
    MediaStreamTrack,
    getUserMedia,
} from './index.js';

// Tests that exercise webrtcbin require libnice's GStreamer plugin on the
// host system. If missing, skip those suites with a clear message instead
// of failing — the RTCPeerConnection constructor already throws the full
// install hint via ensureWebrtcbinAvailable().
Gst.init(null);
const webrtcbinReady = Boolean(
    Gst.ElementFactory.find('webrtcbin') && Gst.ElementFactory.find('nicesrc'),
);
if (!webrtcbinReady) {
    // eslint-disable-next-line no-console
    console.log(
        '  ⚠ webrtcbin/nicesrc not installed — skipping pipeline tests.\n' +
        '    Install: dnf install libnice-gstreamer1 (Fedora) | apt install gstreamer1.0-nice (Ubuntu)',
    );
}

// Phase 1.5 landed: the native @gjsify/webrtc-native bridge marshals
// webrtcbin signals + Gst.Promise callbacks onto the main thread, so the
// async handshake now works on GJS too.
const ASYNC_SIGNALS_WORK = true;

function waitFor<T = void>(ms: number, promise: Promise<T>, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout waiting for ${label} (${ms}ms)`)), ms),
        ),
    ]);
}

function awaitEvent(target: EventTarget, type: string, timeoutMs = 10000): Promise<Event> {
    return waitFor(timeoutMs, new Promise<Event>((resolve) => {
        const handler = (ev: Event) => {
            target.removeEventListener(type, handler);
            resolve(ev);
        };
        target.addEventListener(type, handler);
    }), `${type} event`);
}

export default async () => {
    await describe('@gjsify/webrtc', async () => {

        await describe('RTCPeerConnection construction', async () => {
            if (!webrtcbinReady) {
                await it('(skipped — webrtcbin/nicesrc missing)', async () => {
                    expect(webrtcbinReady).toBeFalsy();
                });
            } else {
                await it('constructs without configuration', async () => {
                    const pc = new RTCPeerConnection();
                    expect(pc).toBeDefined();
                    expect(pc.signalingState).toBe('stable');
                    pc.close();
                });

                await it('accepts a STUN server', async () => {
                    const pc = new RTCPeerConnection({
                        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
                    });
                    expect(pc).toBeDefined();
                    pc.close();
                });

                await it('rejects an empty urls array', async () => {
                    expect(() => {
                        new RTCPeerConnection({ iceServers: [{ urls: [] }] });
                    }).toThrow();
                });
            }
        });

        await describe('RTCSessionDescription', async () => {
            await it('holds type and sdp', async () => {
                const desc = new RTCSessionDescription({ type: 'offer', sdp: 'v=0\r\n' });
                expect(desc.type).toBe('offer');
                expect(desc.sdp).toBe('v=0\r\n');
            });

            await it('survives a Gst round-trip for a minimal SDP', async () => {
                const sdp = [
                    'v=0',
                    'o=- 7614219274584779017 2 IN IP4 127.0.0.1',
                    's=-',
                    't=0 0',
                    'a=group:BUNDLE 0',
                    'a=msid-semantic: WMS',
                    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
                    'c=IN IP4 0.0.0.0',
                    'a=ice-ufrag:abcd',
                    'a=ice-pwd:1234567890123456789012',
                    'a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff',
                    'a=setup:actpass',
                    'a=mid:0',
                    'a=sctp-port:5000',
                    '',
                ].join('\r\n');
                const original = new RTCSessionDescription({ type: 'offer', sdp });
                const gst = original.toGstDesc();
                const roundtripped = RTCSessionDescription.fromGstDesc(gst);
                expect(roundtripped.type).toBe('offer');
                expect(roundtripped.sdp).toContain('a=mid:0');
                expect(roundtripped.sdp).toContain('UDP/DTLS/SCTP');
            });
        });

        await describe('RTCIceCandidate', async () => {
            await it('stores constructor fields', async () => {
                const c = new RTCIceCandidate({
                    candidate: 'candidate:842163049 1 udp 1677729535 1.2.3.4 12345 typ srflx raddr 10.0.0.1 rport 5000',
                    sdpMid: '0',
                    sdpMLineIndex: 0,
                });
                expect(c.sdpMid).toBe('0');
                expect(c.sdpMLineIndex).toBe(0);
                expect(c.protocol).toBe('udp');
                expect(c.type).toBe('srflx');
                expect(c.address).toBe('1.2.3.4');
                expect(c.port).toBe(12345);
                expect(c.component).toBe('rtp');
                expect(c.relatedAddress).toBe('10.0.0.1');
                expect(c.relatedPort).toBe(5000);
            });

            await it('round-trips via toJSON', async () => {
                const c = new RTCIceCandidate({
                    candidate: 'candidate:0 1 udp 1 127.0.0.1 9 typ host',
                    sdpMid: '0',
                    sdpMLineIndex: 0,
                });
                const json = c.toJSON();
                const restored = new RTCIceCandidate(json);
                expect(restored.candidate).toBe(c.candidate);
                expect(restored.sdpMid).toBe(c.sdpMid);
            });

            await it('requires sdpMid or sdpMLineIndex', async () => {
                expect(() => new RTCIceCandidate({ candidate: 'candidate:...' })).toThrow();
            });
        });

        await describe('Deferred APIs throw NotSupported', async () => {
            if (!webrtcbinReady) {
                await it('(skipped — webrtcbin/nicesrc missing)', async () => {
                    expect(webrtcbinReady).toBeFalsy();
                });
                return;
            }
            await it('addTrack throws', async () => {
                const pc = new RTCPeerConnection();
                expect(() => (pc as any).addTrack({}, {})).toThrow();
                pc.close();
            });
            await it('addTransceiver works', async () => {
                const pc = new RTCPeerConnection();
                const t = pc.addTransceiver('audio');
                expect(t).toBeDefined();
                expect(t.direction).toBe('sendrecv');
                pc.close();
            });
            await it('getStats rejects', async () => {
                const pc = new RTCPeerConnection();
                let threw = false;
                try { await (pc as any).getStats(); } catch { threw = true; }
                expect(threw).toBeTruthy();
                pc.close();
            });
            await it('getSenders / getReceivers / getTransceivers return empty arrays', async () => {
                const pc = new RTCPeerConnection();
                expect((pc as any).getSenders().length).toBe(0);
                expect((pc as any).getReceivers().length).toBe(0);
                expect((pc as any).getTransceivers().length).toBe(0);
                pc.close();
            });
        });

        await describe('Loopback data channel', async () => {
            if (!webrtcbinReady) {
                await it('(skipped — webrtcbin/nicesrc missing)', async () => {
                    expect(webrtcbinReady).toBeFalsy();
                });
                return;
            }
            if (!ASYNC_SIGNALS_WORK) {
                await it('(skipped — GJS blocks webrtcbin streaming-thread callbacks; Phase 1.5 needs a native signal bridge)', async () => {
                    expect(ASYNC_SIGNALS_WORK).toBeFalsy();
                });
                return;
            }
            await it('exchanges string and binary payloads over two local peers', async () => {
                const pcA = new RTCPeerConnection();
                const pcB = new RTCPeerConnection();

                // ICE trickle A↔B
                pcA.onicecandidate = (ev) => {
                    if (ev.candidate) pcB.addIceCandidate(ev.candidate.toJSON());
                };
                pcB.onicecandidate = (ev) => {
                    if (ev.candidate) pcA.addIceCandidate(ev.candidate.toJSON());
                };

                const channelA = pcA.createDataChannel('chat');

                // Handshake
                const offer = await pcA.createOffer();
                await pcA.setLocalDescription(offer);
                await pcB.setRemoteDescription(offer);
                const answer = await pcB.createAnswer();
                await pcB.setLocalDescription(answer);
                await pcA.setRemoteDescription(answer);

                // Wait for B's incoming data channel, then both opens.
                const dcEvent = await awaitEvent(pcB, 'datachannel') as any;
                const channelB = dcEvent.channel as RTCDataChannel;

                await Promise.all([
                    channelA.readyState === 'open' ? Promise.resolve() : awaitEvent(channelA, 'open'),
                    channelB.readyState === 'open' ? Promise.resolve() : awaitEvent(channelB, 'open'),
                ]);

                // String A → B
                const recvOnB = awaitEvent(channelB, 'message') as Promise<MessageEvent>;
                channelA.send('hello from A');
                const msg1 = await recvOnB;
                expect(msg1.data).toBe('hello from A');

                // Binary B → A
                const recvOnA = awaitEvent(channelA, 'message') as Promise<MessageEvent>;
                channelB.send(new Uint8Array([1, 2, 3, 4]).buffer);
                const msg2 = await recvOnA;
                expect(msg2.data instanceof ArrayBuffer).toBeTruthy();
                const arr = new Uint8Array(msg2.data as ArrayBuffer);
                expect(arr.length).toBe(4);
                expect(arr[0]).toBe(1);
                expect(arr[3]).toBe(4);

                channelA.close();
                channelB.close();
                pcA.close();
                pcB.close();
            });
        });

        await describe('close()', async () => {
            if (!webrtcbinReady) {
                await it('(skipped — webrtcbin/nicesrc missing)', async () => {
                    expect(webrtcbinReady).toBeFalsy();
                });
                return;
            }
            await it('transitions signalingState to "closed"', async () => {
                const pc = new RTCPeerConnection();
                pc.close();
                expect(pc.signalingState).toBe('closed');
                expect(pc.connectionState).toBe('closed');
            });
        });

        // ── Phase 3: End-to-end audio loopback ─────────────────────────

        await describe('End-to-end audio loopback (Phase 3)', async () => {
            if (!webrtcbinReady) {
                await it('(skipped — webrtcbin/nicesrc missing)', async () => {
                    expect(webrtcbinReady).toBeFalsy();
                });
                return;
            }

            await it('addTrack with getUserMedia track creates offer with audio m-line', async () => {
                const stream = await getUserMedia({ audio: true });
                const audioTrack = stream.getAudioTracks()[0];
                const pc = new RTCPeerConnection();
                const sender = pc.addTrack(audioTrack);
                expect(sender).toBeDefined();
                expect(sender.track).toBe(audioTrack);

                const offer = await pc.createOffer();
                expect(offer.sdp).toContain('m=audio');

                audioTrack.stop();
                pc.close();
            });

            await it('addTrack with plain MediaStreamTrack (no GStreamer source) works', async () => {
                const track = new MediaStreamTrack({ kind: 'audio' });
                const pc = new RTCPeerConnection();
                const sender = pc.addTrack(track);
                expect(sender).toBeDefined();
                expect(sender.track).toBe(track);
                // No GStreamer source — pipeline not wired, but API works
                expect(pc.getSenders().length).toBe(1);
                pc.close();
            });

            await it('should send audio from pcA and receive track event on pcB', async () => {
                const stream = await getUserMedia({ audio: true });
                const audioTrack = stream.getAudioTracks()[0];

                const pcA = new RTCPeerConnection();
                const pcB = new RTCPeerConnection();

                // ICE exchange
                pcA.onicecandidate = (ev: any) => {
                    if (ev.candidate) pcB.addIceCandidate(ev.candidate);
                };
                pcB.onicecandidate = (ev: any) => {
                    if (ev.candidate) pcA.addIceCandidate(ev.candidate);
                };

                pcA.addTrack(audioTrack);

                // Wait for track event on pcB
                const trackPromise = new Promise<any>((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('track event timeout')), 15000);
                    pcB.ontrack = (ev: any) => { clearTimeout(timeout); resolve(ev); };
                });

                // Offer/answer exchange
                const offer = await pcA.createOffer();
                await pcA.setLocalDescription(offer);
                await pcB.setRemoteDescription(offer);
                const answer = await pcB.createAnswer();
                await pcB.setLocalDescription(answer);
                await pcA.setRemoteDescription(answer);

                // Verify track event fires
                const ev = await trackPromise;
                expect(ev.track).toBeDefined();
                expect(ev.track.kind).toBe('audio');
                expect(ev.receiver).toBeDefined();
                expect(ev.transceiver).toBeDefined();

                audioTrack.stop();
                pcA.close();
                pcB.close();
            });
        });
    });
};
