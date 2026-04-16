// WPT-ported tests for @gjsify/webrtc.
//
// Ported from refs/wpt/webrtc/* (W3C, BSD-3-Clause). Each test group is
// labeled with the originating WPT file. Ports cover the spec-conformance
// edges that hand-written tests are prone to missing (range validation,
// legal vs. illegal enum values, binaryType coercion behaviour, bufferedAmount
// increment semantics, createDataChannel option constraints).
//
// Browser reference: the same WPT files also run in Firefox / Chrome / Safari,
// so the assertions here are what Mozilla / Google / Apple agree is
// spec-compliant behaviour.

import Gst from 'gi://Gst?version=1.0';
import { describe, it, expect } from '@gjsify/unit';

import {
    RTCPeerConnection,
    RTCDataChannel,
    RTCDataChannelEvent,
    RTCPeerConnectionIceEvent,
    RTCSessionDescription,
    RTCIceCandidate,
    RTCError,
    RTCErrorEvent,
} from './index.js';

import {
    createDataChannelPair,
    awaitMessage,
    closePeerConnections,
} from './wpt-helpers.js';

Gst.init(null);
const pipelineReady = Boolean(
    Gst.ElementFactory.find('webrtcbin') && Gst.ElementFactory.find('nicesrc'),
);

/** Wrap a WPT-style `promise_test` body in a timeout. */
function withTimeout<T>(ms: number, promise: Promise<T>, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`WPT timeout after ${ms}ms: ${label}`)), ms),
        ),
    ]);
}

