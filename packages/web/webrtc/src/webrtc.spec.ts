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
    RTCDtlsTransport,
    RTCIceTransport,
    RTCSctpTransport,
    MediaStreamTrack,
    MediaDevices,
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

            // ---- Implicit setLocalDescription (perfect negotiation) ----
            // Ported from refs/wpt/webrtc/RTCPeerConnection-restartIce.https.html
            // (negotiators[1] — "perfect negotiation" path).

            await it('implicit SLD() in stable state creates an offer', async () => {
                const pc = new RTCPeerConnection();
                pc.addTransceiver('audio');
                // Call setLocalDescription with no arguments
                await pc.setLocalDescription();
                expect(pc.localDescription).toBeDefined();
                expect(pc.localDescription!.type).toBe('offer');
                expect(pc.localDescription!.sdp.length).toBeGreaterThan(0);
                pc.close();
            });

            await it('implicit SLD() in have-remote-offer creates an answer', async () => {
                const pc1 = new RTCPeerConnection();
                const pc2 = new RTCPeerConnection();
                pc1.addTransceiver('audio');
                const offer = await pc1.createOffer();
                await pc1.setLocalDescription(offer);
                await pc2.setRemoteDescription(offer);
                // pc2 is now in have-remote-offer — implicit SLD should create answer
                expect(pc2.signalingState).toBe('have-remote-offer');
                await pc2.setLocalDescription();
                expect(pc2.localDescription).toBeDefined();
                expect(pc2.localDescription!.type).toBe('answer');
                pc1.close();
                pc2.close();
            });

            await it('perfect negotiation handshake (implicit SLD both sides)', async () => {
                const pc1 = new RTCPeerConnection();
                const pc2 = new RTCPeerConnection();
                pc1.onicecandidate = (ev: any) => {
                    if (ev.candidate) pc2.addIceCandidate(ev.candidate).catch(() => {});
                };
                pc2.onicecandidate = (ev: any) => {
                    if (ev.candidate) pc1.addIceCandidate(ev.candidate).catch(() => {});
                };
                pc1.addTransceiver('audio');
                // Offerer: implicit SLD
                await pc1.setLocalDescription();
                expect(pc1.localDescription!.type).toBe('offer');
                await pc2.setRemoteDescription(pc1.localDescription!);
                // Answerer: implicit SLD
                await pc2.setLocalDescription();
                expect(pc2.localDescription!.type).toBe('answer');
                await pc1.setRemoteDescription(pc2.localDescription!);
                expect(pc1.signalingState).toBe('stable');
                expect(pc2.signalingState).toBe('stable');
                pc1.close();
                pc2.close();
            });

            await it('implicit SLD() on closed connection throws', async () => {
                const pc = new RTCPeerConnection();
                pc.close();
                let threw = false;
                try {
                    await pc.setLocalDescription();
                } catch (e: any) {
                    threw = true;
                    expect(e.message).toContain('closed');
                }
                expect(threw).toBeTruthy();
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

        // ---- getStats() (Phase 4.2) ----------------------------------------
        // Ported from refs/wpt/webrtc/RTCPeerConnection-getStats.https.html

        await describe('getStats()', async () => {
            if (!webrtcbinReady || !ASYNC_SIGNALS_WORK) {
                await it('(skipped — webrtcbin/nicesrc missing)', async () => {
                    expect(webrtcbinReady).toBeFalsy();
                });
            } else {
                await it('getStats() returns an RTCStatsReport', async () => {
                    const pc = new RTCPeerConnection();
                    pc.createDataChannel('test');
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    const report = await pc.getStats();
                    expect(report).toBeDefined();
                    expect(typeof report.size).toBe('number');
                    pc.close();
                });

                await it('getStats(null) returns all stats', async () => {
                    const pc = new RTCPeerConnection();
                    pc.createDataChannel('test');
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    const report = await pc.getStats(null);
                    expect(report).toBeDefined();
                    expect(typeof report.size).toBe('number');
                    pc.close();
                });

                await it('getStats() report entries have type, id, timestamp', async () => {
                    const pc = new RTCPeerConnection();
                    pc.createDataChannel('test');
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    const report = await pc.getStats();
                    for (const [id, stats] of report) {
                        expect(typeof id).toBe('string');
                        expect(id.length).toBeGreaterThan(0);
                        expect(typeof stats.type).toBe('string');
                        expect(typeof stats.id).toBe('string');
                        expect(typeof stats.timestamp).toBe('number');
                    }
                    pc.close();
                });

                await it('getStats() is iterable with forEach', async () => {
                    const pc = new RTCPeerConnection();
                    pc.createDataChannel('test');
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    const report = await pc.getStats();
                    let count = 0;
                    report.forEach(() => { count++; });
                    expect(count).toBe(report.size);
                    pc.close();
                });

                await it('getStats(unknownTrack) rejects with InvalidAccessError', async () => {
                    const pc = new RTCPeerConnection();
                    pc.createDataChannel('test');
                    const unknownTrack = new MediaStreamTrack({ kind: 'audio' });
                    let threw = false;
                    try {
                        await pc.getStats(unknownTrack);
                    } catch (e: any) {
                        threw = true;
                        expect(e.message).toContain('not associated');
                    }
                    expect(threw).toBeTruthy();
                    pc.close();
                });

                await it('getStats() on closed connection rejects', async () => {
                    const pc = new RTCPeerConnection();
                    pc.close();
                    let threw = false;
                    try {
                        await pc.getStats();
                    } catch (e: any) {
                        threw = true;
                        expect(e.message).toContain('closed');
                    }
                    expect(threw).toBeTruthy();
                });

                await it('sender.getStats() returns a report', async () => {
                    const pc = new RTCPeerConnection();
                    const transceiver = pc.addTransceiver('audio');
                    const report = await transceiver.sender.getStats();
                    expect(report).toBeDefined();
                    expect(typeof report.size).toBe('number');
                    pc.close();
                });

                await it('receiver.getStats() returns a report', async () => {
                    const pc = new RTCPeerConnection();
                    const transceiver = pc.addTransceiver('audio');
                    const report = await transceiver.receiver.getStats();
                    expect(report).toBeDefined();
                    expect(typeof report.size).toBe('number');
                    pc.close();
                });
            }
        });

        // ---- restartIce() + setConfiguration() (Phase 4.4) -----------------
        // Ported from refs/wpt/webrtc/RTCPeerConnection-restartIce.https.html
        // and refs/wpt/webrtc/RTCPeerConnection-restartIce-onnegotiationneeded.https.html

        await describe('restartIce()', async () => {
            if (!webrtcbinReady || !ASYNC_SIGNALS_WORK) {
                await it('(skipped — webrtcbin/nicesrc missing)', async () => {
                    expect(webrtcbinReady).toBeFalsy();
                });
            } else {
                await it('restartIce() has no effect on a closed connection', async () => {
                    const pc = new RTCPeerConnection();
                    pc.close();
                    // Should not throw
                    pc.restartIce();
                    expect(pc.signalingState).toBe('closed');
                });

                await it('restartIce() does not fire negotiationneeded before initial negotiation', async () => {
                    const pc = new RTCPeerConnection();
                    let fired = false;
                    pc.onnegotiationneeded = () => { fired = true; };
                    pc.restartIce();
                    // Give microtask a chance to fire
                    await new Promise(r => setTimeout(r, 50));
                    expect(fired).toBeFalsy();
                    pc.close();
                });

                await it('restartIce() fires negotiationneeded after initial negotiation', async () => {
                    const pc1 = new RTCPeerConnection();
                    const pc2 = new RTCPeerConnection();
                    pc1.onicecandidate = (ev: any) => {
                        if (ev.candidate) pc2.addIceCandidate(ev.candidate).catch(() => {});
                    };
                    pc2.onicecandidate = (ev: any) => {
                        if (ev.candidate) pc1.addIceCandidate(ev.candidate).catch(() => {});
                    };
                    pc1.addTransceiver('audio');
                    // Initial negotiation
                    const offer = await pc1.createOffer();
                    await pc1.setLocalDescription(offer);
                    await pc2.setRemoteDescription(offer);
                    const answer = await pc2.createAnswer();
                    await pc2.setLocalDescription(answer);
                    await pc1.setRemoteDescription(answer);

                    // Now restartIce should fire negotiationneeded
                    const nnPromise = awaitEvent(pc1, 'negotiationneeded', 3000);
                    pc1.restartIce();
                    await nnPromise;
                    pc1.close();
                    pc2.close();
                });

                await it('restartIce() causes fresh ICE credentials in the next offer', async () => {
                    const pc1 = new RTCPeerConnection();
                    const pc2 = new RTCPeerConnection();
                    pc1.onicecandidate = (ev: any) => {
                        if (ev.candidate) pc2.addIceCandidate(ev.candidate).catch(() => {});
                    };
                    pc2.onicecandidate = (ev: any) => {
                        if (ev.candidate) pc1.addIceCandidate(ev.candidate).catch(() => {});
                    };
                    pc1.addTransceiver('audio');

                    // Initial negotiation
                    let offer = await pc1.createOffer();
                    await pc1.setLocalDescription(offer);
                    await pc2.setRemoteDescription(offer);
                    let answer = await pc2.createAnswer();
                    await pc2.setLocalDescription(answer);
                    await pc1.setRemoteDescription(answer);

                    const getUfrags = (sdp: string) =>
                        sdp.split('\r\n').filter(l => l.startsWith('a=ice-ufrag:'));
                    const oldUfrags = getUfrags(pc1.localDescription!.sdp);

                    // Restart and re-negotiate
                    pc1.restartIce();
                    offer = await pc1.createOffer();
                    await pc1.setLocalDescription(offer);
                    await pc2.setRemoteDescription(offer);
                    answer = await pc2.createAnswer();
                    await pc2.setLocalDescription(answer);
                    await pc1.setRemoteDescription(answer);

                    const newUfrags = getUfrags(pc1.localDescription!.sdp);
                    // At least one ufrag should have changed
                    expect(oldUfrags.length).toBeGreaterThan(0);
                    expect(newUfrags.length).toBeGreaterThan(0);
                    expect(newUfrags[0]).not.toBe(oldUfrags[0]);

                    pc1.close();
                    pc2.close();
                });
            }
        });

        await describe('setConfiguration()', async () => {
            if (!webrtcbinReady) {
                await it('(skipped — webrtcbin missing)', async () => {
                    expect(webrtcbinReady).toBeFalsy();
                });
            } else {
                await it('setConfiguration() updates iceServers', async () => {
                    const pc = new RTCPeerConnection();
                    pc.setConfiguration({
                        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
                    });
                    const config = pc.getConfiguration();
                    expect(config.iceServers).toBeDefined();
                    expect(config.iceServers!.length).toBe(1);
                    pc.close();
                });

                await it('setConfiguration() throws on bundlePolicy change', async () => {
                    const pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
                    let threw = false;
                    try {
                        pc.setConfiguration({ bundlePolicy: 'balanced' });
                    } catch (e: any) {
                        threw = true;
                        expect(e.message).toContain('bundlePolicy');
                    }
                    expect(threw).toBeTruthy();
                    pc.close();
                });

                await it('setConfiguration() on closed connection throws', async () => {
                    const pc = new RTCPeerConnection();
                    pc.close();
                    let threw = false;
                    try {
                        pc.setConfiguration({});
                    } catch (e: any) {
                        threw = true;
                        expect(e.message).toContain('closed');
                    }
                    expect(threw).toBeTruthy();
                });
            }
        });

        // ---- enumerateDevices / getSupportedConstraints (Phase 4.3) --------
        // Ported from refs/wpt/mediacapture-streams/MediaDevices-enumerateDevices.https.html
        // and refs/wpt/mediacapture-streams/MediaDevices-getSupportedConstraints.https.html

        await describe('MediaDevices', async () => {
            await it('enumerateDevices() returns an array', async () => {
                const md = new MediaDevices();
                const devices = await md.enumerateDevices();
                expect(Array.isArray(devices)).toBeTruthy();
            });

            await it('enumerateDevices() returns devices with valid kind', async () => {
                const md = new MediaDevices();
                const devices = await md.enumerateDevices();
                const validKinds = ['audioinput', 'audiooutput', 'videoinput'];
                for (const device of devices) {
                    expect(validKinds).toContain(device.kind);
                }
            });

            await it('enumerateDevices() devices have toJSON()', async () => {
                const md = new MediaDevices();
                const devices = await md.enumerateDevices();
                for (const device of devices) {
                    const json = device.toJSON() as any;
                    expect(typeof json.kind).toBe('string');
                    expect(typeof json.deviceId).toBe('string');
                    expect(typeof json.label).toBe('string');
                    expect(typeof json.groupId).toBe('string');
                }
            });

            await it('enumerateDevices() sorted: audioinput, videoinput, audiooutput', async () => {
                const md = new MediaDevices();
                const devices = await md.enumerateDevices();
                const order: Record<string, number> = { audioinput: 0, videoinput: 1, audiooutput: 2 };
                for (let i = 1; i < devices.length; i++) {
                    expect(order[devices[i].kind]).not.toBeLessThan(order[devices[i - 1].kind]);
                }
            });

            await it('getSupportedConstraints() returns an object with boolean values', async () => {
                const md = new MediaDevices();
                const supported = md.getSupportedConstraints();
                expect(typeof supported).toBe('object');
                // At least deviceId, width, height should be supported
                expect(supported.deviceId).toBeTruthy();
                expect(supported.width).toBeTruthy();
                expect(supported.height).toBeTruthy();
                expect(supported.frameRate).toBeTruthy();
                expect(supported.sampleRate).toBeTruthy();
                expect(supported.channelCount).toBeTruthy();
            });

            await it('getSupportedConstraints() has boolean-only values', async () => {
                const md = new MediaDevices();
                const supported = md.getSupportedConstraints();
                for (const value of Object.values(supported)) {
                    expect(typeof value).toBe('boolean');
                }
            });
        });

        // ---- Transport objects (Phase 4.5) ---------------------------------
        // Ported from refs/wpt/webrtc/RTCDtlsTransport-state.html,
        // RTCSctpTransport-constructor.html, RTCIceTransport.html

        await describe('Transport objects', async () => {
            if (!webrtcbinReady || !ASYNC_SIGNALS_WORK) {
                await it('(skipped — webrtcbin/nicesrc missing)', async () => {
                    expect(webrtcbinReady).toBeFalsy();
                });
            } else {
                await it('pc.sctp is null before data channel negotiation', async () => {
                    const pc = new RTCPeerConnection();
                    expect(pc.sctp).toBeNull();
                    pc.close();
                });

                await it('pc.sctp is non-null after createDataChannel', async () => {
                    const pc = new RTCPeerConnection();
                    pc.createDataChannel('test');
                    expect(pc.sctp).toBeDefined();
                    expect(pc.sctp).not.toBeNull();
                    pc.close();
                });

                await it('sctp.transport is an RTCDtlsTransport', async () => {
                    const pc = new RTCPeerConnection();
                    pc.createDataChannel('test');
                    const sctp = pc.sctp!;
                    expect(sctp.transport).toBeDefined();
                    expect(sctp.transport instanceof RTCDtlsTransport).toBeTruthy();
                    pc.close();
                });

                await it('sctp.transport.iceTransport is an RTCIceTransport', async () => {
                    const pc = new RTCPeerConnection();
                    pc.createDataChannel('test');
                    const sctp = pc.sctp!;
                    expect(sctp.transport.iceTransport).toBeDefined();
                    expect(sctp.transport.iceTransport instanceof RTCIceTransport).toBeTruthy();
                    pc.close();
                });

                await it('sctp.state starts as connecting', async () => {
                    const pc = new RTCPeerConnection();
                    pc.createDataChannel('test');
                    expect(pc.sctp!.state).toBe('connecting');
                    pc.close();
                });

                await it('sctp.maxMessageSize is a number', async () => {
                    const pc = new RTCPeerConnection();
                    pc.createDataChannel('test');
                    expect(typeof pc.sctp!.maxMessageSize).toBe('number');
                    expect(pc.sctp!.maxMessageSize).toBeGreaterThan(0);
                    pc.close();
                });

                await it('sender.transport is the same as receiver.transport', async () => {
                    const pc = new RTCPeerConnection();
                    const tc = pc.addTransceiver('audio');
                    expect(tc.sender.transport).toBeDefined();
                    expect(tc.sender.transport).toBe(tc.receiver.transport);
                    pc.close();
                });

                await it('sender.transport is an RTCDtlsTransport', async () => {
                    const pc = new RTCPeerConnection();
                    const tc = pc.addTransceiver('audio');
                    expect(tc.sender.transport instanceof RTCDtlsTransport).toBeTruthy();
                    pc.close();
                });

                await it('DTLS transport starts in new state', async () => {
                    const pc = new RTCPeerConnection();
                    const tc = pc.addTransceiver('audio');
                    expect(tc.sender.transport!.state).toBe('new');
                    pc.close();
                });

                await it('ICE transport starts in new state', async () => {
                    const pc = new RTCPeerConnection();
                    const tc = pc.addTransceiver('audio');
                    expect(tc.sender.transport!.iceTransport.state).toBe('new');
                    expect(tc.sender.transport!.iceTransport.gatheringState).toBe('new');
                    pc.close();
                });

                await it('DTLS transport goes to closed on pc.close()', async () => {
                    const pc = new RTCPeerConnection();
                    const tc = pc.addTransceiver('audio');
                    const dtls = tc.sender.transport!;
                    pc.close();
                    // close() is async via idle_add — wait a tick
                    await new Promise(r => setTimeout(r, 100));
                    expect(dtls.state).toBe('closed');
                });

                await it('all transceivers share the same DTLS transport (max-bundle)', async () => {
                    const pc = new RTCPeerConnection();
                    const tc1 = pc.addTransceiver('audio');
                    const tc2 = pc.addTransceiver('video');
                    expect(tc1.sender.transport).toBe(tc2.sender.transport);
                    expect(tc1.receiver.transport).toBe(tc2.receiver.transport);
                    pc.close();
                });
            }
        });
    });
};