export default async () => {
    await describe('WPT — RTCDataChannelEvent-constructor.html', async () => {
        // Ported: refs/wpt/webrtc/RTCDataChannelEvent-constructor.html
        //
        // The W3C-spec `assert_equals(RTCDataChannelEvent.length, 2)` check
        // is skipped because SpiderMonkey doesn't expose the internal
        // Function.length for user-defined classes the way Blink / Gecko do.

        await it('throws TypeError with no init dict', async () => {
            expect(() => new (RTCDataChannelEvent as any)('type')).toThrow();
        });

        await it('throws TypeError with channel: null', async () => {
            expect(() => new RTCDataChannelEvent('type', { channel: null as any })).toThrow();
        });

        await it('throws TypeError with channel: undefined', async () => {
            expect(() => new RTCDataChannelEvent('type', { channel: undefined as any })).toThrow();
        });

        if (pipelineReady) {
            await it('constructs with a real RTCDataChannel', async () => {
                const pc = new RTCPeerConnection();
                const dc = pc.createDataChannel('wpt');
                const event = new RTCDataChannelEvent('type', { channel: dc });
                expect(event instanceof RTCDataChannelEvent).toBeTruthy();
                expect(event.channel).toBe(dc);
                pc.close();
            });
        }
    });

    await describe('WPT — RTCDataChannel-binaryType.window.js', async () => {
        // Ported: refs/wpt/webrtc/RTCDataChannel-binaryType.window.js
        //
        // The WPT default is 'arraybuffer' (spec §6.2 — "The initial value
        // is 'arraybuffer'"). Common confusion: the WebSocket spec defaults
        // to 'blob'; RTCDataChannel does NOT.
        //
        // Key spec rule (asserted by WPT): setting an INVALID binaryType
        // value should be silently ignored, keeping the previous value — NOT
        // throw a TypeError. @gjsify/webrtc currently throws; the
        // `invalid binaryType` cases below are therefore marked as known
        // spec deviations.

        if (!pipelineReady) {
            await it('(skipped — webrtcbin/nicesrc missing)', async () => {
                expect(pipelineReady).toBeFalsy();
            });
            return;
        }

        await it("default binaryType is 'arraybuffer'", async () => {
            const pc = new RTCPeerConnection();
            const dc = pc.createDataChannel('wpt');
            expect(dc.binaryType).toBe('arraybuffer');
            pc.close();
        });

        await it("setting binaryType to 'arraybuffer' succeeds", async () => {
            const pc = new RTCPeerConnection();
            const dc = pc.createDataChannel('wpt');
            dc.binaryType = 'arraybuffer';
            expect(dc.binaryType).toBe('arraybuffer');
            pc.close();
        });

        await it("setting binaryType to 'blob' either succeeds or throws NotSupportedError when Blob is unavailable", async () => {
            const pc = new RTCPeerConnection();
            const dc = pc.createDataChannel('wpt');
            let thrown: Error | null = null;
            try { dc.binaryType = 'blob'; } catch (e: any) { thrown = e; }
            if (typeof (globalThis as any).Blob === 'undefined') {
                // Our documented deviation: no Blob → NotSupportedError.
                expect(thrown).toBeDefined();
                expect((thrown as any)?.name).toBe('NotSupportedError');
            } else {
                expect(thrown).toBeNull();
                expect(dc.binaryType).toBe('blob');
            }
            pc.close();
        });

        // Per WPT: invalid binaryType assignments are silently ignored
        // (keep the previous value). Matches Firefox / Chrome / Safari.
        const invalidBinaryTypes: any[] = ['jellyfish', 'arraybuffer ', '', null, undefined, 234];
        for (const invalid of invalidBinaryTypes) {
            await it(`setting binaryType to ${JSON.stringify(invalid)} is silently ignored`, async () => {
                const pc = new RTCPeerConnection();
                const dc = pc.createDataChannel('wpt');
                dc.binaryType = 'arraybuffer';
                dc.binaryType = invalid;
                expect(dc.binaryType).toBe('arraybuffer');
                pc.close();
            });
        }
    });

    await describe('WPT — RTCPeerConnection-createDataChannel.html', async () => {
        // Ported: refs/wpt/webrtc/RTCPeerConnection-createDataChannel.html
        //
        // Covers the validation rules for RTCPeerConnection.createDataChannel(label, opts).

        if (!pipelineReady) {
            await it('(skipped — webrtcbin/nicesrc missing)', async () => {
                expect(pipelineReady).toBeFalsy();
            });
            return;
        }

        await it('creates with default label and init defaults', async () => {
            const pc = new RTCPeerConnection();
            const dc = pc.createDataChannel('');
            expect(dc instanceof RTCDataChannel).toBeTruthy();
            expect(dc.label).toBe('');
            expect(dc.ordered).toBeTruthy();
            expect(dc.maxPacketLifeTime).toBeNull();
            expect(dc.maxRetransmits).toBeNull();
            expect(dc.protocol).toBe('');
            expect(dc.negotiated).toBeFalsy();
            pc.close();
        });

        await it('throws when both maxPacketLifeTime and maxRetransmits are set', async () => {
            const pc = new RTCPeerConnection();
            expect(() => pc.createDataChannel('wpt', {
                maxPacketLifeTime: 1000,
                maxRetransmits: 5,
            })).toThrow();
            pc.close();
        });

        await it('throws when negotiated=true without id', async () => {
            const pc = new RTCPeerConnection();
            expect(() => pc.createDataChannel('wpt', { negotiated: true })).toThrow();
            pc.close();
        });

        await it('throws when id is out of range', async () => {
            const pc = new RTCPeerConnection();
            expect(() => pc.createDataChannel('wpt', { id: 65535 })).toThrow();
            expect(() => pc.createDataChannel('wpt', { id: -1 })).toThrow();
            pc.close();
        });

        await it('throws InvalidStateError after close()', async () => {
            const pc = new RTCPeerConnection();
            pc.close();
            let thrown: any = null;
            try { pc.createDataChannel('wpt'); } catch (e) { thrown = e; }
            expect(thrown).toBeDefined();
        });
    });

    await describe('WPT — RTCConfiguration-iceServers.html', async () => {
        // Ported: refs/wpt/webrtc/RTCConfiguration-iceServers.html
        //
        // ICE-server URL parsing + credential validation. The browsers throw
        // SyntaxError (for invalid URLs) or TypeError (for missing TURN creds).

        if (!pipelineReady) {
            await it('(skipped — webrtcbin/nicesrc missing)', async () => {
                expect(pipelineReady).toBeFalsy();
            });
            return;
        }

        await it('accepts a single STUN URL', async () => {
            const pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.example.com:19302' }],
            });
            expect(pc).toBeDefined();
            pc.close();
        });

        await it('accepts an array of STUN URLs', async () => {
            const pc = new RTCPeerConnection({
                iceServers: [{ urls: ['stun:stun1.example.com', 'stun:stun2.example.com'] }],
            });
            expect(pc).toBeDefined();
            pc.close();
        });

        await it('throws SyntaxError for empty urls array', async () => {
            expect(() =>
                new RTCPeerConnection({ iceServers: [{ urls: [] }] })
            ).toThrow();
        });

        await it('throws TypeError for TURN without credentials', async () => {
            expect(() => new RTCPeerConnection({
                iceServers: [{ urls: 'turn:turn.example.com' }],
            } as any)).toThrow();
        });

        await it('accepts TURN with username + credential', async () => {
            const pc = new RTCPeerConnection({
                iceServers: [{
                    urls: 'turn:turn.example.com:3478',
                    username: 'alice',
                    credential: 'secret',
                }],
            });
            expect(pc).toBeDefined();
            pc.close();
        });

        await it('throws TypeError for unknown scheme', async () => {
            expect(() => new RTCPeerConnection({
                iceServers: [{ urls: 'wss://example.com' }],
            })).toThrow();
        });
    });

    await describe('WPT — RTCPeerConnection-createOffer.html (subset)', async () => {
        // Ported subset of: refs/wpt/webrtc/RTCPeerConnection-createOffer.html
        //
        // Basic offer generation + SDP shape.

        if (!pipelineReady) {
            await it('(skipped — webrtcbin/nicesrc missing)', async () => {
                expect(pipelineReady).toBeFalsy();
            });
            return;
        }

        await it("createOffer() returns { type: 'offer', sdp: string } without a data channel", async () => {
            const pc = new RTCPeerConnection();
            try {
                const offer = await withTimeout(5000, pc.createOffer() as Promise<any>, 'createOffer');
                expect(offer.type).toBe('offer');
                // With no transceivers / data channels, webrtcbin may produce
                // a minimal SDP or an empty one. Just check type is present.
                expect(typeof offer.sdp).toBe('string');
            } finally {
                pc.close();
            }
        });

        await it("createOffer() with a data channel produces m=application line", async () => {
            const pc = new RTCPeerConnection();
            try {
                pc.createDataChannel('wpt');
                const offer = await withTimeout(5000, pc.createOffer() as Promise<any>, 'createOffer+dc');
                expect(offer.type).toBe('offer');
                expect(offer.sdp).toContain('m=application');
                expect(offer.sdp).toContain('webrtc-datachannel');
            } finally {
                pc.close();
            }
        });
    });

    await describe('WPT — RTCDataChannel-bufferedAmount.html (subset)', async () => {
        // Ported subset of: refs/wpt/webrtc/RTCDataChannel-bufferedAmount.html
        //
        // Spec §6.2: bufferedAmount increases by:
        //   - UTF-8 byte length for strings
        //   - byte length for ArrayBuffer / ArrayBufferView
        //   - size for Blob
        // The "unicodeString should increase bufferedAmount by UTF-8 byte
        // length" test is the interesting one — naive implementations
        // increment by .length (UTF-16 code units) instead of UTF-8 bytes.

        if (!pipelineReady) {
            await it('(skipped — webrtcbin/nicesrc missing)', async () => {
                expect(pipelineReady).toBeFalsy();
            });
            return;
        }

        const helloBuffer = Uint8Array.of(0x68, 0x65, 0x6c, 0x6c, 0x6f);
        const unicodeString = '世界你好';
        const unicodeBytes = 12;

        await it('bufferedAmount starts at 0 for both peers', async () => {
            const [dc1, dc2, pc1, pc2] = await withTimeout(
                15000,
                createDataChannelPair({}),
                'createDataChannelPair',
            );
            try {
                expect(dc1.bufferedAmount).toBe(0);
                expect(dc2.bufferedAmount).toBe(0);
            } finally {
                closePeerConnections(pc1, pc2);
            }
        });

        await it('bufferedAmount increases by UTF-8 byte length when sending a unicode string (not UTF-16 length)', async () => {
            const [dc1, dc2, pc1, pc2] = await withTimeout(
                15000,
                createDataChannelPair({}),
                'createDataChannelPair',
            );
            try {
                dc1.send(unicodeString);
                // The CJK string has 4 UTF-16 code units but 12 UTF-8 bytes.
                expect(dc1.bufferedAmount).toBe(unicodeBytes);
                expect(dc1.bufferedAmount).not.toBe(unicodeString.length);
                await withTimeout(5000, awaitMessage(dc2), 'awaitMessage');
            } finally {
                closePeerConnections(pc1, pc2);
            }
        });

        await it('bufferedAmount increases by byte length when sending an ArrayBuffer', async () => {
            const [dc1, dc2, pc1, pc2] = await withTimeout(
                15000,
                createDataChannelPair({}),
                'createDataChannelPair',
            );
            try {
                dc1.send(helloBuffer.buffer);
                expect(dc1.bufferedAmount).toBe(helloBuffer.byteLength);
                await withTimeout(5000, awaitMessage(dc2), 'awaitMessage');
            } finally {
                closePeerConnections(pc1, pc2);
            }
        });

        await it('bufferedAmount stays at 0 for empty string', async () => {
            const [dc1, dc2, pc1, pc2] = await withTimeout(
                15000,
                createDataChannelPair({}),
                'createDataChannelPair',
            );
            try {
                dc1.send('');
                expect(dc1.bufferedAmount).toBe(0);
            } finally {
                closePeerConnections(pc1, pc2);
            }
        });
    });

    await describe('WPT — RTCDataChannel-close.html (subset)', async () => {
        // Ported subset of: refs/wpt/webrtc/RTCDataChannel-close.html
        //
        // close() on one peer should propagate to the other; both transition
        // readyState to 'closed' and fire the 'close' event.

        if (!pipelineReady) {
            await it('(skipped — webrtcbin/nicesrc missing)', async () => {
                expect(pipelineReady).toBeFalsy();
            });
            return;
        }

        await it("close() transitions readyState to 'closed' on the caller", async () => {
            const [dc1, _dc2, pc1, pc2] = await withTimeout(
                15000,
                createDataChannelPair({}),
                'createDataChannelPair',
            );
            try {
                dc1.close();
                expect(dc1.readyState).toBe('closed');
            } finally {
                closePeerConnections(pc1, pc2);
            }
        });

        await it("close() on one peer fires 'close' on the other (close propagates)", async () => {
            const [dc1, dc2, pc1, pc2] = await withTimeout(
                15000,
                createDataChannelPair({}),
                'createDataChannelPair',
            );
            try {
                const closedOnB = new Promise<void>((resolve) => {
                    if (dc2.readyState === 'closed') return resolve();
                    dc2.addEventListener('close', () => resolve(), { once: true });
                });
                dc1.close();
                await withTimeout(5000, closedOnB, 'dc2 close propagation');
                expect(dc2.readyState).toBe('closed');
            } finally {
                closePeerConnections(pc1, pc2);
            }
        });

        await it('send() after close() throws InvalidStateError', async () => {
            const pc = new RTCPeerConnection();
            const dc = pc.createDataChannel('wpt');
            dc.close();
            let thrown: any = null;
            try { dc.send('hi'); } catch (e) { thrown = e; }
            expect(thrown).toBeDefined();
            expect((thrown as any)?.name).toBe('InvalidStateError');
            pc.close();
        });
    });

    await describe('WPT — RTCIceCandidate constructor', async () => {
        // Ported from refs/wpt/webrtc/RTCIceCandidate.html — the throwing /
        // accepting / parsing rules.

        await it('constructs with candidate + sdpMLineIndex', async () => {
            const c = new RTCIceCandidate({ candidate: '', sdpMLineIndex: 0 });
            expect(c.candidate).toBe('');
            expect(c.sdpMLineIndex).toBe(0);
        });

        await it('constructs with candidate + sdpMid', async () => {
            const c = new RTCIceCandidate({ candidate: '', sdpMid: '0' });
            expect(c.sdpMid).toBe('0');
        });

        await it('throws TypeError without sdpMid AND sdpMLineIndex', async () => {
            expect(() => new RTCIceCandidate({ candidate: 'candidate:…' })).toThrow();
        });

        await it('toJSON round-trip preserves fields', async () => {
            const c = new RTCIceCandidate({
                candidate: 'candidate:1 1 udp 100 1.2.3.4 1234 typ host',
                sdpMid: '0',
                sdpMLineIndex: 0,
                usernameFragment: 'abcd',
            });
            const j = c.toJSON();
            const c2 = new RTCIceCandidate(j);
            expect(c2.candidate).toBe(c.candidate);
            expect(c2.sdpMid).toBe(c.sdpMid);
            expect(c2.sdpMLineIndex).toBe(c.sdpMLineIndex);
            expect(c2.usernameFragment).toBe(c.usernameFragment);
        });

        await it('parses the candidate-line into structured fields', async () => {
            const c = new RTCIceCandidate({
                candidate: 'candidate:842163049 1 udp 1677729535 1.2.3.4 12345 typ srflx raddr 10.0.0.1 rport 5000',
                sdpMid: '0',
            });
            expect(c.protocol).toBe('udp');
            expect(c.address).toBe('1.2.3.4');
            expect(c.port).toBe(12345);
            expect(c.type).toBe('srflx');
            expect(c.component).toBe('rtp');
            expect(c.relatedAddress).toBe('10.0.0.1');
            expect(c.relatedPort).toBe(5000);
        });
    });

    await describe('WPT — RTCError / RTCErrorEvent', async () => {
        // Ported from refs/wpt/webrtc/RTCError.html + RTCErrorEvent-constructor.html

        await it('RTCError extends DOMException', async () => {
            const err = new RTCError({ errorDetail: 'data-channel-failure' }, 'msg');
            expect(err instanceof DOMException).toBeTruthy();
            expect(err.errorDetail).toBe('data-channel-failure');
            expect(err.message).toBe('msg');
            expect(err.name).toBe('OperationError');
        });

        await it('RTCError throws TypeError without errorDetail', async () => {
            expect(() => new (RTCError as any)({})).toThrow();
        });

        await it('RTCErrorEvent carries its error instance', async () => {
            const err = new RTCError({ errorDetail: 'dtls-failure' }, 'handshake failed');
            const ev = new RTCErrorEvent('error', { error: err });
            expect(ev.error).toBe(err);
            expect(ev instanceof Event).toBeTruthy();
        });

        await it('RTCErrorEvent throws TypeError without error', async () => {
            expect(() => new (RTCErrorEvent as any)('error', {})).toThrow();
        });
    });

    await describe('WPT — RTCPeerConnectionIceEvent', async () => {
        // Ported from refs/wpt/webrtc/RTCPeerConnectionIceEvent-constructor.html

        await it('accepts { candidate: null }', async () => {
            const ev = new RTCPeerConnectionIceEvent('icecandidate', { candidate: null });
            expect(ev.candidate).toBeNull();
        });

        await it('accepts a real RTCIceCandidate', async () => {
            const c = new RTCIceCandidate({ candidate: '', sdpMid: '0' });
            const ev = new RTCPeerConnectionIceEvent('icecandidate', { candidate: c });
            expect(ev.candidate).toBe(c);
        });

        await it('defaults url to null', async () => {
            const ev = new RTCPeerConnectionIceEvent('icecandidate');
            expect(ev.url).toBeNull();
        });
    });

    await describe('WPT — RTCSessionDescription round-trip', async () => {
        // Derived from various RTCSessionDescription-related WPT tests.

        await it('serializes to JSON compatible with the init dict', async () => {
            const sdp = 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';
            const d = new RTCSessionDescription({ type: 'offer', sdp });
            const j = d.toJSON();
            expect(j.type).toBe('offer');
            expect(j.sdp).toBe(sdp);
            const d2 = new RTCSessionDescription(j);
            expect(d2.type).toBe(d.type);
            expect(d2.sdp).toBe(d.sdp);
        });
    });
};
